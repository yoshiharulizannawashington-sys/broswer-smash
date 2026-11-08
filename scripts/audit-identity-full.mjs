// Complete roster identity audit: counts every selectable identity and measures how many DISTINCT
// values exist on each identity axis. Duplicates are the finding; nothing here is asserted.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MOVESETS } from '../public/js/combat/movesets.js';
import { LOCOMOTION } from '../public/js/combat/locomotion.js';
import * as motion from '../public/js/anim/motion_style.js';
import { signatureFor } from '../public/js/combat/character_identity.js';

const slugOf = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const main = readFileSync('public/js/main.js','utf8');

// 1. Roster the page publishes (same array character select uses).
const start = main.indexOf('const roster=[[');
const end = main.indexOf('];', start);
const roster = JSON.parse(main.slice(main.indexOf('[', start), end + 1))
  .map(([name, archetype]) => ({ name, slug: slugOf(name), archetype }));

// 2. Other identity sources, counted so the report can reconcile them.
const manifest = JSON.parse(readFileSync('public/models/characters/manifest.json','utf8'));
const manifestEntries = Array.isArray(manifest)
  ? manifest
  : Object.entries(manifest.characters || manifest.entries || manifest)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([id, v]) => ({ id, ...v }));
const onlineRoster = JSON.parse(readFileSync('roster.json','utf8'));

const styleTable = (() => {
  for (const v of Object.values(motion)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.some(k => MOVESETS[k] || roster.some(r => r.slug === k))) return { name: 'motion_style', table: v };
    }
  }
  return { name: null, table: {} };
})();

const keys = (o, fallback = null) => {
  if (!o) return fallback;
  return Array.isArray(o) ? o.join(' / ') : (typeof o === 'string' ? o : JSON.stringify(o));
};

const rows = roster.map(({ name, slug, archetype }) => {
  const ms = MOVESETS[slug] || null;
  const loco = LOCOMOTION[slug] || null;
  const style = styleTable.table?.[slug] || null;
  const sig = signatureFor(slug);
  return {
    name, slug, archetype,
    hasMoveset: Boolean(ms),
    style: ms?.style || null,
    lights: ms?.lights || null,
    heavy: ms?.heavy || null,
    aerial: ms?.aerial || null,
    form: ms?.form ? { label: ms.form.label, aura: ms.form.aura || 'none', special: ms.form.special?.label || null, type: ms.form.special?.type || null } : null,
    ultimate: ms?.ultimate ? { label: ms.ultimate.label, behaviour: ms.ultimate.behaviour || null, hits: ms.ultimate.hits ?? null, damage: ms.ultimate.damage ?? null } : null,
    loco: loco ? { sprint: loco.sprint, walk: loco.walk, run: loco.run, accel: loco.accel, jump: loco.jump, gravity: loco.gravity, turn: loco.turn } : null,
    motionStyle: style ? (style.id || style.label || style) : null,
    motionNote: style?.note || null,
    signature: { label: ms?.form?.special?.label || null, colour: '#' + sig.color.toString(16).padStart(6,'0'), source: sig.source }
  };
});

const distinctOf = f => new Set(rows.map(f).filter(v => v !== null && v !== undefined).map(v => JSON.stringify(v))).size;

// Group duplicate values so the weakest axes are actionable rather than just counted.
const groups = f => {
  const m = new Map();
  for (const r of rows) { const v = f(r); if (v == null) continue; const k = JSON.stringify(v); (m.get(k) || m.set(k, []).get(k)).push(r.name); }
  return [...m.values()].filter(g => g.length > 1).sort((a,b) => b.length - a.length);
};

const axes = {
  fightingStyle: { distinct: distinctOf(r => r.style), groups: groups(r => r.style) },
  lightChain: { distinct: distinctOf(r => r.lights), groups: groups(r => r.lights) },
  heavyPair: { distinct: distinctOf(r => r.heavy), groups: groups(r => r.heavy) },
  aerial: { distinct: distinctOf(r => r.aerial), groups: groups(r => r.aerial) },
  formLabel: { distinct: distinctOf(r => r.form?.label), groups: groups(r => r.form?.label) },
  formAura: { distinct: distinctOf(r => r.form?.aura), groups: groups(r => r.form?.aura) },
  specialType: { distinct: distinctOf(r => r.form?.type), groups: groups(r => r.form?.type) },
  ultimateLabel: { distinct: distinctOf(r => r.ultimate?.label), groups: groups(r => r.ultimate?.label) },
  ultimateBehaviour: { distinct: distinctOf(r => r.ultimate?.behaviour), groups: groups(r => r.ultimate?.behaviour) },
  ultimatePayload: { distinct: distinctOf(r => r.ultimate && [r.ultimate.behaviour, r.ultimate.hits, r.ultimate.damage]), groups: groups(r => r.ultimate && [r.ultimate.behaviour, r.ultimate.hits, r.ultimate.damage]) },
  locomotionProfile: { distinct: distinctOf(r => r.loco), groups: groups(r => r.loco) },
  motionStyle: { distinct: distinctOf(r => r.motionStyle), groups: groups(r => r.motionStyle) },
  impactColour: { distinct: distinctOf(r => r.signature.colour), groups: groups(r => r.signature.colour) }
};

const summary = {
  counts: {
    selectableInMainJs: roster.length,
    movesetIdentities: Object.keys(MOVESETS).length,
    locomotionProfiles: Object.keys(LOCOMOTION).length,
    motionStyleEntries: Object.keys(styleTable.table || {}).length,
    manifestEntries: manifestEntries.length,
    manifestEnabled: manifestEntries.filter(e => e.enabled !== false && !e.disabled).length,
    onlineRosterEntries: onlineRoster.length
  },
  perAxis: Object.fromEntries(Object.entries(axes).map(([k,v]) => [k, { distinct: v.distinct, duplicatedGroups: v.groups.length, biggestGroup: v.groups[0]?.length || 0, example: v.groups[0] || null }])),
  rows
};
mkdirSync('artifacts/dev/identity-audit', { recursive: true });
writeFileSync('artifacts/dev/identity-audit/identity-audit.json', JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary.counts, null, 1));
console.log('\naxis distinct/total (duplicated groups):');
for (const [k,v] of Object.entries(axes)) console.log(`  ${k.padEnd(20)} ${String(v.distinct).padStart(3)}/${rows.length}  groups=${v.groups.length}  biggest=${v.groups[0]?.length || 0}`);
console.log('\nworst shared groups:');
for (const [k,v] of Object.entries(axes)) for (const g of v.groups.slice(0,2)) if (g.length >= 3) console.log(`  ${k}: ${g.length}x -> ${g.slice(0,8).join(', ')}${g.length>8?'…':''}`);
const noSet = rows.filter(r => !r.hasMoveset);
console.log('\nno moveset: ' + (noSet.length ? noSet.map(r => r.name).join(', ') : 'none'));
const noLoco = rows.filter(r => !r.loco);
console.log('no own locomotion: ' + (noLoco.length ? noLoco.length + ' -> ' + noLoco.slice(0,10).map(r=>r.name).join(', ') : 'none'));
