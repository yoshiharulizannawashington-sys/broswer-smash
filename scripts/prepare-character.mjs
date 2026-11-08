#!/usr/bin/env node
// One command from any character model file to a registered, playable character body.
//
//   node scripts/prepare-character.mjs --file <model> [--name "Display"] [--archetype warrior]
//        [--source-rig <rigged.glb>] [--bones <mapping.json>] [--height 1.8] [--no-autorig]
//
// Pipeline, each stage reporting what it actually did:
//   1. format: GLB/GLTF/VRM load directly; FBX/OBJ/BLEND convert to GLB through Blender
//   2. inspect: meshes, materials, textures, skins, joints, clips, triangles
//   3. rig state: already-rigged, unfamiliar bone names, partial skeleton, or unrigged
//        · VRM humanoid metadata is used directly when present (exact bone map, no guessing)
//        · unrigged humanoid meshes get a generated 19-bone rig with validated skin weights
//        · skeletons the classifier cannot resolve stop with a correction template, never a
//          silently broken character
//   4. animation: source clips claimed for the seven game states; when a state has no clip (or the
//      model has no clips at all) rotations are retargeted from a reference rig in Blender
//   5. ingest + technical inspection + registration (manifest, roster, moveset, abilities)
//
// Licence metadata is copied when a sidecar has it. It is informational and gates nothing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const sourcePath = arg('file');
if (!sourcePath) {
  console.error('usage: node scripts/prepare-character.mjs --file <model> [--name "Display Name"] [--archetype warrior]');
  process.exit(1);
}
const ABS_SOURCE = resolve(root, sourcePath);
if (!existsSync(ABS_SOURCE)) {
  console.error(`Source not found: ${ABS_SOURCE}`);
  process.exit(1);
}
const name = arg('name', basename(ABS_SOURCE, extname(ABS_SOURCE)));
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'imported_character';
const archetype = arg('archetype', 'warrior');
const targetHeight = Number(arg('height', 1.8));
const allowAutorig = !args.includes('--no-autorig');
const defaultRig = resolve(root, 'artifacts/dev/source/poly-quaternius-character.glb');
const sourceRig = arg('source-rig', existsSync(defaultRig) ? defaultRig : null);
const work = resolve(root, 'artifacts/dev/prepare', slug);
mkdirSync(work, { recursive: true });

const steps = [];
const step = (label, detail) => {
  steps.push({ label, detail });
  console.log(`[${label}] ${detail}`);
};

const blender = (command, rest) => {
  const out = execFileSync('bash', ['scripts/blender.sh', '-b', '--python', 'scripts/blender_tools.py', '--', command, ...rest],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  const line = out.split('\n').filter(l => l.startsWith('RESULT:')).pop();
  if (!line) throw new Error(`Blender ${command} produced no RESULT line`);
  const result = JSON.parse(line.slice(7));
  if (!result.ok) throw new Error(`Blender ${command}: ${result.error}`);
  return result;
};

const readGlb = path => {
  const buffer = readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));
  return { buffer, json };
};

const trianglesOf = json => (json.meshes || []).reduce((total, mesh) => total
  + mesh.primitives.reduce((sum, primitive) => {
    const accessor = json.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
    return sum + Math.floor((accessor?.count || 0) / (primitive.indices === undefined ? 3 : 3));
  }, 0), 0);

// ------------------------------------------------------------------ 1. format
const EXT = extname(ABS_SOURCE).toLowerCase();
let glbPath = ABS_SOURCE;
let convertedFrom = null;
if (['.glb', '.gltf', '.vrm'].includes(EXT)) {
  step('format', `${EXT} imported directly${EXT === '.vrm' ? ' (VRM is glTF plus humanoid metadata)' : ''}`);
} else {
  const out = join(work, `${slug}-converted.glb`);
  try {
    const result = blender('convert', [ABS_SOURCE, out]);
    glbPath = out;
    convertedFrom = EXT;
    step('format', `${EXT} → GLB via Blender (${result.meshes} mesh(es), ${result.armatures} armature(s), ${result.images.length} image(s))`);
  } catch (error) {
    console.error(`PREPARE STOPPED: ${EXT} could not be converted to GLB.\n  ${error.message}\n  Source untouched at ${ABS_SOURCE}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ 2. inspect
let { json } = readGlb(glbPath);
let clipNames = (json.animations || []).map(a => a.name).filter(Boolean);
let textures = (json.textures || []).length;
let skinJoints = (json.skins || []).reduce((n, skin) => n + (skin.joints || []).length, 0);
step('inspect', `${(json.meshes || []).length} mesh(es), ${(json.materials || []).length} material(s), ${textures} texture(s), `
  + `${(json.skins || []).length} skin(s) with ${skinJoints} joint(s), ${clipNames.length} clip(s)`);

// ------------------------------------------------------------------ 3. rig state
const TARGET = {
  pelvis: 'Hips', spine: 'Spine', torso: 'Chest', neck: 'Neck', head: 'Head',
  leftClavicle: 'LeftShoulder', rightClavicle: 'RightShoulder',
  leftArm: 'LeftArm', leftFore: 'LeftForeArm', leftHand: 'LeftHand',
  rightArm: 'RightArm', rightFore: 'RightForeArm', rightHand: 'RightHand',
  leftLeg: 'LeftUpLeg', leftShin: 'LeftLeg', leftFoot: 'LeftFoot',
  rightLeg: 'RightUpLeg', rightShin: 'RightLeg', rightFoot: 'RightFoot'
};
const strip = raw => String(raw || '').toLowerCase()
  .replace(/^mixamorig:?/, '')
  .replace(/[\s._:()\-]/g, '')
  .replace(/\d+/g, '');
const sideOf = key => (key.includes('left') ? 'left'
  : key.includes('right') ? 'right'
  : key.endsWith('l') ? 'left'
  : key.endsWith('r') ? 'right'
  : null);
const sideSlot = key => {
  if (/finger|thumb|index|middle|ring|pinky/.test(key)) return null;
  if (/hand|wrist|palm/.test(key)) return 'Hand';
  if (/forearm|lowerarm|elbow/.test(key)) return 'Fore';
  if (/clavicle|shoulder/.test(key)) return 'Clavicle';
  if (/upperarm|arm/.test(key)) return 'Arm';
  if (/upleg|thigh|upperleg/.test(key)) return 'Leg';
  if (/shin|calf|lowerleg|knee|leg/.test(key)) return 'Shin';
  if (/foot|ankle|toe/.test(key)) return 'Foot';
  return null;
};

const mapBones = nodeNames => {
  const boneMap = {};
  const taken = new Set();
  let spineSeen = 0;
  for (const sourceName of nodeNames) {
    const key = strip(sourceName);
    if (!key) continue;
    let canonical = null;
    if (/neck/.test(key)) canonical = 'neck';
    else if (/head/.test(key)) canonical = 'head';
    else if (/hips|pelvis/.test(key)) canonical = 'pelvis';
    else if (/spine/.test(key)) { spineSeen++; canonical = spineSeen === 1 ? 'spine' : 'torso'; }
    else if (/chest|torso|abdomen|ribcage/.test(key)) canonical = 'torso';
    else {
      const side = sideOf(key);
      const slot = sideSlot(key);
      if (side && slot) canonical = side + slot;
    }
    const target = canonical ? TARGET[canonical] : null;
    if (!target || taken.has(target)) continue;
    taken.add(target);
    boneMap[sourceName] = target;
  }
  return boneMap;
};

// VRM declares its humanoid bones, so use that instead of guessing from names.
const vrmHumanoid = () => {
  const vrm = json.extensions?.VRM?.humanoid?.humanBones;
  if (!vrm) return null;
  const roleToTarget = {
    hips: 'Hips', spine: 'Spine', chest: 'Chest', upperChest: 'Chest', neck: 'Neck', head: 'Head',
    leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
    rightShoulder: 'RightShoulder', rightUpperArm: 'RightArm', rightLowerArm: 'RightForeArm', rightHand: 'RightHand',
    leftUpperLeg: 'LeftUpLeg', leftLowerLeg: 'LeftLeg', leftFoot: 'LeftFoot',
    rightUpperLeg: 'RightUpLeg', rightLowerLeg: 'RightLeg', rightFoot: 'RightFoot'
  };
  const entries = Array.isArray(vrm) ? vrm.map(v => [v.bone, v.node]) : Object.entries(vrm).map(([role, v]) => [role, v.node]);
  const boneMap = {};
  const taken = new Set();
  for (const [role, nodeIndex] of entries) {
    const target = roleToTarget[role];
    const nodeName = json.nodes?.[nodeIndex]?.name;
    if (!target || !nodeName || taken.has(target)) continue;
    taken.add(target);
    boneMap[nodeName] = target;
  }
  return Object.keys(boneMap).length >= 12 ? boneMap : null;
};

let nodeNames = (json.nodes || []).map(node => node.name).filter(Boolean);
let boneMap = vrmHumanoid() || mapBones(nodeNames);
let rigState = 'rigged';
let autoRigReport = null;

if (vrmHumanoid()) step('rig', `VRM humanoid metadata: ${Object.keys(boneMap).length} bones mapped exactly`);

if (!(json.skins || []).length) {
  // No skeleton at all: build one, then weight the mesh to it.
  rigState = 'unrigged';
  step('rig', `no skin in source — ${allowAutorig ? 'generating a humanoid rig' : 'auto-rig disabled'}`);
  if (!allowAutorig) {
    console.error('PREPARE STOPPED: the model has no skeleton and --no-autorig was requested.');
    process.exit(1);
  }
  const autoOut = join(work, `${slug}-autorig.glb`);
  try {
    autoRigReport = blender('autorig', [glbPath, autoOut]);
  } catch (error) {
    console.error(`PREPARE STOPPED: auto-rig failed.\n  ${error.message}`);
    process.exit(1);
  }
  glbPath = autoOut;
  ({ json } = readGlb(glbPath));
  clipNames = (json.animations || []).map(a => a.name).filter(Boolean);
  nodeNames = (json.nodes || []).map(node => node.name).filter(Boolean);
  boneMap = mapBones(nodeNames);
  rigState = 'auto-rigged';
  step('rig', `generated ${autoRigReport.bones} bones, ${autoRigReport.verticesWeighted} vertices weighted`
    + `${autoRigReport.unweightedBones.length ? `, unweighted: ${autoRigReport.unweightedBones.join(',')}` : ', every bone weighted'}`);
} else {
  const mapped = Object.keys(boneMap).length;
  step('rig', `${skinJoints} source joints, ${mapped} classified as humanoid`);
  if (mapped < 12) {
    rigState = 'unfamiliar';
    const override = arg('bones');
    if (override) {
      boneMap = JSON.parse(readFileSync(resolve(root, override), 'utf8'));
      step('rig', `bone map supplied: ${Object.keys(boneMap).length} entries`);
    } else {
      // Correction workflow rather than a broken character.
      const template = join(root, 'assets/ingest', `${slug}.bones.template.json`);
      const slots = [...new Set(Object.values(TARGET))].sort();
      mkdirSync(resolve(root, 'assets/ingest'), { recursive: true });
      writeFileSync(template, JSON.stringify({
        note: 'Fill these in as "<bone name from your file>": "<target slot>" and re-run with --bones <this file>.',
        sourceNodes: nodeNames,
        targetSlots: slots,
        boneMap: {}
      }, null, 2) + '\n');
      console.error(`PREPARE STOPPED: only ${mapped}/19 humanoid bones could be identified in ${basename(glbPath)}.\n`
        + `  Template written to ${template.replace(root + '/', '')}.\n`
        + '  Fill boneMap with your file\'s bone names against the target slots, then re-run:\n'
        + `  node scripts/prepare-character.mjs --file ${sourcePath} --name "${name}" --bones ${template.replace(root + '/', '')}`);
      process.exit(1);
    }
  }
}

// ------------------------------------------------------------------ 4. animation
const rules = [
  ['Idle', /idle_loop|^idle$|breathing|fight_idle/i],
  ['Walk', /walk(?!_back)|walking/i],
  ['Run', /run_loop|^run$|jog|sprint/i],
  ['Jump', /jump|leap/i],
  ['Punch', /punch|punching|attack(?!_sword)|sword_slash|slash/i],
  ['Kick', /kick/i],
  ['Kamehameha', /cast|spell|throw|shoot|fire|magic|beam|charge/i]
];
const claimClips = names => {
  const clipMap = {};
  const notes = {};
  const used = new Set();
  // A rest/bind pose exported as a clip ("TPose", "BindPose") is not animation. Mapping it to a game
  // state is how a nicely rigged import ends up standing frozen in a T while every structural check
  // passes, so those clips are dropped before any state claims them and the drop is reported.
  const excluded = names.filter(clip => /(^|[^a-z])t[-_ ]?pose|bind[-_ ]?pose|rest[-_ ]?pose/i.test(clip));
  const usableNames = excluded.length ? names.filter(clip => !excluded.includes(clip)) : names;
  if (excluded.length) {
    console.log(`[clips] excluded ${excluded.length} static rest-pose clip(s): ${excluded.join(', ')}`);
  }
  for (const [state, pattern] of rules) {
    const freshest = usableNames.find(clip => !used.has(clip) && pattern.test(clip)) || usableNames.find(clip => !used.has(clip));
    if (freshest) {
      clipMap[state] = freshest;
      used.add(freshest);
      notes[state] = pattern.test(freshest)
        ? `source clip "${freshest}"`
        : `SUBSTITUTE: no ${state.toLowerCase()} clip in source; "${freshest}" used`;
      continue;
    }
    // Three-clip models still have to produce seven game states: reuse a clip and say so.
    const reuse = usableNames.find(clip => pattern.test(clip)) || usableNames[0];
    if (reuse) {
      clipMap[state] = reuse;
      notes[state] = `SUBSTITUTE: rehearsal of "${reuse}" for ${state.toLowerCase()}`;
    }
  }
  return { clipMap, notes };
};

let { clipMap, notes: clipNotes } = claimClips(clipNames);
let substitutions = Object.entries(clipNotes).filter(([, n]) => n.startsWith('SUBSTITUTE'));
let retargeted = false;

// Retarget only when there is nothing to animate with. A model that already has clips keeps its own
// motion: replacing real animation with a bake is how an imported body ends up posed but frozen.
// `--retarget` forces a rebake when a specific model needs it.
const forceRetarget = args.includes('--retarget');
if (!clipNames.length || forceRetarget) {
  if (!sourceRig) {
    console.error(`PREPARE STOPPED: ${substitutions.length ? `${substitutions.length} state(s) have no matching clip` : 'the model has no clips'} and no reference rig was supplied.\n`
      + '  Pass --source-rig <rigged.glb> with a humanoid skeleton and clips to retarget from.');
    process.exit(1);
  }
  const retargetOut = join(work, `${slug}-retargeted.glb`);
  step('animate', `retargeting from ${basename(sourceRig)} (${substitutions.map(([s]) => s).join(', ') || 'no clips in source'})`);
  try {
    // Rest-relative transfer (retarget2), not the world-space copy: COPY_ROTATION-style world
    // baking forces the target into the donor's T-pose and throws away its own rest pose, which is
    // how a prepared body ended up permanently holding its arms out.
    const result = blender('retarget2', [glbPath, resolve(root, sourceRig), retargetOut]);
    glbPath = retargetOut;
    retargeted = true;
    ({ json } = readGlb(glbPath));
    clipNames = (json.animations || []).map(a => a.name).filter(Boolean);
    const retargetedStates = Object.keys(result.baked || {});
    step('animate', `baked ${retargetedStates.join(', ')} onto ${result.pairs} bone pairs`);
  } catch (error) {
    console.error(`PREPARE STOPPED: retargeting failed.\n  ${error.message}`);
    process.exit(1);
  }
  ({ clipMap, notes: clipNotes } = claimClips(clipNames));
  substitutions = Object.entries(clipNotes).filter(([, n]) => n.startsWith('SUBSTITUTE'));
  if (Object.keys(clipMap).length < 7) {
    console.error(`PREPARE STOPPED: after retargeting only ${Object.keys(clipMap).length}/7 states could be mapped (${clipNames.join(', ')}).`);
    process.exit(1);
  }
  step('animate', `states: ${Object.entries(clipMap).map(([s, c]) => `${s}=${c}`).join(', ')}`);
}

// ------------------------------------------------------------------ 5. profile + ingest
const outputRel = `public/models/characters/imported/${slug}.glb`;
const profileRel = `assets/ingest/${slug}.json`;
const triangles = trianglesOf(json);
const sidecarPath = ABS_SOURCE.replace(/\.[^.]+$/, '.source.json');
const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf8')) : {};

const profile = {
  id: slug,
  source: glbPath.replace(root + '/', ''),
  output: outputRel,
  targetHeight,
  boneMap,
  clipMap,
  clipNotes,
  ...(sidecar.creator ? { creator: sidecar.creator } : {}),
  ...(sidecar.license ? { license: sidecar.license } : {}),
  provenance: {
    ...(sidecar.sourceUrl || sidecar.url || sidecar.page ? { sourceUrl: sidecar.sourceUrl || sidecar.url || sidecar.page } : {}),
    notes: `Prepared by scripts/prepare-character.mjs from ${basename(ABS_SOURCE)} (${rigState}${convertedFrom ? `, converted from ${convertedFrom}` : ''}${retargeted ? ', clips retargeted' : ''}). Licence metadata is informational only.`
  }
};
mkdirSync(resolve(root, 'assets/ingest'), { recursive: true });
writeFileSync(resolve(root, profileRel), JSON.stringify(profile, null, 1) + '\n');
step('profile', `bone map ${Object.keys(boneMap).length} entries · clip map ${Object.keys(clipMap).length}/7 states · output ${outputRel}`);

let ingest = null;
try {
  const out = execFileSync(process.execPath, ['scripts/ingest-character.mjs', '--profile', profileRel], { cwd: root, encoding: 'utf8' });
  ingest = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  step('ingest', `PASSED — ${ingest.verify.bonesBound} bones bound, feet ${ingest.verify.feetY} m, ${ingest.verify.clips.length} clips`);
} catch (error) {
  console.error(`PREPARE STOPPED: ingestion failed.\n${String(error.stdout || '').split('\n').slice(-8).join('\n')}\n${String(error.stderr || '').split('\n').slice(-6).join('\n')}`);
  process.exit(1);
}

// ------------------------------------------------------------------ 6. technical gate
let gate = { ok: false, output: '' };
try {
  gate.output = execFileSync(process.execPath, ['scripts/inspect-character-glb.mjs', outputRel], { cwd: root, encoding: 'utf8' });
  gate.ok = true;
} catch (error) {
  gate.output = String(error.stdout || '') + String(error.stderr || '');
}
const geometryLine = gate.output.split('\n').find(line => /zero-area|degenerate|triangles/i.test(line)) || '';
step('gate', `${gate.ok ? 'PASSED' : 'FAILED'} technical inspection${geometryLine ? ` · ${geometryLine.trim().slice(0, 130)}` : ''}`);

// ------------------------------------------------------------------ 7. register (opt-in)
// Preparing a model must never silently add a fighter to the roster. The default is review mode:
// the GLB, profile and report exist, and `--register` is the only thing that creates a roster entry.
const shouldRegister = args.includes('--register');
let registered = null;
if (shouldRegister) {
  execFileSync(process.execPath, ['scripts/register-character.mjs', '--manifest-key', slug, '--name', name,
    '--archetype', archetype, '--model', `/${outputRel.replace(/^public\//, '')}`], { cwd: root, stdio: 'inherit' });
  registered = true;
  step('register', `added "${name}" to the roster`);
} else {
  registered = false;
  step('register', 'skipped (review mode) — re-run with --register to add this fighter to character select');
}

const report = {
  name, slug, archetype, source: ABS_SOURCE, format: convertedFrom || EXT, rigState, retargeted, registered,
  sourceRig: retargeted ? sourceRig : null,
  prepared: outputRel, profile: profileRel,
  geometry: { meshes: (json.meshes || []).length, materials: (json.materials || []).length, textures, triangles },
  skeleton: { skins: (json.skins || []).length, joints: skinJoints, bonesMapped: Object.keys(boneMap).length, autoRig: autoRigReport },
  animation: { clips: clipNames, states: clipMap, substitutions: Object.values(clipNotes).filter(n => n.startsWith('SUBSTITUTE')) },
  ingest: { bonesBound: ingest.verify.bonesBound, feetY: ingest.verify.feetY, height: ingest.verify.height, clips: ingest.verify.clips },
  geometryGate: gate.ok ? 'pass' : 'fail',
  licence: sidecar.license || null,
  steps
};
// The model service gives each import its own report path so concurrent jobs never overwrite
// each other's evidence; direct CLI runs keep the historical location.
const reportPath = arg('report', resolve(root, `artifacts/dev/phase261/${slug}-report.json`));
mkdirSync(dirname(resolve(root, reportPath)), { recursive: true });
writeFileSync(resolve(root, reportPath), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ name, slug, rigState, retargeted, bones: report.skeleton, geometry: report.geometry, gate: report.geometryGate, substitutions: report.animation.substitutions.length }, null, 1));
