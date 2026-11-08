// One-shot patch: impact/spark readability.
//
// Measured problem (artifacts/gallery/before2/measurements-before2.json): a hit put up to ~190
// additive particles plus one additive flash sphere on a fighter, and the largest single object
// reached 0.71x the fighter's own on-screen height - with the nearest-surface offsets that reads
// as a white puff sitting on the character. Two separate causes:
//
//   1. combat_vfx.impact() built its flash from `.18 + intensity * .012` and then scaled it by up
//      to 4.2x, so a 23-intensity explosion produced a ~2 m radius sphere at .98 opacity with
//      additive blending. That single mesh is the white-out. (Graded per hit kind in that file.)
//   2. Every hit also spawned a flat 24-to-70 full-brightness spheres through burst(), and the
//      `bloom.strength = .95` that was meant to sell the hit is dead data: the render pipeline's
//      bloom is `{enabled:false}` and there is no post-processing chain, so it never did anything.
//
// This patch caps particle size/count/opacity, halves the heaviest explosions, and removes the
// misleading bloom write. No damage, radius, timing, stun or knockback value is touched.
//
//   node scripts/_patch-vfx-readability.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = new URL('../public/js/main.js', import.meta.url);

const PATCHES = [
  // ---------------------------------------------------------------- burst()
  [
    "function burst(pos,color=0x58eaff,count=18,power=5){const group=new THREE.Group();for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.065,6,5),new THREE.MeshBasicMaterial({color,transparent:true}));m.position.copy(pos);m.userData.v=new THREE.Vector3((Math.random()-.5)*power,Math.random()*power*.8,(Math.random()-.5)*power*.4);group.add(m);}scene.add(group);effects.push({group,t:0,life:.55});bloom.strength=.95;}",
    "// Hit sparks. Small, additive and capped on purpose: a cluster of full-brightness spheres used\n"
    + "// to read as one opaque cloud sitting on the fighter, and the `bloom.strength` bump the effect\n"
    + "// used to set did nothing at all - the render pipeline's bloom is a disabled stub, so there was\n"
    + "// never any highlight rolloff to sell the hit. The impact reads through motion and colour now.\n"
    + "function burst(pos,color=0x58eaff,count=18,power=5,life=.4){\n"
    + " const capped=Math.max(1,Math.min(34,Math.round(count)));\n"
    + " const group=new THREE.Group();\n"
    + " for(let i=0;i<capped;i++){\n"
    + "  const m=new THREE.Mesh(new THREE.SphereGeometry(.015+Math.random()*.03,6,5),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));\n"
    + "  m.position.copy(pos);\n"
    + "  m.userData.v=new THREE.Vector3((Math.random()-.5)*power,Math.random()*power*.8,(Math.random()-.5)*power*.4);\n"
    + "  group.add(m);\n"
    + " }\n"
    + " scene.add(group);effects.push({group,t:0,life});\n"
    + "}"
  ],
  // ------------------------------------------------- spawnImpact: graded sparks + thinner rings
  [
    " combatVFX.impact(pos,{color,intensity,kind:weaponKind});\n burst(pos,color,24,7);",
    " combatVFX.impact(pos,{color,intensity,kind:weaponKind});\n"
    + " // Grade the spark load by how hard the hit was instead of firing 24 every time.\n"
    + " const heavyHit=intensity>=15;\n"
    + " burst(pos,color,heavyHit?18:12,7,heavyHit?.5:.34);"
  ],
  [
    "  const mesh=new THREE.Mesh(new THREE.TorusGeometry(.72+i*.24,.035,6,32),material);\n  mesh.position.copy(pos);mesh.position.y=Math.max(.18,pos.y-.55+i*.18);mesh.rotation.x=Math.PI/2;mesh.scale.setScalar(.35);\n  scene.add(mesh);impactRings.push({mesh,t:0,life:.3+i*.08,max:1.8+Math.min(1.2,intensity*.035)});",
    "  const mesh=new THREE.Mesh(new THREE.TorusGeometry(.72+i*.24,.026,6,32),material);\n  mesh.position.copy(pos);mesh.position.y=Math.max(.18,pos.y-.55+i*.18);mesh.rotation.x=Math.PI/2;mesh.scale.setScalar(.35);\n  scene.add(mesh);impactRings.push({mesh,t:0,life:.3+i*.08,max:1.5+Math.min(.7,intensity*.02)});"
  ],
  [
    "const material=new THREE.MeshBasicMaterial({color:i?0x9b6dff:color,transparent:true,opacity:.92,blending:THREE.AdditiveBlending,depthWrite:false});",
    "const material=new THREE.MeshBasicMaterial({color:i?0x9b6dff:color,transparent:true,opacity:.66,blending:THREE.AdditiveBlending,depthWrite:false});"
  ],
  // ------------------------------------------------------------- grenade blast
  [
    " burst(pos,color,70,11);\n window.spawnImpact?.(pos,23,0xffe09b);\n const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.12,8,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,emissive:color,emissiveIntensity:1.9,depthWrite:false}));",
    " burst(pos,color,30,9,.5);\n window.spawnImpact?.(pos,23,0xffe09b);\n"
    + " // The blast ring stays thin: `emissive` on a MeshBasicMaterial is dead data (the material is\n"
    + " // unlit), so the ring's readability comes from its tint and its growth, not a glow it never had.\n"
    + " const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.055,8,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false}));"
  ],
  // ------------------------------------------------- projectile-impact spark loads
  [
    "const sparkCount=guarded?10:p.moveType==='lightning'?44:p.moveType==='fireball'?38:p.moveType==='shockwave'?48:p.moveType==='frost'?28:32;const sparkPower=guarded?2:p.moveType==='shockwave'?9:p.moveType==='lightning'?6.8:8;burst(p.group.position,p.color,sparkCount,sparkPower);",
    "const sparkCount=guarded?8:p.moveType==='lightning'?20:p.moveType==='fireball'?18:p.moveType==='shockwave'?22:p.moveType==='frost'?14:16;const sparkPower=guarded?2:p.moveType==='shockwave'?8:p.moveType==='lightning'?6.2:7;burst(p.group.position,p.color,sparkCount,sparkPower,guarded?.3:.44);"
  ],
  // ---------------------------------------------------------- signature move bursts
  [
    "burst(strikePoint,profile.color||0x88e9ff,34,7.2);",
    "burst(strikePoint,profile.color||0x88e9ff,20,7,.44);"
  ],
  [
    "burst(owner.position.clone().add(new THREE.Vector3(0,.18,0)),profile.color||0xffb764,28,4.8);",
    "burst(owner.position.clone().add(new THREE.Vector3(0,.18,0)),profile.color||0xffb764,18,4.8,.4);"
  ],
  [
    "burst(fighter.position.clone().add(new THREE.Vector3(0,1.8,0)),0xf4faff,12,2.6);",
    "burst(fighter.position.clone().add(new THREE.Vector3(0,1.8,0)),0xf4faff,10,2.6,.3);"
  ],
  [
    " burst(start,color,moveType==='web'?14:moveType==='beam'?18:ballistic?5:14,moveType==='shockwave'?5:2.8);",
    " burst(start,color,moveType==='web'?10:moveType==='beam'?14:ballistic?5:10,moveType==='shockwave'?4:2.6,.34);"
  ]
];

const original = readFileSync(TARGET, 'utf8');
let source = original;
const report = [];

for (const [anchor, replacement] of PATCHES) {
  const first = source.indexOf(anchor);
  const last = source.lastIndexOf(anchor);
  if (first < 0) { report.push('MISSING   ' + anchor.slice(0, 62).replace(/\n/g, ' | ')); continue; }
  if (first !== last) { report.push('AMBIGUOUS ' + anchor.slice(0, 62).replace(/\n/g, ' | ')); continue; }
  if (source.includes(replacement)) { report.push('ALREADY   ' + anchor.slice(0, 62).replace(/\n/g, ' | ')); continue; }
  source = source.replace(anchor, replacement);
  report.push('ok        ' + anchor.slice(0, 62).replace(/\n/g, ' | '));
}

const failed = report.filter(line => /MISSING|AMBIGUOUS/.test(line));
for (const line of report) console.log('  ' + line);
if (failed.length) {
  console.error(`\n${failed.length} anchor(s) failed; main.js untouched.`);
  process.exit(1);
}
if (source === original) { console.log('\nalready patched'); process.exit(0); }
writeFileSync(TARGET, source);
console.log(`\nmain.js patched (${source.length - original.length} bytes changed)`);
