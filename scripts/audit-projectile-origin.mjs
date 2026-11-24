// Per-MOVE roster coverage audit.
// Base signatures live in main.js SPECIAL_MOVES; MOVESETS holds form.special and ultimate.behaviour.
import { readFileSync } from 'node:fs';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { originPolicyFor, ORIGIN_OVERRIDES, identityKeyOf } from '../public/js/combat/projectile_origin.js';

const mainSource = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const baseSpecials = new Map();
const entryPattern = /([a-z0-9_]+):\{label:'([^']*)',type:'([a-z]+)'/g;
let m;
while ((m = entryPattern.exec(mainSource)) !== null) {
  if (!baseSpecials.has(m[1])) baseSpecials.set(m[1], { label: m[2], type: m[3] });
}

const rows = [];
for (const [key, moveset] of Object.entries(MOVESETS)) {
  const slug = identityKeyOf({ identityKey: key });
  const base = baseSpecials.get(slug) || null;
  const form = moveset?.form || null;
  const ultimate = moveset?.ultimate || null;
  const policy = base ? originPolicyFor({ identityKey: slug }) : null;
  const moves = [];
  if (base) moves.push({ kind: 'signature', label: base.label, type: base.type, path: 'spawnProjectile', policy });
  if (form?.special) moves.push({ kind: 'transformed-signature', label: form.special.label, type: form.special.type, path: 'spawnProjectile', policy });
  if (ultimate) moves.push({ kind: 'ultimate', label: ultimate.label || null, behaviour: ultimate.behaviour || null, path: ultimate.behaviour ? 'behaviour-move' : 'unknown' });
  rows.push({
    identity: key,
    baseSignature: base,
    transformation: form ? { label: form.label || null, special: form.special?.label || null } : null,
    ultimate: ultimate ? { label: ultimate.label || null, behaviour: ultimate.behaviour || null } : null,
    originPolicy: policy,
    usesProjectile: moves.some(x => x.path === 'spawnProjectile'),
    usesBehaviourMove: moves.some(x => x.path === 'behaviour-move'),
    moves
  });
}

const proj = rows.filter(r => r.usesProjectile);
const byPolicy = proj.reduce((a, r) => { a[r.originPolicy] = (a[r.originPolicy] || 0) + 1; return a; }, {});
const moveCounts = rows.flatMap(r => r.moves).reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {});

console.log(JSON.stringify({
  total: rows.length,
  withProjectileSignature: proj.length,
  withoutProjectileSignature: rows.filter(r => !r.usesProjectile).map(r => r.identity),
  withBehaviourUltimate: rows.filter(r => r.usesBehaviourMove).length,
  byOriginPolicy: byPolicy,
  moveCounts,
  overridesExercised: Object.keys(ORIGIN_OVERRIDES).filter(s => proj.some(r => identityKeyOf({ identityKey: r.identity }) === s)),
  overridesNotOnRoster: Object.keys(ORIGIN_OVERRIDES).filter(s => !rows.some(r => identityKeyOf({ identityKey: r.identity }) === s)),
  rows
}, null, 2));
