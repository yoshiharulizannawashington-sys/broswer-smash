// Rigged human fighters with original archetype-specific armor, weapons, and readable combat motion.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

const MODEL_URL='https://threejs.org/examples/models/gltf/Soldier.glb';
let loaderPromise;
async function getLoader(){
  if(!loaderPromise) loaderPromise=import('https://esm.sh/three@0.152.2/examples/jsm/loaders/GLTFLoader.js');
  return loaderPromise;
}
const palettes={
  warrior:{main:0x9a3029,trim:0xd7a45a,glow:0xff713c,metal:.78},
  ninja:{main:0x17243a,trim:0x4fdcff,glow:0x16bfff,metal:.58},
  brawler:{main:0x72502b,trim:0xf0c16c,glow:0xff8d36,metal:.72},
  mage:{main:0x35245f,trim:0xc8a0ff,glow:0x9d67ff,metal:.45},
  cyborg:{main:0x14536a,trim:0x9bfff5,glow:0x26e8e0,metal:.85}
};
const mat=(color,metalness=.55,roughness=.32,emissive=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:1.6});
function addArmor(root, archetype){
  const p=palettes[archetype]||palettes.warrior;
  const gear=new THREE.Group();gear.name='archetype-armor';root.add(gear);
  const armor=mat(p.main,p.metal,.28), trim=mat(p.trim,.8,.24), glow=new THREE.MeshStandardMaterial({color:p.glow,emissive:p.glow,emissiveIntensity:2.8,metalness:.25,roughness:.22});
  const add=(geo,m,pos,scale,rot)=>{const o=new THREE.Mesh(geo,m);o.position.set(...pos);if(scale)o.scale.set(...scale);if(rot)o.rotation.set(...rot);o.castShadow=true;o.receiveShadow=true;gear.add(o);return o;};
  // Sculpted chest shell, layered collar, shoulder guards, and gauntlets sit over the rigged body.
  add(new THREE.BoxGeometry(.72,.48,.24),armor,[0,1.28,.015],[1,1,1],[0,0,0]);
  add(new THREE.BoxGeometry(.54,.1,.27),trim,[0,1.52,.015]);
  add(new THREE.OctahedronGeometry(.105,1),glow,[0,1.31,.17],[1,1.15,.45]);
  for(const side of [-1,1]){
    add(new THREE.SphereGeometry(.19,12,9),armor,[side*.43,1.43,0],[1.25,.7,1.05]);
    add(new THREE.BoxGeometry(.18,.34,.2),trim,[side*.48,1.12,.015],[1,.92,1]);
    add(new THREE.BoxGeometry(.17,.24,.18),armor,[side*.53,.85,.035]);
    add(new THREE.BoxGeometry(.24,.2,.28),armor,[side*.19,.18,.015]);
    add(new THREE.BoxGeometry(.075,.42,.055),glow,[side*.48,1.42,.13]);
  }
  // Different silhouettes and signature weapon language for each fighter archetype.
  if(archetype==='ninja'){
    const blade=add(new THREE.BoxGeometry(.055,.95,.075),trim,[.63,.88,.04],[1,1,1],[0,0,-.2]);
    add(new THREE.ConeGeometry(.055,.18,6),glow,[.66,.35,.04],[1,1,1],[0,0,Math.PI]);
    add(new THREE.BoxGeometry(.12,.19,.1),armor,[.63,.37,.04],[1,1,1],[0,0,-.2]);
    add(new THREE.BoxGeometry(.82,.16,.08),armor,[0,1.73,-.08],[1,1,1],[0,0,-.1]);
    for(let i=0;i<3;i++)add(new THREE.BoxGeometry(.12,.04,.07),glow,[-.22+i*.22,1.74,-.02]);
    gear.userData.weapon=blade;gear.userData.weaponKind='blade';
  }else if(archetype==='mage'){
    add(new THREE.ConeGeometry(.34,.42,6),armor,[0,1.79,0]);
    add(new THREE.TorusGeometry(.19,.035,8,28),glow,[0,1.3,.19],[1,1,1],[0,0,0]);
    const staff=add(new THREE.CylinderGeometry(.035,.055,1.35,8),trim,[.68,.85,0],[1,1,1],[0,0,-.12]);
    add(new THREE.IcosahedronGeometry(.16,1),glow,[.76,1.56,0]);
    gear.userData.weapon=staff;gear.userData.weaponKind='staff';
  }else if(archetype==='cyborg'){
    add(new THREE.BoxGeometry(.78,.12,.28),trim,[0,1.62,-.02]);
    for(let i=0;i<3;i++)add(new THREE.BoxGeometry(.12,.055,.05),glow,[-.14+i*.14,1.3,.155]);
    add(new THREE.BoxGeometry(.2,.42,.22),armor,[.53,.88,.02]);
    const emitter=add(new THREE.CylinderGeometry(.1,.16,.28,10),glow,[.6,1.1,.03],[1,1,1],[0,0,-Math.PI/2]);
    gear.userData.weapon=emitter;gear.userData.weaponKind='emitter';
  }else{
    add(new THREE.BoxGeometry(.82,.11,.2),trim,[0,1.65,-.02]);
    if(archetype==='brawler'){
      for(const side of [-1,1])add(new THREE.DodecahedronGeometry(.17,1),trim,[side*.58,.77,.04],[1.25,.8,1]);
    }else{
      add(new THREE.BoxGeometry(.7,.48,.08),armor,[0,1.04,-.16],[1,.8,1]);
      add(new THREE.BoxGeometry(.56,.06,.08),glow,[0,1.2,-.2]);
    }
  }
  // A compact energy ring gives every character a distinctive powered-up silhouette.
  const ring=add(new THREE.TorusGeometry(.24,.025,7,32),glow,[0,1.3,.2],[1,1,.6],[0,0,0]);
  gear.userData.ring=ring;gear.userData.attackTime=0;gear.userData.specialTime=0;gear.userData.palette=p;
  root.userData.armorGear=gear;
  return gear;
}
export async function upgradeFighterModel(fighter,archetype='warrior'){
  const {GLTFLoader}=await getLoader();
  const gltf=await new Promise((resolve,reject)=>new GLTFLoader().load(MODEL_URL,resolve,undefined,reject));
  const root=gltf.scene;root.scale.setScalar(1.45);root.rotation.y=Math.PI;
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material=o.material.clone();if(o.material.color)o.material.color.lerp(new THREE.Color((palettes[archetype]||palettes.warrior).main),.19);if('roughness' in o.material)o.material.roughness=Math.min(.72,Math.max(.3,o.material.roughness??.5));}}});
  root.position.copy(fighter.position);
  const mixer=new THREE.AnimationMixer(root), animations={};
  for(const clip of gltf.animations)animations[clip.name.toLowerCase()]=mixer.clipAction(clip);
  const find=(...words)=>Object.entries(animations).find(([n])=>words.some(w=>n.includes(w)))?.[1];
  const idle=find('idle')||gltf.animations[0]&&mixer.clipAction(gltf.animations[0]);
  const walk=find('walk'),run=find('run'),jump=find('jump','fall'),punch=find('punch','attack','swing'),hit=find('hit','damage','hurt');
  if(idle){idle.play();idle.enabled=true;}
  root.userData.humanMixer=mixer;root.userData.walkAction=walk;root.userData.runAction=run;root.userData.idleAction=idle;root.userData.jumpAction=jump;root.userData.punchAction=punch;root.userData.hitAction=hit;root.userData.lastMoveAction=idle;root.userData.attackLock=0;root.userData.wasAttacking=false;
  addArmor(root,archetype);
  const previous=fighter.model,parent=previous.parent;
  if(parent){parent.add(root);parent.remove(previous);}else if(window.__smashScene)window.__smashScene.add(root);
  fighter.model=root;fighter.position=root.position;
  return root;
}
export function animateHumanFighter(fighter,dt){
  const root=fighter.model;if(!root?.userData?.humanMixer)return;
  fighter.position=root.position;
  root.rotation.y=Math.atan2(fighter.facingZ,Math.abs(fighter.facing))+(fighter.facing>=0?Math.PI:0);
  root.userData.humanMixer.update(dt);
  const speed=Math.hypot(fighter.velocity.x,fighter.velocity.z), airborne=!fighter.isGrounded;
  const attacking=(fighter.attackQueue?.length||0)>0;
  const gear=root.userData.armorGear;
  const attackStarted=attacking&&!root.userData.wasAttacking;
  if(attackStarted)root.userData.attackLock=.34;
  root.userData.wasAttacking=attacking;
  root.userData.attackLock=Math.max(0,root.userData.attackLock-dt);
  if(gear){
    gear.userData.attackTime=Math.max(0,gear.userData.attackTime-dt);
    gear.userData.specialTime=Math.max(0,gear.userData.specialTime-dt);
    if(attackStarted)gear.userData.attackTime=.18;
    if(fighter.specialCooldown>.65)gear.userData.specialTime=.3;
    const swing=gear.userData.attackTime>0?Math.sin((1-gear.userData.attackTime/.18)*Math.PI):0;
    gear.rotation.z=-swing*.22;
    gear.position.x=Math.sin(fighter.t*2)*.018+(swing*.1);
    gear.userData.ring.rotation.z+=dt*(gear.userData.specialTime>0?8:1.1);
    gear.userData.ring.scale.setScalar(gear.userData.specialTime>0?1.55:1);
    gear.userData.ring.material.emissiveIntensity=gear.userData.specialTime>0?5:2.8;
    if(gear.userData.weapon)gear.userData.weapon.rotation.z=(gear.userData.weaponKind==='blade'?-0.2:gear.userData.weaponKind==='staff'?-0.12:0)+swing*.8;
  }
  let target;
  if(fighter.hitstun>0)target=root.userData.hitAction||root.userData.idleAction;
  else if(attacking)target=root.userData.punchAction||root.userData.lastMoveAction;
  else if(airborne)target=root.userData.jumpAction||root.userData.lastMoveAction;
  else target=speed>7?(root.userData.runAction||root.userData.walkAction):speed>.35?(root.userData.walkAction||root.userData.runAction):root.userData.idleAction;
  if(target&&target!==root.userData.lastMoveAction){
    const old=root.userData.lastMoveAction;
    target.reset().setEffectiveTimeScale(1).fadeIn(.13).play();
    if(old&&old!==target)old.fadeOut(.13);
    root.userData.lastMoveAction=target;
  }
  // A small anticipation/impact lean remains available even when the source GLB has no combat clip.
  const lean=root.userData.attackLock>0?Math.sin((1-root.userData.attackLock/.34)*Math.PI)*.12:0;
  root.rotation.z=THREE.MathUtils.damp(root.rotation.z,lean+(fighter.hitstun>0?-.13:0),12,dt);
}
