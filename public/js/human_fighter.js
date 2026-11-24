// Rigged human fighters with original archetype-specific armor, weapons, and readable combat motion.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mountImportedCharacter, faceFighterModel } from './fighter_model_placement.js';
import { heightProfileFor, AUTHORING_BASELINE_HEIGHT } from './character_scale.js';
import { validateFighterRig, describeRigValidation, isEquippedWeapon } from './rig_validation.js';
import { enhanceSurfaceMaterials, surfaceDetailReport } from './surface_detail.js';
import { claimModelTextures, releaseModelTextures } from './render/texture_ownership.js';
import { resolveRig } from './anim/rig_map.js';
import { buildClip } from './anim/clip_library.js';
import { buildAttackClip } from './anim/attack_clips.js';
import { MOTION_SETS, MOTION_SET_BY_IDENTITY } from './anim/attack_animator.js';
import { specialClipFor, attackClipsFor, authoredStrikeSlotFor, authoredFormClipsFor, importedAttackClipsFor, importedReactionClipsFor, importedAbilityClipsFor, importedAuthoredClipsFor, importedStrikeSlotFor, bodyClipSlotsFor } from './anim/animation_manifest.js';
import { advanceFlightLocomotion, applyFlightLocomotionPose, flightLocomotionFor } from './anim/flight_locomotion.js?v=browser-smash-flight-locomotion-v1-20261123';
import { applySharedRigGrounding, bindSharedRigFamily, sharedRigTimeScaleForAction, sharedRigTransitionFade } from './anim/shared_rig_family.js';
import { applySoloRigGrounding, prepareSoloClip } from './anim/solo_rig_lanes.js';
import { settleRestingArms } from './anim/resting_arms.js';
import { resolveTransition, syncActionPhase } from './anim/transition_policy.js';
import { maskClip, UPPER_BODY_BONES, LOWER_BODY_BONES } from './anim/body_mask.js';
import { applyEquipmentState } from './equipment_state.js';
import { applyIdentityDetails } from './character_identity_details.js';
import { resetAnimationOverlays, updateAnimationOverlays } from './anim/animation_overlays.js';
import { applyNativeSpiderStow } from './anim/native_spider_stow.js?v=browser-smash-phase3-v45-20261027';
import { applyLocomotionPresentation, locomotionPilotEnabled, strideScaleFor } from './anim/foot_plant.js?v=browser-smash-locomotion-v2-20261124';

const MODEL_BASE='/models/characters/';
const MODEL_MANIFEST_URL=`${MODEL_BASE}manifest.json`;
// The Saitama GLB was exported with every untextured slot set to a black base factor. The
// texture-bearing suit/shoe slots survive, but skin, cape and gloves become a silhouette. These
// are the authored colours for the model's own material names; only black, untextured slots are
// touched, so the embedded suit and shoe textures keep their pixels.
const SAITAMA_MISSING_COLORS=Object.freeze({
  cape:0xf2efe7,cape_shadow:0xded9cc,cape_button:0xc9a227,
  skin:0xefc3a0,skin_shadow:0xd9a07c,glove:0xc8332f,
  white_eye:0xffffff,black_eye:0x111111,eyebrows:0x1b1b1b,
  shoe_sole:0x292623,zip1:0x33302c,zip2:0x272421,
  belt1:0x3b3026,belt2:0x2b241e
});
function repairMissingMaterialColors(root,slug){
  if(slug!=='saitama')return 0;
  let repaired=0;
  root.traverse(o=>{
    if(!o.isMesh||!o.material)return;
    const mats=Array.isArray(o.material)?o.material:[o.material];
    for(const mat of mats){
      if(!mat||mat.map)continue;
      const key=String(mat.name||'').replace(/\.\d+$/,'');
      if(key==='OH_Outline_Material')continue;
      const hex=SAITAMA_MISSING_COLORS[key];
      if(hex===undefined||!mat.color)continue;
      // GLTF colour management leaves these exported black slots slightly above literal zero;
      // treat near-black as the missing authoring colour, not just an exact 0x000000 match.
      if(Math.max(mat.color.r,mat.color.g,mat.color.b)>0.12)continue;
      mat.color.setHex(hex);
      mat.userData.materialRepair='saitama-missing-base-color';
      repaired++;
    }
  });
  return repaired;
}

// ---------------------------------------------------------------------------- body masks
// Imported bodies use the legacy mixer in this file. They need the same lower/upper split as the
// AnimationController path: a guard or a punch must not replace the walk cycle underneath it.
const LEGACY_MASK_BONES=Object.freeze([...UPPER_BODY_BONES,...LOWER_BODY_BONES]);
// A one-frame pose in a source GLB is not an animation. Keeping it in the action bank lets a
// substring search or a late repair silently select it for a gameplay slot; the static Flash
// `jumpUp` and Hulk `@collection` clips are exactly that failure mode.
function isStaticAnimationClip(clip){
  const tracks=clip?.tracks||[];
  if(!tracks.length)return true;
  if(Number(clip?.duration)<=1e-4)return true;
  return tracks.every(track=>!track?.times||track.times.length<2);
}

function legacyMaskRig(root){
  if(root?.userData?.bodyMaskRig)return root.userData.bodyMaskRig;
  const joints={};
  for(const bone of LEGACY_MASK_BONES){
    const node=root?.userData?.[bone];
    if(node?.isObject3D)joints[bone]=node;
  }
  const rig={joints};
  if(root?.userData)root.userData.bodyMaskRig=rig;
  return rig;
}
function legacyMaskedAction(root,source,region){
  const clip=source?.getClip?.();
  const mixer=root?.userData?.humanMixer;
  if(!clip||!mixer)return null;
  const masked=maskClip(clip,legacyMaskRig(root),region);
  if(!masked)return null;
  return mixer.existingAction(masked)||mixer.clipAction(masked);
}
function legacyLayerPlan(root,target,{speed=0,guarding=false,attacking=false,airborne=false,hitstun=0}={}){
  const u=root?.userData;
  if(!u?.humanMixer||!target||airborne||hitstun>0)return null;
  if(!guarding&&!attacking)return null;
  const name=String(target.getClip?.()?.name||'');
  const lowerAttack=/kick|sweep|leg/i.test(name);
  const baseSource=lowerAttack
    ?(u.blockAction||u.idleAction)
    :(speed>11?(u.sprintAction||u.runAction||u.walkAction)
      :speed>7?(u.runAction||u.walkAction)
      :speed>.35?(u.walkAction||u.runAction)
      :(u.fightingIdleAction||u.idleAction));
  const overlaySource=guarding&&!lowerAttack?(u.blockAction||target):target;
  const baseRegion=lowerAttack?'upper':'lower';
  const overlayRegion=lowerAttack?'lower':'upper';
  const base=legacyMaskedAction(root,baseSource,baseRegion);
  const overlay=legacyMaskedAction(root,overlaySource,overlayRegion);
  if(!base||!overlay)return null;
  return {base,overlay,overlaySource,baseRegion,overlayRegion,
    baseName:base.getClip().name,overlayName:overlay.getClip().name};
}
function playLegacyMaskOverlay(root,layer,fade=.1){
  const u=root?.userData;
  if(!u||!layer?.overlay)return;
  const old=u.maskOverlayAction;
  if(old!==layer.overlay){
    layer.overlay.reset();
    layer.overlay.setLoop(layer.overlaySource?.loop??THREE.LoopRepeat,
      layer.overlaySource?.repetitions??Infinity);
    layer.overlay.clampWhenFinished=Boolean(layer.overlaySource?.clampWhenFinished);
    layer.overlay.setEffectiveTimeScale(layer.overlaySource?.timeScale||1);
    layer.overlay.setEffectiveWeight(1);
    layer.overlay.fadeIn(fade).play();
    if(old&&old!==layer.overlay)old.fadeOut(fade);
  }else{
    layer.overlay.setEffectiveTimeScale(layer.overlaySource?.timeScale||1);
  }
  u.maskOverlayAction=layer.overlay;
  u.maskOverlayRegion=layer.overlayRegion;
  u.maskOverlayName=layer.overlayName;
}
function clearLegacyMaskOverlay(root,fade=.1){
  const u=root?.userData;
  if(!u?.maskOverlayAction)return;
  u.maskOverlayAction.fadeOut(fade);
  u.maskOverlayAction=null;
  u.maskOverlayRegion=null;
  u.maskOverlayName=null;
  u.bodyMaskLayers=null;
}
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
// The Blender-authored showcase export is opt-in so it can be reviewed in a real match without
// replacing the roster body: `?showcaseGoku=1` or localStorage.browserSmashShowcaseGoku='1'.
function showcaseBodyRequested(){
  try{
    if(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('showcaseGoku')==='1')return true;
    return typeof localStorage!=='undefined'&&localStorage.getItem('browserSmashShowcaseGoku')==='1';
  }catch(_error){return false;}
}
async function loadCharacterModel(fighter,archetype,GLTFLoader,FBXLoader){
  const slug=characterSlug(fighter,archetype);
  const manifest=await getCharacterManifest();
  let entry=manifest?.characters?.[slug];
  // Review ANY manifest-registered body without touching the roster or the character-select
  // entries: ?showcaseCharacter=<manifestKey>. Used by the licensed-asset ingestion pipeline so a
  // newly imported model can be inspected in a real match before anything is promoted.
  const reviewKey=(()=>{try{return new URLSearchParams(window.location.search).get('showcaseCharacter')||localStorage.getItem('browserSmashShowcaseCharacter')||'';}catch(_e){return '';}})();
  // Scope the review override to the player side. Applying it on both sides silently replaced the
  // opponent too, so a candidate body could never be judged against an existing fighter.
  const reviewIsPlayer=(()=>{try{const picked=document.querySelector('#p1Character')?.value;return Boolean(picked)&&picked===fighter?.identity;}catch(_error){return true;}})();
  if(reviewKey&&reviewIsPlayer&&manifest?.characters?.[reviewKey])entry=manifest.characters[reviewKey];
  if(slug==='goku'&&showcaseBodyRequested()){
    // The opt-in flag now selects the Phase 2.3 sculpted body; ?showcaseGoku=showcase still loads the
    // Phase 2.2 body so the earlier export stays reachable.
    const legacyBody=(()=>{try{return new URLSearchParams(window.location.search).get('showcaseGoku')==='showcase'||localStorage.getItem('browserSmashShowcaseGoku')==='showcase';}catch(_e){return false;}})();
    const showcase=manifest?.characters?.[legacyBody?'goku_showcase':'goku_sculpt'];
    if(showcase&&showcase.enabled!==false)entry=showcase;
  }
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
      // A model authored facing -Z needs half a turn; the manifest carries the correction so
      // a new asset can be dialled in without touching code. FBX imports have historically
      // been authored facing away from the fighter, glTF exports face +Z.
      const yawOffset=Number.isFinite(entry?.yawOffset)
        ? THREE.MathUtils.degToRad(entry.yawOffset)
        : (isFbx?Math.PI:0);
      return {gltf,url,format:isFbx?'fbx':'gltf',yawOffset};
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
// Free the geometry of a model that is being replaced. `parent.remove` only detaches it: the
// geometry stays in the renderer's memory (and in renderer.info.memory.geometries) for the rest of
// the session, which is why repeated character switching used to climb forever.
// Only geometry is disposed here, and only when no other mesh under the same parent still uses it:
// materials in this project can be shared between rigs, and disposing a shared material would break
// a fighter that is still on screen.
function disposeReplacedModel(root,container){
  if(!root||typeof root.traverse!=='function')return 0;
  resetAnimationOverlays(root);
  const inUse=new Set();
  if(container&&typeof container.traverse==='function'){
    container.traverse(node=>{ if(node!==root&&node.geometry)inUse.add(node.geometry); });
  }
  const seen=new Set();
  let disposed=0;
  root.traverse(node=>{
    const geometry=node.geometry;
    if(!geometry||seen.has(geometry))return;
    seen.add(geometry);
    if(inUse.has(geometry)||geometry.userData?.shared)return;
    try{geometry.dispose();disposed++;}catch(_error){/* already disposed */}
  });
  return disposed;
}
export async function upgradeFighterModel(fighter,archetype='warrior',override=null){
  const previous=fighter?.model;
  if(!previous||!previous.userData)return false;
  const identityAtStart=String(fighter.identity||fighter.name||'');
  const {GLTFLoader,FBXLoader}=await getLoader();
  // `override` lets the development harness mount a candidate file through this exact path
  // (placement, rig gate, joint binding, mixer, material detail) without a manifest entry and
  // therefore without registering anything in the roster.
  const loaded=override||await loadCharacterModel(fighter,archetype,GLTFLoader,FBXLoader);
  // A slow load that lost the race is discarded outright: abandoning the parsed scene used to
  // leave its geometry and every one of its texture maps resident with nothing on screen.
  if(!loaded||fighter.model!==previous||String(fighter.identity||fighter.name||'')!==identityAtStart){
    if(loaded?.gltf?.scene){releaseModelTextures(loaded.gltf.scene);disposeReplacedModel(loaded.gltf.scene,null);}
    return false;
  }
  const {gltf,url,format,yawOffset}=loaded;
  const root=gltf.scene;
  // Normalize imported GLTF/FBX character height so models authored in centimeters or meters
  // line up with the existing fighter physics and camera framing.
  root.updateMatrixWorld(true);
  if(format==='fbx')applyGokuTextures(root,url.slice(0,url.lastIndexOf('/')+1));
  // Scale, ground contact and facing are normalised by mountImportedCharacter: it keeps the
  // asset's own transform and animation intact, puts the model's lowest point on the
  // fighter's origin and records the yaw offset the controller adds every frame.
  root.userData.modelFacingOffset=yawOffset;
  root.userData.characterAssetUrl=url;
  // Object_122 is the supplied Iron Spider appendage mesh. The direct-GLB repair normalises its
  // authored 45x51x58 m bounds and reattaches it under the body, so a mounted mesh is the proof
  // that the supplied arms are visible. When it is present main.js deliberately does not attach
  // the procedural four-leg fallback.
  const nativeArmMesh=root.getObjectByName?.('Object_122');
  if(nativeArmMesh){
    // Count the bones that actually influence the supplied arm, not the whole body skeleton.
    // The mesh is fully weighted to its 21 appendage/body groups, while skeleton.bones contains
    // all 107 joints. Filtering bone names is unreliable because the exported skeleton uses body
    // names; the skinIndex accessor is the authoritative binding.
    const skinIndices=nativeArmMesh.geometry?.attributes?.skinIndex;
    const skinWeights=nativeArmMesh.geometry?.attributes?.skinWeight;
    const weightedJoints=new Set();
    // Three r152's BufferAttribute exposes getX/getY/getZ/getW, not getComponent. Accessing the
    // components through those methods keeps interleaved attributes correct and cannot abort the
    // whole character mount if a future Three release lacks one generic accessor.
    const component=(attribute,index,channel)=>channel===0?attribute.getX(index):channel===1?attribute.getY(index):channel===2?attribute.getZ(index):attribute.getW(index);
    if(skinIndices){
      for(let i=0;i<skinIndices.count;i++){
        for(let channel=0;channel<skinIndices.itemSize;channel++){
          const weight=skinWeights?component(skinWeights,i,channel):1;
          if(weight>.0001)weightedJoints.add(component(skinIndices,i,channel));
        }
      }
    }
    root.userData.nativeSpiderLegs={
      bones:weightedJoints.size||(nativeArmMesh.skeleton?.bones?.length||0),
      skeletonBones:nativeArmMesh.skeleton?.bones?.length||0,
      vertices:nativeArmMesh.geometry?.attributes?.position?.count||0,
      source:url,
      mesh:nativeArmMesh.name
    };
  } else root.userData.nativeSpiderLegsRemoved={reason:'no mounted Object_122 arm mesh; procedural four-leg fallback remains available'};
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
  const mixer=new THREE.AnimationMixer(root),animations={};
  const staticClipsSkipped=[];
  for(const clip of gltf.animations||[]){
    if(isStaticAnimationClip(clip)){staticClipsSkipped.push(clip.name);continue;}
    animations[clip.name.toLowerCase()]=mixer.clipAction(clip);
  }
  root.userData.staticClipsSkipped=staticClipsSkipped;
  // Search words are ordered by priority: for each word in turn, take the first clip whose name
  // contains it. Searching all words at once let a broad word steal a clip from a specific one -
  // a rig shipping `jab` and `heavy_punch` had both light and heavy attack bound to the heavy
  // clip, because `heavy_punch` contains `punch` and came first in the file.
  const find=(...words)=>{for(const word of words){const hit=Object.entries(animations).find(([n])=>n.includes(word));if(hit)return hit[1];}return undefined;};
  const firstPlayable=(gltf.animations||[]).find(clip=>!isStaticAnimationClip(clip));
  const idle=find('idle','stand')||(firstPlayable&&mixer.clipAction(firstPlayable));
  // The exported roster bodies now carry the full state set, so the searches for dodge, charge,
  // beam and land (declared below) finally resolve instead of falling through to idle, and these
  // additional states are bound here: sprint, flight, knockdown, get-up and the rising launcher.
  const sprint=find('sprint'),fly=find('fly','hover'),knockdownAction=find('knockdown','knock_down'),getUpAction=find('get_up','getup','stand_up'),launcherAction=find('launcher');
  // The eight authored states. Each is bound to a search that only matches the clip it names -
  // `hover` is separate from `fly` (holding station vs travelling), and `air_attack` cannot be
  // stolen by `air`-prefixed jump searches because it is bound here rather than derived.
  const hoverAction=find('hover'),airAttackAction=find('air_attack','airattack','aerial_attack'),throwAction=find('throw'),parryAction=find('parry','deflect'),strafeAction=find('strafe'),victoryAction=find('victory','win'),defeatAction=find('defeat','lose'),hitHeavyAction=find('hit_heavy','hithard','heavy_hit'),hitLightAction=find('hit_light','hit_light_react');
  const walk=find('walk','locomotion'),run=find('run','sprint'),jump=find('jump','fall','air'),punch=find('jab','lightattack','light_punch','lightjab','punch','attack','swing','kick'),heavy=find('heavy','finisher','uppercut'),hit=find('hit','damage','hurt'),block=find('block','guard'),dodgeAction=find('dodge','evade','roll'),charge=find('charge','powerup','power_up'),beam=find('beam','kame','repulsor','blast','special'),land=find('land','landing');
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
    // Head and neck are different joints, and the traversal reaches the neck first because it is
    // the skull's parent: the old shared `head||neck` slot therefore bound the NECK as the head and
    // never looked at the skull again, so head motion drove the wrong bone on every imported body.
    if(/neck/.test(n))joints.neck ||= {bone:o,base:o.rotation.clone()};
    if(/head|skull|cranium/.test(n)&&!/neck/.test(n))joints.head ||= {bone:o,base:o.rotation.clone()};
  });
  // Second pass for exports that write the side as a bare suffix (`hand.l`, `hand_r`) instead of
  // the `_L`/`Left` forms the first pass prefers. Those bodies ended up with pelvis/torso/head only,
  // so the weapon mount found no hand joint and the imported character silently carried nothing.
  // Additive: a part that already matched is never replaced.
  root.traverse(o=>{
    if(!o.isBone)return;
    const c=String(o.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const side=c.endsWith('l')?'L':c.endsWith('r')?'R':'';
    if(!side)return;
    const part=/hand|wrist|palm/.test(c)?'hand':/forearm|lowerarm/.test(c)?'forearm':/upperarm/.test(c)?'arm':'';
    if(part&&!joints[part+side])joints[part+side]={bone:o,base:o.rotation.clone()};
  });
  // A rig that only names a neck still needs a head joint for the structural gate, but the
  // substitution is recorded so a probe can tell a real skull from a fallback.
  if(!joints.head&&joints.neck)joints.head={bone:joints.neck.bone,base:joints.neck.base.clone(),fallback:'neck'};
  root.userData.proceduralJoints=joints;
  // The same bones, addressed by the names the rest of the game reads. The weapon mount, the
  // ground pickup and the structural rig gate all look up userData.rightArm and friends, so a
  // character body that answered to none of those names silently lost its signature weapon.
  const boneOf=part=>joints[part]?.bone||null;
  Object.assign(root.userData,{
    pelvis:boneOf('pelvis'),torso:boneOf('torso'),neck:boneOf('neck'),head:boneOf('head'),
    leftArm:boneOf('armL'),rightArm:boneOf('armR'),
    leftFore:boneOf('forearmL'),rightFore:boneOf('forearmR'),
    leftHand:boneOf('handL'),rightHand:boneOf('handR'),
    leftLeg:boneOf('legL'),rightLeg:boneOf('legR'),
    leftShin:boneOf('shinL'),rightShin:boneOf('shinR')
  });
  // Identity details the baked asset does not carry (Jack's tricorn, Voldemort's face and robe).
  // Runs after the joint mirror above, because both attach to model.userData.head.
  try{
    const details=applyIdentityDetails(root,fighter);
    root.userData.identityDetails=details;
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.identityDetails=window.__browserSmashAssets.identityDetails||{};
    window.__browserSmashAssets.identityDetails[String(fighter?.identityKey||fighter?.identity||'?')]=details;
  }catch(error){console.warn('Identity details unavailable:',error);}
  root.userData.humanMixer=mixer;
  root.userData.animationActions=animations;
  root.userData.hasAnimationClips=Boolean((gltf.animations||[]).length);
  root.userData.walkAction=walk;root.userData.runAction=run;root.userData.idleAction=idle;
  root.userData.jumpAction=jump;root.userData.punchAction=punch;root.userData.heavyAction=heavy;root.userData.hitAction=hit;root.userData.blockAction=block;root.userData.dodgeAction=dodgeAction;root.userData.chargeAction=charge;root.userData.beamAction=beam;root.userData.landAction=land;
  root.userData.sprintAction=sprint;root.userData.flyAction=fly;root.userData.knockdownAction=knockdownAction;root.userData.getUpAction=getUpAction;root.userData.launcherAction=launcherAction;
  // Track where the charge pose came from. A source-owned charge stays source; a body without one
  // gets the same semantic library clip the other missing states use. The form fallback publishes
  // the real provenance instead of always claiming `body-charge`.
  root.userData.chargeClipSource=charge?'source-charge':null;
  root.userData.hoverAction=hoverAction;root.userData.airAttackAction=airAttackAction;root.userData.flyForwardAction=root.userData.flyForwardAction||null;root.userData.doubleJumpAction=root.userData.doubleJumpAction||null;root.userData.fallAction=root.userData.fallAction||null;root.userData.throwAction=throwAction;root.userData.parryAction=parryAction;root.userData.strafeAction=strafeAction;root.userData.victoryAction=victoryAction;root.userData.defeatAction=defeatAction;root.userData.hitHeavyAction=hitHeavyAction;root.userData.hitLightAction=hitLightAction;
  // Kicks and grabs are bound through the animation manifest's alias lists instead of fresh ad hoc
  // searches: a body that ships a kick clip uses it, one that does not falls back to a named clip
  // (its kick-family or throw) rather than silently binding nothing.
  const lightKick=find('front_kick','light_kick','kick')||launcherAction||punch;
  const heavyKick=find('spinning_kick','heavy_kick','roundhouse','kick')||launcherAction||heavy;
  const grabAction=find('grab','grapple')||throwAction;
  root.userData.lightKickAction=lightKick;root.userData.heavyKickAction=heavyKick;root.userData.grabAction=grabAction;
  // A fighter put on the floor stands up through its own get-up clip instead of snapping to idle.
  root.userData.getUpTime=0;root.userData.wasKnockedDown=false;
  root.userData.lastMoveAction=idle;root.userData.attackLock=0;root.userData.wasAttacking=false;root.userData.proceduralAttackTime=0;root.userData.specialPoseTime=0;root.userData.lastSpecialCooldown=0;root.userData.landingPoseTime=0;root.userData.wasGrounded=true;
  // Authored signature bridge. The identity's authored clip is registered as an action on THIS
  // body's existing mixer, so the fighter still has exactly one animation system writing its
  // bones: baked clips keep owning locomotion, and the authored clip owns only the signature
  // window. An identity with no authored move keeps the baked charge/beam pair untouched.
  root.userData.authoredSpecialAction=null;root.userData.authoredSpecialTime=0;root.userData.authoredSpecialClipId=null;
  try{
    const authoredId=specialClipFor(fighter);
    if(authoredId&&authoredId!=='special_attack'){
      const authoredRig=resolveRig(root);
      const authoredClip=buildClip(authoredId,authoredRig);
      if(authoredRig&&authoredClip){
        const authoredAction=mixer.clipAction(authoredClip);
        authoredAction.setLoop(THREE.LoopOnce,1);
        authoredAction.clampWhenFinished=true;
        root.userData.authoredSpecialAction=authoredAction;
        root.userData.authoredSpecialClipId=authoredId;
        root.userData.authoredSpecialRig={kind:authoredRig.kind,bound:authoredRig.boundCount,missing:authoredRig.missing};
        window.__browserSmashAssets=window.__browserSmashAssets||{};
        window.__browserSmashAssets.authoredSignatures=window.__browserSmashAssets.authoredSignatures||{};
        window.__browserSmashAssets.authoredSignatures[characterSlug(fighter,archetype)]={
          clip:authoredId,duration:authoredClip.duration,rig:root.userData.authoredSpecialRig
        };
      }
    }
  }catch(error){console.warn('Authored signature clip could not bind: '+(error?.message||error));}
  // A character-specific asset already owns its silhouette and materials; don't stack generic armor over it.
  const parent=previous.parent;
  if(!parent)return false;
  root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  // The exported character bodies ship UV charts but no image textures, exactly like the prefab
  // library, so they take the same generated weave/brushed/grain detail the prefab path applies.
  // Without this every selectable fighter rendered as smooth flat plastic under its own GLB - the
  // detail was only ever applied to the prefab body the exported one replaces a frame later.
  // Repair authored palette slots before adding detail so the detail pass samples final colours.
  const materialRepairs=repairMissingMaterialColors(root,characterSlug(fighter,archetype));
  const detail=enhanceSurfaceMaterials(root);
  root.userData.materialRepairs=materialRepairs;
  root.userData.surfaceDetail=surfaceDetailReport(root);
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.lastCharacterDetail={key:characterSlug(fighter,archetype),materialRepairs,...detail,classes:root.userData.surfaceDetail};
  // "Hands are the weapon" survives the body swap: the three hand-attack identities are unarmed
  // by design and must not pick up a blade from the prefab weapon library under their new body.
  if(previous.userData?.unarmed===true||previous.userData?.sculptedBody)root.userData.unarmed=true;
  // Stamp the mounted body with the URL it came from. A probe can then prove that the skinned
  // mesh it measured belongs to THIS fighter's imported body, instead of accidentally reporting
  // another fighter's skeleton.
  const heightProfile=heightProfileFor(fighter);
  const {holder,placement}=mountImportedCharacter(root,previous,{
    yawOffset,
    facing:fighter.facing,
    facingZ:fighter.facingZ,
    targetHeight:heightProfile.targetHeight
  });
  // animateHumanFighter rolls the asset for the hit-reaction lean, not the holder: the holder is
  // the fighter's physics root and is the transform every structural rig gate measures, so a roll
  // written there reads as a rig that lost its up axis. Remember the asset's own roll so the lean
  // stays an offset from it instead of overwriting it.
  root.userData.leanBaseZ=root.rotation.z;
  holder.userData.assetUrl=url;
  holder.userData.targetHeight=heightProfile.targetHeight;
  holder.userData.heightProfile=heightProfile;
  holder.userData.leanBaseY=root.position.y;
  // Same gate as the prefab swap: an import that lands squashed, buried or empty keeps the
  // procedural fighter instead of putting a broken body in the arena.
  // The holder itself is unscaled: mountImportedCharacter has already folded the source scale
  // into the imported root, so the limits are checked against the 2.05 m target body.
  const validation=validateFighterRig(holder,{ground:holder.position.y,ignore:isEquippedWeapon,requireJoints:false,scale:heightProfile.targetHeight/AUTHORING_BASELINE_HEIGHT});
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.characterModels=window.__browserSmashAssets.characterModels||{};
  window.__browserSmashAssets.characterModels[characterSlug(fighter,archetype)]={
    status:validation.ok?'loaded':'rejected',
    url,
    animations:(gltf.animations||[]).map(c=>c.name),
    bones:Object.keys(joints),
    placement,
    heightProfile:heightProfile.label,
    targetHeight:heightProfile.targetHeight,
    validation:{ok:validation.ok,issues:validation.issues},
    metrics:validation.metrics
  };
  if(!validation.ok){
    console.warn('Imported character model for '+characterSlug(fighter,archetype)+' failed rig validation; keeping the procedural fighter. '+describeRigValidation(validation));
    return false;
  }
  parent.add(holder);
  // Refcount the new body's maps, then hand the replaced body's maps back. `parent` and the other
  // fighter's live model are scanned as surviving owners so a shared map is never disposed.
  claimModelTextures(holder);
  // The replaced body is still `fighter.model` at this point, so leaving it in `keep` made the
  // release protect its own maps and dispose nothing. It is the body being released, not a
  // surviving owner.
  releaseModelTextures(previous,{keep:(window.fighters||[]).map(f=>f.model).filter(model=>model&&model!==previous)});
  disposeReplacedModel(previous,parent);parent.remove(previous);
  fighter.model=holder;fighter.position=holder.position;
  fighter.characterModelLoaded=true;
  // The legacy mixer's idle action is started while the imported scene is still at its load
  // transform. Re-parenting the scene under the holder rebinds the skeleton, and an action that
  // was already running before that rebind can report weight 1 without ever writing a bone: the
  // displayed rig stays in its bind T-pose while the action clock advances. Force one fresh
  // start of the locomotion action after the mount has settled. Controller-owned rigs skip this
  // path and keep their own mixer.
  root.userData.legacyLocomotionNeedsRestart=true;
  // An imported body can hold the identity's weapon exactly like a prefab body: models.js mounts a
  // prop on a hand bone, writes per-weapon grip offsets, and syncEquippedWeapons() keeps the holder
  // on that bone every frame. Nothing about that path is prefab-specific, so the body only has to
  // ask for it. Loaded lazily so human_fighter never imports models.js at module scope, and skipped
  // for "hands are the weapon" bodies, which must not grow a blade.
  if(root.userData.unarmed!==true){
    // Must match the specifier main.js statically imports, or the browser evaluates a second copy of
    // models.js (without the ?v= query) and its prefab/asset caches fork into two instances.
    import('./models.js?v=browser-smash-phase3-v45-20261027')
      .then(module=>module.equipCharacterWeapons?.(fighter))
      .catch(error=>console.warn('Imported weapon attachment failed: '+(error?.message||error)));
  }
  return true;
}
const leanScratch=new THREE.Box3();
/**
 * Bind this identity's authored attack clips onto the body's own mixer, lazily.
 *
 * It cannot happen at mount. The mount path runs before main.js assigns `fighter.identityKey`, so
 * the manifest resolves the identity as empty: the signature id comes back null and every kit slot
 * is skipped. That is the whole reason Naruto's casts stamped `abilityCast` and then animated
 * nothing. The first animation frame has the real identity, so bind here and rebind if it changes.
 * One mixer, one writer - the same rule the baked clips already follow.
 */
const importedAuthoredLoads=new WeakMap();
/**
 * Bind the Blender-baked authored clips onto the mounted skeleton.
 *
 * The runtime still compiles the same motion as a fallback, so this load is an upgrade rather than
 * a dependency: it replaces the compiled actions in place once the clip-only GLB arrives. Clips are
 * keyed by the manifest's slot names, exactly like the imported strike set, so selection code does
 * not know which source won.
 */
function ensureImportedAuthoredClips(root,fighter,mixer){
  const set=importedAuthoredClipsFor(fighter);
  if(!set||!mixer)return;
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!key)return;
  const bound=root.userData.importedAuthoredSet;
  if(bound&&bound.key===key&&bound.url===set.url)return;
  if(importedAuthoredLoads.get(root)===set.url)return;
  importedAuthoredLoads.set(root,set.url);
  root.userData.importedAuthoredReport={key,url:set.url,status:'loading',bound:[],forms:[],missing:Object.keys(set.strikes)};
  getLoader().then(({GLTFLoader})=>new Promise((resolve,reject)=>{
    new GLTFLoader().load(set.url,resolve,undefined,reject);
  })).then(gltf=>{
    const byName=new Map((gltf.animations||[]).map(clip=>[clip.name,clip]));
    const actions=root.userData.authoredAbilityActions||(root.userData.authoredAbilityActions={});
    const formActions=root.userData.authoredFormActions||(root.userData.authoredFormActions={});
    const baked={};
    const bakedForms={};
    for(const [slot,clipName] of Object.entries(set.strikes)){
      const clip=byName.get(clipName);
      if(!clip)continue;
      const action=bindSoloClip(mixer,root,gltf,clip);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      const authoredSpider=(key==='spider_man'&&(
        (slot==='special'&&root.userData.authoredSpecialClipId==='spider_man_web_zip')||
        (slot==='ultimate'&&actions.ultimate?.getClip?.()?.name==='spider_web_ultimate')));
      if(authoredSpider)continue;
      actions[slot]=action;
      baked[slot]=action;
    }
    for(const [formId,clipName] of Object.entries(set.forms)){
      const clip=byName.get(clipName);
      if(!clip)continue;
      const action=bindSoloClip(mixer,root,gltf,clip);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      formActions[formId]=action;
      bakedForms[formId]=action;
    }
    root.userData.bakedAuthoredActions=baked;
    root.userData.bakedAuthoredForms=bakedForms;
    root.userData.importedAuthoredSet={key,url:set.url};
    // The signature slot has its own action key, so point it at the baked clip too. Otherwise the
    // cast would keep playing the compiled copy while every strike used the baked one.
    if(baked.special&&!(key==='spider_man'&&root.userData.authoredSpecialClipId==='spider_man_web_zip')){
      root.userData.authoredSpecialAction=baked.special;
      root.userData.authoredSpecialClipId=set.strikes.special;
    }
    root.userData.importedAuthoredReport={
      key,url:set.url,status:Object.keys(baked).length?'ready':'failed',authoredBy:set.authoredBy,
      clips:[...byName.keys()],bound:Object.keys(baked),forms:Object.keys(bakedForms),
      missing:Object.keys(set.strikes).filter(slot=>!baked[slot])
    };
    root.userData.authoredBindDiag={...(root.userData.authoredBindDiag||{}),baked:Object.keys(baked),bakedForms:Object.keys(bakedForms),bakedUrl:set.url};
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.authoredBaked=window.__browserSmashAssets.authoredBaked||{};
    window.__browserSmashAssets.authoredBaked[key]=root.userData.importedAuthoredReport;
  }).catch(error=>{
    root.userData.importedAuthoredReport={key,url:set.url,status:'error',error:String(error?.message||error)};
    importedAuthoredLoads.delete(root);
  });
}

// A body with authored idle/guard/hit states owns its rig even when its source pack has no walk
// cycle. Requiring a walk slot kept Aquaman's procedural controller alive on top of CombatIdle, so
// the mixer action was selected but its pose was overwritten every frame (measured idle delta 0).
function authoredStateOwnsBody(fighter){
  const slots=importedReactionClipsFor(fighter)?.slots;
  return Boolean(slots&&(slots.idle||slots.walk||slots.run||slots.block));
}

function bindAuthoredClips(root,fighter,mixer){
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!mixer||!key)return;
  // A body that ships its own idle/walk/run/block clips is driven by those clips. The canonical
  // posture controller otherwise owns the rig, and animateHumanFighter returns before the mixer is
  // advanced on such a body: every imported clip would bind and then never play, which is exactly
  // the "clips are loaded but the fighter stands still" failure. Bodies without that state coverage
  // keep the controller unchanged.
  if(root.userData.animationController&&authoredStateOwnsBody(fighter)){
    root.userData.animationController.dispose?.();
    root.userData.animationController=null;
    root.userData.animationRig=null;
    root.userData.animationControllerReleased=true;
    if(fighter)fighter.animationController=null;
  }
  // Reactions bind on their own guard: the strike set can be ready while the reaction GLB is still
  // loading, and returning early on the strike key would leave the body with attacks but no reactions.
  ensureLibraryStateClips(root,fighter,mixer);
  ensureImportedReactionClips(root,fighter,mixer);
  ensureImportedAuthoredClips(root,fighter,mixer);
  ensureImportedAbilityClips(root,fighter,mixer);
  if(root.userData.authoredClipKey===key)return;
  const rig=resolveRig(root);
  if(!rig){
    root.userData.authoredBindDiag={key,mixer:!!mixer,rig:null,slotCount:0,bound:0};
    return;
  }
  ensureImportedStrikeClips(root,fighter,mixer);
  const slots=attackClipsFor(fighter)||{};
  // The identity's own keyframe motion leads. It compiles against the rig this body actually owns
  // (`rig.joints` comes from rig_map, so an imported Rigify chain resolves the same canonical
  // joints a generated body does), which is what makes two moves impossible to collapse onto one
  // baked clip. The body's shipped clip is now only a fallback for a slot the motion does not
  // cover - it used to win, so Naruto's eleven-move set played five baked clips.
  const bodySlots=bodyClipSlotsFor(fighter)||{};
  const motions=MOTION_SETS[MOTION_SET_BY_IDENTITY[key]||'default']||{};
  const actions={};
  const compiled=[];
  const fallback=[];
  const bakedSlots=[];
  for(const clipId of Object.values(slots)){
    if(!String(clipId||'').startsWith('authored_'))continue;
    const slot=String(clipId).slice('authored_'.length);
    if(actions[slot])continue;
    // A baked clip is the same motion as an asset. Keep it instead of recompiling over it; the
    // compile below remains the path when the GLB has not loaded or does not cover this slot.
    const bakedAction=root.userData.bakedAuthoredActions?.[slot];
    if(bakedAction){actions[slot]=bakedAction;bakedSlots.push(slot);continue;}
    // Authored ids are compiled from keyframe motion, exactly as animation_controller does it for
    // a controller-owned rig; clip_library has no CLIP_SPECS entry for them and returns null.
    const motion=motions[slot];
    const clip=motion?buildAttackClip(clipId,motion,rig,{label:`${slot} (authored)`}):null;
    if(clip){
      // The ultimate is a sequence, not a one-second gesture: stretch its keys across the record's
      // own startup+active+recovery so the seal, the clone formation, the palm drives and the
      // ending land on the damage beats. Stretched before the action is created, because the action
      // reads its clip duration for the whole run.
      if(slot==='ultimate'){
        const def=fighter?.moveset?.ultimate;
        const total=Math.max(.9,Number(def?.startup||0)+Number(def?.active||0)+Number(def?.recovery||0));
        if(Number.isFinite(total)&&Math.abs(total-clip.duration)>.05){
          const ratio=total/clip.duration;
          for(const track of clip.tracks)for(let i=0;i<track.times.length;i++)track.times[i]*=ratio;
          clip.duration=total;
        }
      }
      const action=mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      actions[slot]=action;
      compiled.push(slot);
      continue;
    }
    const bodyAction=bodySlots[slot]?root.userData.animationActions?.[bodySlots[slot]]:null;
    if(bodyAction?.getClip?.()){
      bodyAction.setLoop(THREE.LoopOnce,1);
      bodyAction.clampWhenFinished=true;
      actions[slot]=bodyAction;
      fallback.push(slot);
    }
  }
  // Grab and throw are read from their own userData keys by the state machine, not from an attack
  // slot, so a compiled motion has to be published there as well or it would be bound and unused.
  if(actions.grab)root.userData.grabAction=actions.grab;
  if(actions.throw)root.userData.throwAction=actions.throw;
  // One authored sequence per transformation, keyed by the form id the transform record carries.
  // Compiled on this same mixer: no second animation writer, and a form without a sequence simply
  // keeps the aura-only presentation instead of playing another form's clip.
  const formActions={};
  for(const [formId,formSlot] of Object.entries(authoredFormClipsFor(fighter)||{})){
    const bakedForm=root.userData.bakedAuthoredForms?.[formId];
    if(bakedForm){formActions[formId]=bakedForm;continue;}
    const motion=motions[formSlot];
    const clip=motion?buildAttackClip(`authored_form_${formSlot}`,motion,rig,{label:`${formSlot} (form)`}):null;
    if(!clip)continue;
    const action=mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce,1);
    action.clampWhenFinished=true;
    formActions[formId]=action;
  }
  // Miles's imported body ships 26 state clips but no web-kit casts. The canonical library
  // already authors Web Shot, Web Pull, Web Swing, the three-beat Maximum Web Takedown and the
  // Spider-Sense activation on this body's own rig; bind those as kit actions instead of letting
  // the generic beam/charge pair stand in for every web move. This is one mixer and one writer.
  const proceduralAbilitySlots={};
  if(key==='spider_man'){
    for(const [slot,clipId] of Object.entries({
      spider_web_shot:'spider_web_shot',
      spider_web_pull:'spider_web_pull',
      spider_web_swing:'spider_web_swing',
      ultimate:'spider_web_ultimate',
      spider_sense_overdrive:'spider_sense_overdrive',
      web_swing:'web_swing'
    })){
      const clip=buildClip(clipId,rig);
      if(!clip)continue;
      const action=mixer.clipAction(clip);
      // Web Swing is a held pendulum, not a one-shot cast; every other kit clip is a one-shot.
      if(slot==='web_swing')action.setLoop(THREE.LoopRepeat,Infinity);
      else{action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
      actions[slot]=action;
      proceduralAbilitySlots[slot]=clip.name;
    }
    root.userData.webSwingAction=actions.web_swing||null;
    // Web Zip is Spider-Man's signature, not the generic beam the imported attack table maps to.
    // The action is already bound under its own attack-slot name, so promote that same action.
    if(actions.spider_man_web_zip){
      root.userData.authoredSpecialAction=actions.spider_man_web_zip;
      root.userData.authoredSpecialClipId='spider_man_web_zip';
    }
    // Miles's 26-clip source pack has locomotion and combat but no semantic fall/land action on
    // the legacy owner. Compile those two states against this same rig so a jump does not read as
    // standing idle while airborne and a touchdown has a real pose.
    for(const [slot,clipId] of Object.entries({fall:'fall',land:'land'})){
      if(actions[slot])continue;
      const clip=buildClip(clipId,rig);
      if(!clip)continue;
      const action=mixer.clipAction(clip);
      if(slot==='fall')action.setLoop(THREE.LoopRepeat,Infinity);
      else{action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
      actions[slot]=action;
      if(slot==='fall')root.userData.fallAction=action;
      else root.userData.landAction=action;
      proceduralAbilitySlots[slot]=clip.name;
    }
    const formClip=buildClip('spider_sense_overdrive',rig);
    if(formClip){
      const formAction=mixer.clipAction(formClip);
      formAction.setLoop(THREE.LoopOnce,1);
      formAction.clampWhenFinished=true;
      formActions['spider-sense-overdrive']=formAction;
    }
  }
  // The imported strike table is published above as soon as its clips are on the mounted mixer.
  // `actions` here is a fresh object for compiled/procedural kit motions, so without this merge it
  // replaced the published Iron Spider table and the early `authoredClipKey` return meant the
  // donor slots were never written onto the live map. Merge them last; for Miles the donor move
  // must win over the older procedural web ultimate.
  const importedStrikeActions=root.userData.importedStrikeActions;
  if(importedStrikeActions){
    for(const [slot,action] of Object.entries(importedStrikeActions)){
      if(key==='spider_man'||!actions[slot])actions[slot]=action;
    }
  }
  root.userData.authoredFormActions=formActions;
  root.userData.authoredAbilityActions=actions;
  root.userData.authoredAbilityAction=null;
  root.userData.authoredAbilityTime=0;
  // The signature compiles from the same clip library; when mount time had no identity, take it
  // from the set that just bound instead of leaving the generic baked charge/release pair.
  const specialId=specialClipFor(fighter);
  if(!root.userData.authoredSpecialAction&&specialId&&specialId!=='special_attack'){
    const slot=specialId.startsWith('authored_')?specialId.slice('authored_'.length):null;
    if(slot&&actions[slot]){
      root.userData.authoredSpecialAction=actions[slot];
      root.userData.authoredSpecialClipId=specialId;
    }
  }
  root.userData.authoredClipKey=key;
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.authoredClips={key,slots:Object.keys(actions),forms:Object.keys(formActions),special:root.userData.authoredSpecialClipId||null};
  root.userData.authoredBindDiag={key,mixer:!!mixer,rig:{kind:rig.kind,bound:rig.boundCount},slotCount:Object.keys(slots).length,slotIds:slots,bound:Object.keys(actions).length,compiled,fallback,baked:bakedSlots,gap:Object.keys(slots).filter(k=>!actions[k]),forms:Object.keys(formActions),proceduralAbilitySlots};
}

/**
 * Bind a clip from a solo clip-only GLB onto the mounted body's one mixer.
 *
 * Exact-name tracks stay byte-identical. A clip authored on an equivalent but differently named
 * skeleton (Spider-Man's 19-bone canonical clips on his 66-joint Mixamo body) is baked onto the
 * mounted bones once, with a per-track report, instead of creating an action that silently drives
 * nothing. The report is available on userData and on the live asset registry for verification.
 */
function bindSoloClip(mixer,root,gltf,clip){
  const prepared=prepareSoloClip(clip,gltf?.scene,root,{name:clip.name});
  const reports=root.userData.soloClipReports||(root.userData.soloClipReports={});
  reports[clip.name]={
    mode:prepared.mode, source:prepared.source, mappedBones:prepared.mappedBones||0,
    unresolved:prepared.unresolved||[], error:prepared.error||null
  };
  root.userData.soloClipReport={
    clips:Object.keys(reports).length,
    retargeted:Object.values(reports).filter(r=>r.mode==='retargeted').length,
    unresolved:Object.values(reports).filter(r=>r.mode==='unresolved'||r.mode==='retarget-failed').length
  };
  return mixer.clipAction(prepared.clip);
}

const LIBRARY_SUPPLEMENT_IDS=new Set(['superman','hulk_bruce_banner','green_lantern_hal_jordan','the_flash_barry_allen','aquaman','doctor_strange','kaze','iron_spider','naruto_uzumaki','wonder_woman','infantry','iron_man_tony_stark']);
// Slots that the supplied author clip sets do not genuinely describe. The compiled library motion
// is state-specific (run/jump/land/victory/defeat), so it is preferred over a dash or a skill pose
// being relabelled as that state. All other supplied clips are preserved.
const LIBRARY_STATE_OVERRIDES=Object.freeze({
  // The source dash owns run/sprint, the success cutscene owns victory and the source death owns
  // defeat. The pack has no honest single jump, double jump, falling, landing, knockdown or get-up
  // clip, so those remain semantic library motion. The aerial states are Hulk/Iron Spider additions
  // below: they keep the double jump distinct from the first jump and give the body a readable fall.
  hulk_bruce_banner:new Set(['jump','double_jump','fall','land','knockdown','get_up']),
  // Iron Spider's supplied pack has no second-jump or falling cycle. Keep its authored jump and
  // use the semantic air states on the same rig rather than replaying jump for both.
  iron_spider:new Set(['double_jump','fall']),
  // Aquaman's supplied CombatIdle/LeapAir/LeapLand/GroundDeathB are real authored motion, but the
  // idle holds the left hand still. Standing idle stays on the semantic library (A0 measures real
  // idle deformation); walk/run have no source clip. CombatIdle is bound as fightingIdleAction;
  // DashLoop supplies the source sprint lane and is not forced back to the library.
  aquaman:new Set(['idle','walk','run']),
  // Both bodies bind in a horizontal T-pose. Their source idle is static or near-static, and the
  // source walk inherits the same shoulders, so the corrected library locomotion is the only
  // version that does not read as a mannequin. Strikes and reactions stay on the authored clips.
  naruto_uzumaki:new Set(['idle','walk','run']),
  wonder_woman:new Set(['idle','walk','run']),
  // The HD soldier's GLB only ships walk and run, and the authored Infantry_idle leaves one
  // shoulder in the bind T. The semantic idle is the only symmetric, settled stance on this rig.
  infantry:new Set(['idle','walk','run']),
  kaze:new Set(['victory','defeat'])
});
const LIBRARY_STATE_BINDINGS=Object.freeze({
  idle:{clip:'idle',target:'idleAction',loop:true},
  walk:{clip:'walk',target:'walkAction',loop:true},
  run:{clip:'run',target:'runAction',loop:true},
  sprint:{clip:'sprint',target:'sprintAction',loop:true},
  jump:{clip:'jump',target:'jumpAction',loop:false},
  double_jump:{clip:'double_jump',target:'doubleJumpAction',loop:false},
  fall:{clip:'fall',target:'fallAction',loop:true},
  land:{clip:'land',target:'landAction',loop:false},
  charge:{clip:'charge',target:'chargeAction',loop:false},
  block:{clip:'block',target:'blockAction',loop:true},
  dodge:{clip:'dodge',target:'dodgeAction',loop:false},
  hit_light:{clip:'hit_light',target:'hitLightAction',loop:false},
  hit_heavy:{clip:'hit_heavy',target:'hitHeavyAction',loop:false},
  knockdown:{clip:'knockdown',target:'knockdownAction',loop:false},
  get_up:{clip:'get_up',target:'getUpAction',loop:false},
  victory:{clip:'victory',target:'victoryAction',loop:false},
  defeat:{clip:'defeat',target:'defeatAction',loop:false}
});
// Iron Man's source pack supplies fly/hover but no takeoff, banked-turn, climb, dive, boost or
// flight-landing actions. These are library clips compiled onto his own mixer, not a second
// controller: the legacy selector reads the same action keys it already uses for Goku.
const IRON_MAN_FLIGHT_BINDINGS=Object.freeze({
  fly_takeoff:{clip:'iron_fly_start',target:'flyTakeoffAction',loop:false},
  fly_loop:{clip:'iron_fly_loop',target:'flyLoopAction',loop:true},
  fly_back:{clip:'iron_fly_loop',target:'flyBackAction',loop:true},
  fly_turn:{clip:'iron_fly_turn',target:'flyTurnAction',loop:true},
  fly_climb:{clip:'iron_fly_climb',target:'flyClimbAction',loop:true},
  fly_dive:{clip:'iron_fly_dive',target:'flyDiveAction',loop:true},
  fly_boost:{clip:'iron_fly_boost',target:'flyBoostAction',loop:true},
  fly_land:{clip:'iron_fly_land',target:'flyLandAction',loop:false}
});
/**
 * Fill only the semantic state slots a supplied body does not already own.
 *
 * The clips are built by the same clip_library that drives generated roster bodies and baked onto
 * the mounted body's own rig, so this is one animation system on one skeleton. It is deliberately
 * restricted to the imported rows still missing state coverage; authored clips and the
 * identity's combat/rig/equipment remain unchanged.
 */
function ensureLibraryStateClips(root,fighter,mixer){
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!LIBRARY_SUPPLEMENT_IDS.has(key)||!mixer)return;
  if(root.userData.libraryStateSupplementKey===key)return;
  const rig=resolveRig(root);
  if(!rig)return;
  const force=LIBRARY_STATE_OVERRIDES[key]||new Set();
  const actions=root.userData.animationActions||(root.userData.animationActions={});
  const bound=[];
  const bindings=key==='iron_man_tony_stark'
    ? {...LIBRARY_STATE_BINDINGS,...IRON_MAN_FLIGHT_BINDINGS}
    : LIBRARY_STATE_BINDINGS;
  for(const [slot,binding] of Object.entries(bindings)){
    // The source bodies that already own jump/fall keep them. Hulk and Iron Spider have no aerial
    // recovery clips, so only their bodies receive the two extra semantic states.
    const aerialOnly=slot==='double_jump'||slot==='fall';
    if(aerialOnly&&!['hulk_bruce_banner','iron_spider'].includes(key))continue;
    if(root.userData[binding.target]&&!force.has(slot))continue;
    const clip=buildClip(binding.clip,rig);
    if(!clip)continue;
    const action=mixer.clipAction(clip);
    if(binding.loop){action.setLoop(THREE.LoopRepeat,Infinity);action.clampWhenFinished=false;}
    else {action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}
    // Publish the target the state machine already reads. The two semantic aerial states are kept
    // out of the GLB clip inventory so a body's supplied clip count stays exactly what shipped.
    if(!aerialOnly)actions[slot]=action;
    root.userData[binding.target]=action;
    if(slot==='charge')root.userData.chargeClipSource='library-charge';
    bound.push(slot);
  }
  root.userData.libraryStateSupplementKey=key;
  root.userData.libraryStateSupplement={
    key,bound,forced:[...force],rig:{kind:rig.kind,bound:rig.boundCount}
  };
  // A body given a real walk/run/jump clip must hand the skeleton to the mixer; leaving the old
  // procedural controller running would overwrite the new clips on the same bones.
  if(bound.some(slot=>['walk','run'].includes(slot))&&root.userData.animationController){
    root.userData.animationController.dispose?.();
    root.userData.animationController=null;
    root.userData.animationRig=null;
    if(fighter)fighter.animationController=null;
  }
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.libraryStateSupplement=window.__browserSmashAssets.libraryStateSupplement||{};
  window.__browserSmashAssets.libraryStateSupplement[key]=root.userData.libraryStateSupplement;
}

const importedStrikeLoads=new WeakMap();
/**
 * Bind an imported body's own combat clips as one-shot actions on this body's mixer.
 *
 * The clips live in a separate clip-only GLB that was authored on this exact skeleton, so the
 * mounted mesh is never re-exported: geometry, materials, texture maps and the rig's rest pose all
 * stay byte-identical to the source file. Clips are addressed by name and land on the bones this
 * model already owns, and every action is keyed by the manifest slot it fills so the strike
 * selector can pick it exactly like an authored motion.
 */
function ensureImportedStrikeClips(root,fighter,mixer){
  const set=importedAttackClipsFor(fighter);
  if(!set||!mixer)return;
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!key)return;
  const bound=root.userData.importedStrikeSet;
  if(bound&&bound.key===key&&bound.url===set.url)return;
  // The mounted body already exposes every clip in its GLB through animationActions. Use those
  // actions synchronously when the whole strike table is present: re-fetching the same 6 MB body
  // left J on the old jab for the first frames of a match, even though the Iron Spider actions had
  // been on the mixer since mount. The fallback loader below still handles clip-only strike packs.
  const bank=root.userData.animationActions||{};
  const bankByName=new Map();
  for(const action of Object.values(bank)){
    const clip=action?.getClip?.();
    if(clip)bankByName.set(clip.name,action);
  }
  const slotsInSet=Object.entries(set.slots);
  if(slotsInSet.length&&slotsInSet.every(([,clipName])=>bankByName.has(clipName))){
    const actions=root.userData.authoredAbilityActions||(root.userData.authoredAbilityActions={});
    const slots=[];
    for(const [slot,clipName] of slotsInSet){
      const action=bankByName.get(clipName);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      actions[slot]=action;
      slots.push(slot);
    }
    root.userData.importedStrikeActions=actions;
    if(key==='spider_man'&&actions.air)root.userData.airAttackAction=actions.air;
    if(actions.grab)root.userData.grabAction=actions.grab;
    if(actions.throw)root.userData.throwAction=actions.throw;
    const special=actions.special;
    if(special){
      root.userData.importedSpecialAction=special;
      root.userData.authoredSpecialAction=special;
      root.userData.authoredSpecialClipId=special.getClip().name;
    }
    root.userData.importedStrikeSet={key,url:set.url};
    root.userData.importedStrikeReport={
      key,url:set.url,status:'ready',authoredBy:set.authoredBy,source:'mounted-body',
      clips:[...bankByName.keys()],bound:slots,missing:Object.keys(set.slots).filter(slot=>!slots.includes(slot)),
      special:special?special.getClip().name:null
    };
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.importedStrikes=window.__browserSmashAssets.importedStrikes||{};
    window.__browserSmashAssets.importedStrikes[key]=root.userData.importedStrikeReport;
    return;
  }
  if(importedStrikeLoads.get(root)===set.url)return;
  importedStrikeLoads.set(root,set.url);
  root.userData.importedStrikeReport={key,url:set.url,status:'loading',clips:[],bound:[],missing:Object.keys(set.slots)};
  getLoader().then(({GLTFLoader})=>new Promise((resolve,reject)=>{
    new GLTFLoader().load(set.url,resolve,undefined,reject);
  })).then(gltf=>{
    const byName=new Map((gltf.animations||[]).map(clip=>[clip.name,clip]));
    const actions=root.userData.authoredAbilityActions||(root.userData.authoredAbilityActions={});
    const slots=[];
    for(const [slot,clipName] of Object.entries(set.slots)){
      const clip=byName.get(clipName);
      if(!clip)continue;
      const action=bindSoloClip(mixer,root,gltf,clip);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      // Miles's strike table now selects the retargeted Iron Spider performances, including the
      // donor skill07 special/ultimate, so this async load must publish every slot instead of
      // protecting the older procedural web-cast pair.
      actions[slot]=action;
      slots.push(slot);
    }
    root.userData.importedStrikeActions=actions;
    // The ultimate runner reads its clip from authoredAbilityActions. A body whose kit lives in the
    // imported strike set (Hulk) has no separate ability set, so without this bridge the meter
    // drained while the body stayed on the last strike pose. An authored ability set that loads
    // later still wins because this only fills an empty slot.
    if(actions.ultimate){
      const abilityActions=root.userData.authoredAbilityActions||(root.userData.authoredAbilityActions={});
      // Miles's imported table now carries the Iron Spider ultimate on this same action slot; the
      // older web ultimate must not survive underneath it. Other bodies keep the first-writer win.
      if(key==='spider_man'||!abilityActions.ultimate)abilityActions.ultimate=actions.ultimate;
    }
    // The airborne branch reads airAttackAction by name. Without promoting the imported air slot,
    // Miles would keep his original air_attack even after every grounded strike switched over.
    if(key==='spider_man'&&actions.air)root.userData.airAttackAction=actions.air;
    // A bespoke signature clip is not a second, parallel animation system: put it on the same
    // authoredSpecialAction the state machine already prioritises. Goku's mount-time library
    // Kamehameha action is replaced here; Superman and Spider-Man had no authored signature at all.
    const special=actions.special;
    if(special){
      root.userData.importedSpecialAction=special;
      root.userData.authoredSpecialAction=special;
      root.userData.authoredSpecialClipId=special.getClip().name;
    }
    // Grab and throw are read from their own keys by the state machine, not from an attack slot.
    // The authored-motion path publishes these at bind time; an imported body binds them from the
    // strike GLB instead, which lands after that bind, so publish them here as well.
    if(actions.grab)root.userData.grabAction=actions.grab;
    if(actions.throw)root.userData.throwAction=actions.throw;
    root.userData.importedStrikeSet={key,url:set.url};
    root.userData.importedStrikeReport={
      key,url:set.url,status:slots.length?'ready':'failed',authoredBy:set.authoredBy,
      clips:[...byName.keys()],bound:slots,missing:Object.keys(set.slots).filter(slot=>!slots.includes(slot)),
      special:special?special.getClip().name:null
    };
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.importedStrikes=window.__browserSmashAssets.importedStrikes||{};
    window.__browserSmashAssets.importedStrikes[key]=root.userData.importedStrikeReport;
  }).catch(error=>{
    root.userData.importedStrikeReport={key,url:set.url,status:'error',error:String(error?.message||error)};
    importedStrikeLoads.delete(root);
  });
}

const importedReactionLoads=new WeakMap();
/**
 * Bind an imported body's authored reaction clips onto the actions its state machine already reads.
 *
 * The state machine in this file selects hitLightAction / hitHeavyAction / knockdownAction /
 * getUpAction / victoryAction / defeatAction / jumpAction / landAction / idleAction by name, so a
 * reaction clip only has to be assigned to the right key to be used by the real branches - no
 * parallel animation path. One-shot reactions clamp on their final pose; idle loops.
 */
function publishClipOwnership(root,set){
  root.userData.clipOwnership={
    body:set.ownsBody===true,
    hands:set.ownsHands===true,
    arms:set.ownsArms===true
  };
}

// One slot table for both reaction-loading paths (clips already on the body, and an external
// reaction-only GLB). The state machine reads these action names by convention.
const REACTION_SLOT_TARGETS=Object.freeze({
  idle:'idleAction', fighting_idle:'fightingIdleAction', jump:'jumpAction', double_jump:'doubleJumpAction',
  fall:'fallAction', land:'landAction', hit_light:'hitLightAction', hit_heavy:'hitHeavyAction',
  knockdown:'knockdownAction', get_up:'getUpAction', victory:'victoryAction', defeat:'defeatAction',
  walk:'walkAction', run:'runAction', sprint:'sprintAction', block:'blockAction', dodge:'dodgeAction',
  fly:'flyAction', hover:'hoverAction', fly_forward:'flyForwardAction', strafe:'strafeAction',
  fly_takeoff:'flyTakeoffAction', fly_back:'flyBackAction', fly_turn:'flyTurnAction', fly_land:'flyLandAction',
  fly_boost:'flyBoostAction',
  parry:'parryAction', charge:'chargeAction', beam:'beamAction'
});
const LOOPING_REACTION_SLOTS=new Set(['idle','fighting_idle','walk','run','sprint','block','fly','hover','fall','fly_forward',
  'fly_back','fly_turn','fly_boost']);
function bindReactionSlot(root,actions,slot,action,forced){
  if(!action||forced.has(slot))return false;
  if(LOOPING_REACTION_SLOTS.has(slot)){ action.setLoop(THREE.LoopRepeat,Infinity); action.clampWhenFinished=false; }
  else { action.setLoop(THREE.LoopOnce,1); action.clampWhenFinished=true; }
  actions[slot]=action;
  const target=REACTION_SLOT_TARGETS[slot];
  if(target)root.userData[target]=action;
  return true;
}

function ensureImportedReactionClips(root,fighter,mixer){
  const set=importedReactionClipsFor(fighter);
  if(!set||!mixer)return;
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!key)return;
  const bound=root.userData.importedReactionSet;
  if(bound&&bound.key===key&&bound.url===set.url)return;
  // Reaction clips appended to the mounted body are already live actions. Bind those immediately
  // so the first hit after a round starts uses the Iron Spider flinch, not the original clip until
  // a second GLB fetch finishes. The asynchronous path remains for external reaction-only files.
  const bank=root.userData.animationActions||{};
  const bankByName=new Map();
  for(const action of Object.values(bank)){
    const clip=action?.getClip?.();
    if(clip)bankByName.set(clip.name,action);
  }
  const slotsInSet=Object.entries(set.slots);
  if(slotsInSet.length&&slotsInSet.every(([,clipName])=>bankByName.has(clipName))){
    const actions=root.userData.animationActions||(root.userData.animationActions={});
    const forcedStateSlots=new Set(root.userData.libraryStateSupplement?.forced||[]);
    const slots=[];
    for(const [slot,clipName] of slotsInSet){
      if(bindReactionSlot(root,actions,slot,bankByName.get(clipName),forcedStateSlots))slots.push(slot);
    }
    root.userData.importedReactionSet={key,url:set.url};
    publishClipOwnership(root,set);
    root.userData.importedReactionReport={
      key,url:set.url,status:slots.length?'ready':'failed',authoredBy:set.authoredBy,source:'mounted-body',
      clips:[...bankByName.keys()],bound:slots,missing:Object.keys(set.slots).filter(slot=>!slots.includes(slot))
    };
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.importedReactions=window.__browserSmashAssets.importedReactions||{};
    window.__browserSmashAssets.importedReactions[key]=root.userData.importedReactionReport;
    return;
  }
  if(importedReactionLoads.get(root)===set.url)return;
  importedReactionLoads.set(root,set.url);
  root.userData.importedReactionReport={key,url:set.url,status:'loading',clips:[],bound:[],missing:Object.keys(set.slots)};
  getLoader().then(({GLTFLoader})=>new Promise((resolve,reject)=>{
    new GLTFLoader().load(set.url,resolve,undefined,reject);
  })).then(gltf=>{
    const byName=new Map((gltf.animations||[]).map(clip=>[clip.name,clip]));
    const actions=root.userData.animationActions||(root.userData.animationActions={});
    const forcedStateSlots=new Set(root.userData.libraryStateSupplement?.forced||[]);
    const slots=[];
    for(const [slot,clipName] of Object.entries(set.slots)){
      const clip=byName.get(clipName);
      // A semantic library clip was deliberately chosen for a forced slot; the late reaction load
      // must not undo it.
      if(!clip)continue;
      const action=bindSoloClip(mixer,root,gltf,clip);
      if(bindReactionSlot(root,actions,slot,action,forcedStateSlots))slots.push(slot);
    }
    root.userData.importedReactionSet={key,url:set.url};
    publishClipOwnership(root,set);
    root.userData.importedReactionReport={
      key,url:set.url,status:slots.length?'ready':'failed',authoredBy:set.authoredBy,
      clips:[...byName.keys()],bound:slots,missing:Object.keys(set.slots).filter(slot=>!slots.includes(slot))
    };
    // Take over the idle only when the body is not mid-action: replacing it during an attack would
    // cut that attack's clip on the frame the GLB lands.
    const idleAction=root.userData.idleAction;
    const busy=(fighter?.attackQueue||[]).length>0||(root.userData.authoredStrikeTime||0)>0||(fighter?.hitstun||0)>0;
    if(idleAction&&!busy&&!(fighter?.ko))idleAction.reset().play();
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.importedReactions=window.__browserSmashAssets.importedReactions||{};
    window.__browserSmashAssets.importedReactions[key]=root.userData.importedReactionReport;
  }).catch(error=>{
    root.userData.importedReactionReport={key,url:set.url,status:'error',error:String(error?.message||error)};
    // Publish the failure too. The global registry used to be written only on success, so a 404 or
    // a malformed GLB was indistinguishable from a load that had not finished yet.
    window.__browserSmashAssets=window.__browserSmashAssets||{};
    window.__browserSmashAssets.importedReactions=window.__browserSmashAssets.importedReactions||{};
    window.__browserSmashAssets.importedReactions[key]=root.userData.importedReactionReport;
    importedReactionLoads.delete(root);
  });
}

const importedAbilityLoads=new WeakMap();
/**
 * Bind authored kit-cast clips (a kunai throw, a jutsu release) onto the body's own mixer.
 *
 * The kit path selects a cast's animation by `fighter.abilityCast.motion`, so these land in
 * `authoredAbilityActions` under the motion key instead of a state action. That keeps one mixer
 * and one writer: the same object the attack slots use.
 */
function ensureImportedAbilityClips(root,fighter,mixer){
  const set=importedAbilityClipsFor(fighter);
  if(!set||!mixer)return;
  const key=String(fighter?.identityKey||'').toLowerCase();
  if(!key)return;
  const bound=root.userData.importedAbilitySet;
  if(bound&&bound.key===key&&bound.url===set.url)return;
  if(importedAbilityLoads.get(root)===set.url)return;
  importedAbilityLoads.set(root,set.url);
  root.userData.importedAbilityReport={key,url:set.url,status:'loading',clips:[],bound:[],missing:Object.keys(set.slots)};
  window.__browserSmashAssets=window.__browserSmashAssets||{};
  window.__browserSmashAssets.importedAbilities=window.__browserSmashAssets.importedAbilities||{};
  window.__browserSmashAssets.importedAbilities[key]=root.userData.importedAbilityReport;
  getLoader().then(({GLTFLoader})=>new Promise((resolve,reject)=>{
    new GLTFLoader().load(set.url,resolve,undefined,reject);
  })).then(gltf=>{
    const byName=new Map((gltf.animations||[]).map(clip=>[clip.name,clip]));
    // Read the map again after the async load: a rebind may have replaced the object since.
    const actions=root.userData.authoredAbilityActions||(root.userData.authoredAbilityActions={});
    const slots=[];
    for(const [slot,clipName] of Object.entries(set.slots)){
      const clip=byName.get(clipName);
      if(!clip)continue;
      const action=bindSoloClip(mixer,root,gltf,clip);
      action.setLoop(THREE.LoopOnce,1);
      action.clampWhenFinished=true;
      actions[slot]=action;
      slots.push(slot);
    }
    root.userData.importedAbilitySet={key,url:set.url};
    root.userData.importedAbilityReport={
      key,url:set.url,status:slots.length?'ready':'failed',authoredBy:set.authoredBy,
      clips:[...byName.keys()],bound:slots,missing:Object.keys(set.slots).filter(slot=>!slots.includes(slot))
    };
    window.__browserSmashAssets.importedAbilities[key]=root.userData.importedAbilityReport;
  }).catch(error=>{
    root.userData.importedAbilityReport={key,url:set.url,status:'error',error:String(error?.message||error)};
    importedAbilityLoads.delete(root);
  });
}

/**
 * Close the authored finger chains into a fist for the striking part of an attack.
 *
 * The imported body rig has four three-segment fingers and a two-bone thumb per hand (`DEF_Finger.*`),
 * but no clip animates them, so the hand stayed open through every punch. Rotating the actual finger
 * bones keeps the real hand geometry, skin weights and material: this is a pose, not a prop. The
 * curl ramps in over the first 18% of the strike, holds while it is extended, and releases in the
 * last 30%, so guard/neutral keep the open hand and contact is fully clenched.
 */
function applyFingerFist(root,fighter){
  // Authored full-body sets key every finger joint, including open palms and fists. The generic
  // overlay samples only the strike phase and rebuilds from a bind-pose base, which re-opened the
  // authored fists in idle/run. Skip it only for sets that declare hand ownership.
  if(root?.userData?.clipOwnership?.hands)return;
  let bones=root.userData.fistBones;
  if(!bones){
    bones=[];
    root.traverse?.(node=>{
      if(!node.isBone)return;
      const name=node.name||'';
      // Match the family rather than an exact prefix: the loader may keep dots, replace them with
      // underscores, or strip them, and an exact pattern silently collected zero bones.
      if(/finger/i.test(name)&&!/end/i.test(name))bones.push(node);
    });
    root.userData.fistBoneNames=bones.map(b=>b.name).slice(0,32);
    root.userData.fistBones=bones;
  }
  root.userData.fistDebug={bones:bones.length,names:root.userData.fistBoneNames||[]};
  if(!bones.length)return;
  const strike=root.userData.authoredStrikeAction;
  let amount=0;
  // During a frozen capture the action is paused, so isRunning() is false even though the pose is
  // the real strike frame. `poseHold` lets the capture evaluate the same curl the live action gets.
  if(strike&&(strike.isRunning?.()||root.userData.poseHold)){
    const duration=strike.getClip()?.duration||1;
    const phase=Math.min(1,Math.max(0,strike.time/duration));
    amount=phase<.18?phase/.18:phase<.7?1:Math.max(0,1-(phase-.7)/.3);
  }
  root.userData.fistDebug={bones:bones.length,amount:+amount.toFixed(2)};
  // Capture hook: the paused pose is evaluated by hand, so the normal animation call that would
  // apply this pose never runs. The capture calls this after setting the clip time.
  if(!root.userData.applyFistPose)root.userData.applyFistPose=()=>{root.userData.poseHold=true;applyFingerFist(root,fighter);};
  const bend=new THREE.Quaternion();
  for(const bone of bones){
    if(!bone.userData.fistBase)bone.userData.fistBase=bone.quaternion.clone();
    const left=/[._]L[._]/.test(bone.name);
    const thumb=/[._]00[12]_/.test(bone.name);
    // Blender finger bones run along local Y; the curl axis is local X. The thumb also folds
    // across the palm, so it takes a Z component and a smaller bend.
    const curl=(thumb?.55:1.12)*amount;
    // Negative X folds the fingers toward the palm on this rig; the positive direction
    // hyperextended them backward into an open, splayed hand.
    bend.setFromAxisAngle(new THREE.Vector3(1,0,0),-curl);
    bone.quaternion.copy(bone.userData.fistBase).multiply(bend);
    if(thumb){
      bend.setFromAxisAngle(new THREE.Vector3(0,0,1),(left?.7:-.7)*amount);
      bone.quaternion.multiply(bend);
    }
  }
}

export function animateHumanFighter(fighter,dt){
  /**
   * Move every animation action this body owns onto the mixer rooted at the mounted model.
   *
   * `animationActions` was rebuilt here while `importedStrikeActions` and `bakedAuthoredActions`
   * kept actions created against another root. Those bind `Hips.quaternion` against a root with no
   * `Hips`, so every binding stays null and Three throws on `_cacheIndex` the moment they play.
   * The walk is reference-driven, not key-driven: every action reachable from userData is collected,
   * including through arrays, maps and sets, so a collection added later is covered by construction.
   * Actions are never moved between mixers - a new action is created on the live mixer from the same
   * clip and the stale one is stopped and uncached. A second call returns the same actions.
   */
  function ensureHumanMixerOnMountedModel(fighter,force){
    const root=fighter?.model,u=root?.userData,old=u?.humanMixer;
    if(!old||!old.getRoot)return old||null;
    if(u.__mixerRepairDone&&!force)return old;
    const found=new Set();
    const seen=new WeakSet();
    // Three's AnimationAction carries no `isAnimationAction` flag (r152), so identity by duck type is
    // the only reliable test. Without it every action looked like a plain object and collections such
    // as importedStrikeActions were walked past instead of rewritten.
    const isAction=value=>!!value&&typeof value==='object'&&typeof value.getClip==='function'&&typeof value.reset==='function'&&typeof value.play==='function';
    const collect=value=>{
      if(!value||typeof value!=='object'||seen.has(value))return;
      seen.add(value);
      if(isAction(value)){found.add(value);return;}
      if(value.isObject3D||value.isMixer||value.isTexture||value.isMaterial||value.isBufferGeometry||value.isSkeleton||value.isBone)return;
      if(Array.isArray(value)){for(const v of value)collect(v);return;}
      if(value instanceof Map){for(const v of value.values())collect(v);return;}
      if(value instanceof Set){for(const v of value)collect(v);return;}
      for(const k of Object.keys(value)){if(k!=='humanMixer')collect(value[k]);}
    };
    for(const k of Object.keys(u))if(k!=='humanMixer')collect(u[k]);
    const clips=new Map();
    for(const a of old._actions||[])if(a?.getClip)clips.set(a.getClip().name,a.getClip());
    for(const a of found)if(a?.getClip)clips.set(a.getClip().name,a.getClip());
    if(!clips.size)return old;
    const previous=u.animationActions||{};
    const originals=new Map();
    for(const a of found){const n=a.getClip().name;if(!originals.has(n))originals.set(n,a);}
    const rootOk=old.getRoot()===root;
    const live=rootOk?old:new THREE.AnimationMixer(root);
    const byName=new Map();
    for(const [name,clip] of clips){
      const action=live.clipAction(clip);
      const original=originals.get(name);
      if(original&&original!==action){
        action.loop=original.loop;
        action.clampWhenFinished=original.clampWhenFinished;
        action.enabled=original.enabled;
        action.setEffectiveTimeScale(original.getEffectiveTimeScale?.()??1);
        action.setEffectiveWeight(original.getEffectiveWeight?.()??1);
      }
      byName.set(name,action);
    }
    // Retire stale actions only after their replacements exist, so a failure here cannot leave the
    // body with fewer working actions than it started with.
    for(const a of found){
      const mixer=a._mixer;
      if(!mixer||mixer===live)continue;
      try{a.stop();}catch{}
      try{mixer.uncacheAction(a.getClip());}catch{}
    }
    if(!rootOk){try{old.stopAllAction();old.uncacheRoot(old.getRoot());}catch{}}
    const seenSwap=new WeakSet();
    const swap=value=>{
      if(!value||typeof value!=='object')return value;
      if(isAction(value)){
        const clip=value.getClip?.();
        return (clip&&byName.get(clip.name))||value;
      }
      if(value.isObject3D||value.isMixer||value.isTexture||value.isMaterial||value.isBufferGeometry||value.isSkeleton||value.isBone)return value;
      if(seenSwap.has(value))return value;
      seenSwap.add(value);
      // Rewrite in place. Building a replacement object meant a throw partway through left a
      // half-filled collection installed on userData; mutating each entry cannot do that, and the
      // per-entry guard confines any odd third-party value to itself.
      if(Array.isArray(value)){for(let i=0;i<value.length;i+=1){try{value[i]=swap(value[i]);}catch{}}return value;}
      if(value instanceof Map){for(const [k,x] of [...value]){try{value.set(k,swap(x));}catch{}}return value;}
      if(value instanceof Set){const next=[...value].map(x=>{try{return swap(x);}catch{return x;}});value.clear();for(const x of next)value.add(x);return value;}
      for(const k of Object.keys(value)){try{value[k]=swap(value[k]);}catch{}}
      return value;
    };
    for(const k of Object.keys(u))if(k!=='humanMixer')u[k]=swap(u[k]);
    // Slot keys ('idle', 'light', ...) are not clip names. Rebuild them from the previous map so the
    // state machine keeps addressing actions by slot after the repair replaces the collection.
    const animations={};
    for(const [name,action] of byName){
      if(isStaticAnimationClip(action?.getClip?.()))continue;
      animations[name.toLowerCase()]=action;
    }
    for(const [slot,action] of Object.entries(previous)){
      const clip=action?.getClip?.();
      if(clip&&byName.has(clip.name))animations[slot]=byName.get(clip.name);
    }
    u.animationActions=animations;
    u.__mixerRepairDone=true;
    u.humanMixer=live;
    return live;
  }
  if(!window.__browserSmashRepairMixer)window.__browserSmashRepairMixer=f=>ensureHumanMixerOnMountedModel(f,true);

  const root=fighter.model;if(!root?.userData?.humanMixer)return;
  const humanMixer=ensureHumanMixerOnMountedModel(fighter)||root.userData.humanMixer;  // The release at bind time can lose a race: the reaction GLB lands, then the canonical controller
  // is attached, and the rig is never handed back even though the body owns walk/idle clips. Doing
  // the same check per frame closes that window without changing bodies that have no locomotion set.
  if(root.userData.legacyLocomotionNeedsRestart&&!root.userData.animationController){
    const locomotion=root.userData.idleAction;
    if(locomotion){locomotion.stop();locomotion.reset();locomotion.setEffectiveWeight(1);locomotion.play();}
    root.userData.legacyLocomotionRestartCount=(root.userData.legacyLocomotionRestartCount||0)+1;
    root.userData.legacyLocomotionNeedsRestart=false;
  }
  if(root.userData.animationController&&authoredStateOwnsBody(fighter)){
    root.userData.animationController.dispose?.();
    root.userData.animationController=null;root.userData.animationRig=null;
    root.userData.animationControllerReleased=true;
    if(fighter)fighter.animationController=null;
  }
  // A reaction set binds straight into animationActions; republish the locomotion keys the state
  // machine reads so a body is never left without an idle because the key was cleared on remount.
  {
    const acts=root.userData.animationActions||{};
    if(!root.userData.idleAction&&acts.idle)root.userData.idleAction=acts.idle;
    if(!root.userData.walkAction&&acts.walk)root.userData.walkAction=acts.walk;
    if(!root.userData.runAction&&acts.run)root.userData.runAction=acts.run;
  }
  fighter.position=root.position;
  faceFighterModel(root,fighter.facing,fighter.facingZ,root.userData.modelFacingOffset||0);
  // Equipment state is derived from animation state and applied to every holdable, whichever
  // system mounted it. It runs before the pose is written, so a stowed weapon is already out of
  // the way on the same frame the two-handed technique starts.
  applyEquipmentState(fighter,dt);
  bindAuthoredClips(root,fighter,humanMixer);
  // The exact 19-bone family uses its own native clips where present, with the shared Kaze bank
  // only as a fallback. This runs on the same mixer and leaves solo rigs untouched.
  bindSharedRigFamily(root,fighter,humanMixer);
  // A rig the clip controller drives is owned by that controller. The legacy mixer and the
  // per-joint overlay would otherwise rewrite the same bones on the same frame.
  if(root.userData.animationController){
    root.rotation.z=THREE.MathUtils.damp(root.rotation.z,0,12,dt);
    return;
  }
  humanMixer.update(dt);
  applyHulkDebrisPose(fighter);
  const speed=Math.hypot(fighter.velocity.x,fighter.velocity.z), airborne=!fighter.isGrounded;
  // One flight plan feeds the baked-clip selector below and the shared bank/pitch overlay at the
  // end of this function. Goku's authored Fly* clips keep ownership of his limbs.
  const flightPlan=flightLocomotionFor(fighter,{dt,speed});
  root.userData.flightLocomotion=flightPlan;
  root.userData.flightLocomotionStamp=fighter.t??0;
  if(root.userData.wasGrounded===false&&fighter.isGrounded)root.userData.landingPoseTime=.24;
  root.userData.wasGrounded=!!fighter.isGrounded;
  root.userData.landingPoseTime=Math.max(0,root.userData.landingPoseTime-dt);
  root.userData.authoredStrikeTime=Math.max(0,(root.userData.authoredStrikeTime||0)-dt);
  // A signature starts from the cast the input path actually recorded, not from a delta on the
  // cooldown timer. The old delta test missed a cast whose cooldown had already been raised (a
  // transformed special, a second cast inside the same second) and could never restart an action
  // that was already the current pose - so the Kamehameha stayed bound, weight 1 and time 0.
  const castId=Number(fighter.specialCast?.id||0);
  if(castId!==(root.userData.lastSpecialCastId||0)){
    root.userData.lastSpecialCastId=castId;
    root.userData.specialPoseTime=.56;
    const specialAction=root.userData.authoredSpecialAction;
    if(specialAction){
      const clip=specialAction.getClip();
      // Explicitly played, not left to the target swap below: when the signature was also the
      // last chosen pose the swap saw "same action" and never restarted it.
      specialAction.reset().setEffectiveTimeScale(1).fadeIn(.05).play();
      // An authored signature covers its own wind-up and release, so it runs for its own length
      // instead of being cut off when the generic 0.56 s special window closes.
      root.userData.authoredSpecialTime=clip.duration;
      root.userData.lastAuthoredSpecial={
        clip:clip.name,cast:castId,at:fighter.specialCast?.at??null,
        releaseIn:fighter.specialCast?.releaseIn??0
      };
    }
  }
  root.userData.lastSpecialCooldown=fighter.specialCooldown;
  // A kit cast owns the body for exactly its own clip length. `abilityCast` is stamped only where
  // `castAbility` actually returned cast: true, so a refused or interrupted cast cannot reach here.
  const kitCast=fighter.abilityCast;
  if(kitCast&&kitCast.motion&&kitCast.at!==root.userData.lastAbilityCastAt){
    const abilityAction=root.userData.authoredAbilityActions?.[kitCast.motion];
    // A kit cast is dropped while a higher-priority signature owns the pose. The cast id is still
    // consumed (`lastAbilityCastAt`) so it cannot fire late once the signature ends.
    if(abilityAction&&!(root.userData.authoredSpecialTime>0)){
      abilityAction.reset();abilityAction.fadeIn(.08);abilityAction.play();
      root.userData.authoredAbilityAction=abilityAction;
      root.userData.authoredAbilityTime=abilityAction.getClip().duration;
    }
    root.userData.lastAbilityCastAt=kitCast.at;
  }

  // The ultimate runner owns damage, VFX and movement, but it never owned the body: the fighter
  // stood in idle for the whole barrage, so the authored `ultimate` clip was bound and unused.
  // `casting` is set by startUltimate and cleared by endRecord, so it is exactly the move's
  // lifetime - no second timer that can drift out of sync with the record.
  const ultimateCasting=fighter.casting==='ultimate';
  if(ultimateCasting&&!root.userData.wasUltimateCasting){
    const ultimateAction=(root.userData.authoredAbilityActions||{}).ultimate||null;
    root.userData.authoredUltimateAction=ultimateAction;
    if(ultimateAction){
      root.userData.lastUltimateAnimation={
        clip:ultimateAction.getClip().name,
        id:String(fighter.ultimateDef?.id||fighter.ultimateDef?.label||''),
        at:Math.round((fighter.t||0)*1000)
      };
    }
  }
  if(!ultimateCasting)root.userData.authoredUltimateAction=null;
  root.userData.wasUltimateCasting=ultimateCasting;
  // A transformation owns the body for its activation window, and every form plays its OWN
  // sequence. Selecting by form id (not by tier index) means a form whose sequence is missing
  // keeps the old aura-only presentation instead of borrowing another form's animation.
  const activeFormId=String(fighter.transform?.form?.id||'');
  if(activeFormId&&activeFormId!==root.userData.lastFormId){
    root.userData.lastFormId=activeFormId;
    const formAction=root.userData.authoredFormActions?.[activeFormId]||null;
    const formWindow=Math.max(.8,(fighter.formLock||0)+.35);
    // Imported bodies that ship a full 25-clip state set but no form-specific sequence still need
    // a real activation pose. Use their own charge clip for the form window instead of letting the
    // body sit in idle while the aura turns on. This is source motion on the same mixer; nothing is
    // fabricated and the authored form sequence still wins whenever one exists.
    root.userData.formFallbackAction?.stop?.();
    root.userData.formFallbackAction=null;
    if(formAction){
      // Retimed onto the activation window the rules module already enforces (`formLock`), so the
      // burst lands while the fighter is still committed and the final pose is reached exactly as
      // control returns - the transformation can never lock movement past its own window.
      formAction.reset();
      formAction.setEffectiveTimeScale(Math.max(.5,formAction.getClip().duration/formWindow));
      formAction.fadeIn(.06).play();
      root.userData.authoredFormAction=formAction;
      root.userData.authoredFormTime=formWindow;
      root.userData.lastFormAnimation={
        form:activeFormId,label:String(fighter.transform?.form?.label||''),
        clip:formAction.getClip().name,at:Math.round((fighter.t||0)*1000)
      };
    }else{
      const chargeClip=root.userData.chargeAction?.getClip?.();
      const mixer=root.userData.humanMixer;
      if(chargeClip&&mixer){
        const fallbackAction=mixer.clipAction(chargeClip);
        fallbackAction.setLoop(THREE.LoopOnce,1);
        fallbackAction.clampWhenFinished=true;
        fallbackAction.setEffectiveTimeScale(Math.max(.5,chargeClip.duration/formWindow));
        fallbackAction.reset().fadeIn(.06).play();
        root.userData.formFallbackAction=fallbackAction;
        root.userData.authoredFormAction=fallbackAction;
        root.userData.authoredFormTime=formWindow;
        root.userData.lastFormAnimation={
          form:activeFormId,label:String(fighter.transform?.form?.label||''),
          clip:chargeClip.name,source:root.userData.chargeClipSource||'body-charge',
          at:Math.round((fighter.t||0)*1000)
        };
      }
    }
  }
  if(!activeFormId){
    root.userData.lastFormId=null;
    root.userData.formFallbackAction?.stop?.();
    root.userData.formFallbackAction=null;
  }
  root.userData.authoredFormTime=Math.max(0,(root.userData.authoredFormTime||0)-dt);
  root.userData.specialPoseTime=Math.max(0,root.userData.specialPoseTime-dt);
  root.userData.authoredSpecialTime=Math.max(0,(root.userData.authoredSpecialTime||0)-dt);
  root.userData.authoredAbilityTime=Math.max(0,(root.userData.authoredAbilityTime||0)-dt);
  // A queued follow-up has to retrigger the authored strike too. This used to fire only when the
  // queue went 0 -> 1, so a buffered light string animated its first hit and then kept that pose
  // for the rest of the chain (Hulk selected atk01 for all five presses). Trigger whenever another
  // attack joins the queue, and animate the newest one: its comboStep is the step just resolved.
  const queuedAttacks=fighter.attackQueue?.length||0;
  const attacking=queuedAttacks>0;
  const gear=root.userData.armorGear;
  // The queue latch alone can be stale when a test or a round reset clears `attackQueue` between
  // render frames: `wasAttacking` still says true and a fresh heavy move is then treated as the
  // continuation of the old one, so it animates with the generic fallback. Include the resolved
  // move signature so a genuinely new move always gets its own strike selection.
  const newestAttack=fighter.attackQueue?.[queuedAttacks-1]||null;
  const strikeSignature=newestAttack?`${newestAttack.id||newestAttack.kind||''}:${newestAttack.comboStep??newestAttack.step??''}`:'';
  const newStrike=Boolean(strikeSignature)&&strikeSignature!==root.userData.lastStrikeSignature;
  const attackStarted=attacking&&(queuedAttacks>(root.userData.lastStrikeQueueLength||0)||!root.userData.wasAttacking||newStrike);
  if(attackStarted)root.userData.lastStrikeSignature=strikeSignature;
  root.userData.lastStrikeQueueLength=queuedAttacks;
  if(attackStarted){
    root.userData.attackLock=.34;root.userData.proceduralAttackTime=.34;
    // Authored strike, selected ONCE at the start and held on its own timer. Selecting it from the
    // live attack queue was frame-fragile: traced at this renderer's dt, the queue was non-empty for
    // exactly one frame, so a branch gated on `attacking` never held a pose long enough to be seen.
    {
      const strike=fighter.attackQueue?.[queuedAttacks-1]||null;
      const step=Number(strike?.comboStep??strike?.step??fighter.comboStep??1)||1;
      const actions=root.userData.authoredAbilityActions||{};
      // The resolved move id leads (authoredStrikeSlotFor). Choosing from `kind` and the chain step
      // made three coarse kinds cover eleven moves, so the launcher, slam, counter, air and
      // air-finisher ids the manifest maps were bound and then never selected.
      // An imported body ships its own keyframed strikes instead of authored motion; both paths
      // resolve to the same slot keys, so selection below is unchanged.
      // A body that ships its own air clip is the most specific answer for an airborne strike.
      // The authored table's air fallback (a ground light slot) would otherwise play a jab in
      // mid-air even though the rig has a real air_attack bound and ready.
      const ownAir=airborne&&root.userData.airAttackAction;
      if(ownAir){
        root.userData.lastAuthoredStrike={slot:'air',clip:ownAir.getClip().name,id:String(strike?.id||strike?.kind||''),at:Math.round((fighter.t||0)*1000)};
      }
      // A supplied source clip is more specific than the generated roster motion. The imported
      // table only covers the slots the pack really contains (Hulk's whole strike set, Flash's
      // punch), so prefer it when the action is bound and fall back to the authored motion for
      // the rest of the chain. Asking the authored table first bound these clips and never played
      // them, which is how a fighter ended up with generic strikes beside unused source motion.
      const importedSlot=importedStrikeSlotFor(fighter,strike,{step,airborne});
      const authoredSlot=authoredStrikeSlotFor(fighter,strike,{step,airborne});
      const slot=ownAir?null:(importedSlot&&actions[importedSlot]?importedSlot:authoredSlot);
      // With the own-air branch selected, do not fall through to the generic airborne light4
      // action either: that fallback is what turned the air attack into a heavy punch.
      const strikeAction=ownAir?null:((slot&&actions[slot])||(airborne?actions.light4:null)||null);
      if(strikeAction){
        const seconds=Math.max(.22,Number(strike?.duration||strike?.totalTime||.34));
        strikeAction.setEffectiveTimeScale(Math.max(.6,Math.min(3.2,strikeAction.getClip().duration/seconds)));
        root.userData.authoredStrikeAction=strikeAction;
        root.userData.authoredStrikeTime=seconds;
        // Selection is recorded, not just played: at a large frame delta a short strike can begin and
        // finish inside one frame, so a probe polling `isRunning()` would miss a strike that ran.
        root.userData.lastAuthoredStrike={slot,clip:strikeAction.getClip().name,id:String(strike?.id||strike?.kind||''),at:Math.round((fighter.t||0)*1000)};
      }
    }if(root.userData.lastMoveAction)root.userData.lastMoveAction.fadeOut(.08);root.userData.lastMoveAction=null;}
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
  const comboLean=fighter.comboStep>=5?.1:(fighter.comboStep===4?.06:.0);
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
  // A hard hit while airborne is a knockdown; the fighter then recovers through the get-up clip.
  const knocked=(fighter.hitstun||0)>1&&!fighter.isGrounded;
  if(knocked)root.userData.wasKnockedDown=true;
  if(root.userData.wasKnockedDown&&(fighter.hitstun||0)<=0&&fighter.isGrounded){root.userData.getUpTime=.9;root.userData.wasKnockedDown=false;}
  root.userData.getUpTime=Math.max(0,(root.userData.getUpTime||0)-dt);
  // Stun is sampled once, when it lands: a jab is ~0.16-0.5 s and must read as a light flinch,
  // while a heavy/ultimate blow is >=0.55 s and owns the hit_heavy clip. Reading the decaying
  // timer every frame switched the clip under the body halfway through the same reaction.
  const stunNow=fighter.hitstun||0;
  if(stunNow>(root.userData.stunPrev||0))root.userData.heavyStun=stunNow>=.55;
  root.userData.stunPrev=stunNow>0?stunNow:0;
  // A completed KO is a match-end pose, not an ongoing flinch. The shipping match loop freezes the
  // simulation at match over, so hitstun can remain at its final value; leaving the hit-reaction
  // branch first kept the loser frozen in the killing blow's flinch forever and never showed the
  // body's defeat/death clip. Defeat outranks hitstun once the body is on the floor. While the KO'd
  // body is still airborne the reaction/knockdown lanes below still own the fall.
  if(fighter.ko&&root.userData.defeatAction&&(fighter.isGrounded||fighter.forceDefeatPose))target=root.userData.defeatAction;
  else if(fighter.hitstun>0)target=(knocked&&root.userData.knockdownAction)?root.userData.knockdownAction:((root.userData.heavyStun&&root.userData.hitHeavyAction)||root.userData.hitLightAction||root.userData.hitAction||root.userData.idleAction);
  else if(root.userData.getUpTime>0&&root.userData.getUpAction)target=root.userData.getUpAction;
  else if((fighter.victoryPose||0)>0&&root.userData.victoryAction&&fighter.isGrounded&&!(fighter.hitstun>0))target=root.userData.victoryAction;
  // A signature move winds up before it fires: the charge pose holds through the start of the
  // special window, then the release pose takes over.
  // The authored signature move outranks the generic baked pair, and runs on the same mixer with
  // the same 0.13 s crossfade as every other state change - no second mixer, no second writer.
  // Priority: the signature/ultimate outranks a kit ability. A Rasengan cast that lands while the
  // signature is still running must not steal the body back mid-move, so the ability sits below it.
  // The ultimate spends the whole meter and must outrank a signature that shares the cast
  // window; otherwise the generic beam would cover the authored Maximum Web Takedown.
  else if(root.userData.authoredUltimateAction&&fighter.casting==='ultimate')target=root.userData.authoredUltimateAction;
  else if(root.userData.authoredSpecialAction&&root.userData.authoredSpecialTime>0)target=root.userData.authoredSpecialAction;
  // The form sequence sits directly under the ultimate: a transformation is a bigger beat than a
  // single kit cast, and it must not be stolen by a Rasengan fired on the same frame.
  else if(root.userData.authoredFormAction&&root.userData.authoredFormTime>0)target=root.userData.authoredFormAction;
  else if(root.userData.authoredAbilityAction&&root.userData.authoredAbilityTime>0)target=root.userData.authoredAbilityAction;
  else if(root.userData.specialPoseTime>0)target=((root.userData.specialPoseTime>.34?root.userData.beamAction:root.userData.chargeAction)||root.userData.beamAction||root.userData.chargeAction||root.userData.punchAction||root.userData.lastMoveAction);
  else if(guarding)target=(speed>2.2&&root.userData.strafeAction)?root.userData.strafeAction:(root.userData.blockAction||root.userData.idleAction);
  // A held web line owns the body through the pendulum; without this it fell through to the
  // airborne jump/fall pose while webSwinging was already true.
  else if(fighter.webSwinging&&root.userData.webSwingAction)target=root.userData.webSwingAction;
  else if(fighter.dodgeTimer>0)target=root.userData.dodgeAction||root.userData.jumpAction||root.userData.lastMoveAction;
  // A parry is a 0.22 s read, not a held guard: it only steals the pose while its window is open.
  else if((fighter.parryTimer||0)>0&&root.userData.parryAction)target=root.userData.parryAction;
  // Grab and throw share one clip: the grab window owns it while a target is held, the release
  // window keeps it until the throw animation is done.
  else if((fighter.grabTarget||fighter.grabbedBy||(fighter.grabHold||0)>0||(fighter.heldThrow&&fighter.heldThrow.t>0))&&root.userData.throwAction)target=root.userData.throwAction;
  // A grab that has not acquired a target yet is a reach, not a punch: the queued grab move owns
  // grabAction for its startup frames, and the hold branch above takes the pose back the moment
  // the target is acquired. Gated on the live queue entry so the grab clip cannot stick once the
  // move has resolved.
  else if(attacking&&activeAttack?.kind==='grab'&&root.userData.grabAction)target=root.userData.grabAction;
  else if(root.userData.authoredStrikeAction&&root.userData.authoredStrikeTime>0)target=root.userData.authoredStrikeAction;
  else if(attacking)target=(airborne&&root.userData.airAttackAction)?root.userData.airAttackAction:((activeAttack?.kind==='counter-strike'||activeAttack?.kind==='air-finisher')&&root.userData.launcherAction?root.userData.launcherAction:null)||((activeAttack?.kind==='heavy'||activeAttack?.kind==='air-finisher'||activeAttack?.comboStep>=4)?root.userData.heavyAction:null)||root.userData.punchAction||root.userData.lastMoveAction;
  // A downed fighter holds the loss pose instead of standing back up into an idle.
  else if(fighter.flightMode&&root.userData.flyAction){
    // Phases come from the shared plan, not from a second speed test here. A body without a
    // dedicated takeoff/turn/back clip falls back to the old hover/forward pair.
    const phase=flightPlan?.phase;
    const preferred=phase&&flightPlan?.action?root.userData[flightPlan.action]:null;
    if(preferred&&phase!=='takeoff')target=preferred;
    else if(phase==='takeoff'&&root.userData.flyTakeoffAction)target=root.userData.flyTakeoffAction;
    else if(phase==='hover'&&root.userData.hoverAction)target=root.userData.hoverAction;
    else target=root.userData.flyForwardAction||root.userData.flyAction;
  }
  else if(flightPlan?.phase==='landing'&&root.userData.flyLandAction)target=root.userData.flyLandAction;
  else if(airborne){
    // Imported bodies that author a distinct fall/double-jump cycle use it; bodies without those
    // states keep the single jump clip instead of being forced onto an unrelated action.
    target=(fighter.velocity?.y<0&&root.userData.fallAction)
      ?root.userData.fallAction
      :((fighter.jumps||0)>1&&root.userData.doubleJumpAction)
        ?root.userData.doubleJumpAction
        :(root.userData.jumpAction||root.userData.lastMoveAction);
  }
  else if(root.userData.landingPoseTime>0)target=root.userData.landAction||root.userData.idleAction;
  else target=speed>11?(root.userData.sprintAction||root.userData.runAction||root.userData.walkAction):speed>7?(root.userData.runAction||root.userData.walkAction):speed>.35?(root.userData.walkAction||root.userData.runAction):root.userData.idleAction;
  // Guard and basic attacks split across the body on the legacy mixer too. The base clip owns one
  // half, a masked copy of the guard/strike owns the other, and both are ordinary mixer actions.
  // Link's authored strikes are complete body motions, and imported sets can declare the same
  // ownership. Masking them leaves a lower lane on idle, which is how a punch with keyed hip drive
  // still ended up with both feet planted. Only sets that actually key the whole body opt in.
  const maskLayer=(fighter.identityKey==='link'||root?.userData?.clipOwnership?.body===true)?null:legacyLayerPlan(root,target,{
    speed,guarding,attacking,airborne,hitstun:fighter.hitstun||0
  });
  if(maskLayer){
    target=maskLayer.base;
    playLegacyMaskOverlay(root,maskLayer,.1);
    root.userData.bodyMaskLayers={
      base:maskLayer.baseName,baseRegion:maskLayer.baseRegion,
      overlay:maskLayer.overlayName,overlayRegion:maskLayer.overlayRegion
    };
  }else{
    clearLegacyMaskOverlay(root,.1);
    root.userData.bodyMaskLayers=null;
  }
  // Every played action must belong to the mixer that is actually advancing this frame. A reaction
  // or signature action can be created on the pre-mount mixer when its GLB lands first, and playing
  // it then lends its bindings to a mixer whose root no longer matches - Three throws on the
  // undefined binding node (`_cacheIndex`). Re-resolve by clip name instead of playing a stale one.
  if(target&&target._mixer&&target._mixer!==humanMixer){
    const clip=target.getClip?.();
    const live=clip?(humanMixer.existingAction(clip)||humanMixer.clipAction(clip)):null;
    if(live)target=live;
  }
  if(target&&target!==root.userData.lastMoveAction){
    const old=root.userData.lastMoveAction;
    const transition=resolveTransition(old,target,{requestedFade:.13});
    const fade=sharedRigTransitionFade(fighter,transition.fade);
    target.reset();
    const syncedPhase=transition.syncPhase?syncActionPhase(target,old):null;
    const flightCadence=fighter.flightMode&&flightPlan?.timeScale?flightPlan.timeScale:1;
    target.setEffectiveTimeScale(sharedRigTimeScaleForAction(fighter,target,speed)*flightCadence).fadeIn(fade).play();
    if(old&&old!==target)old.fadeOut(fade);
    root.userData.lastMoveAction=target;
    // Record the decision, not just the result. A live probe can now tell a deliberately sharp
    // reaction blend from a missing crossfade without sampling ambiguous mixer weights.
    const record={
      from:transition.from,to:transition.to,fromFamily:transition.fromFamily,toFamily:transition.toFamily,
      fade:Number(fade.toFixed(3)),syncPhase:transition.syncPhase,
      phase:syncedPhase===null?null:Number(syncedPhase.toFixed(3)),
      reason:transition.reason,at:Math.round((Number(fighter?.t)||0)*1000)
    };
    root.userData.lastAnimationTransition=record;
    root.userData.animationTransitionCount=(root.userData.animationTransitionCount||0)+1;
    const history=root.userData.animationTransitions||(root.userData.animationTransitions=[]);
    history.push(record);
    if(history.length>16)history.splice(0,history.length-16);
  }
  // The swap above only fires when the chosen action changes. If that action was stopped again -
  // a clamped one-shot, a mixer pause, or the reaction GLB landing mid-action - the cached
  // lastMoveAction kept the body frozen on its final pose until some unrelated state change.
  // Locomotion must always be live, so restart only the looping idle here and never a one-shot.
  // Cadence is refreshed on the same action every frame so a fighter who accelerates mid-stride
  // does not keep the speed they entered the clip with. A rejected rig gets the 1x pilot scale but
  // still needs the speed-matched base cadence; the pilot-off capture is the only raw case.
  if(target&&target.getClip&&/walk|run|sprint/i.test(String(target.getClip().name||''))
    &&locomotionPilotEnabled()){
    const pilotScale=strideScaleFor(root,fighter);
    const base=sharedRigTimeScaleForAction(fighter,target,speed);
    target.setEffectiveTimeScale(base*pilotScale);
  }
  // A continuing flight loop still needs its cadence refreshed: entering boost from an already
  // selected FlyForward action used to leave the old 1.0 playback rate in place, so the authored
  // clip changed phase but not speed. Attack and reaction actions are excluded by the fly check.
  if(target&&fighter.flightMode&&flightPlan?.timeScale&&target===root.userData.lastMoveAction
    &&/fly/i.test(String(target.getClip?.()?.name||''))){
    target.setEffectiveTimeScale(sharedRigTimeScaleForAction(fighter,target,speed)*flightPlan.timeScale);
  }
  const rest=root.userData.idleAction;
  if(target===rest&&rest&&!rest.isRunning())rest.reset().setEffectiveTimeScale(1).fadeIn(.1).play();
  // Which clip the state machine actually chose this frame, for runtime probes. Crossfade weights
  // are ambiguous for ~0.13 s and hide the answer; this field never is.
  const authoredCurrent=(fighter.casting==='ultimate'&&root.userData.authoredUltimateAction)
    ||(root.userData.authoredSpecialTime>0&&root.userData.authoredSpecialAction)
    ||(fighter.webSwinging&&root.userData.webSwingAction)
    ||(root.userData.authoredFormTime>0&&root.userData.authoredFormAction)
    ||(root.userData.authoredAbilityTime>0&&root.userData.authoredAbilityAction)
    ||(root.userData.authoredStrikeTime>0&&root.userData.authoredStrikeAction);
  root.userData.currentClip=root.userData.maskOverlayAction?.getClip?.()?.name
    ||(authoredCurrent&&authoredCurrent.getClip?authoredCurrent.getClip().name:null)
    ||(root.userData.lastMoveAction&&root.userData.lastMoveAction.getClip
      ?root.userData.lastMoveAction.getClip().name:null);
  // A shield bearer braces the offhand across the body instead of crossing both forearms. A body
  // that ships baked clips has no shield-block clip of its own, and the 22.3 weapon GLB is frozen,
  // so this rides on top of the block clip as an additive bone offset: the mixer has already
  // written the clip this frame, and a rotation offset can never displace the bind pose. Nobody
  // without a real shield in the offhand reaches this branch.
  if(guard&&root.userData.offhandKind==='shield'){
    const arm=root.userData.leftArm,fore=root.userData.leftFore,torso=root.userData.torso;
    // Bring the shield shoulder forward and turn the shield face toward the attacker.
    if(arm){arm.rotation.x-=.30;arm.rotation.y-=.34;arm.rotation.z+=.18;}
    if(fore)fore.rotation.z+=.24;
    if(torso)torso.rotation.y-=.20;
  }
  // A small anticipation/impact lean remains available even when the source GLB has no combat clip.
  // Authored on the asset root under the holder, so the fighter itself never tilts off world up.
  const lean=root.userData.attackLock>0?Math.sin((1-root.userData.attackLock/.34)*Math.PI)*.12:0;
  const leanRoot=root.userData.importedModel||root;
  if(!root.userData.importedModel&&root.userData.leanBaseZ===undefined)root.userData.leanBaseZ=root.rotation.z;
  leanRoot.rotation.z=THREE.MathUtils.damp(leanRoot.rotation.z,(root.userData.leanBaseZ||0)+lean+(fighter.hitstun>0?-.13:0),12,dt);
  // The lean is a roll about the fighter's own origin, which is where the feet stand, so it swings
  // the body's lowest geometry through the floor. On the imported Knight that measured 0.023 m in
  // attack poses and 0.030 m in hitstun, while every clip on its own measured 0.000 - so the dip is
  // the rigid tilt, not the animation. Lift the asset by exactly what the tilt loses, measured from
  // the tilted bounds: the pose is untouched, the feet stay planted, and airborne frames keep their
  // real height because the correction is applied to the asset root only while it is rolled.
  if(root.userData.importedModel){
    const baseY=root.userData.leanBaseY??leanRoot.position.y;
    if(root.userData.leanBaseY===undefined)root.userData.leanBaseY=baseY;
    const roll=Math.abs(leanRoot.rotation.z-(root.userData.leanBaseZ||0));
    if(roll>0.002){
      leanRoot.position.y=baseY;
      leanRoot.updateMatrixWorld(true);
      const tilted=leanScratch.setFromObject(leanRoot);
      const sink=Math.max(0,root.position.y-tilted.min.y);
      leanRoot.position.y=baseY+sink;
    }else if(leanRoot.position.y!==baseY){
      leanRoot.position.y=baseY;
    }
  }
  // Deformation-aware floor clamp for imported bodies. The tilt correction above only accounts for
  // the rigid roll; the hit-reaction pose itself still deforms the mesh through the floor (26 mm
  // measured). Measure the animated geometry, excluding equipped weapons, and lift by exactly the
  // penetration while the fighter is grounded. This never rotates or re-poses anything, so the
  // reaction keep its shape, and airborne frames are untouched.
  if(root.userData.importedModel&&(fighter.hitstun>0||fighter.guardBreak>0)&&fighter.isGrounded){
    const clampRoot=root.userData.importedModel||root;
    clampRoot.updateMatrixWorld(true);
    const lowest=clampScratch.makeEmpty();
    clampRoot.traverse(node=>{
      if(!node.isMesh)return;
      for(let parent=node;parent;parent=parent.parent)if(String(parent.name||'').startsWith('Equipped'))return;
      node.updateMatrixWorld(true);
      lowest.union(new THREE.Box3().setFromObject(node));
    });
    if(!lowest.isEmpty()&&lowest.min.y<-0.004){
      clampRoot.position.y+=Math.min(0.12,-lowest.min.y);
    }
  }
  applyLinkBowPose(root,fighter,dt);
  applySharedRigGrounding(root,fighter,root.userData.currentClip);
  applySoloRigGrounding(root,fighter,root.userData.currentClip);
  applyFingerFist(root,fighter);
  // The legacy mixer has finished writing the body. Face and weapon are additive channels that the
  // masked body lanes never covered, so they compose on top of the final pose.
  updateAnimationOverlays(root,fighter,dt,{
    owner:'legacy',active:root.userData.currentClip,layers:root.userData.bodyMaskLayers,
    rig:root.userData.animationRig||null
  });
  // Native appendage stow rides after every legacy pose writer. A controller-driven body returns
  // above and gets the same overlay from syncFighterAnimation instead.
  applyNativeSpiderStow(fighter,dt);
  // Source idles are not all authored from a relaxed stance. A body whose clip keeps the bind
  // A/T pose breathing (Infantry is the clearest case) would otherwise fight with one or both
  // elbows near shoulder height. Settle only during resting/locomotion clips; authored sets that
  // own their arms skip it inside the helper. Attack, guard, hit and throw clips never enter here.
  applyRestingArmSettle(root,fighter);
  // A controller-driven body is still on the pre-controller pose here; syncFighterAnimation runs
  // the foot layer after the mixer has written the final pose. Legacy and preview bodies have no
  // controller and get their correction here.
  if(!fighter.animationController){
    applyLocomotionPresentation(root,fighter,dt);
    // Bank/pitch is painted after the legacy mixer and foot layer have finished. It is additive,
    // so Goku's authored flight poses remain the base motion.
    applyFlightLocomotionPose(fighter,{dt,root});
    advanceFlightLocomotion(fighter,dt);
  }
}
/**
 * Link's bow stance, layered after the body clip and state machine have written the rig. The
 * left hand is carried forward to the bow grip while the right arm draws to the cheek; both
 * offsets blend in and out with the hold so the return to sword-and-shield is continuous.
 */
function aimBoneAt(bone,child,target,weight){
  if(!bone||!child||weight<=0)return;
  bone.updateWorldMatrix(true,false);child.updateWorldMatrix(true,false);
  const origin=bone.getWorldPosition(new THREE.Vector3());
  const from=child.getWorldPosition(new THREE.Vector3()).sub(origin);
  const to=target.clone().sub(origin);
  if(from.lengthSq()<1e-8||to.lengthSq()<1e-8)return;
  from.normalize();to.normalize();
  const delta=new THREE.Quaternion().setFromUnitVectors(from,to);
  const world=bone.getWorldQuaternion(new THREE.Quaternion());
  const parentWorld=bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const desiredLocal=parentWorld.invert().multiply(delta.multiply(world));
  bone.quaternion.slerp(desiredLocal,weight);
  bone.updateWorldMatrix(true,true);
}

function applyRestingArmSettle(root,fighter){
  // Authored full-body sets own their arms; the elbow test in the shared helper would otherwise
  // flatten an intentional guard. Everything else gets the same settle the select preview uses.
  if(root?.userData?.clipOwnership?.arms)return;
  if(!fighter||fighter.casting||(fighter.attackQueue||[]).length||(fighter.hitstun||0)>0||(fighter.guardBreak||0)>0||(fighter.dodgeTimer||0)>0)return;
  const clip=String(root.userData?.currentClip||'').toLowerCase();
  if(!/idle|stand|walk|run|sprint|strafe|locomotion/.test(clip))return;
  settleRestingArms(root);
}

function applyLinkBowPose(root,fighter,dt){
  if(!root?.userData)return;
  const u=root.userData;
  const target=u.linkAim?.holding?1:0;
  u.linkPoseWeight=THREE.MathUtils.damp(u.linkPoseWeight||0,target,14,dt);
  const w=u.linkPoseWeight||0;
  if(w<.002)return;
  const L=u.leftArm,R=u.rightArm,LF=u.leftFore,RF=u.rightFore,handL=u.leftHand,handR=u.rightHand;
  if(!L||!R||!LF||!RF||!handL||!handR)return;
  // Archer stance turns the chest a little, then the arms are aimed in world space rather than by
  // guessing Euler signs on a 202-joint imported rig. The upper arm points at an elbow target and
  // the forearm at the hand target, which is stable whatever rest orientation the source used.
  if(u.torso){u.torso.rotation.y+=.30*w;u.torso.rotation.x-=.03*w;}
  if(u.head){u.head.rotation.y-=.22*w;u.head.rotation.x-=.03*w;}
  root.updateMatrixWorld(true);
  const q=root.getWorldQuaternion(new THREE.Quaternion());
  const forward=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
  const up=new THREE.Vector3(0,1,0);
  const leftShoulder=L.getWorldPosition(new THREE.Vector3());
  const rightShoulder=R.getWorldPosition(new THREE.Vector3());
  const side=leftShoulder.clone().sub(rightShoulder);
  if(side.lengthSq()<1e-8)side.set(1,0,0);else side.normalize();
  const bowElbow=leftShoulder.clone().addScaledVector(forward,.24).addScaledVector(side,.12).addScaledVector(up,-.18);
  const bowHand=leftShoulder.clone().addScaledVector(forward,.52).addScaledVector(side,.16).addScaledVector(up,-.10);
  const drawElbow=rightShoulder.clone().addScaledVector(forward,.14).addScaledVector(side,-.10).addScaledVector(up,-.11);
  const drawHand=leftShoulder.clone().addScaledVector(forward,.28).addScaledVector(side,-.02).addScaledVector(up,.04);
  aimBoneAt(L,LF,bowElbow,w);
  aimBoneAt(LF,handL,bowHand,w);
  aimBoneAt(R,RF,drawElbow,w);
  aimBoneAt(RF,handR,drawHand,w);
}

const clampScratch=new THREE.Box3();


/** Hulk's debris reach/hold/throw overlay. Called after the clip owner has written the rig. */
export function applyHulkDebrisPose(fighter){
  const root=fighter?.model,fighterPose=fighter?.debrisPose;
  if(!root||!fighterPose)return;
  const b=root.userData.debrisBones||{}, dur=fighterPose.phase==='pickup'?.45:.34, p=Math.min(1,(fighterPose.t||0)/dur);
  if(fighterPose.phase==='pickup'){
    // Reach in over the first 80% of the pickup, then hold that reach while the rock is in the
    // palm. A full sine finished at zero, so Hulk snapped back to idle during the hold.
    const reach=Math.min(1,p/.8), w=Math.sin(Math.PI*reach*.5);
    if(b.upper)b.upper.rotation.x+=.95*w;if(b.fore)b.fore.rotation.x-=.75*w;if(b.spine)b.spine.rotation.x+=.18*w;
  }else{
    // Start from the same held pose, swing through, and return to the clip by p=1.
    const swing=Math.sin(Math.PI*p), hold=1-p;
    if(b.upper)b.upper.rotation.x+=.95*hold-1.35*swing;if(b.fore)b.fore.rotation.x-=.75*hold+.95*swing;if(b.spine)b.spine.rotation.x+=.18*hold-.15*swing;
    if(p>=1)delete fighter.debrisPose;
  }
}
