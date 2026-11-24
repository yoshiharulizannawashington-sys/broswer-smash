import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const files=[['thor','public/models/characters/imported/thor_rigged/thor_rigged.glb'],['aang','public/models/characters/imported/aang_rigged/aang_rigged.glb'],['sasuke','public/models/characters/imported/sasuke_rigged/sasuke_rigged.glb'],['madara','public/models/characters/imported/madara_rigged/madara_rigged.glb'],['infantry','public/models/characters/roster_hd/infantry_cc0.glb']];
for (const [key,p] of files) {
  const b=readFileSync(p);
  const g=await new Promise((ok,bad)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,bad));
  const bones=[]; g.scene.traverse(n=>{if(n.isBone)bones.push(n.name)});
  console.log('\n==',key,'bones',bones.length); console.log(bones.join(', '));
  console.log('clips',g.animations.map(c=>c.name+':'+c.duration.toFixed(2)+'/'+c.tracks.length).join(' | '));
}
