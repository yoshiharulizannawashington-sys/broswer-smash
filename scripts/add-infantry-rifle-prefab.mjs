#!/usr/bin/env node
/**
 * Give Infantry its own rifle prefab in the shared weapon library.
 *
 * Infantry's roster identity is a rifleman, and the moveset names its attacks Rifle Butt and Stock
 * Slam, but `character_weapons.glb` had no `weapon_infantry_right` node. `equipCharacterWeapons`
 * looks up `weapon_<identity>_right` and falls back to `makeProceduralWeapon`, which builds a sword
 * for any identity that is not a blaster/hammer/staff - so Infantry carried a katana while the HUD,
 * the moveset and the damage tables all said rifle.
 *
 * The library already contains a genuine rifle assembly (`weapon_sigourney_weaver_right`: barrel,
 * forward grip, grip, muzzle, receiver, stock, top optic, trigger guard). Rather than authoring a
 * second rifle or renaming the sword, this appends a new prefab node that instantiates those same
 * meshes under Infantry's own name. glTF allows many nodes to reference one mesh, so the vertex
 * data is shared: no geometry is duplicated, no buffer changes, and no other fighter's prefab is
 * touched. Re-running is a no-op.
 *
 *   node scripts/add-infantry-rifle-prefab.mjs [--dry-run]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const GLB = "public/assets/character_weapons.glb";
const SOURCE_ROOT = "weapon_sigourney_weaver_right";
const TARGET_ROOT = "weapon_infantry_right";
const dryRun = process.argv.includes("--dry-run");

function readGlb(file) {
  const buffer = readFileSync(file);
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB: " + file);
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.toString("utf8", 16, 20) !== "JSON") throw new Error("first chunk is not JSON");
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  // The BIN chunk starts after the padded JSON chunk.
  const binHeader = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binHeader);
  return {
    json,
    binary: buffer.subarray(binHeader + 8, binHeader + 8 + binLength),
    jsonPadding: jsonLength - Buffer.byteLength(JSON.stringify(json), "utf8"),
  };
}

function writeGlb(file, json, binary) {
  const jsonBuffer = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuffer.length % 4)) % 4;
  const binPad = (4 - (binary.length % 4)) % 4;
  const total = 12 + 8 + jsonBuffer.length + jsonPad + 8 + binary.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonBuffer.length + jsonPad, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuffer.copy(out, 20);
  out.fill(0x20, 20 + jsonBuffer.length, 20 + jsonBuffer.length + jsonPad);
  const binHeader = 20 + jsonBuffer.length + jsonPad;
  out.writeUInt32LE(binary.length + binPad, binHeader);
  out.writeUInt32LE(0x004e4942, binHeader + 4);
  binary.copy(out, binHeader + 8);
  writeFileSync(file, out);
  return out.length;
}

const before = createHash("sha256").update(readFileSync(GLB)).digest("hex");
const glb = readGlb(GLB);
const json = glb.json;
const nodes = json.nodes || [];
const meshes = json.meshes || [];
const scene = json.scenes?.[json.scene ?? 0];

const existing = nodes.find((node) => node.name === TARGET_ROOT);
if (existing) {
  console.log(JSON.stringify({ ok: true, changed: false, reason: "prefab already present", node: nodes.indexOf(existing) }, null, 2));
  process.exit(0);
}

const source = nodes.find((node) => node.name === SOURCE_ROOT);
if (!source) throw new Error(`source rifle prefab ${SOURCE_ROOT} not found`);
const sourceKind = source.extras?.kind;
if (sourceKind !== "rifle") throw new Error(`${SOURCE_ROOT} is kind "${sourceKind}", expected "rifle"`);
if (!source.children?.length) throw new Error(`${SOURCE_ROOT} has no child parts`);

const meshCountBefore = meshes.length;
const parts = [];
for (const childIndex of source.children) {
  const child = nodes[childIndex];
  if (child.mesh === undefined) continue;
  const part = {
    name: "Infantry rifle " + String(child.name || "part"),
    mesh: child.mesh,
  };
  if (child.translation) part.translation = [...child.translation];
  if (child.rotation) part.rotation = [...child.rotation];
  if (child.scale) part.scale = [...child.scale];
  if (child.extras) part.extras = { ...child.extras };
  parts.push(part);
}
if (parts.length < 5) throw new Error(`only ${parts.length} rifle parts found`);

const firstNewNode = nodes.length;
for (const part of parts) nodes.push(part);
const rootNode = {
  name: TARGET_ROOT,
  children: parts.map((_, index) => firstNewNode + index),
  extras: {
    character_key: "infantry",
    hand: "right",
    display_name: "Infantry · service rifle",
    kind: "rifle",
    // Where this geometry came from, so nobody later mistakes the shared meshes for duplicates.
    derived_from: SOURCE_ROOT,
  },
};
if (source.translation) rootNode.translation = [...source.translation];
if (source.rotation) rootNode.rotation = [...source.rotation];
if (source.scale) rootNode.scale = [...source.scale];
nodes.push(rootNode);
scene.nodes.push(nodes.length - 1);

if (meshes.length !== meshCountBefore) throw new Error("mesh count changed; this script must only instance existing geometry");

const bytes = dryRun ? 0 : writeGlb(GLB, json, glb.binary);
const after = dryRun ? before : createHash("sha256").update(readFileSync(GLB)).digest("hex");

// Verify the result by reading it back rather than trusting what was written.
const verify = readGlb(GLB);
const verifyRoot = (verify.json.nodes || []).find((node) => node.name === TARGET_ROOT);
const report = {
  ok: true,
  changed: !dryRun,
  file: GLB,
  bytesBefore: readFileSync(GLB).length,
  bytesWritten: bytes,
  sha256Before: before,
  sha256After: after,
  binaryUnchanged: createHash("sha256").update(verify.json ? glb.binary : Buffer.alloc(0)).digest("hex")
    === createHash("sha256").update(glb.binary).digest("hex"),
  nodesBefore: firstNewNode,
  nodesAfter: verify.json.nodes.length,
  meshesBefore: meshCountBefore,
  meshesAfter: verify.json.meshes.length,
  prefab: verifyRoot && {
    name: verifyRoot.name,
    kind: verifyRoot.extras?.kind,
    displayName: verifyRoot.extras?.display_name,
    parts: verifyRoot.children.length,
    partNames: verifyRoot.children.map((index) => verify.json.nodes[index].name),
    sharedMeshes: [...new Set(verifyRoot.children.map((index) => verify.json.nodes[index].mesh))],
  },
  otherPrefabsUntouched: (verify.json.nodes || []).filter((node) => /^weapon_/.test(node.name || "")).length === 69,
};
console.log(JSON.stringify(report, null, 2));
if (!report.prefab) {
  console.error("VERIFY FAILED: prefab not readable back from the file");
  process.exit(1);
}
