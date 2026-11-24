// Phase 24 roster identity matrix.
// Reads the real per-identity data (locomotion, flight, movesets, motion style) rather than
// assuming a registration means a playable identity. Uniqueness is counted, not asserted: the
// summary reports how many DISTINCT values exist on each axis.
import * as loco from '../public/js/combat/locomotion.js';
import * as flight from '../public/js/combat/flight.js';
import * as motion from '../public/js/anim/motion_style.js';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { readFileSync } from 'node:fs';

function findTable(ns, probeKey) {
  for (const [name, value] of Object.entries(ns)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && probeKey in value) return { name, table: value };
  }
  return { name: null, table: {} };
}

const identities = Object.keys(MOVESETS);
const locoTable = findTable(loco, 'goku');
const flightTable = findTable(flight, 'goku');
const styleTable = findTable(motion, identities[0] || 'superman') || findTable(motion, 'goku');

const mainSource = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
const specials = new Map();
for (const m of mainSource.matchAll(/([a-z0-9_]+):\{label:'([^']*)',type:'([a-z]+)'/g)) {
  if (!specials.has(m[1])) specials.set(m[1], { label: m[2], type: m[3] });
}

const clipVariety = new Map();
for (const m of mainSource.matchAll(/([a-z0-9_]+):\s*Object\.freeze\(\{\s*key/g)) clipVariety.set(m[1], true);

const rows = identities.map(key => {
  const ms = MOVESETS[key];
  const l = locoTable.table[key] || null;
  const f = flightTable.table[key] || null;
  const style = styleTable.table?.[key] || null;
  return {
    identity: key,
    locomotion: l ? { sprint: l.sprint, accel: l.accel, jump: l.jump, gravity: l.gravity, turn: l.turn } : null,
    flight: f ? { cruise: f.cruise, boost: f.boost, climb: f.climb, brake: f.brake } : null,
    animationStyle: style?.id || style?.label || (typeof style === 'string' ? style : null),
    styleNote: style?.note || null,
    stance: ms?.style || null,
    lights: ms?.lights || [],
    heavy: ms?.heavy || [],
    aerial: ms?.aerial || null,
    form: ms?.form ? { label: ms.form.label, aura: ms.form.aura, mods: ms.form.mods, special: ms.form.special?.label || null } : null,
    ultimate: ms?.ultimate ? { label: ms.ultimate.label, behaviour: ms.ultimate.behaviour } : null,
    signature: specials.get(key) || null,
    hasCinematic: Boolean(ms?.ultimate?.cinematic || ms?.ultimate?.sequence || ms?.ultimate?.stages)
  };
});

const distinct = (values) => new Set(values.filter(v => v !== null && v !== undefined).map(v => JSON.stringify(v))).size;
const summary = {
  identities: rows.length,
  withLocomotion: rows.filter(r => r.locomotion).length,
  withFlight: rows.filter(r => r.flight).length,
  withSignature: rows.filter(r => r.signature).length,
  withForm: rows.filter(r => r.form).length,
  withUltimate: rows.filter(r => r.ultimate).length,
  withCinematicUltimate: rows.filter(r => r.hasCinematic).length,
  distinct: {
    locomotionProfiles: distinct(rows.map(r => r.locomotion)),
    flightProfiles: distinct(rows.map(r => r.flight)),
    animationStyles: distinct(rows.map(r => r.animationStyle)),
    stances: distinct(rows.map(r => r.stance)),
    lightSets: distinct(rows.map(r => r.lights)),
    heavySets: distinct(rows.map(r => r.heavy)),
    aerialLabels: distinct(rows.map(r => r.aerial)),
    ultimateLabels: distinct(rows.map(r => r.ultimate?.label)),
    ultimateBehaviours: distinct(rows.map(r => r.ultimate?.behaviour)),
    signatureLabels: distinct(rows.map(r => r.signature?.label)),
    formLabels: distinct(rows.map(r => r.form?.label))
  },
  // Honest red flags: an axis with one value across 34 fighters is shared presentation, not identity.
  sharedAcrossRoster: Object.entries({
    animationStyle: distinct(rows.map(r => r.animationStyle)),
    ultimateBehaviour: distinct(rows.map(r => r.ultimate?.behaviour)),
    stance: distinct(rows.map(r => r.stance)),
    lights: distinct(rows.map(r => r.lights)),
    heavy: distinct(rows.map(r => r.heavy))
  }).filter(([, n]) => n <= 2).map(([axis, n]) => ({ axis, distinct: n })),
  rows
};

console.log(JSON.stringify(summary, null, 2));
