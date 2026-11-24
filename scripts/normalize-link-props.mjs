#!/usr/bin/env node
// Normalise the supplied sword, shield, bow and arrow into prop frames the equipment mount can
// use: +Y up the prop, +Z out of its face, origin at the grip/centre, metre scale.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.self=globalThis;
const OUT='public/models/characters/equipment';mkdirSync(OUT,{recursive:true});
function parse(bytes){let off=12,json=null,bin=null;while(off<bytes.length){const len=bytes.readUInt32LE(off),type=bytes.readUInt32LE(off+4),chunk=bytes.subarray(off+8,off+8+len);if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));else if(type===0x004e4942)bin=Buffer.from(chunk);off+=8+len;}return{json,bin};}
function write(file,{json,bin}){const pad=n=>(4-(n%4))%4;const text=JSON.stringify(json);const j=Buffer.from(text+' '.repeat(pad(Buffer.byteLength(text))));const b=Buffer.concat([bin,Buffer.alloc(pad(bin.length))]);const total=12+8+j.length+8+b.length,out=Buffer.alloc(total);out.write('glTF',0,'ascii');out.writeUInt32LE(2,4);out.writeUInt32LE(total,8);out.writeUInt32LE(j.length,12);out.write('JSON',16,'ascii');j.copy(out,20);out.writeUInt32LE(b.length,20+j.length);out.write('BIN\0',24+j.length,'binary');b.copy(out,28+j.length);writeFileSync(file,out);}
function points(root){const pts=[];root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;o.updateMatrixWorld(true);const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)pts.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));});return pts;}
function covariance(pts){const c=new THREE.Vector3();for(const p of pts)c.add(p);c.multiplyScalar(1/pts.length);const m=new THREE.Matrix3();const e=m.elements;for(const p of pts){const x=p.x-c.x,y=p.y-c.y,z=p.z-c.z;e[0]+=x*x;e[3]+=x*y;e[6]+=x*z;e[4]+=y*y;e[7]+=y*z;e[8]+=z*z;}e[1]=e[3];e[2]=e[6];e[5]=e[7];return{c,m};}
function largestEigen(m,skip=[]){let v=new THREE.Vector3(1,.3,.2).normalize();for(let i=0;i<80;i++){const n=new THREE.Vector3(v.x*m.elements[0]+v.y*m.elements[3]+v.z*m.elements[6],v.x*m.elements[1]+v.y*m.elements[4]+v.z*m.elements[7],v.x*m.elements[2]+v.y*m.elements[5]+v.z*m.elements[8]);for(const s of skip)n.addScaledVector(s,-n.dot(s));if(n.lengthSq()<1e-12)return null;v=n.normalize();}return v;}
function axesFor(pts,{face=false}={}){const{c,m}=covariance(pts);const a=largestEigen(m);if(!a)throw new Error('degenerate geometry');const b=largestEigen(m,[a])||new THREE.Vector3(0,1,0);b.addScaledVector(a,-b.dot(a)).normalize();let n=new THREE.Vector3().crossVectors(a,b).normalize();if(face){if(n.dot(new THREE.Vector3(0,0,1))<0)n.negate();return{long:a,normal:n,c,up:a};}return{long:a,normal:n,c,up:b};}
function matrixFrom(x,y,z){const m=new THREE.Matrix4();m.makeBasis(x,y,z);return m;}
async function loadRaw(path){const bytes=readFileSync(path);const gltf=await new Promise((ok,fail)=>new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,fail));return gltf;}
async function normalize({src,name,kind,targetHeight,face=false,gripFrac=0,flipForHilt=false}){
  const raw=parse(readFileSync(src));const gltf=await loadRaw(src);const pts=points(gltf.scene);
  const ax=axesFor(pts,{face});let Y=ax.long.clone(), Z=ax.normal.clone();
  if(!face){Z=Z.clone();}
  // For the sword, the long axis may already be close to vertical; Y is the blade axis.
  let X=new THREE.Vector3().crossVectors(Y,Z).normalize();Z.crossVectors(X,Y).normalize();
  let q=new THREE.Quaternion().setFromRotationMatrix(matrixFrom(X,Y,Z));
  // matrixFrom builds canonical -> world; the prop wrapper needs world -> canonical.
  q.invert();
  if(flipForHilt){
    // The wide end (crossguard) must be at the bottom. Compare lateral spread at both ends.
    const put=p=>p.clone().applyQuaternion(q);
    const qpts=pts.map(put);const minY=Math.min(...qpts.map(p=>p.y)),maxY=Math.max(...qpts.map(p=>p.y)),span=maxY-minY;
    const spread=arr=>{const lo=arr.filter(p=>p.y<minY+span*.22),hi=arr.filter(p=>p.y>maxY-span*.22);const s=arr2=>{let mx=0;for(const p of arr2)mx=Math.max(mx,Math.abs(p.x));return mx};return [s(lo),s(hi)]};
    const [low,high]=spread(qpts);if(low<high){const flip=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI);q.premultiply(flip);}
  }
  const transformed=pts.map(p=>p.clone().applyQuaternion(q));
  const min=new THREE.Vector3(Infinity,Infinity,Infinity),max=new THREE.Vector3(-Infinity,-Infinity,-Infinity);
  for(const p of transformed){min.min(p);max.max(p);}
  const size=max.clone().sub(min);const scale=targetHeight/Math.max(1e-6,size.y);
  const center=new THREE.Vector3((min.x+max.x)/2,(min.y+max.y)/2,(min.z+max.z)/2);
  const gripY=min.y+size.y*gripFrac;
  const translation=new THREE.Vector3(-center.x*scale,-(gripY)*scale,-center.z*scale);
  const wrapper={name,rotation:[q.x,q.y,q.z,q.w],scale:[scale,scale,scale],translation:[translation.x,translation.y,translation.z]};
  const oldRoots=raw.json.scenes?.[0]?.nodes||[];
  const idx=raw.json.nodes.length;raw.json.nodes.push({...wrapper,children:oldRoots});raw.json.scenes[0].nodes=[idx];
  write(`${OUT}/${name}.glb`,raw);
  console.log(JSON.stringify({name,src,targetHeight,scale:+scale.toFixed(4),size:[+size.x.toFixed(3),+size.y.toFixed(3),+size.z.toFixed(3)],gripY:+gripY.toFixed(3),translation:translation.toArray().map(v=>+v.toFixed(3)),axes:{x:X.toArray().map(v=>+v.toFixed(2)),y:Y.toArray().map(v=>+v.toFixed(2)),z:Z.toArray().map(v=>+v.toFixed(2))}},null,1));
}
await normalize({src:'artifacts/link-upgrade/equipment/link_sword.glb',name:'weapon_link_right',kind:'sword',targetHeight:1.15,gripFrac:.16,flipForHilt:true});
await normalize({src:'artifacts/link-upgrade/equipment/link_shield.glb',name:'weapon_link_left',kind:'shield',targetHeight:.90,face:true,gripFrac:.5});
await normalize({src:'artifacts/link-upgrade/equipment/link_bow.glb',name:'weapon_link_bow',kind:'bow',targetHeight:1.20,face:true,gripFrac:.5});
await normalize({src:'artifacts/link-upgrade/equipment/link_arrow.glb',name:'weapon_link_arrow',kind:'arrow',targetHeight:.90,face:true,gripFrac:.05});
