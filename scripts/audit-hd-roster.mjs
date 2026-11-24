#!/usr/bin/env node
// Audit the four requested HD roster fighters against the real files and manifest metadata.
//
// This is deliberately read-only: it does not enable a character, rewrite the manifest or claim
// that a project-generated substitute is a licensed third-party model. It answers one question:
// can each requested identity currently mount a genuine HD character asset?
//
// Run:
//   npm run audit:hd-roster
//   node scripts/audit-hd-roster.mjs --gate   # exit 1 unless all four are VERIFIED
import './glb-node-compat.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { resolveRig } from '../public/js/anim/rig_map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const MANIFEST_PATH = path.join(PUBLIC, 'models', 'characters', 'manifest.json');
const OUT_DIR = path.join(ROOT, 'artifacts', 'hd-roster');
const OUT_PATH = path.join(OUT_DIR, 'audit.json');

const MIN = Object.freeze({
  triangles: 25000,
  textureImages: 3,
  bones: 20,
  clips: 5,
  skinnedMeshes: 1,
  height: 1.5,
  maxHeight: 2.3
});

const TARGETS = [
  { key: 'naruto_uzumaki', name: 'Naruto Uzumaki', request: 'new HD fighter' },
  { key: 'superman', name: 'Superman', request: 'new HD fighter' },
  { key: 'goku', name: 'Goku', request: 'HD upgrade of the existing identity' },
  { key: 'spider_man', name: 'Spider-Man', request: 'new HD fighter' }
];

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function glbJson(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('not a binary glTF');
  }
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binStart = binHeader + 8;
  return { json, binStart };
}

function pngSize(bytes) {
  if (bytes.length < 24) return null;
  if (bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function imageInfo(buffer, glb, image) {
  const info = { name: image.name || null, mime: image.mimeType || null, bytes: 0, width: null, height: null };
  if (image.bufferView == null) return info;
  const view = (glb.json.bufferViews || [])[image.bufferView];
  if (!view) return info;
  const start = glb.binStart + (view.byteOffset || 0);
  const bytes = buffer.subarray(start, start + view.byteLength);
  info.bytes = bytes.length;
  const size = pngSize(bytes);
  if (size) {
    info.width = size.width;
    info.height = size.height;
  }
  return info;
}

function fail(message) {
  return { ok: false, error: message };
}

async function inspectUrl(url) {
  const relative = decodeURIComponent(String(url || '').split(/[?#]/, 1)[0]).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, relative);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return fail('path escapes public/');
  if (!fs.existsSync(file)) return fail('missing file');
  const bytes = fs.readFileSync(file);
  let glb;
  try {
    glb = glbJson(bytes);
  } catch (error) {
    return fail(error.message);
  }
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let gltf;
  try {
    gltf = await new Promise((ok, bad) =>
      new GLTFLoader().parse(arrayBuffer, path.dirname(file) + path.sep, ok, bad));
  } catch (error) {
    return fail('loader rejected file: ' + String(error?.message || error));
  }
  const scene = gltf.scene || gltf.scenes[0];
  if (!scene) return fail('file has no scene');
  scene.updateMatrixWorld(true);

  let meshes = 0;
  let skinnedMeshes = 0;
  let vertices = 0;
  let triangles = 0;
  let bones = 0;
  const materials = new Set();
  const texturedMaterials = new Set();
  scene.traverse(node => {
    if (node.isBone) bones++;
    if (!node.isMesh) return;
    meshes++;
    if (node.isSkinnedMesh) skinnedMeshes++;
    const geometry = node.geometry;
    if (geometry?.attributes?.position) vertices += geometry.attributes.position.count;
    if (geometry?.index) triangles += geometry.index.count / 3;
    else if (geometry?.attributes?.position) triangles += geometry.attributes.position.count / 3;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material.name || material.uuid);
      if (material.map || material.normalMap || material.roughnessMap || material.metalnessMap) {
        texturedMaterials.add(material.name || material.uuid);
      }
    }
  });

  const images = (glb.json.images || []).map(image => imageInfo(bytes, glb, image));
  const textureBytes = images.reduce((sum, image) => sum + image.bytes, 0);
  const clips = (gltf.animations || []).map(clip => ({ name: clip.name, duration: +clip.duration.toFixed(2) }));
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const rig = resolveRig(scene);

  const technical = {
    triangles: Math.round(triangles),
    vertices,
    meshes,
    skinnedMeshes,
    bones,
    materials: materials.size,
    texturedMaterials: texturedMaterials.size,
    textureImages: images.length,
    textureBytes,
    clips,
    height: +size.y.toFixed(3),
    feetY: +box.min.y.toFixed(3),
    rig: {
      kind: rig?.kind || null,
      bound: rig?.boundCount ?? 0,
      missingCore: rig?.missingCore || [],
      missing: rig?.missing || []
    }
  };

  const reasons = [];
  if (technical.triangles < MIN.triangles) reasons.push(`${technical.triangles} triangles < ${MIN.triangles}`);
  if (technical.textureImages < MIN.textureImages) reasons.push(`${technical.textureImages} texture images < ${MIN.textureImages}`);
  if (technical.bones < MIN.bones) reasons.push(`${technical.bones} bones < ${MIN.bones}`);
  if (technical.clips.length < MIN.clips) reasons.push(`${technical.clips.length} clips < ${MIN.clips}`);
  if (technical.skinnedMeshes < MIN.skinnedMeshes) reasons.push(`${technical.skinnedMeshes} skinned meshes < ${MIN.skinnedMeshes}`);
  if (technical.height < MIN.height || technical.height > MIN.maxHeight) {
    reasons.push(`height ${technical.height} m outside ${MIN.height}-${MIN.maxHeight} m`);
  }
  if (!rig || rig.kind !== 'bone' || technical.rig.missingCore.length) {
    reasons.push('core rig unresolved: ' + JSON.stringify(technical.rig.missingCore));
  }

  return {
    ok: true,
    file: relative,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    technical,
    technicalPass: reasons.length === 0,
    technicalReasons: reasons,
    images
  };
}

function licenseClass(entry) {
  const text = `${entry?.assetKind || ''} ${entry?.license || ''} ${entry?.source || ''}`;
  if (/original-alternative|showcase-|original work generated by this repository/i.test(text)) {
    return 'project-authored-substitute';
  }
  if (/CC0|CC BY|public domain|licensed/i.test(text)) return 'licensed';
  return 'unverified';
}

function provenance(entry) {
  return {
    assetKind: entry?.assetKind || null,
    creator: entry?.creator || null,
    source: entry?.source || null,
    license: entry?.license || null,
    retrieved: entry?.retrieved || null,
    declaredSha256: entry?.verified?.sha256 || null,
    complete: Boolean(entry?.creator && entry?.source && entry?.license && entry?.retrieved)
  };
}

function statusFor(asset, entry) {
  if (!entry) return { status: 'BLOCKED ON ASSET', reason: 'no manifest entry' };
  if (!asset.ok) return { status: 'BLOCKED ON ASSET', reason: asset.error };
  if (entry.enabled === false) return { status: 'BLOCKED ON ASSET', reason: 'manifest entry is disabled' };
  if (!asset.technicalPass) {
    return { status: 'BLOCKED ON ASSET', reason: asset.technicalReasons.join('; ') };
  }
  const cls = licenseClass(entry);
  if (cls !== 'licensed') {
    return {
      status: 'PARTIAL',
      reason: 'meets the technical HD thresholds, but provenance is ' + cls + ', not a licensed character asset'
    };
  }
  if (!provenance(entry).complete) {
    return { status: 'PARTIAL', reason: 'licensed asset is missing creator/source/license/retrieved metadata' };
  }
  return { status: 'VERIFIED', reason: 'technical and provenance gates pass' };
}

function describe(asset) {
  if (!asset.ok) return asset.error;
  const t = asset.technical;
  return `${t.triangles.toLocaleString()} tris, ${t.textureImages} texture images, ${t.bones} bones, ` +
    `${t.clips.length} clips, ${t.height} m, ${(asset.bytes / 1024 / 1024).toFixed(1)} MB`;
}

const manifest = readManifest();
const characters = manifest.characters || {};
const altGokuKeys = Object.keys(characters).filter(key =>
  key !== 'goku' && /^goku[-_]/.test(key) && characters[key]?.enabled !== false);
const report = {
  generatedAt: new Date().toISOString(),
  source: 'public/models/characters/manifest.json',
  thresholds: MIN,
  blender: fs.existsSync(path.join(ROOT, '.tools', 'blender-4.2.23-linux-x64', 'blender'))
    ? '4.2.23 LTS (workspace portable)'
    : 'not installed',
  duplicateGokuSelectable: altGokuKeys.filter(key => characters[key]?.assetKind !== 'showcase-export' &&
    characters[key]?.assetKind !== 'showcase-sculpt' && characters[key]?.assetKind !== 'original-alternative'),
  fighters: []
};

for (const target of TARGETS) {
  const entry = characters[target.key];
  const asset = entry?.url ? await inspectUrl(entry.url) : fail('no manifest URL');
  const state = statusFor(asset, entry);
  console.log(`${target.name}: ${state.status} — ${state.reason}`);
  console.log(`  active ${entry?.url || '(none)'}: ${describe(asset)}`);

  const candidates = [];
  if (target.key === 'goku') {
    for (const key of ['goku_sculpt', 'goku_showcase']) {
      const candidate = characters[key];
      if (!candidate?.url) continue;
      const inspected = await inspectUrl(candidate.url);
      const candidateState = statusFor(inspected, candidate);
      candidates.push({
        key,
        url: candidate.url,
        assetKind: candidate.assetKind || null,
        status: candidateState.status,
        reason: candidateState.reason,
        asset: inspected
      });
      console.log(`  candidate ${key}: ${candidateState.status} — ${describe(inspected)}`);
    }
  }

  report.fighters.push({
    identity: target.name,
    key: target.key,
    request: target.request,
    status: state.status,
    reason: state.reason,
    entry: entry || null,
    provenance: provenance(entry),
    licenseClass: licenseClass(entry),
    active: asset,
    candidates
  });
}

report.summary = {
  verified: report.fighters.filter(f => f.status === 'VERIFIED').length,
  partial: report.fighters.filter(f => f.status === 'PARTIAL').length,
  blocked: report.fighters.filter(f => f.status === 'BLOCKED ON ASSET').length,
  partialCandidates: report.fighters.reduce((sum, fighter) =>
    sum + fighter.candidates.filter(candidate => candidate.status === 'PARTIAL').length, 0),
  total: report.fighters.length
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`\nSummary: ${report.summary.verified} VERIFIED, ${report.summary.partial} PARTIAL, ` +
  `${report.summary.blocked} BLOCKED ON ASSET (${report.summary.total} requested); ` +
  `${report.summary.partialCandidates} rejected/partial candidate(s).`);
console.log(`Report: ${path.relative(ROOT, OUT_PATH)}`);

if (process.argv.includes('--gate') && report.summary.verified !== report.summary.total) {
  console.error('HD roster gate failed: not every requested fighter has a verified licensed HD asset.');
  process.exit(1);
}
