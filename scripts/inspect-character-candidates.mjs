#!/usr/bin/env node
// Download and inspect Sketchfab character candidates before they are allowed anywhere near the
// roster. This tool is deliberately read-only: it stages downloads under artifacts/, never enables
// a manifest entry, and never edits public/ assets.
//
//   node scripts/inspect-character-candidates.mjs --metadata-only [--uid <uid>]
//   node scripts/inspect-character-candidates.mjs --full [--uid <uid>] [--no-render]
//   node scripts/inspect-character-candidates.mjs --fixture <local.glb> --samples 2
//
// Full mode requires a valid SKETCHFAB_TOKEN / SKETCHFAB_API_TOKEN (case-insensitive). The token is
// used only by the fetch child process; it is never written to a report or passed in an argument.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FETCH_SCRIPT = path.join(ROOT, 'scripts', 'fetch-character-model.mjs');
const BLENDER_SCRIPT = path.join(ROOT, 'scripts', 'candidate_inspection.py');
const DEFORM_SCRIPT = path.join(ROOT, 'scripts', 'blender_check_deform.py');
const PROTECTED_FILES = [
  'public/models/characters/manifest.json',
  'public/js/main.js',
  'public/js/models.js',
];
const LICENSE_OK = /^(CC0|CC Attribution|CC BY)/i;
const RIPPED = /ultimate ninja storm|mobile game|xenoverse|kakarot|sparking|mugen|ripped|extracted from/i;
const CANDIDATES = [
  {
    key: 'goku-oup77',
    name: 'Goku',
    author: 'Oup77',
    uid: '75b88c3bf6a446df87680b8e7d4ba8e0',
    expected: { license: 'CC BY 4.0', faces: 77860, animations: 0 },
  },
  {
    key: 'superman-3dworldz',
    name: 'Superman (black suit)',
    author: '3Dworldz',
    uid: '61ecb87e712a437ba18930378d7aeb0e',
    expected: { license: 'CC BY 4.0', faces: 4858, animations: 13 },
  },
  {
    key: 'superman-chechorams16',
    name: 'Superman (Chechorams16)',
    author: 'Chechorams16',
    uid: 'ccad133a5a684003a059a01c89216780',
    expected: { license: 'CC BY 4.0', faces: 19926, animations: 0 },
  },
];

const commands = [];
const secrets = Object.keys(process.env)
  .filter(key => /^(SKETCHFAB_TOKEN|SKETCHFAB_API_TOKEN)$/i.test(key))
  .map(key => String(process.env[key] || ''))
  .filter(Boolean);

function redact(value) {
  let text = String(value ?? '');
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function quote(value) {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

function commandText(command, args) {
  return [command, ...args].map(quote).join(' ');
}

function run(command, args, { timeout = 300000, allowFailure = false } = {}) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  const record = {
    command: commandText(command, args),
    startedAt,
    durationMs: Date.now() - started,
    exitCode: result.status,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
  };
  commands.push(record);
  if (result.error && !allowFailure) {
    const error = new Error(redact(result.error.message));
    error.stdout = redact(result.stdout || '');
    error.stderr = redact(result.stderr || '');
    throw error;
  }
  if (result.status !== 0 && !allowFailure) {
    const error = new Error(redact((result.stderr || result.stdout || '').trim().slice(-3000)));
    error.exitCode = result.status;
    error.stdout = redact(result.stdout || '');
    error.stderr = redact(result.stderr || '');
    throw error;
  }
  return {
    ...record,
    stdout: redact(result.stdout || ''),
    stderr: redact(result.stderr || ''),
    error: result.error ? redact(result.error.message) : null,
  };
}

function runNode(args, options) {
  return run(process.execPath, args, options);
}

function parseArgs(argv) {
  const args = {
    mode: 'metadata',
    selected: [],
    out: path.join('artifacts', 'candidate-inspection'),
    samples: 8,
    noRender: false,
    json: false,
    fixture: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--metadata-only') args.mode = 'metadata';
    else if (arg === '--full') args.mode = 'full';
    else if (arg === '--uid') {
      const match = String(argv[++i] || '').match(/([0-9a-f]{32})/i);
      if (!match) throw new Error('--uid must contain a 32-character Sketchfab model id');
      args.selected.push(match[1].toLowerCase());
    } else if (arg === '--all') args.selected = [];
    else if (arg === '--fixture') {
      args.mode = 'fixture';
      args.fixture = path.resolve(ROOT, argv[++i] || '');
    } else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--samples') args.samples = Math.max(1, Number(argv[++i]) || 8);
    else if (arg === '--no-render') args.noRender = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/inspect-character-candidates.mjs [--metadata-only|--full|--fixture <file>] [--uid <uid>] [--out <dir>] [--samples N] [--no-render] [--json]');
      process.exit(0);
    } else {
      throw new Error('unexpected argument: ' + arg);
    }
  }
  args.out = path.resolve(ROOT, args.out);
  if (args.out === path.resolve(ROOT, 'public') || args.out.startsWith(path.resolve(ROOT, 'public') + path.sep)) {
    throw new Error('refusing to write inspection output under public/');
  }
  if (args.mode === 'full' && !args.selected.length) args.selected = CANDIDATES.map(candidate => candidate.uid);
  if (args.mode === 'metadata' && args.selected.length) {
    const known = new Set(CANDIDATES.map(candidate => candidate.uid));
    for (const uid of args.selected) if (!known.has(uid)) throw new Error('unknown candidate uid: ' + uid);
  }
  if (args.mode === 'fixture' && !args.fixture) throw new Error('--fixture requires a local model path');
  return args;
}

function sha256File(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function protectedSnapshot() {
  return Object.fromEntries(PROTECTED_FILES.map(file => [file, sha256File(path.join(ROOT, file))]));
}

function makeRunDir(out) {
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let runDir = path.join(out, 'run-' + stamp);
  let suffix = 1;
  while (fs.existsSync(runDir)) {
    runDir = path.join(out, 'run-' + stamp + '-' + suffix);
    suffix += 1;
  }
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) found.push(rel(full));
    }
  };
  visit(dir);
  return found.sort();
}

function safeName(value) {
  return String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'candidate';
}

function parseBlenderResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter(line => line.trim().startsWith('RESULT:'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = lines[i].slice(lines[i].indexOf('RESULT:') + 7).trim();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Blender may print a RESULT line from an earlier phase; keep looking backwards.
    }
  }
  return null;
}

function locateModel(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return target;
  const found = [];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(glb|gltf|fbx)$/i.test(entry.name)) found.push(full);
    }
  };
  visit(target);
  const rank = file => (/\.glb$/i.test(file) ? 0 : /\.gltf$/i.test(file) ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b) || fs.statSync(b).size - fs.statSync(a).size);
  return found[0] || null;
}

async function fetchMetadata(uid) {
  const response = await fetch('https://api.sketchfab.com/v3/models/' + uid, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('Sketchfab metadata was not JSON (HTTP ' + response.status + ')');
  }
  if (!response.ok) throw new Error('Sketchfab metadata failed (HTTP ' + response.status + '): ' + body.detail);
  const license = body.license?.label || 'unknown';
  const licenseFamily = /^CC0/i.test(license) ? 'CC0' : /^(CC Attribution|CC BY)/i.test(license) ? 'CC BY' : license;
  return {
    httpStatus: response.status,
    uid,
    name: body.name || '(unnamed)',
    author: body.user?.displayName || body.user?.username || 'unknown',
    license,
    licenseFamily,
    licenseUrl: body.license?.url || null,
    faces: body.faceCount ?? null,
    vertices: body.vertexCount ?? null,
    animations: body.animationCount ?? null,
    isDownloadable: Boolean(body.isDownloadable),
    isProtected: Boolean(body.isProtected),
    sourcePage: body.viewerUrl || ('https://sketchfab.com/3d-models/' + uid),
    description: String(body.description || '').slice(0, 1200),
    licenseAccepted: LICENSE_OK.test(license),
    rippedDescription: RIPPED.test(String(body.description || '')),
  };
}

function downloadCandidate(candidate, stagingRoot) {
  const result = runNode([
    FETCH_SCRIPT,
    '--uid', candidate.uid,
    '--identity', candidate.name,
    '--stage-only',
    '--dir', stagingRoot,
  ], { timeout: 300000 });
  const fetchReportPath = path.join(stagingRoot, candidate.uid, 'fetch-report.json');
  if (!fs.existsSync(fetchReportPath)) throw new Error('fetch report was not written: ' + rel(fetchReportPath));
  const report = JSON.parse(fs.readFileSync(fetchReportPath, 'utf8'));
  if (report.uid !== candidate.uid) throw new Error('fetch report uid mismatch');
  if (report.install !== 'staged-only') throw new Error('fetch escaped stage-only mode');
  return { result, report, reportPath: fetchReportPath };
}

function inspectWithBlender(modelFile, evidenceDir, options) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const args = [
    'scripts/blender.sh',
    '-b',
    '--python', path.relative(ROOT, BLENDER_SCRIPT),
    '--', modelFile, evidenceDir,
    '--samples', String(options.samples),
  ];
  if (options.noRender) args.push('--no-render');
  const result = run('bash', args, { timeout: 300000 });
  const parsed = parseBlenderResult(result.stdout);
  if (!parsed) throw new Error('Blender produced no RESULT JSON; tail: ' + result.stdout.slice(-1500));
  if (!parsed.ok) throw new Error('Blender inspection failed: ' + parsed.error);
  return { parsed, result };
}

function inspectDeformation(modelFile) {
  if (!/\.(glb|gltf)$/i.test(modelFile)) {
    return { available: false, reason: 'deformation check currently supports .glb/.gltf only' };
  }
  const result = run('bash', [
    'scripts/blender.sh',
    '-b',
    '--python', path.relative(ROOT, DEFORM_SCRIPT),
    '--', modelFile,
  ], { timeout: 300000, allowFailure: true });
  const parsed = parseBlenderResult(result.stdout);
  if (!parsed) return { available: false, reason: 'deformation check produced no RESULT JSON' };
  if (!parsed.ok) return { available: false, reason: parsed.error || 'deformation check failed' };
  return { available: true, ...parsed };
}

function mergeDeformation(inspection, deform) {
  const clips = inspection.animations?.clips || [];
  const deformClips = deform?.clips || {};
  for (const clip of clips) {
    const key = Object.keys(deformClips).find(name => name === clip.name || name.startsWith(clip.name) || clip.name.startsWith(name));
    clip.deform = key ? deformClips[key] : null;
    clip.meaningful = Boolean(clip.deform && clip.deform.verdict === 'pass');
  }
  inspection.animations.meaningfulClips = clips.filter(clip => clip.meaningful).length;
  inspection.animations.failedClips = clips.filter(clip => clip.deform && clip.deform.verdict !== 'pass').map(clip => clip.name);
  inspection.animations.motionChecked = Boolean(deform?.available);
}

function point(value, max) {
  return Math.max(0, Math.min(max, value));
}

function scoreCandidate(inspection, deform, metadata, fetchReport) {
  const geometry = inspection.geometry || {};
  const textures = inspection.textures || {};
  const rig = inspection.rig || {};
  const animations = inspection.animations || {};
  const bounds = inspection.bounds || {};
  const body = rig.bodyPartVertices || {};
  const tris = geometry.triangles || 0;
  const faces = Number(metadata?.faces || fetchReport?.faces || 0);
  const maxRes = Math.max(0, ...(textures.maxResolution || [0, 0]));
  const uv = Number(inspection.uvCoverage || 0);
  const degRatio = tris ? (geometry.degenerateTriangles || 0) / tris : 0;
  const base = Number(inspection.materials?.connectedMaps?.baseColor || 0);
  const normal = Number(inspection.materials?.connectedMaps?.normal || 0);
  const rough = Number(inspection.materials?.connectedMaps?.roughness || 0);
  const metal = Number(inspection.materials?.connectedMaps?.metallic || 0);
  const head = Number(body.Head || 0);
  const hands = Number(body.LeftHand || 0) + Number(body.RightHand || 0);
  const feet = Number(body.LeftFoot || 0) + Number(body.RightFoot || 0);
  const torso = Number(body.Hips || 0) + Number(body.Spine || 0) + Number(body.Chest || 0);
  const meaningful = Number(animations.meaningfulClips || 0);
  const clips = Number(animations.count || 0);
  const states = (animations.statesCovered || []).length;

  const visualResolution = maxRes >= 2048 ? 6 : maxRes >= 1024 ? 4 : maxRes >= 512 ? 2 : 0;
  const visualUv = uv >= 0.6 ? 5 : uv >= 0.4 ? 3 : uv >= 0.2 ? 1 : 0;
  const visualBody = (head > 0 ? 2 : 0) + (hands > 0 ? 2 : 0) + (feet > 0 ? 2 : 0);
  const visualIntegrity =
    (geometry.degenerateTriangles === 0 ? 1 : 0) +
    ((geometry.duplicateMeshes || []).length === 0 ? 1 : 0) +
    ((geometry.nonManifoldEdges || 0) === 0 ? 1 : 0) +
    ((geometry.looseVertices || 0) === 0 ? 1 : 0);
  const visualMaterials = (base > 0 ? 2 : 0) + (normal > 0 ? 1 : 0) + ((rough > 0 || metal > 0) ? 1 : 0);
  const visual = visualResolution + visualUv + visualBody + visualIntegrity + visualMaterials;

  const geometryDensity = tris >= 100000 ? 8 : tris >= 50000 ? 7 : tris >= 25000 ? 5 : tris >= 10000 ? 3 : 1;
  const geometryIntegrity =
    (degRatio < 0.001 ? 3 : degRatio < 0.005 ? 2 : 0) +
    ((geometry.duplicateMeshes || []).length === 0 ? 1 : 0) +
    ((geometry.nonManifoldEdges || 0) === 0 ? 1 : 0) +
    ((geometry.looseVertices || 0) === 0 ? 1 : 0);
  const geometryCoverage = (head > 0 ? 1 : 0) + (hands > 0 ? 1 : 0) + (feet > 0 ? 1 : 0) + (torso > 0 ? 1 : 0);
  const geometryScale = (bounds.upright ? 1 : 0) + (bounds.height >= 0.8 && bounds.height <= 3.0 ? 1 : 0);
  const geometryScore = point(geometryDensity + geometryIntegrity + geometryCoverage + geometryScale, 20);

  const textureMaps = (base > 0 ? 3 : 0) + (normal > 0 ? 2 : 0) + (rough > 0 ? 2 : 0) + (metal > 0 ? 1 : 0);
  const textureResolution = maxRes >= 2048 ? 6 : maxRes >= 1024 ? 4 : maxRes >= 512 ? 2 : 0;
  const textureUv = uv >= 0.6 ? 4 : uv >= 0.4 ? 2 : uv >= 0.2 ? 1 : 0;
  const textureConnected = (base > 0 ? 1 : 0) + ((normal > 0 || rough > 0 || metal > 0) ? 1 : 0);
  const textureScore = point(textureMaps + textureResolution + textureUv + textureConnected, 20);

  const rigArmature = (rig.armatures || 0) > 0 ? 5 : 0;
  const rigRoles = rig.retargetCoverage >= 0.999 ? 5 : rig.retargetCoverage >= 0.75 ? 3 : rig.retargetCoverage >= 0.4 ? 1 : 0;
  const weightedRatio = Number(rig.weightedRatio || 0);
  const rigWeights = weightedRatio >= 0.95 ? 5 : weightedRatio >= 0.8 ? 3 : weightedRatio >= 0.5 ? 1 : 0;
  const deformationPass = Boolean(deform?.available && deform?.ok && deform?.clips && deform?.passed && Object.keys(deform.clips).length > 0);
  const rigDeform = deformationPass ? 5 : meaningful > 0 ? 2 : 0;
  const rigScore = point(rigArmature + rigRoles + rigWeights + rigDeform, 20);

  const animationClips = clips >= 5 ? 3 : clips >= 1 ? 1 : 0;
  const animationMeaningful = meaningful >= 3 ? 3 : meaningful >= 1 ? 1 : 0;
  const animationCoverage = states >= 4 ? 2 : states >= 2 ? 1 : 0;
  const animationRetarget = rig.retargetCoverage >= 0.999 ? 2 : rig.retargetCoverage >= 0.75 ? 1 : 0;
  const animationScore = point(animationClips + animationMeaningful + animationCoverage + animationRetarget, 10);

  const browserTriangles = tris <= 50000 ? 2 : tris <= 100000 ? 1 : tris <= 250000 ? 0.5 : 0;
  const browserTextures = (textures.count || 0) <= 6 ? 1 : 0;
  const browserMaterials = (geometry.materials || 0) <= 8 ? 1 : 0;
  const browserAnimations = clips <= 20 ? 1 : 0;
  const browserScore = point(browserTriangles + browserTextures + browserMaterials + browserAnimations, 5);

  const visualQuality = {
    score: point(visual, 25),
    max: 25,
    automatedProxy: true,
    manualReviewRequired: true,
    basis: 'texture resolution, UV coverage, weighted head/hand/foot geometry, mesh integrity, and connected PBR maps; it is not a substitute for looking at the six renders',
  };
  const total = point(visualQuality.score + geometryScore + textureScore + rigScore + animationScore + browserScore, 100);
  return {
    total: Math.round(total * 10) / 10,
    max: 100,
    visualQuality,
    geometry: { score: geometryScore, max: 20, density: geometryDensity, integrity: geometryIntegrity, coverage: geometryCoverage, scale: geometryScale },
    textures: { score: textureScore, max: 20, maps: textureMaps, resolution: textureResolution, uv: textureUv, connected: textureConnected },
    rig: { score: rigScore, max: 20, armature: rigArmature, roles: rigRoles, weights: rigWeights, deformation: rigDeform },
    animation: { score: animationScore, max: 10, clips: animationClips, meaningful: animationMeaningful, coverage: animationCoverage, retarget: animationRetarget },
    browser: { score: browserScore, max: 5, triangles: browserTriangles, textures: browserTextures, materials: browserMaterials, animations: browserAnimations },
    flags: {
      below25k: tris < 25000,
      facesMetadata: faces,
      faceCountDelta: faces && tris ? tris - faces : null,
      motionUnchecked: !deform?.available,
      rigAligned: inspection.rig?.aligned ?? null,
      weightedRatio: inspection.rig?.weightedRatio ?? null,
      scaleOutOfRange: Number(inspection.bounds?.height || 0) < 0.5 || Number(inspection.bounds?.height || 0) > 3.0,
      excludedHelperMeshes: (inspection.geometry?.helpers || []).length,
    },
  };
}

function classify(inspection, score, metadata, deform) {
  if (!inspection?.ok) return 'NOT RECOMMENDED';
  if (!metadata?.licenseAccepted) return 'NOT RECOMMENDED';
  if (!inspection.geometry?.meshes || !inspection.geometry?.triangles) return 'NOT RECOMMENDED';
  if (!inspection.rig?.armatures || !inspection.rig?.skinnedMeshes) return 'NOT RECOMMENDED';
  if (inspection.rig?.aligned === false || Number(inspection.rig?.weightedRatio || 0) < 0.75) return 'NOT RECOMMENDED';
  if (Number(inspection.bounds?.height || 0) < 0.5 || Number(inspection.bounds?.height || 0) > 3.0) return 'NOT RECOMMENDED';
  if (inspection.geometry.triangles < 25000 || score.geometry.score < 12 || inspection.uvCoverage < 0.15) {
    return 'NEEDS RETOPOLOGY OR DETAIL IMPROVEMENT';
  }
  if (!(inspection.animations?.meaningfulClips > 0)) return 'NEEDS ANIMATION AUTHORING';
  if (score.total >= 70 && score.rig.score >= 14 && score.textures.score >= 14) return 'READY FOR GAME INTEGRATION';
  if (score.total >= 55) return 'NEEDS ANIMATION AUTHORING';
  return 'NOT RECOMMENDED';
}

function recommendationFor(classification, inspection) {
  if (classification === 'READY FOR GAME INTEGRATION') {
    return 'Ready for a separately reviewed integration test. This tool did not modify the roster or manifest.';
  }
  if (classification === 'NEEDS ANIMATION AUTHORING') {
    return 'Promising body/rig, but it cannot enter gameplay until a complete idle, locomotion, attack, reaction, block and victory/defeat set is authored or retargeted.';
  }
  if (classification === 'NEEDS RETOPOLOGY OR DETAIL IMPROVEMENT') {
    return 'Do not integrate at this density. It is below the 25,000-triangle HD target or has a geometry/detail problem; use only as a reference or retopology source.';
  }
  if (!inspection?.rig?.armatures) return 'Do not use as a fighter; there is no armature to animate or retarget.';
  if (inspection?.rig?.aligned === false) return 'Do not use: the armature bounds do not align with the character mesh; repair or re-export the rig before any animation test.';
  if (Number(inspection?.rig?.weightedRatio || 0) < 0.75) return 'Do not use as-is: too many vertices are unweighted; repair the skinning before animation or integration.';
  if (Number(inspection?.bounds?.height || 0) < 0.5 || Number(inspection?.bounds?.height || 0) > 3.0) return 'Do not use without re-exporting at human scale; the measured height is outside the project\'s usable range.';
  return 'Do not use in the roster without a substantial asset rebuild and a separate review.';
}

function evidenceLinks(entry) {
  const images = entry.inspection?.evidence?.images || {};
  return Object.fromEntries(Object.entries(images).map(([key, file]) => [key, rel(file)]));
}

function markdownCell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Sketchfab character candidate inspection');
  lines.push('');
  lines.push('Generated: ' + report.generatedAt);
  lines.push('Mode: **' + report.mode + '**');
  lines.push('Authentication: **' + (report.auth.accepted ? 'accepted' : report.auth.skipped ? 'skipped (local fixture)' : 'rejected/missing') + '**');
  lines.push('Downloads staged under: `' + report.paths.staging + '`');
  lines.push('');
  lines.push('This tool never installs a candidate, enables a roster entry, or writes a game asset. The current roster and maps are untouched.');
  lines.push('');
  if (report.mode === 'fixture') {
    lines.push('**This is a local pipeline self-test, not a candidate verdict.** The imported file is an existing project asset used only to prove that the Blender inspector, scoring, and six evidence renders work.');
    lines.push('');
  }
  lines.push('## Comparison');
  lines.push('');
  lines.push('| Candidate | Status | Verified triangles | Textures | Rig / bones | Clips | Visual /25 | Total /100 | Classification |');
  lines.push('|---|---:|---:|---|---:|---:|---:|---:|---|');
  for (const candidate of report.candidates) {
    const inspection = candidate.inspection;
    const score = candidate.score;
    const tris = inspection?.geometry?.triangles ?? '—';
    const texture = inspection ? `${inspection.textures.count} @ ${inspection.textures.maxResolution.join('×')}` : '—';
    const rig = inspection ? `${inspection.rig.armatures ? 'yes' : 'no'} / ${inspection.rig.bones}` : '—';
    const clips = inspection ? inspection.animations.count : '—';
    lines.push('| ' + [
      candidate.name + ' — ' + candidate.author,
      candidate.status,
      tris,
      texture,
      rig,
      clips,
      score ? score.visualQuality.score : '—',
      score ? score.total : '—',
      candidate.classification || '—',
    ].map(markdownCell).join(' | ') + ' |');
  }
  lines.push('');
  lines.push('Visual quality is an automated proxy, not a final art verdict. Review the six renders before choosing a candidate. No points are awarded for unverified or absent features.');
  lines.push('');
  for (const candidate of report.candidates) {
    lines.push('## ' + candidate.name + ' — ' + candidate.author);
    lines.push('');
    lines.push('UID: `' + candidate.uid + '`  ');
    lines.push('Status: **' + candidate.status + '**  ');
    lines.push('Classification: **' + (candidate.classification || 'not classified') + '**');
    lines.push('');
    if (candidate.metadata) {
      const m = candidate.metadata;
      lines.push('Sketchfab metadata: ' + m.name + '; license **' + m.license + '**; ' + (m.faces ?? '?') + ' faces, ' + (m.vertices ?? '?') + ' vertices, ' + (m.animations ?? '?') + ' clips; downloadable=' + m.isDownloadable + '.');
      lines.push('');
      lines.push('Source: ' + m.sourcePage);
      lines.push('');
      if (candidate.errors.length) {
        lines.push('Errors:');
        for (const error of candidate.errors) lines.push('- ' + error);
        lines.push('');
      }
      if (candidate.download?.report) {
        const d = candidate.download.report;
        lines.push('Download: staged only; archive SHA-256 `' + d.archiveSha256 + '`; extracted `' + d.extracted + '`; installer=' + d.install + '.');
        lines.push('');
      }
      if (candidate.inspection) {
        const i = candidate.inspection;
        lines.push('Verified geometry: ' + i.geometry.meshes + ' meshes, ' + i.geometry.triangles + ' triangles, ' + i.geometry.vertices + ' vertices, ' + i.geometry.submeshes + ' submeshes/materials; degenerate=' + i.geometry.degenerateTriangles + '; non-manifold=' + i.geometry.nonManifoldEdges + '; loose vertices=' + i.geometry.looseVertices + '.');
        lines.push('');
        lines.push('Bounds: height ' + i.bounds.height + ' m, width ' + i.bounds.width + ' m, depth ' + i.bounds.depth + ' m; upright=' + i.bounds.upright + '; feet below origin=' + i.bounds.feetBelowOrigin + ' m.');
        lines.push('');
        lines.push('Textures: ' + i.textures.count + ' images, max ' + i.textures.maxResolution.join('×') + '; base-color materials=' + i.materials.texturedMaterials + '; connected maps=' + JSON.stringify(i.materials.connectedMaps) + '; average UV coverage=' + i.uvCoverage + '.');
        lines.push('');
        lines.push('Rig: ' + i.rig.armatures + ' armature(s), ' + i.rig.bones + ' bones, ' + i.rig.skinnedMeshes + ' skinned mesh(es), ' + i.rig.weightedVertices + ' weighted / ' + i.rig.unweightedVertices + ' unweighted vertices; roles=' + Object.keys(i.rig.canonicalRoles).length + '/' + 19 + '; missing=' + (i.rig.missingCanonicalRoles.join(', ') || 'none') + '.');
        lines.push('');
        lines.push('Animation metadata: ' + i.animations.count + ' clips; states covered=' + (i.animations.statesCovered.join(', ') || 'none') + '; meaningful after deformation check=' + i.animations.meaningfulClips + (i.animations.motionChecked ? '' : ' (deformation not checked)') + '.');
        lines.push('');
        if (candidate.deform?.available) {
          lines.push('Deformation: ' + (candidate.deform.passed ? 'all sampled clips passed' : 'failures: ' + (candidate.deform.failing || []).join(', ')) + '; per-clip results are in `report.json`.');
          lines.push('');
        }
        if (i.warnings.length) {
          lines.push('Warnings:');
          for (const warning of i.warnings) lines.push('- ' + warning);
          lines.push('');
        }
        if (candidate.score) {
          const s = candidate.score;
          lines.push('Score: **' + s.total + '/100**. Visual ' + s.visualQuality.score + '/25 (automated proxy), geometry ' + s.geometry.score + '/20, textures ' + s.textures.score + '/20, rig ' + s.rig.score + '/20, animation ' + s.animation.score + '/10, browser suitability ' + s.browser.score + '/5.');
          lines.push('');
          lines.push('Recommendation: ' + candidate.recommendation);
          lines.push('');
        }
        const evidence = evidenceLinks(candidate);
        if (Object.keys(evidence).length) {
          lines.push('Evidence:');
          for (const [key, file] of Object.entries(evidence)) lines.push('- ' + key + ': [' + path.basename(file) + '](' + file + ')');
          lines.push('');
        }
      }
    } else if (candidate.errors.length) {
      for (const error of candidate.errors) lines.push('- ' + error);
      lines.push('');
    }
  }
  lines.push('## Safety and provenance');
  lines.push('');
  lines.push('- Protected files unchanged: **' + report.safety.unchanged + '**');
  lines.push('- Roster/manifest integration: **none**');
  lines.push('- Downloads: ' + (report.mode === 'full' ? 'staged only under artifacts/' : 'none in this mode'));
  lines.push('- Secret exposure: token values are never included in commands, reports, or logs');
  lines.push('');
  lines.push('## Commands executed');
  lines.push('');
  lines.push('```text');
  for (const command of report.commands) lines.push(command.command);
  lines.push('```');
  lines.push('');
  lines.push('Full JSON report: [`report.json`](' + report.paths.reportJson + ')');
  lines.push('');
  return lines.join('\n');
}

function listCandidates(args) {
  if (args.mode === 'fixture') return [];
  if (!args.selected.length) return CANDIDATES;
  return CANDIDATES.filter(candidate => args.selected.includes(candidate.uid));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.fixture && !fs.existsSync(args.fixture)) throw new Error('fixture does not exist: ' + args.fixture);
  const runDir = makeRunDir(args.out);
  const stagingRoot = path.join(runDir, 'staging');
  const evidenceRoot = path.join(runDir, 'candidates');
  fs.mkdirSync(stagingRoot, { recursive: true });

  const auth = { checked: false, accepted: false, skipped: false, exitCode: null, tokenSource: null, stderr: '' };
  if (args.mode !== 'fixture') {
    const tokenKeys = Object.keys(process.env).filter(key => /^(SKETCHFAB_TOKEN|SKETCHFAB_API_TOKEN)$/i.test(key) && String(process.env[key] || '').trim());
    auth.checked = true;
    auth.tokenSource = tokenKeys[0] || null;
    const check = runNode([FETCH_SCRIPT, '--check-auth'], { timeout: 60000, allowFailure: true });
    auth.exitCode = check.exitCode;
    auth.accepted = check.exitCode === 0;
    auth.stderr = check.stderr.trim().slice(-1000);
    if (args.mode === 'full' && !auth.accepted) {
      const blocked = {
        version: 1,
        generatedAt: new Date().toISOString(),
        mode: args.mode,
        auth,
        candidates: [],
        commands,
        paths: { runDirectory: rel(runDir), staging: rel(stagingRoot), reportJson: rel(path.join(runDir, 'report.json')) },
        safety: { unchanged: true, installed: false, protected: protectedSnapshot() },
        errors: ['Authentication failed; no candidate was downloaded.'],
      };
      fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(blocked, null, 2) + '\n');
      fs.writeFileSync(path.join(runDir, 'report.md'), '# Candidate inspection blocked\n\nAuthentication failed. No download was attempted.\n');
      fs.writeFileSync(path.join(runDir, 'run-manifest.json'), JSON.stringify({ ...blocked, files: walkFiles(runDir) }, null, 2) + '\n');
      console.error('blocked: Sketchfab authentication failed; no download was attempted.');
      process.exitCode = 2;
      return;
    }
  } else {
    auth.skipped = true;
  }

  const before = protectedSnapshot();
  const selected = listCandidates(args);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    auth,
    candidates: [],
    commands,
    paths: {
      runDirectory: rel(runDir),
      staging: rel(stagingRoot),
      reportJson: rel(path.join(runDir, 'report.json')),
      reportMarkdown: rel(path.join(runDir, 'report.md')),
    },
    safety: { before, after: null, unchanged: null, installed: false },
    errors: [],
  };

  if (args.mode === 'fixture') {
    const entry = {
      key: 'fixture',
      name: 'Local pipeline fixture',
      author: 'existing project asset — not a Sketchfab candidate',
      uid: 'local-fixture',
      expected: {},
      status: 'inspecting',
      metadata: null,
      download: null,
      inspection: null,
      deform: null,
      score: null,
      classification: null,
      recommendation: 'Pipeline self-test only; not a roster candidate.',
      evidence: {},
      errors: [],
    };
    try {
      const evidenceDir = path.join(evidenceRoot, 'fixture', 'evidence');
      const { parsed } = inspectWithBlender(args.fixture, evidenceDir, args);
      entry.inspection = parsed;
      entry.evidence = parsed.evidence?.images || {};
      if (parsed.rig?.armatures && parsed.rig?.skinnedMeshes && parsed.animations?.count) {
        entry.deform = inspectDeformation(args.fixture);
        mergeDeformation(parsed, entry.deform);
      } else {
        mergeDeformation(parsed, { available: false });
      }
      entry.metadata = { licenseAccepted: true, license: 'local fixture', name: path.basename(args.fixture), faces: null, vertices: null, animations: null };
      entry.score = scoreCandidate(parsed, entry.deform, entry.metadata, null);
      entry.classification = 'LOCAL SELF-TEST';
      entry.status = 'inspected';
    } catch (error) {
      entry.status = 'failed';
      entry.errors.push(redact(error.message));
    }
    report.candidates.push(entry);
  } else {
    for (const candidate of selected) {
      const entry = {
        key: candidate.key,
        name: candidate.name,
        author: candidate.author,
        uid: candidate.uid,
        expected: candidate.expected,
        status: 'metadata',
        metadata: null,
        download: null,
        inspection: null,
        deform: null,
        score: null,
        classification: null,
        recommendation: null,
        evidence: {},
        errors: [],
      };
      try {
        entry.metadata = await fetchMetadata(candidate.uid);
        if (args.mode === 'metadata') {
          entry.status = 'metadata-only';
          entry.recommendation = 'Metadata verified; no download or Blender inspection was performed.';
          report.candidates.push(entry);
          continue;
        }
        if (!entry.metadata.licenseAccepted) {
          entry.status = 'skipped';
          entry.errors.push('license is not accepted by the pipeline: ' + entry.metadata.license);
          entry.recommendation = 'Do not download or use this model.';
          report.candidates.push(entry);
          continue;
        }
        if (entry.metadata.rippedDescription) {
          entry.status = 'skipped';
          entry.errors.push('description indicates ripped/extracted commercial-game geometry');
          entry.recommendation = 'Do not download or use this model.';
          report.candidates.push(entry);
          continue;
        }
        if (!entry.metadata.isDownloadable) {
          entry.status = 'skipped';
          entry.errors.push('author has not enabled downloads');
          entry.recommendation = 'Cannot legally download this candidate.';
          report.candidates.push(entry);
          continue;
        }

        entry.status = 'downloading';
        const download = downloadCandidate(candidate, stagingRoot);
        entry.download = {
          report: download.report,
          reportPath: rel(download.reportPath),
          archiveSha256: download.report.archiveSha256,
          archiveBytes: download.report.archiveBytes,
          extracted: download.report.extracted,
          install: download.report.install,
        };
        const modelFile = locateModel(path.resolve(ROOT, download.report.extracted));
        if (!modelFile) throw new Error('no .glb, .gltf or .fbx inside the staged download');
        entry.download.modelFile = rel(modelFile);
        entry.status = 'inspecting';
        const evidenceDir = path.join(evidenceRoot, candidate.key, 'evidence');
        const { parsed } = inspectWithBlender(modelFile, evidenceDir, args);
        entry.inspection = parsed;
        entry.evidence = parsed.evidence?.images || {};
        if (parsed.rig?.armatures && parsed.rig?.skinnedMeshes && parsed.animations?.count) {
          entry.deform = inspectDeformation(modelFile);
        } else {
          entry.deform = { available: false, reason: 'no skinned rig with clips to deform-check' };
        }
        mergeDeformation(parsed, entry.deform);
        entry.score = scoreCandidate(parsed, entry.deform, entry.metadata, download.report);
        entry.classification = classify(parsed, entry.score, entry.metadata, entry.deform);
        entry.recommendation = recommendationFor(entry.classification, parsed);
        entry.status = 'inspected';
      } catch (error) {
        entry.status = 'failed';
        entry.errors.push(redact(error.message));
        entry.recommendation = 'Inspection did not complete; do not claim this candidate passed.';
      }
      report.candidates.push(entry);
    }

    const inspected = report.candidates.filter(candidate => candidate.status === 'inspected');
    if (inspected.length) {
      const best = [...inspected].sort((a, b) => (b.score?.total || 0) - (a.score?.total || 0))[0];
      report.bestCandidate = {
        uid: best.uid,
        name: best.name,
        score: best.score?.total ?? null,
        classification: best.classification,
        note: 'Best automated total only; inspect the evidence renders before any decision.',
      };
    }
    if (args.mode === 'metadata') {
      report.bestCandidate = null;
    }
  }

  report.safety.after = protectedSnapshot();
  report.safety.unchanged = PROTECTED_FILES.every(file => report.safety.before[file] === report.safety.after[file]);
  if (!report.safety.unchanged) report.errors.push('A protected game file changed during inspection; do not trust this run.');
  report.files = walkFiles(runDir);
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(runDir, 'report.md'), buildMarkdown(report) + '\n');
  fs.writeFileSync(path.join(runDir, 'run-manifest.json'), JSON.stringify({
    version: 1,
    generatedAt: report.generatedAt,
    mode: report.mode,
    auth: report.auth,
    paths: report.paths,
    safety: report.safety,
    commands: report.commands,
    files: walkFiles(runDir),
    bestCandidate: report.bestCandidate || null,
    errors: report.errors,
  }, null, 2) + '\n');

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('mode       ' + report.mode);
    console.log('auth       ' + (report.auth.skipped ? 'skipped (fixture)' : report.auth.accepted ? 'accepted' : 'rejected/missing'));
    for (const candidate of report.candidates) {
      console.log(candidate.name + ' — ' + candidate.status + (candidate.classification ? ' — ' + candidate.classification : '') + (candidate.score ? ' — ' + candidate.score.total + '/100' : ''));
    }
    console.log('report     ' + rel(path.join(runDir, 'report.md')));
    console.log('safety     protected files unchanged=' + report.safety.unchanged + ', installed=false');
  }
  if (!report.safety.unchanged) process.exitCode = 1;
}

main().catch(error => {
  console.error('error: ' + redact(error.message));
  process.exitCode = 1;
});
