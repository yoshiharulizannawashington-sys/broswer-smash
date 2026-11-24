// AI brain test: every fighter must have a personality, behaviour must differ by archetype, and
// decisions must stay decisions (no damage or health inflation), not hidden stat buffs.
//
//   node scripts/test-ai-brain.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARCHETYPES, personalityFor, decide, neutralInput } from '../public/js/combat/ai_brain.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- the real roster must all resolve -----------------------------------
const main = readFileSync('public/js/main.js', 'utf8');
const rosterBlock = main.match(/const roster=\[([\s\S]*?)\];/);
check('the roster is present in main.js', Boolean(rosterBlock));
const identities = [...rosterBlock[1].matchAll(/\["([^"]+)",\s*"[^"]+"\]/g)].map(m => m[1]);
check('the roster was parsed', identities.length >= 30, `${identities.length} fighters`);

const resolved = identities.map(name => ({ name, persona: personalityFor(name, {}, {}) }));
check('every roster fighter gets a personality',
  resolved.every(entry => entry.persona && entry.persona.id),
  resolved.filter(e => !e.persona?.id).map(e => e.name).join(', '));
const used = new Set(resolved.map(entry => entry.persona.id));
check('at least four archetypes are represented across the roster', used.size >= 4, [...used].join(', '));

// Identity overrides land where they should.
check('The Flash is evasive', personalityFor('The Flash (Barry Allen)').id === 'evasive');
check('Hulk is heavy', personalityFor('Hulk (Bruce Banner)').id === 'heavy');
check('Doctor Strange is ranged energy', personalityFor('Doctor Strange').id === 'energy');
check('Superman is aggressive', personalityFor('Superman').id === 'aggressive');
check('an unknown identity still resolves', Boolean(personalityFor('Brand New Fighter').id));
check('weight drives a heavy fallback for an unknown fighter',
  personalityFor('Mystery Brute', { weight: 1.4 }).id === 'heavy');
check('profile damage drives an aggressive fallback',
  personalityFor('Mystery Striker', { damage: 1.2 }).id === 'aggressive');

// ---- decisions are decisions, never stats ------------------------------
const sample = decide({ distance: 3, dx: 3, dz: 0, attackTimerReady: true }, { range: 3, hesitation: 0 }, ARCHETYPES.aggressive, () => 0.5);
check('the decision has the full input shape',
  Object.keys(sample).length === Object.keys(neutralInput()).length);
const forbidden = ['damage', 'damageScale', 'health', 'hp', 'weight', 'knockback', 'percent'];
check('no decision carries a damage or health multiplier',
  forbidden.every(key => !(key in sample)), forbidden.filter(k => k in sample).join(', '));

// ---- personality changes behaviour -------------------------------------
const seed = () => { let s = 42; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };
const trials = (persona, distance, range, hesitation = 0.2) => {
  let attacks = 0, approaches = 0;
  for (let i = 0; i < 200; i++) {
    const input = decide({ distance, dx: distance, dz: 0, attackTimerReady: true, selfPercent: 40 }, { range, hesitation }, persona, seed());
    if (input.attack) attacks++;
    if (input.left || input.right) approaches++;
  }
  return { attacks, approaches };
};
// Attack pressure: at 2.85 m the aggressive's extended reach (range x 1.05) connects while the
// defensive's shortened reach (range x 0.95) does not. Comparing outside both ranges would prove
// nothing - which is exactly what the first version of this test did (0 vs 0).
const aggressive = trials(ARCHETYPES.aggressive, 2.85, 2.8);
const defensive = trials(ARCHETYPES.defensive, 2.85, 2.8);
check('an aggressive fighter attacks at a distance a defensive one holds back from',
  aggressive.attacks > 0 && defensive.attacks === 0, `${aggressive.attacks} vs ${defensive.attacks}`);
// Distance management: at 3 m the aggressive still wants to close, the defensive is at its range.
const aggressiveGap = trials(ARCHETYPES.aggressive, 3, 2.8);
const defensiveGap = trials(ARCHETYPES.defensive, 3, 2.8);
check('an aggressive fighter closes a gap a defensive one leaves open',
  aggressiveGap.approaches > defensiveGap.approaches, `${aggressiveGap.approaches} vs ${defensiveGap.approaches}`);
const energy = trials(ARCHETYPES.energy, 6, 4);
const aggressiveFar = trials(ARCHETYPES.aggressive, 6, 4);
check('a ranged fighter does not rush a distant opponent like a brawler',
  energy.approaches < aggressiveFar.approaches, `${energy.approaches} vs ${aggressiveFar.approaches}`);

// ---- defensive reactions ------------------------------------------------
for (const persona of Object.values(ARCHETYPES)) {
  const react = decide({ distance: 2, dx: 2, dz: 0, incoming: true, attackTimerReady: true }, { parry: 0.6, block: 0.3, dodge: 0.3 }, persona, () => 0.1);
  check(`${persona.id} defends instead of attacking when a strike is in startup`,
    (react.parry || react.shield || react.dodge) && !react.attack);
}
const calm = decide({ distance: 2, dx: 2, dz: 0, incoming: false }, { parry: 0.9, block: 0.9 }, ARCHETYPES.defensive, () => 0.1);
check('defence does not fire when nothing is incoming', !calm.parry && !calm.shield);

// ---- energy management -------------------------------------------------
const noMeter = decide({ distance: 5, dx: 5, ultimateMeter: 60 }, { ultimate: 1 }, ARCHETYPES.aggressive, () => 0);
check('an ultimate is never used before the meter is full', noMeter.ultimate === false);
const fullMeter = decide({ distance: 5, dx: 5, ultimateMeter: 100 }, { ultimate: 1 }, ARCHETYPES.aggressive, () => 0);
check('a full meter can be spent', fullMeter.ultimate === true);
const clinchSpecial = decide({ distance: 1.2, dx: 1.2, specialReady: true }, { special: 1 }, ARCHETYPES.energy, () => 0);
check('a special is not fired point-blank', clinchSpecial.special === false);
const rangedSpecial = decide({ distance: 7, dx: 7, specialReady: true }, { special: 1 }, ARCHETYPES.energy, () => 0);
check('a special is fired from its useful range', rangedSpecial.special === true);

// ---- environmental awareness and recovery ------------------------------
const edge = decide({ distance: 5, edgeDistance: 0.8, toCenterX: -1, toCenterZ: 0 }, {}, ARCHETYPES.aggressive, () => 0);
check('a fighter on the edge walks back toward the centre', edge.left === true && edge.attack === false);
const hurt = decide({ distance: 1.2, dx: 1.2, selfPercent: 190, attackTimerReady: true }, { range: 3 }, ARCHETYPES.evasive, () => 0.99);
check('a badly hurt evasive fighter backs off instead of trading', hurt.left === true);
const aerial = decide({ distance: 4, airborne: true, canFly: true, flightMode: true, selfY: 1, foeY: 6 }, {}, ARCHETYPES.aggressive, () => 0.5);
check('a flying fighter climbs toward an airborne opponent', aerial.ascend === true);

// ---- determinism -------------------------------------------------------
const a = decide({ distance: 3, dx: 3, attackTimerReady: true }, { hesitation: 0.2, special: 0.5 }, ARCHETYPES.heavy, seed());
const b = decide({ distance: 3, dx: 3, attackTimerReady: true }, { hesitation: 0.2, special: 0.5 }, ARCHETYPES.heavy, seed());
check('the same snapshot and random sequence give the same decision',
  JSON.stringify(a) === JSON.stringify(b));

console.log(`\nAI brain checks passed (${checks} checks).`);
