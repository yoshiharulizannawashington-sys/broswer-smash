// Measurement-only hooks for the visual gallery. No behaviour change.
//
// The gallery needs to see the live effects to answer "how big is this hit on screen relative to
// the fighter it covers". Both effect stores are module-private, so this exposes read-only
// handles: the burst/ring list main.js already keeps, and the combat VFX layer's active list.
// Nothing here changes timing, size, colour or gameplay.
//
//   node scripts/_patch-vfx-hooks.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = new URL('../public/js/main.js', import.meta.url);
const PATCHES = [
  [
    "const combatVFX=createCombatVFX(THREE,scene);",
    "const combatVFX=createCombatVFX(THREE,scene);\n"
    + "// Read-only handles for the visual gallery: the live effect meshes and the VFX layer's active\n"
    + "// list, so a capture can measure how much of a fighter an impact covers.\n"
    + "window.combatVFX=combatVFX;\n"
    + "window.__browserSmashEffects=()=>effects;"
  ]
];

const original = readFileSync(TARGET, 'utf8');
let source = original;
for (const [anchor, replacement] of PATCHES) {
  const first = source.indexOf(anchor);
  const last = source.lastIndexOf(anchor);
  if (first < 0 || first !== last) {
    console.error(`anchor ${first < 0 ? 'missing' : 'ambiguous'}: ${anchor.slice(0, 60)}`);
    process.exit(1);
  }
  if (source.includes(replacement)) { console.log('  ALREADY ' + anchor.slice(0, 60)); continue; }
  source = source.replace(anchor, replacement);
  console.log('  ok ' + anchor.slice(0, 60));
}
if (source === original) { console.log('nothing to write'); process.exit(0); }
writeFileSync(TARGET, source);
console.log('measurement hooks added');
