import './glb-node-compat.mjs';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self ||= globalThis;
const files=[['thor','public/models/characters/imported/thor_rigged/thor_rigged.glb'],['aang','public/models/characters/imported/aang_rigged/aang_rigged.glb'],['sasuke','public/models/characters/imported/sasuke_rigged/sasuke_rigged.glb'],['madara','public/models/characters/imported/madara_rigged/madara_rigged.glb'],['infantry','public/models/characters/roster_hd/infantry_cc0.glb']];
const wp=(n)=>n.getWorldPosition(new THREE.Vector3());
for(const [key,p] of files){
  const b=readFileSync(p); const g=await new Promise((ok,bad)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,bad));
  const s=g.scene; s.updateMatrixWorld(true);
  const find=f=>s.getObjectByName(f);
  const L=find('LeftArm'),R=find('RightArm'),LF=find('LeftForeArm')||find('LeftForeArm')||find('LeftForeArm'),RF=find('RightForeArm');
  const LH=find('LeftHand'),RH=find('RightHand');
  const row={key,bind:null,idle:null,clips:g.animations.length};
  if(L&&LH&&R&&RH){row.bind=[LH,RH].map(h=>+(h.getWorldPosition(new THREE.Vector3()).y-L.getWorldPosition(new THREE.Vector3()).y).toFixed(3));}
  const clip=g.animations.find(c=>/idle/i.test(c.name))||g.animations[0];
  if(clip){const mx=new THREE.AnimationMixer(s);const a=mx.clipAction(clip);a.play();mx.update(clip.duration*0.35);s.updateMatrixWorld(true);
    row.idle={name:clip.name,handMinusShoulder:[LH,RH].map(h=>+(wp(h).y-wp(L).y).toFixed(3)),elbowMinusShoulder:[LF,RF].map(f=>+(wp(f).y-wp(L).y).toFixed(3))};}
  console.log(JSON.stringify(row));
}
