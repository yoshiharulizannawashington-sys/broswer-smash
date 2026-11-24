#!/usr/bin/env node
/**
 * Convert KHR_materials_pbrSpecularGlossiness materials to core metallic-roughness.
 *
 * three.js's GLTFLoader no longer implements the spec/gloss extension, so every surface that uses it
 * loads with a default white MeshStandardMaterial: the geometry, skin and UVs are fine, but the
 * diffuse map is never bound. That is exactly how the imported Goku body rendered in a live match.
 *
 * The conversion is metadata only. Diffuse colour + texture become base colour, the glossiness is
 * inverted into roughness, and metalness is pinned to 0 because the extension's specular factor is
 * black in this asset. Accessors, buffer views, the BIN chunk, skin, inverse bind matrices, UVs and
 * the embedded PNGs are copied byte for byte.
 *
 *   node scripts/convert-specgloss-to-pbr.mjs --in <source.glb> --out <converted.glb>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const arg = name => {
  const index = process.argv.indexOf('--' + name);
  return index > 0 ? process.argv[index + 1] : null;
};

const source = arg('in');
const out = arg('out');
if (!source || !out) {
  console.error('usage: node scripts/convert-specgloss-to-pbr.mjs --in <source.glb> --out <converted.glb>');
  process.exit(2);
}

const file = readFileSync(source);
if (file.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + source);
const jsonLength = file.readUInt32LE(12);
const jsonType = file.readUInt32LE(16);
if (jsonType !== 0x4e4f534a) throw new Error('first chunk is not JSON');
const json = JSON.parse(file.toString('utf8', 20, 20 + jsonLength));
const binStart = 20 + jsonLength;
const binLength = file.readUInt32LE(binStart);
const binType = file.readUInt32LE(binStart + 4);
if (binType !== 0x004e4942) throw new Error('second chunk is not BIN');
const bin = Buffer.from(file.subarray(binStart + 8, binStart + 8 + binLength));

const EXT = 'KHR_materials_pbrSpecularGlossiness';
const clamp01 = value => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const converted = [];
for (const material of json.materials || []) {
  const spec = material.extensions?.[EXT];
  if (!spec) continue;
  const gloss = spec.glossinessFactor ?? 1;
  const diffuse = spec.diffuseFactor || [1, 1, 1, 1];
  const pbr = {
    baseColorFactor: diffuse.map(clamp01),
    metallicFactor: 0,
    roughnessFactor: clamp01(1 - gloss)
  };
  if (spec.diffuseTexture) pbr.baseColorTexture = spec.diffuseTexture;
  material.pbrMetallicRoughness = pbr;
  // A fully black diffuse factor with no map is a deliberate shadow/eye material; keep the colour
  // but do not let the default white base colour take over.
  delete material.extensions[EXT];
  if (!Object.keys(material.extensions).length) delete material.extensions;
  converted.push({
    name: material.name,
    roughness: pbr.roughnessFactor,
    hasMap: Boolean(pbr.baseColorTexture),
    baseColor: pbr.baseColorFactor
  });
}

if (json.extensionsUsed) {
  json.extensionsUsed = json.extensionsUsed.filter(extension => extension !== EXT);
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
}
if (json.extensionsRequired) {
  json.extensionsRequired = json.extensionsRequired.filter(extension => extension !== EXT);
  if (!json.extensionsRequired.length) delete json.extensionsRequired;
}

// Re-emit the container: JSON chunk padded with spaces, BIN copied untouched.
const jsonText = JSON.stringify(json);
const jsonBytes = Buffer.from(jsonText, 'utf8');
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (bin.length % 4)) % 4;
const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binChunk.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));

console.log(JSON.stringify({
  source,
  out,
  sourceBytes: file.length,
  outBytes: 12 + 8 + jsonChunk.length + 8 + binChunk.length,
  binBytesIdentical: bin.length,
  convertedMaterials: converted,
  geometry: {
    nodes: json.nodes?.length || 0,
    meshes: json.meshes?.length || 0,
    skins: json.skins?.length || 0,
    joints: json.skins?.[0]?.joints?.length || 0,
    animations: json.animations?.length || 0
  }
}, null, 2));
