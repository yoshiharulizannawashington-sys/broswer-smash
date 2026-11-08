// Exact GLB audit for the active Infantry roster body: embedded textures, skeleton connectivity,
// primitive/skin counts, clips, and whether the shared weapon library actually contains an Infantry
// rifle prefab. Read-only; no game or asset changes.
//
//   node scripts/audit-infantry-asset.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/models/characters/manifest.json'), 'utf8'));
const entry = manifest.characters.infantry;
if (!entry) throw new Error('manifest has no infantry entry');

function readGlb(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB: ' + file);
  const version = buffer.readUInt32LE(4);
  const total = buffer.readUInt32LE(8);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.toString('utf8', 16, 20);
  if (jsonType !== 'JSON') throw new Error('first GLB chunk is not JSON');
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  return { buffer, version, total, json };
}

const glb = readGlb(path.join(root, 'public', entry.url));
const g = glb.json;
const nodes = g.nodes || [];
const accessors = g.accessors || [];
const parent = new Map();
for (let i = 0; i < nodes.length; i += 1) {
  for (const child of nodes[i].children || []) parent.set(child, i);
}
const meshes = g.meshes || [];
const primitives = meshes.flatMap(mesh => mesh.primitives || []);
const posCount = p => p.attributes?.POSITION != null ? (accessors[p.attributes.POSITION]?.count || 0) : 0;
const triCount = p => p.indices != null
  ? (accessors[p.indices]?.count || 0) / 3
  : posCount(p) / 3;
const skins = g.skins || [];
const skin = skins[0] || null;
const joints = skin?.joints || [];
const jointSet = new Set(joints);
const parentName = i => nodes[parent.get(i)]?.name || null;
const jointRoots = joints.filter(i => {
  const p = parent.get(i);
  return p == null || !jointSet.has(p);
});
// Reachability through the full node graph, not only direct joint-to-joint edges: exporters often
// put an Armature node between the scene and Hips.
const reachable = new Set();
const stack = skin?.skeleton != null ? [skin.skeleton] : [...jointRoots];
while (stack.length) {
  const i = stack.pop();
  if (reachable.has(i)) continue;
  reachable.add(i);
  for (const child of nodes[i]?.children || []) stack.push(child);
}
const unreachableJoints = joints.filter(i => !reachable.has(i));

const images = g.images || [];
const textures = g.textures || [];
const materials = g.materials || [];
const materialMaps = materials.map(mat => {
  const pbr = mat.pbrMetallicRoughness || {};
  return {
    name: mat.name || null,
    baseColorTexture: pbr.baseColorTexture?.index ?? null,
    metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index ?? null,
    normalTexture: mat.normalTexture?.index ?? null,
    occlusionTexture: mat.occlusionTexture?.index ?? null,
    emissiveTexture: mat.emissiveTexture?.index ?? null,
    alphaMode: mat.alphaMode || 'OPAQUE'
  };
});
const embeddedImages = images.filter(image => image.bufferView != null).length;
const imageMimeTypes = [...new Set(images.map(image => image.mimeType || 'unknown'))];

const animations = (g.animations || []).map(animation => ({
  name: animation.name || null,
  channels: animation.channels?.length || 0,
  samplers: animation.samplers?.length || 0
}));

let weaponPrefabs = [];
try {
  const weapon = readGlb(path.join(root, 'public/assets/character_weapons.glb'));
  weaponPrefabs = (weapon.json.nodes || [])
    .map(node => node.name)
    .filter(name => name && /infantry/i.test(name));
} catch (error) {
  weaponPrefabs = ['weapon library unavailable: ' + String(error.message || error)];
}

const audit = {
  file: entry.url,
  bytes: glb.buffer.length,
  sha256: crypto.createHash('sha256').update(glb.buffer).digest('hex'),
  glbVersion: glb.version,
  declaredBytes: glb.total,
  meshes: meshes.length,
  meshNames: meshes.map(mesh => mesh.name || null),
  primitives: primitives.length,
  skinnedPrimitives: primitives.filter(p => p.attributes?.JOINTS_0 != null).length,
  materials: materials.length,
  materialMaps,
  textures: textures.length,
  images: images.length,
  embeddedImages,
  imageMimeTypes,
  animations,
  skin: skin ? {
    joints: joints.length,
    skeletonNode: skin.skeleton != null ? nodes[skin.skeleton]?.name || skin.skeleton : null,
    jointRoots: jointRoots.map(i => ({ name: nodes[i]?.name || null, parent: parentName(i) })),
    unreachableJoints: unreachableJoints.map(i => nodes[i]?.name || null),
    allJointsReachable: unreachableJoints.length === 0
  } : null,
  geometry: {
    vertices: primitives.reduce((sum, p) => sum + posCount(p), 0),
    triangles: Math.round(primitives.reduce((sum, p) => sum + triCount(p), 0))
  },
  weaponPrefabs,
  weaponPrefabFound: weaponPrefabs.some(name => /^weapon_infantry(_|$)/i.test(name)),
  roster: {
    key: 'infantry',
    url: entry.url,
    enabled: entry.enabled,
    assetKind: entry.assetKind,
    yawOffset: entry.yawOffset,
    license: entry.license,
    creator: entry.creator
  }
};

const out = path.join(root, 'artifacts/infantry-roster');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'asset-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 2));
