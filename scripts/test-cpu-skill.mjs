// CPU difficulty audit. Runs without a browser.
//
//   node scripts/test-cpu-skill.mjs
//
// Difficulty has to be a decision-quality setting. If an "ace" only dealt more damage or had more
// health, the game would not get harder to read, it would just get unfair. This test pins that
// intent:
//   1. the three levels are ordered in the direction that actually makes the opponent harder
//      (faster reaction, more defence, more commitment to specials and meter),
//   2. every level is complete - a missing key would make the AI evaluate undefined comparisons
//      and quietly stop acting,
//   3. no level carries a damage, health, weight or knockback field at all,
//   4. an unknown or missing level falls back to the documented default,
//   5. main.js really reads the table instead of keeping its own private probabilities, so the
//      old hard-coded numbers cannot creep back in and silently override the setting.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CPU_SKILLS, CPU_SKILL_LEVELS, DEFAULT_SKILL_LEVEL, normalizeSkillLevel, skillFor, skillTable
} from '../public/js/combat/cpu_skill.js';

let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ok  ${name}`);
}

const LEVELS = [...CPU_SKILL_LEVELS];
const PROFILES = LEVELS.map(level => CPU_SKILLS[level]);

check('three difficulty levels exist', LEVELS.length === 3, LEVELS.join(', '));
check('the default level is a real level', LEVELS.includes(DEFAULT_SKILL_LEVEL), DEFAULT_SKILL_LEVEL);
check('skillFor returns the profile for a level', skillFor('ace') === CPU_SKILLS.ace);
check('a missing level falls back to the default', skillFor(undefined) === CPU_SKILLS[DEFAULT_SKILL_LEVEL]);
check('a misspelled level falls back to the default', skillFor('LEGENDARY') === CPU_SKILLS[DEFAULT_SKILL_LEVEL]);
check('a padded, upper-case level normalises', normalizeSkillLevel('  ACE ') === 'ace');
check('skillTable is ordered weakest to strongest',
  skillTable().map(profile => profile.level).join('|') === 'rookie|fighter|ace');

// ---- every profile is complete and self-consistent ---------------------------
const REQUIRED = ['cooldown', 'cooldownJitter', 'range', 'notice', 'readAhead', 'parry', 'block',
  'dodge', 'hesitation', 'special', 'form', 'ultimate'];
for (const profile of PROFILES) {
  const missing = REQUIRED.filter(key => !Number.isFinite(profile[key]));
  check(`${profile.level} defines every decision parameter`, missing.length === 0, missing.join(', '));
  const probabilities = ['parry', 'block', 'dodge', 'hesitation', 'special', 'form', 'ultimate'];
  const outOfRange = probabilities.filter(key => profile[key] < 0 || profile[key] > 1);
  check(`${profile.level} keeps its probabilities in range`, outOfRange.length === 0, outOfRange.join(', '));
  check(`${profile.level} has a positive attack cooldown`, profile.cooldown > 0, String(profile.cooldown));
  check(`${profile.level} has a positive notice distance`, profile.notice > 0, String(profile.notice));
  check(`${profile.level} has a label for the pause menu`, Boolean(profile.label), profile.label);
}

// ---- difficulty is ordered, and never a stat --------------------------------
const [rookie, fighter, ace] = [CPU_SKILLS.rookie, CPU_SKILLS.fighter, CPU_SKILLS.ace];
const rising = key => {
  check(`${key} rises with skill`, rookie[key] < fighter[key] && fighter[key] < ace[key],
    `${rookie[key]} -> ${fighter[key]} -> ${ace[key]}`);
};
const falling = key => {
  check(`${key} falls with skill`, rookie[key] > fighter[key] && fighter[key] > ace[key],
    `${rookie[key]} -> ${fighter[key]} -> ${ace[key]}`);
};
// Reaction: the ace attacks sooner and notices a startup from further away with more of it visible.
falling('cooldown');
rising('notice');
rising('readAhead');
// Defence.
rising('parry');
rising('block');
rising('dodge');
// Commitment: the rookie declines more attacks and almost never spends a special or the meter.
falling('hesitation');
rising('special');
rising('form');
rising('ultimate');

const FORBIDDEN = ['damage', 'damageScale', 'health', 'hp', 'weight', 'knockback', 'kbs', 'percent', 'launch'];
for (const profile of PROFILES) {
  const stats = FORBIDDEN.filter(key => key in profile);
  check(`${profile.level} carries no health or damage multiplier`, stats.length === 0, stats.join(', '));
}

// ---- main.js must actually consume the table --------------------------------
const main = readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
check('the AI reads the current skill profile each decision', /const skill=cpuSkill\(\)/.test(main));
check('the AI resolves a level through skillFor', /skillFor\(cpuSkillLevel\)/.test(main));
check('the AI uses the profile for its attack timing', /cpu\.aiTimer=skill\.cooldown/.test(main));
check('the AI uses the profile for its defence', /Math\.random\(\)<skill\.parry/.test(main) && /Math\.random\(\)<skill\.block/.test(main));
check('the AI uses the profile for its attacks', /Math\.random\(\)>skill\.hesitation/.test(main));
const staleNumbers = ['<.72;', '<.13;', '<.018;', '<.28;', '>.22&&'].filter(fragment => main.includes(fragment));
check('the old hard-coded AI probabilities are gone', staleNumbers.length === 0, staleNumbers.join(' '));
check('the level is persisted for the next session', /browserSmashCpuSkill/.test(main));
check('the setup screen receives the live level', /difficulty:cpuSkillLevel/.test(main));

console.log(`\nCPU skill test passed (${checks} checks).`);
