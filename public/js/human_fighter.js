// Rigged human fighters with original archetype-specific armor, weapons, and readable combat motion.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const MODEL_BASE='/models/characters/';
const MODEL_MANIFEST_URL=`${MODEL_BASE}manifest.json`;
let characterManifestPromise;
function getCharacterManifest(){
  if(!characterManifestPromise){
    characterManifestPromise=fetch(MODEL_MANIFEST_URL,{cache:'no-store'})
      .then(response=>response.ok?response.json():{characters:{}})
      .catch(()=>({characters:{}}));
  }
  return characterManifestPromise;
}
function characterSlug(fighter,archetype='warrior'){
  return String(fighter?.identity||fighter?.name||archetype)
    .normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
async function loadCharacterModel(fighter,archetype,GLTFLoader,FBXLoader){
  const slug=characterSlug(fighter,archetype);
  const manifest=await getCharacterManifest();
  const entry=manifest?.characters?.[slug];
  // Repository manifests can stage paths before the separate binary asset bundle is installed.
  if(entry&&typeof entry==='object'&&entry.enabled===false)return null;
  const urls=typeof entry==='string'?[entry]
    :Array.isArray(entry)?entry
    :Array.isArray(entry?.urls)?entry.urls
    :entry?.url?[entry.url]:[];
  // Do not probe missing model URLs: unregistered assets are intentionally skipped so the
  // existing game can run cleanly with its Blender/procedural character library.
  for(const candidate of urls){
    const url=String(candidate).startsWith('/')?String(candidate):`${MODEL_BASE}${candidate}`;
    try{
      const isFbx=/\.fbx(?:[?#]|$)/i.test(url);
      const loader=isFbx?new FBXLoader():new GLTFLoader();
      const loaded=await new Promise((resolve,reject)=>loader.load(url,resolve,undefined,reject));
      const gltf=isFbx?{scene:loaded,animations:loaded.animations||[]}:loaded;
      return {gltf,url,format:isFbx?'fbx':'gltf'};
    }catch(_error){
      // An explicitly registered but broken asset should still fall back safely.
    }
  }
  return null;
}
async function getLoader(){
  // Use the same import-map-resolved Three.js instance as the renderer and fighter models.
  return { GLTFLoader, FBXLoader };
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
  add(new THREE.SphereGeometry(1,24,16),armor,[0,1.29,.015],[.405,.29,.17],[0,0,0]);
  add(new THREE.BoxGeometry(.54,.1,.27),trim,[0,1.52,.015]);
  add(new THREE.OctahedronGeometry(.105,1),glow,[0,1.31,.17],[1,1.15,.45]);
  for(const side of [-1,1]){
    add(new THREE.SphereGeometry(.19,12,9),armor,[side*.43,1.43,0],[1.25,.7,1.05]);
    add(new THREE.CapsuleGeometry(.085,.22,5,10),trim,[side*.48,1.12,.015],[1,.92,1]);
    add(new THREE.CapsuleGeometry(.08,.16,5,10),armor,[side*.53,.85,.035]);
    add(new THREE.SphereGeometry(1,16,12),armor,[side*.19,.18,.015],[.15,.12,.14]);
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
    add(new THREE.TorusGeometry(.27,.045,8,28),trim,[0,1.62,-.02],[1.6,.55,.8],[0,0,0]);
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
function applyGokuTextures(root,baseUrl){
  const loader=new THREE.TextureLoader();
  const load=(file,color=false)=>{
    const texture=loader.load(baseUrl+file);
    texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.anisotropy=8;
    return texture;
  };
  const sets={
    cloth:{map:load('cloth_c.webp',true),normalMap:load('cloth_n.webp'),orm:load('cloth_ORM.webp')},
    skin:{map:load('skin_c.webp',true),normalMap:load('skin_n.webp'),orm:load('skin_ORM.webp')},
    face:{map:load('face_ss_c.webp',true),normalMap:load('face_ss_n.webp'),orm:load('face_ss_ORM.webp')},
    hair:{map:load('hair_c.webp',true),normalMap:load('hair_ss_n.webp'),orm:null}
  };
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const source=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const mapped=source.map(original=>{
      const name=String(original?.name||'').toLowerCase();
      const set=name.includes('hair')?sets.hair:name.includes('cloth')?sets.cloth:name.includes('skin')?sets.skin:(name.includes('face')||name.includes('eyebrow')||name.includes('iris')||name.includes('eyeshadow'))?sets.face:null;
      if(!set)return original?.clone?.()||new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7});
      if(set.orm&&mesh.geometry?.attributes?.uv&&!mesh.geometry.attributes.uv2)mesh.geometry.setAttribute('uv2',mesh.geometry.attributes.uv.clone());
      const material=new THREE.MeshStandardMaterial({name:original?.name||'Goku material',color:0xffffff,map:set.map,normalMap:set.normalMap,aoMap:set.orm||null,roughnessMap:set.orm||null,metalnessMap:set.orm||null,roughness:.72,metalness:.04,transparent:Boolean(original?.transparent),opacity:original?.opacity??1,alphaTest:name.includes('hair') ? 0.25 : 0,side:original?.side??THREE.FrontSide});
      if(set.orm)material.aoMapIntensity=1;
      return material;
    });
    mesh.material=Array.isArray(mesh.material)?mapped:mapped[0];
  });
}
export async function upgradeFighterModel(fighter,archetype='warrior'){
  const previous=fighter?.model;
  if(!previous||!previous.userData)return false;
  const identityAtStart=String(fighter.identity||fighter.name||'');
  const {GLTFLoader,FBXLoader}=await getLoader();
  const loaded=await loadCharacterModel(fighter,archetype,GLTFLoader,FBXLoader);
  if(!loaded||fighter.model!==previous||String(fighter.identity||fighter.name||'')!==identityAtStart)return false;
  const {gltf,url,format}=loaded;
  const root=gltf.scene;
  // Normalize imported GLTF/FBX character height so models authored in centimeters or meters
  // line up with the existing fighter physics and camera framing.
  root.updateMatrixWorld(true);
  const modelBounds=new THREE.Box3().setFromObject(root);
  const modelHeight=Math.max(.001,modelBounds.max.y-modelBounds.min.y);
  root.scale.setScalar(2.05/modelHeight);
  if(format==='fbx')applyGokuTextures(root,url.slice(0,url.lastIndexOf('/')+1));
  // Imported rigs in this project face +Z; retain that correction as an offset while the
  // fighter controller turns the outer model toward its opponent.
  root.rotation.y=0;
  root.userData.modelFacingOffset=Math.PI;
  root.userData.characterAssetUrl=url;
  root.userData.characterAssetIdentity=identityAtStart;
  root.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=true;o.receiveShadow=true;
    const tuneMaterial=source=>{
      if(!source)return source;
      const material=source.clone();
      if(material.color)material.color.lerp(new THREE.Color((palettes[archetype]||palettes.warrior).main),.08);
      if('roughness' in material)material.roughness=Math.min(.9,Math.max(.24,material.roughness??.5));
      if('envMapIntensity' in material)material.envMapIntensity=1.15;
      return material;
    };
    if(Array.isArray(o.material))o.material=o.material.map(tuneMaterial);
    else if(o.material)o.material=tuneMaterial(o.material);
  });
  root.position.copy(fighter.position);
  const mixer=new THREE.AnimationMixer(root),animations={};
  for(const clip of gltf.animations||[])animations[clip.name.toLowerCase()]=mixer.clipAction(clip);
  const find=(...words)=>Object.entries(animations).find(([n])=>words.some(w=>n.includes(w)))?.[1];
  const idle=find('idle','stand')||(gltf.animations?.[0]&&mixer.clipAction(gltf.animations[0]));
  const walk=find('walk','locomotion'),run=find('run','sprint'),jump=find('jump','fall','air'),punch=find('punch','lightattack','attack','swing','kick'),heavy=find('heavy','finisher','uppercut'),hit=find('hit','damage','hurt'),block=find('block','guard'),dodgeAction=find('dodge','evade','roll'),charge=find('charge','powerup','power_up'),beam=find('beam','kame','repulsor','blast','special'),land=find('land','landing');
  if(idle){idle.reset().play();idle.enabled=true;}
  // Rig-aware procedural motion covers rigs that contain a skeleton but no baked animation clips.
  const joints={};
  root.traverse(o=>{
    if(!o.isBone)return;
    const raw=String(o.name||'').toLowerCase();
    const n=raw.replace(/[^a-z0-9]/g,'');
    // Support both suffix rigs (upper_arm.L) and Mixamo-style prefixes (mixamorig:LeftArm).
    const left=n.includes('left')||/(?:^|[._:\-\s])l(?:$|[._:\-\s])/.test(raw);
    const right=n.includes('right')||/(?:^|[._:\-\s])r(?:$|[._:\-\s])/.test(raw);
    const side=left?'L':right?'R':'';
    if(/arm|shoulder|clavicle|elbow|wrist|hand|palm|finger|thumb/.test(n)&&side&&!/roll/.test(n)){
      const part=(/hand|wrist|palm|finger|thumb/.test(n)?'hand':/forearm|lowerarm|elbow/.test(n)?'forearm':/shoulder|clavicle/.test(n)?'shoulder':'arm')+side;
      joints[part] ||= {bone:o,base:o.rotation.clone()};
    }
    if(/thigh|upperleg|upleg/.test(n)&&side)joints['leg'+side] ||= {bone:o,base:o.rotation.clone()};
    else if(/shin|calf|lowerleg|knee|(?:left|right)leg$/.test(n)&&side)joints['shin'+side] ||= {bone:o,base:o.rotation.clone()};
    if(/spine|chest/.test(n))joints.torso ||= {bone:o,base:o.rotation.clone()};
    if(/hips|pelvis/.test(n))joints.pelvis ||= {bone:o,base:o.rotation.clone()};
    if(/head|neck/.test(n))joints.head ||= {bone:o,base:o.rotation.clone()};
  });
  root.userData.proceduralJoints=joints;
  root.userData.humanMixer=mixer;
  root.userData.animationActions=animations;
  root.userData.hasAnimationClips=Boolean((gltf.animations||[]).length);
  root.userData.walkAction=walk;root.userData.runAction=run;root.userData.idleAction=idle;
  root.userData.jumpAction=jump;root.userData.punchAction=punch;root.userData.heavyAction=heavy;root.userData.hitAction=hit;root.userData.blockAction=block;root.userData.dodgeAction=dodgeAction;root.userData.chargeAction=charge;root.userData.beamAction=beam;root.userData.landAction=land;
  root.userData.lastMoveAction=idle;root.userData.attackLock=0;root.userData.wasAttacking=false;root.userData.proceduralAttackTime=0;root.userData.specialPoseTime=0;root.userData.lastSpecialCooldown=0;root.userData.landingPoseTime=0;root.userData.wasGrounded=true;
  // A character-specific asset already owns its silhouette and materials; don't stack generic armor over it.
  const parent=previous.parent;
  if(!parent)return false;
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  parent.add(root);parent.remove(previous);
  fighter.model=root;fighter.position=root.position;
  fighter.characterModelLoaded=true;
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.characterModels=window.__browserSmashAssets.characterModels||{};
  window.__browserSmashAssets.characterModels[characterSlug(fighter,archetype)]={status:'loaded',url,animations:(gltf.animations||[]).map(c=>c.name),bones:Object.keys(joints)};
  return true;
}
export function animateHumanFighter(fighter,dt){
  const root=fighter.model;if(!root?.userData?.humanMixer)return;
  fighter.position=root.position;
  root.rotation.y=Math.atan2(fighter.facingZ,Math.abs(fighter.facing))+(fighter.facing>=0?Math.PI:0)+(root.userData.modelFacingOffset||0);
  // A rig the clip controller drives is owned by that controller. The legacy mixer and the
  // per-joint overlay would otherwise rewrite the same bones on the same frame.
  if(root.userData.animationController){
    root.rotation.z=THREE.MathUtils.damp(root.rotation.z,0,12,dt);
    return;
  }
  root.userData.humanMixer.update(dt);
  const speed=Math.hypot(fighter.velocity.x,fighter.velocity.z), airborne=!fighter.isGrounded;
  if(root.userData.wasGrounded===false&&fighter.isGrounded)root.userData.landingPoseTime=.24;
  root.userData.wasGrounded=!!fighter.isGrounded;
  root.userData.landingPoseTime=Math.max(0,root.userData.landingPoseTime-dt);
  const lastCooldown=root.userData.lastSpecialCooldown||0;
  if(fighter.specialCooldown>lastCooldown+.12)root.userData.specialPoseTime=.56;
  root.userData.lastSpecialCooldown=fighter.specialCooldown;
  root.userData.specialPoseTime=Math.max(0,root.userData.specialPoseTime-dt);
  const attacking=(fighter.attackQueue?.length||0)>0;
  const gear=root.userData.armorGear;
  const attackStarted=attacking&&!root.userData.wasAttacking;
  if(attackStarted){root.userData.attackLock=.34;root.userData.proceduralAttackTime=.34;if(root.userData.lastMoveAction)root.userData.lastMoveAction.fadeOut(.08);root.userData.lastMoveAction=null;}
  root.userData.proceduralAttackTime=Math.max(0,root.userData.proceduralAttackTime-dt);
  // Overlay a short, weighty punch/slash while preserving each rig's bind pose.
  const joints=root.userData.proceduralJoints||{};
  const phase=root.userData.proceduralAttackTime>0?1-root.userData.proceduralAttackTime/.34:0;
  const strike=root.userData.proceduralAttackTime>0?Math.sin(Math.min(1,phase)*Math.PI):0;
  const hitReact=fighter.hitstun>0?Math.min(1,fighter.hitstun/.38):0;
  const guard=fighter.guardHeld&&fighter.hitstun<=0&&fighter.guardBreak<=0;
  const dodge= fighter.dodgeTimer>0?Math.sin(THREE.MathUtils.clamp(fighter.dodgeTimer/(fighter.roamMode?.62:.48),0,1)*Math.PI):0;
  const proceduralOnly=!root.userData.walkAction&&!root.userData.runAction&&!root.userData.jumpAction&&!root.userData.punchAction&&!root.userData.hitAction;
  const gait=proceduralOnly&&!airborne&&speed>.35?Math.min(1,speed/7):0;
  const stride=Math.sin(fighter.t*(speed>7?10.5:7.2))*gait;
  const idleBreath=proceduralOnly&&!airborne&&gait<.08?Math.sin(fighter.t*2.15)*.025:0;
  const comboLean=fighter.comboStep===3?.1:.0;
  const specialPose=root.userData.specialPoseTime>0?Math.sin(THREE.MathUtils.clamp(1-root.userData.specialPoseTime/.56,0,1)*Math.PI):0;
  const landingPose=root.userData.landingPoseTime>0?Math.sin(THREE.MathUtils.clamp(root.userData.landingPoseTime/.24,0,1)*Math.PI):0;
  if(proceduralOnly)for(const [key,j] of Object.entries(joints)){
    j.bone.rotation.copy(j.base);
    if(key==='shoulderR')j.bone.rotation.x+=strike*-.35+stride*.12+specialPose*-.3+(guard?-.22:0);
    if(key==='shoulderL')j.bone.rotation.x+=strike*-.12-stride*.12+specialPose*-.28+(guard?-.22:0);
    if(key==='armR')j.bone.rotation.x+=strike*(-.95-comboLean)-hitReact*.22+stride*.28+idleBreath+specialPose*-.86+(guard?-.78:0);
    if(key==='forearmR')j.bone.rotation.x+=strike*-.45-hitReact*.12+specialPose*-.35+(guard?-.82:0);
    if(key==='handR')j.bone.rotation.x+=strike*-.18+(guard?-.18:0);
    if(key==='armL')j.bone.rotation.x+=strike*-.24+hitReact*.12-stride*.28-idleBreath+specialPose*-.82+(guard?-.78:0);
    if(key==='forearmL')j.bone.rotation.x+=strike*-.12+specialPose*-.32+(guard?-.82:0);
    if(key==='handL')j.bone.rotation.x+=guard?-.18:0;
    if(key==='torso'){
      j.bone.rotation.x+=strike*.14-hitReact*.22+(gait?Math.abs(stride)*.035:0)+idleBreath*1.8+specialPose*-.08+landingPose*.16;
      j.bone.rotation.y+=strike*(fighter.comboStep===2?-.24:.16)+stride*.045;
      j.bone.rotation.z+=dodge*(fighter.facing>=0?-.3:.3);
    }
    if(key==='pelvis')j.bone.rotation.x+=airborne?-.12:stride*.035;
    if(key==='head')j.bone.rotation.x+=hitReact*.16-idleBreath*.7;
    if(key==='legL')j.bone.rotation.x+=airborne?-.16:stride*.62+dodge*.15+landingPose*.42;
    if(key==='legR')j.bone.rotation.x+=airborne?-.16:-stride*.62-dodge*.15+landingPose*.42;
    if(key==='shinL')j.bone.rotation.x+=airborne?.24:Math.max(0,-stride)*.42;
    if(key==='shinR')j.bone.rotation.x+=airborne?.24:Math.max(0,stride)*.42;
  }
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
  const guarding=fighter.guardHeld&&fighter.guardBreak<=0;
  const activeAttack=fighter.attackQueue?.[fighter.attackQueue.length-1];
  if(fighter.hitstun>0)target=root.userData.hitAction||root.userData.idleAction;
  else if(root.userData.specialPoseTime>0)target=root.userData.beamAction||root.userData.chargeAction||root.userData.punchAction||root.userData.lastMoveAction;
  else if(guarding)target=root.userData.blockAction||root.userData.idleAction;
  else if(fighter.dodgeTimer>0)target=root.userData.dodgeAction||root.userData.jumpAction||root.userData.lastMoveAction;
  else if(attacking)target=((activeAttack?.kind==='heavy'||activeAttack?.kind==='air-finisher'||activeAttack?.comboStep===3)?root.userData.heavyAction:null)||root.userData.punchAction||root.userData.lastMoveAction;
  else if(airborne)target=root.userData.jumpAction||root.userData.lastMoveAction;
  else if(root.userData.landingPoseTime>0)target=root.userData.landAction||root.userData.idleAction;
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
