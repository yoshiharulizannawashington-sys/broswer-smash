# Procedural stages removed in PART 10

Archived reference only — none of this is executed. It records the exact code and layout data that
was removed so `volcano`, `ice` and `neon` can be restored if a future stage brief needs them.

Removed from `public/js/main.js`:

1. `arenaFloorMaterials` entries:

```js
volcano: makeArenaSurface('#302629','#5d3934','#ff5426',.96,.08),
ice:     makeArenaSurface('#8bbdcc','#b8f3ff','#52cfff',.34,.16),
neon:    makeArenaSurface('#17162b','#39305c','#ff32db',.62,.32),
```

2. `mapThemes` entries:

```js
volcano:{label:'OBSIDIAN VOLCANO · LAVA CALDERA',sky:0x230d16,fog:0x5b1d1c,floor:0x251d20,platform:0x3b2929,ringA:0xff4c20,ringB:0xffb13b,light:0xff8b52,sun:0xff4428,density:.013},
ice:{label:'FROSTFALL CITADEL · CRYSTAL KEEP',sky:0x071c35,fog:0x315b78,floor:0x7bafc6,platform:0x31566e,ringA:0x73f5ff,ringB:0xc4eaff,light:0xc5f3ff,sun:0x9cecff,density:.007},
neon:{label:'NEON MEGACITY · SKYLINE DISTRICT',sky:0x08051e,fog:0x25205a,floor:0x17172b,platform:0x24213c,ringA:0xff32db,ringB:0x31eaff,light:0xb2a1ff,sun:0xff4dd8,density:.006},
```

3. `applyMap()` landmark props:

```js
if(key==='volcano'){addProp(new THREE.ConeGeometry(10,23,7),mat(0x292124,.15,.96),-32,8,-38,1,1,1);addProp(new THREE.ConeGeometry(4,1.2,7),new THREE.MeshBasicMaterial({color:0xff5a1e}),-32,19,-38,1,1,1);}
if(key==='ice'){const citadel=addProp(new THREE.CylinderGeometry(5,8,18,6),mat(0x456c85,.35,.32),-34,9,-35);for(let i=0;i<6;i++)addProp(new THREE.ConeGeometry(1.2,7,5),mat(0xbdefff,.25,.2),-39+i*2,19,-35);}
if(key==='neon'){for(let i=0;i<5;i++){const tower=addProp(new THREE.BoxGeometry(5,18+i*3,5),mat(0x1a2340,.65,.25),-38+i*9,(18+i*3)/2,-38);addProp(new THREE.BoxGeometry(5.1,.12,5.1),new THREE.MeshBasicMaterial({color:i%2?0xff32db:0x31eaff}),tower.position.x,tower.position.y+tower.geometry.parameters.height/2+.1,-38);}}
```

4. `applyMap()` scattered dressing (the first three branches of the `else if` chain):

```js
if(key==='volcano'){for(let i=0;i<22;i++){const x=(Math.random()-.5)*45,z=-18+Math.random()*10,h=2+Math.random()*7;addProp(new THREE.ConeGeometry(1.4+Math.random()*1.5,h,5),mat(0x292124,.2,.95),x,h*.35,z,1,.7,1);if(i%2===0)addProp(new THREE.BoxGeometry(.12,h*.8,.12),new THREE.MeshBasicMaterial({color:0xff4b18}),x,h*.35,z+.8,1,1,1);}}
else if(key==='ice'){for(let i=0;i<26;i++){const x=(Math.random()-.5)*44,z=-20+Math.random()*18,h=2+Math.random()*7;const crystal=addProp(new THREE.OctahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:i%2?0x75dfff:0xd3f7ff,metalness:.25,roughness:.2,emissive:0x1d7399,emissiveIntensity:.35}),x,h*.35,z,.45,h*.65,.45);crystal.rotation.z=(Math.random()-.5)*.3;}}
else if(key==='neon'){for(let i=0;i<30;i++){const x=(Math.random()-.5)*48,z=-23+Math.random()*14,h=4+Math.random()*12,w=1.2+Math.random()*2;addProp(new THREE.BoxGeometry(w,h,1.5),mat(i%2?0x252043:0x172e4a,.6,.3),x,h/2-1,z);for(let row=1;row<h;row+=1.7)addProp(new THREE.BoxGeometry(w*.55,.07,.04),new THREE.MeshBasicMaterial({color:i%2?0xff32db:0x31eaff}),x,row,z+.8);}}
```

5. `applyMap()` skyline landmarks:

```js
else if(key==='volcano'){landmark(-90,-65,1.4);for(let i=0;i<28;i++){const x=(Math.random()-.5)*230,z=(Math.random()-.5)*230,h=3+Math.random()*13;addProp(new THREE.ConeGeometry(3+Math.random()*5,h,7),landmarkMat,x,h*.35,z);if(i%2===0)addProp(new THREE.BoxGeometry(.18,h*.8,.18),glowMat,x,h*.4,z+2);}}
else if(key==='ice'){landmark(95,-75,1.5);for(let i=0;i<36;i++){const x=(Math.random()-.5)*230,z=(Math.random()-.5)*230,h=4+Math.random()*18;const crystal=addProp(new THREE.OctahedronGeometry(1,1),glowMat,x,h*.32,z,1.1,h*.9,1.1);crystal.rotation.z=(Math.random()-.5)*.3;}}
else if(key==='neon'){landmark(0,-100,1.8);for(let i=0;i<45;i++){const x=(Math.random()-.5)*220,z=(Math.random()-.5)*220,h=8+Math.random()*28,w=2+Math.random()*5;addProp(new THREE.BoxGeometry(w,h,w),landmarkMat,x,h/2,z);for(let row=2;row<h;row+=2.5)addProp(new THREE.BoxGeometry(w*.6,.09,.06),glowMat,x,row,z+w/2+.04);}}
```

6. The `landmarkMat` colour pick:

```js
const landmarkMat=mat(key==='volcano'?0x41272a:key==='ice'?0x9dd9e9:key==='neon'?0x252044:0x536477,.38,.48);
```

7. Ambience and footstep branches:

```js
combatAudio.startAmbience?.(activeLayoutKey==='volcano'?'volcanic':activeLayoutKey==='ice'?'ice':activeLayoutKey==='neon'?'city':...)
const surface=activeLayoutKey==='neon'||activeLayoutKey==='deathstar'||...
```

Removed from `public/js/world/arena_layouts.js` (LEGACY_LAYOUTS):

```js
volcano: {
  label: 'Obsidian Volcano', kind: 'open',
  bounds: { x0: -70, x1: 70, z0: -74, z1: 34 },
  ground: 0, spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
  blocks: [{ x: -42, z: -38, r: 12, top: 23 }, c(-90, -65, 11, 30)]
},
ice: {
  label: 'Frostfall Citadel', kind: 'open',
  bounds: { x0: -70, x1: 70, z0: -72, z1: 34 },
  ground: 0, spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
  blocks: [c(-34, -35, 9, 22), c(95, -75, 12, 30)]
},
neon: {
  label: 'Neon Megacity', kind: 'open',
  bounds: { x0: -66, x1: 66, z0: -74, z1: 34 },
  ground: 0, spawns: [{ x: -6, z: -20 }, { x: 6, z: -19.3 }],
  blocks: [
    k(-40.5, -40.5, -35.5, -35.5, 18), k(-31.5, -40.5, -26.5, -35.5, 21),
    k(-22.5, -40.5, -17.5, -35.5, 24), k(-13.5, -40.5, -8.5, -35.5, 27),
    k(-4.5, -40.5, 0.5, -35.5, 30), c(0, -100, 12, 40)
  ]
},
```

`valley` was kept in `LEGACY_LAYOUTS` because it is `DEFAULT_KEY` and still backs free roam; it was
only removed from the versus arena pickers.
