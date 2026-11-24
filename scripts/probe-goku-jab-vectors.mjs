// Numeric probe: where does the right hand end up, in rig space, for candidate jab contact poses?
// Rig space is Z-up (feet at z=0). Forward is derived from the foot->toe direction, so the table says
// whether a candidate actually punches toward the opponent instead of sideways or backwards.
import { readFileSync } from 'node:fs';

const buf = readFileSync('artifacts/goku-repair/repaired/goku.glb');
const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
const nodes = json.nodes;
const joints = json.skins[0].joints;
const parentOf = new Map();
nodes.forEach((n, i) => (n.children || []).forEach(c => parentOf.set(c, i)));
const byName = new Map(joints.map(i => [nodes[i].name, i]));
const rest = new Map();
for (const i of joints) {
  const n = nodes[i];
  rest.set(n.name, {
    parent: parentOf.has(i) ? nodes[parentOf.get(i)].name : null,
    t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1]
  });
}

const DEG = Math.PI / 180;
const quat = ([x, y, z]) => {
  const c1 = Math.cos(x * DEG / 2), c2 = Math.cos(y * DEG / 2), c3 = Math.cos(z * DEG / 2);
  const s1 = Math.sin(x * DEG / 2), s2 = Math.sin(y * DEG / 2), s3 = Math.sin(z * DEG / 2);
  return [s1*c2*c3 + c1*s2*s3, c1*s2*c3 - s1*c2*s3, c1*c2*s3 + s1*s2*c3, c1*c2*c3 - s1*s2*s3];
};
const mul = (a, b) => [
  a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
  a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
  a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
  a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
];
const rotV = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2*(y*v[2] - z*v[1]), ty = 2*(z*v[0] - x*v[2]), tz = 2*(x*v[1] - y*v[0]);
  return [v[0] + w*tx + (y*tz - z*ty), v[1] + w*ty + (z*tx - x*tz), v[2] + w*tz + (x*ty - y*tx)];
};
const BASE = {
  Hips: [0,0,0], Spine: [3,0,0], Chest: [2,0,0], Neck: [-3,0,0], Head: [-2,0,0],
  LeftShoulder: [0,0,-3], RightShoulder: [0,0,3],
  LeftArm: [-59,-6,0], RightArm: [-61,6,0],
  LeftForeArm: [-38,0,0], RightForeArm: [-40,0,0],
  LeftHand: [0,0,0], RightHand: [0,0,0],
  LeftUpLeg: [-5,0,0], RightUpLeg: [-5,0,0], LeftLeg: [11,0,0], RightLeg: [12,0,0],
  LeftFoot: [-5,0,0], RightFoot: [-6,0,0]
};
function pose(changes = {}) {
  const out = {};
  for (const [b, r] of Object.entries(BASE)) out[b] = [...r];
  for (const [b, d] of Object.entries(changes)) {
    if (b === '_lift') continue;
    const before = out[b] || [0,0,0];
    out[b] = [before[0]+d[0], before[1]+d[1], before[2]+d[2]];
  }
  // same +45 degree arm rebase the authoring script applies
  for (const b of ['LeftArm', 'RightArm']) out[b][0] += 45;
  return out;
}
function fk(values) {
  const P = new Map(), R = new Map(), I = [0,0,0,1], O = [0,0,0];
  const visit = name => {
    if (P.has(name)) return;
    const info = rest.get(name);
    if (!info) return;
    const parent = info.parent && rest.has(info.parent) ? info.parent : null;
    if (parent) visit(parent);
    const pr = parent ? R.get(parent) : I, pp = parent ? P.get(parent) : O;
    const r = mul(info.r, values[name] ? quat(values[name]) : I);
    const l = rotV(pr, info.t);
    P.set(name, [pp[0]+l[0], pp[1]+l[1], pp[2]+l[2]]);
    R.set(name, mul(pr, r));
  };
  for (const n of rest.keys()) visit(n);
  return P;
}
const round = v => v.map(n => +n.toFixed(4));

const stance = fk(pose());
const hip = stance.get('Hips');
const foot = stance.get('RightFoot'), toe = stance.get('DEF_Toe.R_054') || stance.get('RightToeBase');
// Rig-space forward: horizontal foot->toe direction, normalized.
let fwd = [toe[0]-foot[0], toe[1]-foot[1], 0];
const len = Math.hypot(...fwd) || 1;
fwd = fwd.map(n => n / len);
const side = [-fwd[1], fwd[0], 0];
console.log('HIP', round(hip), 'FWD', round(fwd), 'TOE', round(toe), 'HAND_STANCE', round(stance.get('RightHand')));

const forwardOf = p => (p[0]-hip[0])*fwd[0] + (p[1]-hip[1])*fwd[1];
const sideOf = p => (p[0]-hip[0])*side[0] + (p[1]-hip[1])*side[1];
const cases = {
  stance: {},
  original: { RightArm: [-72,-28,78], RightForeArm: [44,0,0], RightHand: [0,0,0], Spine: [0,12,0], Hips: [0,10,0], RightShoulder: [0,0,10] },
  B_forward_x: { RightArm: [-72,0,0], RightForeArm: [44,0,0] },
  C_x90: { RightArm: [-95,0,0], RightForeArm: [44,0,0] },
  D_z40: { RightArm: [-60,0,40], RightForeArm: [44,0,0] },
  E_z55: { RightArm: [-60,0,55], RightForeArm: [44,0,0] },
  F_z70: { RightArm: [-62,0,70], RightForeArm: [44,0,0] },
  G_z80: { RightArm: [-62,0,80], RightForeArm: [44,0,0] },
  H_z70_straight: { RightArm: [-62,0,70], RightForeArm: [84,0,0] },
  I_z55_straight: { RightArm: [-55,0,55], RightForeArm: [84,0,0] },
  J_front_z30: { RightArm: [-85,0,30], RightForeArm: [84,0,0] },
  K_orig_straight: { RightArm: [-72,-28,78], RightForeArm: [84,0,0] },
  L_orig_fore0: { RightArm: [-72,-28,78], RightForeArm: [0,0,0], Spine: [0,12,0], Hips: [0,10,0], RightShoulder: [0,0,10] },
  M_orig_fore20: { RightArm: [-72,-28,78], RightForeArm: [20,0,0], Spine: [0,12,0], Hips: [0,10,0], RightShoulder: [0,0,10] },
  N_orig_fore60: { RightArm: [-72,-28,78], RightForeArm: [60,0,0], Spine: [0,12,0], Hips: [0,10,0], RightShoulder: [0,0,10] },
  O_reach: { RightArm: [-80,-24,70], RightForeArm: [40,0,0], Spine: [0,20,0], Chest: [0,12,0], Hips: [0,16,0], RightShoulder: [0,0,12] },
  P_reach2: { RightArm: [-86,-20,64], RightForeArm: [30,0,0], Spine: [0,22,0], Chest: [0,14,0], Hips: [0,18,0], RightShoulder: [0,-6,12] },
  Q_reach3: { RightArm: [-78,-14,72], RightForeArm: [36,0,0], Spine: [0,18,0], Chest: [0,10,0], Hips: [0,14,0], RightShoulder: [0,0,8] }
};
for (const [name, changes] of Object.entries(cases)) {
  const p = fk(pose(changes));
  const hand = p.get('RightHand');
  const elbow = p.get('RightForeArm');
  console.log(name.padEnd(14), 'HAND', round(hand), 'fwd', forwardOf(hand).toFixed(3), 'side', sideOf(hand).toFixed(3), 'height', (hand[2]-hip[2]).toFixed(3), 'elbow', round(elbow));
}
