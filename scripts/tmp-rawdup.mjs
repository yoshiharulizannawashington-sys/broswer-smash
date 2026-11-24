import './glb-node-compat.mjs';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const b=readFileSync(process.argv[2]);const g=await new Promise((ok,fail)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,fail));
const s=g.scene;s.updateMatrixWorld(true);
const key=p=>Math.round(p.x*1e5)+','+Math.round(p.y*1e5)+','+Math.round(p.z*1e5);
for(const n of []);s.traverse(n=>{if(!n.isMesh)return;const p=n.geometry.attributes.position;const m=new Map();for(let i=0;i<p.count;i++){const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);const k=key(v);(m.get(k)||m.set(k,[]).get(k)).push(i);}const multi=[...m].filter(([,a])=>a.length>1);console.log(n.name,'raw',p.count,'welded',m.size,'multi positions',multi.length,'max copies',Math.max(0,...multi.map(([,a])=>a.length)));});
