import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const load=f=>new Promise((ok,bad)=>{const b=readFileSync(f);new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,bad)});
const [bodyG,clipG]=await Promise.all([load('public/models/characters/imported/saitama/saitama.glb'),load('public/models/characters/bespoke/saitama_animated.glb')]);
const body=bodyG.scene;body.updateMatrixWorld(true);
const bones=[];body.traverse(n=>{if(n.isBone)bones.push(n)});
const mixer=new THREE.AnimationMixer(body);
for(const clipName of ['run','sprint','walk']){
 const clip=clipG.animations.find(c=>c.name===clipName);const act=mixer.clipAction(clip);act.play();
 const snaps=[];
 for(let i=0;i<9;i++){act.time=clip.duration*i/8;act.paused=true;mixer.update(0);body.updateMatrixWorld(true);const m=new Map();for(const b of bones)m.set(b.name,b.quaternion.clone());snaps.push(m);}
 const rows=[];
 for(const b of bones){const f=snaps[0].get(b.name);let mx=0;for(let i=1;i<9;i++){const q=snaps[i].get(b.name);mx=Math.max(mx,2*Math.acos(Math.min(1,Math.abs(f.dot(q)))));}rows.push([b.name,mx]);}
 rows.sort((a,b)=>b[1]-a[1]);console.log(clipName, rows.slice(0,6).map(([n,a])=>n+':'+(a*180/Math.PI).toFixed(0)+'deg').join(' | '));
 mixer.stopAllAction();mixer.uncacheRoot(body);
}
// mesh identity + bind bounds
body.traverse(n=>{if(!n.isSkinnedMesh)return;const box=new THREE.Box3().setFromObject(n);console.log('MESH',n.name,'verts',n.geometry.attributes.position.count,'mat',n.material?.name,'minY',+box.min.y.toFixed(3),'maxY',+box.max.y.toFixed(3));});
