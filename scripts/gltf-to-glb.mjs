#!/usr/bin/env node
// Pack a .gltf plus its external .bin/textures into one GLB, byte-for-byte preserving the
// geometry, skin, materials, samplers and texture pixels. This is the staging step for supplied
// Sketchfab downloads: their .gltf/.bin/texture layout cannot be loaded as a single runtime asset,
// and re-exporting through Blender would rewrite the bind pose. This converter only relocates the
// existing bytes into the GLB container.
//
//   node scripts/gltf-to-glb.mjs <model.gltf> <out.glb>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/gltf-to-glb.mjs <model.gltf> <out.glb>');
  process.exit(2);
}
if (extname(input).toLowerCase() !== '.gltf') {
  console.error('input must be a .gltf file');
  process.exit(2);
}

const root = dirname(resolve(input));
const json = JSON.parse(readFileSync(input, 'utf8'));
const chunks = [];
let length = 0;

function append(bytes, alignment = 4) {
  const pad = (alignment - (length % alignment)) % alignment;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    length += pad;
  }
  const offset = length;
  chunks.push(bytes);
  length += bytes.length;
  return offset;
}

function readUri(uri) {
  if (!uri) throw new Error('image/buffer URI is empty');
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0) throw new Error('malformed data URI');
    const meta = uri.slice(5, comma);
    const payload = uri.slice(comma + 1);
    return /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  }
  return readFileSync(resolve(root, decodeURIComponent(uri)));
}

// The single glTF buffer must be the BIN chunk. Refuse multi-buffer files rather than silently
// dropping one: every supplied Sketchfab export we ingest uses a single scene.bin.
if ((json.buffers || []).length > 1) {
  throw new Error(`expected one buffer, found ${json.buffers.length}`);
}
const sourceBuffer = json.buffers?.[0];
const binBytes = sourceBuffer?.uri ? readUri(sourceBuffer.uri) : Buffer.alloc(0);
append(binBytes, 4);
json.buffers = [{ byteLength: binBytes.length }];

// Move every external image into the BIN chunk. Keep textures/samplers untouched.
json.images = json.images || [];
json.bufferViews = json.bufferViews || [];
for (const image of json.images) {
  if (!image.uri) continue;
  if (image.bufferView !== undefined) throw new Error('image has both uri and bufferView');
  const bytes = readUri(image.uri);
  const ext = extname(image.uri).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
    : null;
  if (!mimeType) throw new Error(`unsupported texture type: ${image.uri}`);
  const byteOffset = append(bytes, 4);
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
  image.bufferView = json.bufferViews.length - 1;
  image.mimeType = mimeType;
  delete image.uri;
}

const bin = Buffer.concat(chunks);
json.buffers[0].byteLength = bin.length;

const jsonText = JSON.stringify(json);
const jsonPad = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
const jsonChunk = Buffer.from(jsonText + ' '.repeat(jsonPad));
const binPad = (4 - (bin.length % 4)) % 4;
const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const glb = Buffer.alloc(total);
glb.write('glTF', 0, 'ascii');
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jsonChunk.length, 12);
glb.write('JSON', 16, 'ascii');
jsonChunk.copy(glb, 20);
glb.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
glb.write('BIN\0', 24 + jsonChunk.length, 'binary');
binChunk.copy(glb, 28 + jsonChunk.length);

mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, glb);
console.log(JSON.stringify({
  input, output, bytes: glb.length,
  nodes: json.nodes?.length || 0,
  meshes: json.meshes?.length || 0,
  skins: json.skins?.length || 0,
  images: json.images.length,
  animations: json.animations?.length || 0
}, null, 1));
