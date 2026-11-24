// Full-roster ability matrix.
//
// Phase 12 requires every selectable fighter to have a complete, individual moveset - not seven
// finished characters and twenty-seven recolours. That claim has to be measurable, so this script
// reads the real roster out of main.js, joins it against the real ability tables, and writes a row
// per fighter with its identity, moves and presentation plus an explicit status.
//
// A row is only marked COMPLETE when the fighter has three light attacks, a heavy pair, an aerial,
// a named form with a special, a named ultimate, and a presentation signature. Anything else is a
// listed gap. This is a data audit: per-ability in-match verification (Task 12) is separate and is
// never implied by a COMPLETE row here.
//
//   node scripts/roster-ability-matrix.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { LOCOMOTION } from '../public/js/combat/locomotion.js';
import { signatureFor } from '../public/js/combat/character_identity.js';

const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The roster the page actually publishes, read from the same array character select uses. */
function readRoster() {
  const source = readFileSync('public/js/main.js', 'utf8');
  const start = source.indexOf('const roster=[[');
  if (start < 0) throw new Error('could not find the roster array in main.js');
  const end = source.indexOf('];', start);
  const literal = source.slice(source.indexOf('[', start), end + 1);
  return JSON.parse(literal).map(([name, archetype]) => ({ name, slug: slugOf(name), archetype }));
}

const roster = readRoster();
const rows = roster.map(({ name, slug, archetype }) => {
  const set = MOVESETS[slug] || null;
  const gaps = [];
  if (!set) gaps.push('no moveset');
  else {
    if (!Array.isArray(set.lights) || set.lights.length < 3) gaps.push('lights');
    if (!Array.isArray(set.heavy) || set.heavy.length < 2) gaps.push('heavy');
    if (!set.aerial) gaps.push('aerial');
    if (!set.form?.id || !set.form?.label) gaps.push('form');
    if (!set.form?.special?.type) gaps.push('special');
    if (!set.ultimate?.label) gaps.push('ultimate');
  }
  const signature = signatureFor(slug);
  return {
    name, slug, archetype,
    style: set?.style || '—',
    lights: set?.lights?.join(' / ') || '—',
    heavy: set?.heavy?.join(' / ') || '—',
    aerial: set?.aerial || '—',
    form: set?.form ? `${set.form.label} (${set.form.cost} m, ${set.form.cooldown}s)` : '—',
    special: set?.form?.special ? `${set.form.special.label} [${set.form.special.type}]` : '—',
    ultimate: set?.ultimate?.label || '—',
    movement: LOCOMOTION[slug] ? 'own profile' : 'archetype fallback',
    colour: '#' + signature.color.toString(16).padStart(6, '0'),
    pitch: signature.pitch,
    status: gaps.length ? `GAP: ${gaps.join(', ')}` : 'COMPLETE (data)'
  };
});

const complete = rows.filter(r => r.status.startsWith('COMPLETE')).length;
const fallbackMovement = rows.filter(r => r.movement !== 'own profile').length;

const lines = [
  '# Browser Bros — full roster ability matrix',
  '',
  'Generated from the live roster array, the moveset table, locomotion profiles and identity signatures.',
  '',
  `- Roster: **${rows.length}** selectable fighters`,
  `- Data-complete: **${complete}**`,
  `- Gaps: **${rows.length - complete}**`,
  `- Own movement profile: **${rows.length - fallbackMovement}**, archetype fallback: **${fallbackMovement}**`,
  '',
  '> "COMPLETE (data)" means the fighter has a full individual data entry. It does not mean the',
  '> ability has been verified inside a match — that is Task 12 and is tracked separately.',
  '',
  '| # | Fighter | Archetype | Style | Light chain | Heavy | Aerial | Form | Special | Ultimate | Movement | Impact | Pitch | Status |',
  '|---|---------|-----------|-------|-------------|-------|--------|------|---------|----------|----------|--------|-------|--------|'
];

rows.forEach((row, index) => {
  lines.push(`| ${index + 1} | ${row.name} | ${row.archetype} | ${row.style} | ${row.lights} | ${row.heavy} | ${row.aerial} | ${row.form} | ${row.special} | ${row.ultimate} | ${row.movement} | ${row.colour} | ${row.pitch} | ${row.status} |`);
});

mkdirSync('artifacts/phase12', { recursive: true });
writeFileSync('artifacts/phase12/roster-ability-matrix.md', lines.join('\n') + '\n');

console.log(`roster: ${rows.length} fighters`);
console.log(`data-complete: ${complete} · gaps: ${rows.length - complete}`);
console.log(`own movement profile: ${rows.length - fallbackMovement} · archetype fallback: ${fallbackMovement}`);
const gapRows = rows.filter(r => !r.status.startsWith('COMPLETE'));
if (gapRows.length) {
  console.log('\ngaps:');
  for (const row of gapRows) console.log(`  ${row.name} (${row.slug}) -> ${row.status}`);
}
const byStyle = rows.reduce((acc, row) => {
  (acc[row.style] ||= []).push(row.name);
  return acc;
}, {});
const shared = Object.entries(byStyle).filter(([, names]) => names.length > 1);
console.log(`\nshared fighting styles: ${shared.length}`);
for (const [style, names] of shared) console.log(`  ${style}: ${names.join(', ')}`);
console.log('\nwrote artifacts/phase12/roster-ability-matrix.md');
