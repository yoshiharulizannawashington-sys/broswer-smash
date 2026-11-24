#!/usr/bin/env node
// Put a single wrapper over the Link body so the roster's 1.70 m scale profile sees a
// normal-sized skinned rig. Keeping the wrapper outside the skin avoids rewriting inverse-bind
// matrices; the runtime therefore keeps the author's exact joint animation and textures.
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self = globalThis;
const input = process.argv[2];
const output = process.argv[3];
const target = Number(process.argv[4] || 1.70);
if (!input || !output) throw new Error('usage: wrap-link-height.mjs <in.glb> <out.glb> [height]');
function parse(bytes){let off=12,json=null,bin=null;while(off<bytes.length){const len=bytes.readUInt32LE(off),type=bytes.readUInt32LE(off+4),chunk=bytes.subarray(off+8,off+8+len);if(type===0x4e4f534a)json=JSON.parse(chunk.toString('utf8'));else if(type===0x004e4942)bin=chunk;off+=8+len;}return{json,bin};}
function write(json,bin){const pad=n=>(4-(n%4))%4;const text=JSON.stringify(json),jsonChunk=Buffer.from(text+' '.repeat(pad(Buffer.byteLength(text)))),binChunk=Buffer.concat([bin,Buffer.alloc(pad(bin.length))]),total=12+8+jsonChunk.length+8+binChunk.length,out=Buffer.alloc(total);out.write('glTF',0,'ascii');out.writeUInt32LE(2,4);out.writeUInt32LE(total,8);out.writeUInt32LE(jsonChunk.length,12);out.write('JSON',16,'ascii');jsonChunk.copy(out,20);out.writeUInt32LE(binChunk.length,20+jsonChunk.length);out.write('BIN\0',24+jsonChunk.length,'binary');binChunk.copy(out,28+jsonChunk.length);writeFileSync(output,out);}
const raw=readFileSync(input);const {json,bin}=parse(raw);
const buf=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
const gltf=await new Promise((ok,fail)=>new GLTFLoader().parse(buf,'',ok,fail));
gltf.scene.updateMatrixWorld(true);
const box=new THREE.Box3().setFromObject(gltf.scene);const size=box.getSize(new THREE.Vector3());
const scale=target/size.y, ground=-box.min.y*scale;
if(json.scenes?.[0]?.nodes?.length!==1)throw new Error('expected one scene root, got '+(json.scenes?.[0]?.nodes||[]).length);
const oldRoot=json.scenes[0].nodes[0];
const wrapper=json.nodes.length;
json.nodes.push({name:'LinkBodyScale',translation:[0,+ground.toFixed(6),0],scale:[+scale.toFixed(6),+scale.toFixed(6),+scale.toFixed(6)],children:[oldRoot]});
json.scenes[0].nodes=[wrapper];
console.log(JSON.stringify({sourceHeight:+size.y.toFixed(4),target,scale:+scale.toFixed(6),ground:+ground.toFixed(6),sourceMinY:+box.min.y.toFixed(4)},null,2));
write(json,bin);
