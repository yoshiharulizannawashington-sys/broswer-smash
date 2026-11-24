#!/usr/bin/env node
// Orthographic front/side silhouette renderer for character GLBs, with optional joint overlay.
// Pure Node (three + zlib), no GPU. Usage:
//   node scripts/silhouette-glb.mjs <model.glb> <out.png> [--joints <rigged.glb>]
import './glb-node-compat.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const file = args[0], out = args[1];
const jointsIdx = args.indexOf('--joints');
const jointsFile = jointsIdx >= 0 ? args[jointsIdx + 1] : null;
const PANEL = 420, W = PANEL * 2, H = PANEL;
const load = async path => {
  const b = readFileSync(path);
  const g = await new Promise((ok, bad) => new GLTFLoader().parse(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', ok, bad));
  g.scene.updateMatrixWorld(true);
  return g;
};

const gltf = await load(file);
const scene = gltf.scene;
const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());

const tris = [];
let materials = new Map();
scene.traverse(n => {
  if (!n.isMesh) return;
  const geo = n.geometry;
  const pos = geo.attributes.position;
  if (!pos) return;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  const get = i => idx ? idx.getX(i) : i;
  const matList = Array.isArray(n.material) ? n.material : [n.material];
  const col = matList[0]?.color ? matList[0].color : new THREE.Color(0.8, 0.8, 0.8);
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(pos, get(i)).applyMatrix4(n.matrixWorld);
    b.fromBufferAttribute(pos, get(i + 1)).applyMatrix4(n.matrixWorld);
    c.fromBufferAttribute(pos, get(i + 2)).applyMatrix4(n.matrixWorld);
    ab.subVectors(b, a); ac.subVectors(c, a); normal.crossVectors(ab, ac).normalize();
    tris.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, normal.x, normal.y, normal.z,
      col.r, col.g, col.b]);
  }
});

// two orthographic panels: front (x/y) and side (z/y)
const views = [
  { name: 'front', h: p => p.x, v: p => p.y, depth: p => -p.z },
  { name: 'side', h: p => p.z, v: p => p.y, depth: p => p.x }
];
const panels = views.map(v => {
  let h0 = Infinity, h1 = -Infinity;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const p = { x: t[k * 3], y: t[k * 3 + 1], z: t[k * 3 + 2] };
    const h = v.h(p); h0 = Math.min(h0, h); h1 = Math.max(h1, h);
  }
  const v0 = box.min.y, v1 = box.max.y;
  const scale = (PANEL * 0.88) / Math.max(h1 - h0, v1 - v0, 1e-6);
  const ox = PANEL / 2 - ((h0 + h1) / 2) * scale;
  const oy = PANEL * 0.94 + v0 * scale; // y grows up, canvas y grows down
  const project = p => [ox + v.h(p) * scale, oy - p.y * scale, v.depth(p) * scale];
  return { v, scale, project };
});

const rgb = new Uint8ClampedArray(W * H * 3).fill(0);
for (let i = 0; i < W * H; i++) { rgb[i * 3] = 18; rgb[i * 3 + 1] = 20; rgb[i * 3 + 2] = 26; }
const depth = new Float32Array(W * H).fill(-Infinity);
const light = new THREE.Vector3(0.35, 0.55, 0.76).normalize();
const triShade = t => {
  const d = t[9] * light.x + t[10] * light.y + t[11] * light.z;
  return 0.35 + 0.65 * Math.max(0, Math.abs(d)); // double-sided silhouettes
};
for (let pi = 0; pi < panels.length; pi++) {
  const panel = panels[pi];
  const xOff = pi * PANEL;
  depth.fill(-Infinity);
  for (const t of tris) {
    const P = [0, 1, 2].map(k => { const q = panel.project({ x: t[k * 3], y: t[k * 3 + 1], z: t[k * 3 + 2] }); q[0] += xOff; return q; });
    const minX = Math.max(xOff, Math.floor(Math.min(P[0][0], P[1][0], P[2][0])));
    const maxX = Math.min(xOff + PANEL - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    if (minX > maxX || minY > maxY) continue;
    const [x0, y0, z0] = P[0], [x1, y1, z1] = P[1], [x2, y2, z2] = P[2];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) continue;
    const shade = triShade(t);
    const cr = Math.min(255, t[12] * 210 * shade + 18), cg = Math.min(255, t[13] * 200 * shade + 20), cb = Math.min(255, t[14] * 190 * shade + 26);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const o = y * W + x;
        if (z <= depth[o]) continue;
        depth[o] = z;
        rgb[o * 3] = cr; rgb[o * 3 + 1] = cg; rgb[o * 3 + 2] = cb;
      }
    }
  }
  // ground line at y=0 when it is in frame
  const gy = panel.project({ x: 0, y: 0, z: 0 })[1];
  if (gy >= 0 && gy < H) for (let x = xOff; x < xOff + PANEL; x++) {
    const o = Math.round(gy) * W + x;
    rgb[o * 3] = 120; rgb[o * 3 + 1] = 110; rgb[o * 3 + 2] = 80;
  }
  // panel divider
  for (let y = 0; y < H; y++) { const o = y * W + xOff; rgb[o * 3] = 60; rgb[o * 3 + 1] = 60; rgb[o * 3 + 2] = 70; }
}

// joint overlay: draw bone segments + heads projected per panel
if (jointsFile) {
  const rigged = await load(jointsFile);
  const arm = [];
  rigged.scene.traverse(n => { if (n.isBone) arm.push(n); });
  const bones = arm.filter(b => /Hips|Spine|Chest|Neck|Head|Shoulder|Arm|ForeArm|Hand|UpLeg|Leg|Foot/.test(b.name))
    .filter(b => !/finger|thumb|index|middle|ring|pinky/i.test(b.name));
  const drawLine = (x0, y0, x1, y1, r, g, b) => {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const o = yy * W + xx; rgb[o * 3] = r; rgb[o * 3 + 1] = g; rgb[o * 3 + 2] = b;
      }
    }
  };
  const drawDot = (x, y, r, g, b) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      const xx = Math.round(x + dx), yy = Math.round(y + dy);
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
      const o = yy * W + xx; rgb[o * 3] = r; rgb[o * 3 + 1] = g; rgb[o * 3 + 2] = b;
    }
  };
  for (let pi = 0; pi < panels.length; pi++) {
    const panel = panels[pi], xOff = pi * PANEL;
    for (const bone of bones) {
      const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      const tail = new THREE.Vector3(0, bone.length, 0).applyMatrix4(bone.matrixWorld);
      const pa = panel.project({ x: a.x, y: a.y, z: a.z });
      const pt = panel.project({ x: tail.x, y: tail.y, z: tail.z });
      pa[0] += xOff; pt[0] += xOff;
      const isLeft = /^Left/.test(bone.name), isRight = /^Right/.test(bone.name);
      const col = isLeft ? [80, 220, 255] : isRight ? [255, 130, 80] : [180, 255, 120];
      drawLine(pa[0], pa[1], pt[0], pt[1], ...col);
      drawDot(pa[0], pa[1], ...col);
    }
  }
  console.log(JSON.stringify({ joints: bones.length, names: bones.map(b => b.name) }));
}

// PNG encode
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = rgb[y * W * 3 + x];
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(JSON.stringify({ out, bytes: png.length, triangles: tris.length, size: size.toArray().map(v => +v.toFixed(3)), min: box.min.toArray().map(v => +v.toFixed(3)) }));
