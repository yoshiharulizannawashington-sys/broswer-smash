import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const file = process.argv[2];
const b = readFileSync(file);
const g = await new Promise((ok,bad)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,bad));
const s=g.scene; s.updateMatrixWorld(true);
const box=new THREE.Box3().setFromObject(s); const size=box.getSize(new THREE.Vector3());
let meshes=0,tris=0,verts=0,skinned=0; const mats=new Set(); const names=[];
s.traverse(n=>{ if(!n.isMesh)return; meshes++; names.push(n.name); if(n.isSkinnedMesh)skinned++;
 const p=n.geometry.attributes.position; if(p)verts+=p.count;
 tris+=Math.round((n.geometry.index?n.geometry.index.count:p.count)/3);
 for(const m of (Array.isArray(n.material)?n.material:[n.material])) if(m) mats.add(m.name||m.uuid); });
// 24 height bands over the model, world space; report x/z extents and x-cluster count per band
const bands=[]; const H=size.y||1; const N=24;
const acc=Array.from({length:N},()=>({n:0,x0:1e9,x1:-1e9,z0:1e9,z1:-1e9,xs:[]}));
const v=new THREE.Vector3();
s.traverse(n=>{ if(!n.isMesh)return; const p=n.geometry.attributes.position; if(!p)return;
 for(let i=0;i<p.count;i+=1){ v.fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);
  let k=Math.floor((v.y-box.min.y)/H*N); k=Math.max(0,Math.min(N-1,k)); const e=acc[k]; e.n++;
  e.x0=Math.min(e.x0,v.x); e.x1=Math.max(e.x1,v.x); e.z0=Math.min(e.z0,v.z); e.z1=Math.max(e.z1,v.z);
  if(e.n<=2500)e.xs.push(v.x); }});
const gaps=arr=>{ const a=[...arr].sort((x,y)=>x-y); let clusters=0,last=-1e9; for(const x of a){ if(x-last>0.02*H){clusters++;} last=x; } return clusters; };
for(let k=0;k<N;k++){ const e=acc[k]; bands.push({band:+(k/N).toFixed(2),n:e.n, x:[+e.x0.toFixed(3),+e.x1.toFixed(3)], z:[+e.z0.toFixed(3),+e.z1.toFixed(3)], xClusters:e.n?gaps(e.xs):0}); }
// arm span by band relative to torso width near hips
const hipBand=acc[Math.floor(N*0.45)], shoulderBand=acc[Math.floor(N*0.72)];
console.log(JSON.stringify({file,meshes,tris,verts,skinned,materials:mats.size,meshNames:names,
 bounds:{min:[+box.min.x.toFixed(3),+box.min.y.toFixed(3),+box.min.z.toFixed(3)],max:[+box.max.x.toFixed(3),+box.max.y.toFixed(3),+box.max.z.toFixed(3)],size:[+size.x.toFixed(3),+size.y.toFixed(3),+size.z.toFixed(3)]},
 hipWidth:+(hipBand.x1-hipBand.x0).toFixed(3), shoulderWidth:+(shoulderBand.x1-shoulderBand.x0).toFixed(3), bands},null,1));
