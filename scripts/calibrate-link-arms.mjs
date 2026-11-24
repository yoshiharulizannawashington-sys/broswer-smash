#!/usr/bin/env node
// Link's source bind is a strict T-pose while the roster clips were authored for a relaxed
// A-pose. Bend both upper arms down around their local X axis in every retargeted clip. This is
// animation-side only: geometry, skin weights, inverse bind matrices and materials are untouched.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
const input=process.argv[2], output=process.argv[3]||input;
const left=Number(process.argv[4]??.72), right=Number(process.argv[5]??-.72);
if(!input)throw new Error('usage: calibrate-link-arms.mjs <in.glb> [out.glb] [leftRad] [rightRad]');
const raw=readFileSync(input);let off=12,json=null,bin=null;
while(off<raw.length){const len=raw.readUInt32LE(off),type=raw.readUInt32LE(off+4),chunk=raw.subarray(off+8,off+8+len);if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));else if(type===0x004e4942)bin=Buffer.from(chunk);off+=8+len;}
const accessor=(index)=>{const a=json.accessors[index],v=json.bufferViews[a.bufferView],base=(v.byteOffset||0)+(a.byteOffset||0),stride=v.byteStride||16;return{index,count:a.count,base,stride,componentType:a.componentType};};
const qL=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),left);
const qR=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),right);
const tmp=new THREE.Quaternion();
let clips=0,tracks=0,keys=0;
for(const anim of json.animations||[]){clips++;for(const ch of anim.channels){const node=json.nodes[ch.target.node];if(ch.target.path!=='rotation'||!node?.name)continue;if(node.name!=='LeftArm'&&node.name!=='RightArm')continue;const smp=anim.samplers[ch.sampler],acc=accessor(smp.output);if(acc.componentType!==5126)throw new Error('expected float quaternion accessor');const q=node.name==='LeftArm'?qL:qR;for(let i=0;i<acc.count;i++){const p=acc.base+i*acc.stride;tmp.set(bin.readFloatLE(p),bin.readFloatLE(p+4),bin.readFloatLE(p+8),bin.readFloatLE(p+12));tmp.multiply(q).normalize();bin.writeFloatLE(tmp.x,p);bin.writeFloatLE(tmp.y,p+4);bin.writeFloatLE(tmp.z,p+8);bin.writeFloatLE(tmp.w,p+12);keys++;}tracks++;}}
const pad=n=>(4-(n%4))%4;const text=JSON.stringify(json);const jsonChunk=Buffer.from(text+' '.repeat(pad(Buffer.byteLength(text))));const binChunk=Buffer.concat([bin,Buffer.alloc(pad(bin.length))]);const total=12+8+jsonChunk.length+8+binChunk.length;const out=Buffer.alloc(total);out.write('glTF',0,'ascii');out.writeUInt32LE(2,4);out.writeUInt32LE(total,8);out.writeUInt32LE(jsonChunk.length,12);out.write('JSON',16,'ascii');jsonChunk.copy(out,20);out.writeUInt32LE(binChunk.length,20+jsonChunk.length);out.write('BIN\0',24+jsonChunk.length,'binary');binChunk.copy(out,28+jsonChunk.length);writeFileSync(output,out);
console.log(JSON.stringify({input,output,left,right,clips,tracks,keys},null,2));
