#!/usr/bin/env node
/**
 * Pack a .gltf (+ .bin + loose textures) into a single self-contained .glb, or repack a .glb.
 *
 * Geometry, skin weights, inverse bind matrices, UVs and animation curves are copied byte for
 * byte: this only rewrites the container and, optionally, node names. That matters for rigs whose
 * skeleton cannot survive a Blender round-trip -- an armature node carrying a 100x scale is applied
 * one-sidedly by the glTF importer, which leaves the rest skeleton tens of metres from the mesh
 * and every posed joint pivoting outside the body. Packing keeps the author's skeleton intact.
 *
 *   node scripts/pack-gltf-to-glb.mjs <model.gltf|model.glb> --out <model.glb> \
 *     [--auto-rename] [--rename map.json] [--report out.json]
 *
 * --auto-rename rewrites bone names to the canonical slots the runtime rig classifier resolves
 * (Hips, Spine, Chest, LeftForeArm, LeftUpLeg, ...). Only names are touched; the skin is untouched.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((value, index) => !value.startsWith("--") && !args[index - 1]?.startsWith("--rename") && !args[index - 1]?.startsWith("--out") && !args[index - 1]?.startsWith("--report"));
const source = positional[0];
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};
const flag = (name) => args.includes(`--${name}`);
const outPath = option("out");
const reportPath = option("report");
const renamePath = option("rename");
const autoRename = flag("auto-rename");

if (!source || !outPath) {
  console.error("usage: node scripts/pack-gltf-to-glb.mjs <model.gltf|glb> --out <model.glb> [--auto-rename] [--rename map.json]");
  process.exit(2);
}

// ------------------------------------------------------------------ load

function loadGltfContainer(file) {
  const bytes = readFileSync(file);
  if (bytes.length >= 12 && bytes.readUInt32LE(0) === 0x46546c67) {
    let offset = 12;
    let json = null;
    let binary = Buffer.alloc(0);
    while (offset < bytes.length) {
      const length = bytes.readUInt32LE(offset);
      const type = bytes.readUInt32LE(offset + 4);
      const chunk = bytes.subarray(offset + 8, offset + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
      else if (type === 0x004e4942) binary = Buffer.from(chunk);
      offset += 8 + length;
    }
    return { json, baseDir: path.dirname(file), externalBinary: binary, wasGlb: true };
  }
  return { json: JSON.parse(bytes.toString("utf8")), baseDir: path.dirname(file), externalBinary: null, wasGlb: false };
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
  ".avif": "image/avif",
};

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

// ------------------------------------------------------------------ bone naming

const CANONICAL = [
  "Hips", "Spine", "Chest", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
  "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
];

function roleOf(rawName) {
  const raw = String(rawName || "").toLowerCase().replace(/^mixamorig:?/, "");
  const spaced = raw.replace(/[._:\-\s]/g, " ");
  const key = spaced.replace(/ /g, "");
  let side = null;
  if (key.includes("left")) side = "Left";
  else if (key.includes("right")) side = "Right";
  else {
    for (const token of spaced.split(" ").filter(Boolean)) {
      if (token === "l") { side = "Left"; break; }
      if (token === "r") { side = "Right"; break; }
    }
    if (!side) {
      const glued = /^(.+?)([lr])$/.exec(key);
      if (glued && /(arm|hand|palm|wrist|clavicle|shoulder|leg|thigh|shin|calf|foot|ankle|toe|knee|elbow)$/.test(glued[1])) {
        side = glued[2] === "l" ? "Left" : "Right";
      }
    }
  }
  if (/finger|thumb|index|middle|ring|pinky/.test(key)) return null;
  if (/(^|[^a-z])end([^a-z]|$)|end\d*$/.test(key)) return null;
  if (/ik|control|ctrl|roll|socket|slot|nub|camera|weapon/.test(key)) return null;
  if (key.includes("neck")) return "Neck";
  if (key.includes("head")) return "Head";
  if (key.includes("hips") || key.includes("pelvis")) return "Hips";
  if (key.includes("spine")) return "Spine";
  if (/chest|torso|abdomen|ribcage/.test(key)) return "Chest";
  if (!side) return null;
  if (/hand|wrist|palm/.test(key)) return side + "Hand";
  if (/forearm|lowerarm|elbow/.test(key)) return side + "ForeArm";
  if (/clavicle|shoulder/.test(key)) return side + "Shoulder";
  if (/upperarm|arm/.test(key)) return side + "Arm";
  if (/upleg|thigh|upperleg/.test(key)) return side + "UpLeg";
  if (/shin|calf|lowerleg|knee|leg/.test(key)) return side + "Leg";
  if (/foot|ankle|toe/.test(key)) return side + "Foot";
  return null;
}

function buildAutoRename(nodes) {
  const mapping = {};
  const taken = new Set();
  let spineSeen = 0;
  for (const node of nodes) {
    let role = roleOf(node.name);
    if (!role) continue;
    if (role === "Spine") {
      spineSeen += 1;
      if (spineSeen > 1) role = "Chest";
    }
    if (taken.has(role) || !CANONICAL.includes(role)) continue;
    if (node.name === role) { taken.add(role); continue; }
    taken.add(role);
    mapping[node.name] = role;
  }
  return mapping;
}

// ------------------------------------------------------------------ pack

const gltf = loadGltfContainer(source);
const json = gltf.json;
const warnings = [];

const rename = renamePath ? JSON.parse(readFileSync(renamePath, "utf8")) : {};
if (autoRename) Object.assign(rename, buildAutoRename(json.nodes || []));

const renamed = [];
for (const node of json.nodes || []) {
  if (rename[node.name] && rename[node.name] !== node.name) {
    renamed.push({ from: node.name, to: rename[node.name] });
    node.name = rename[node.name];
  }
}

// One binary chunk: every buffer, then every loose image.
const blobs = [];
let cursor = 0;
const appendBlob = (bytes) => {
  const offset = cursor;
  blobs.push(bytes);
  cursor += bytes.length;
  const padding = pad4(cursor);
  if (padding) { blobs.push(Buffer.alloc(padding)); cursor += padding; }
  return offset;
};

const bufferStarts = [];
for (const buffer of json.buffers || []) {
  let bytes;
  if (buffer.uri) {
    const dataUri = /^data:.*?;base64,(.*)$/.exec(buffer.uri);
    bytes = dataUri ? Buffer.from(dataUri[1], "base64") : readFileSync(path.resolve(gltf.baseDir, decodeURIComponent(buffer.uri)));
  } else {
    bytes = gltf.externalBinary || Buffer.alloc(0);
  }
  if (bytes.length !== buffer.byteLength) {
    warnings.push(`buffer declared ${buffer.byteLength} bytes but carries ${bytes.length}`);
  }
  bufferStarts.push(appendBlob(bytes));
}

for (const [index, view] of (json.bufferViews || []).entries()) {
  const start = bufferStarts[view.buffer ?? 0];
  if (start === undefined) throw new Error(`bufferView ${index} references missing buffer ${view.buffer}`);
  view.byteOffset = (view.byteOffset || 0) + start;
  view.buffer = 0;
}

let embeddedImages = 0;
for (const image of json.images || []) {
  if (image.bufferView !== undefined || !image.uri) continue;
  if (image.uri.startsWith("data:")) {
    const match = /^data:(.*?);base64,(.*)$/.exec(image.uri);
    const bytes = Buffer.from(match[2], "base64");
    const offset = appendBlob(bytes);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    image.bufferView = json.bufferViews.length - 1;
    image.mimeType = image.mimeType || match[1];
    delete image.uri;
    embeddedImages += 1;
    continue;
  }
  const file = path.resolve(gltf.baseDir, decodeURIComponent(image.uri));
  const bytes = readFileSync(file);
  const offset = appendBlob(bytes);
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
  image.bufferView = json.bufferViews.length - 1;
  image.mimeType = image.mimeType || MIME[path.extname(file).toLowerCase()] || "image/png";
  delete image.uri;
  embeddedImages += 1;
}

const binary = Buffer.concat(blobs);
json.buffers = [{ byteLength: binary.length }];
json.asset = { ...(json.asset || {}), generator: `${json.asset?.generator || "glTF"} + browser-smash pack` };

const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
const jsonPadding = pad4(jsonBuffer.length);
const binaryPadding = pad4(binary.length);
const total = 12 + 8 + jsonBuffer.length + jsonPadding + 8 + binary.length + binaryPadding;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBuffer.length + jsonPadding, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonBuffer.copy(out, 20);
out.fill(0x20, 20 + jsonBuffer.length, 20 + jsonBuffer.length + jsonPadding);
const binHeader = 20 + jsonBuffer.length + jsonPadding;
out.writeUInt32LE(binary.length + binaryPadding, binHeader);
out.writeUInt32LE(0x004e4942, binHeader + 4);
binary.copy(out, binHeader + 8);

mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
writeFileSync(outPath, out);

const report = {
  ok: true,
  source,
  output: path.resolve(outPath),
  sourceBytes: readFileSync(source).length,
  outputBytes: out.length,
  embeddedImages,
  renamedBones: renamed.length,
  renamed: renamed.slice(0, 40),
  mappedRoles: Object.values(rename).filter((value) => CANONICAL.includes(value)).sort(),
  missingRoles: CANONICAL.filter((role) => !Object.values(rename).includes(role)),
  warnings,
};
console.log(JSON.stringify(report, null, 2));
if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
