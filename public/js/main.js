import { tuneArchitecturalStone } from './arenas/architectural_materials.js';
// Actual root-site entrypoint loads this scene. Cinematic arena, powers and visible impacts.
import * as THREE from 'three';
import { installOnlineCharacters } from './online_characters.js';
import { IMPORTED_SPECIAL_MOVES, IMPORTED_COMBAT_PROFILES } from './combat/imported_profiles.js';
import { createSmashRenderPipeline, createWetStoneMaterial } from './smash_render_pipeline.js?v=browser-smash-phase3-v45-20261027';
import SmashCamera from './SmashCamera.js?v=browser-smash-phase3-v45-20261027';
import InputManager from './InputManager.js?v=browser-smash-phase3-v45-20261027';
import Fighter3D from './fighter3D.js?v=browser-smash-phase3-v45-20261027';
import { offhandOf, guardDamageScale } from './combat/combat_rules.js?v=browser-smash-phase3-v45-20261027';
import { createCombatDebug } from './combat/combat_debug.js?v=browser-smash-phase3-v45-20261027';
import { createCombatPowers } from './combat/combat_powers.js?v=browser-smash-phase3-v45-20261027';
import { createCombatItems } from './combat_items.js?v=browser-smash-phase3-v45-20261027';
import { makeProceduralCharacter, upgradeCharacterWithBlenderModel, equipCharacterWeapons } from './models.js?v=browser-smash-phase3-v45-20261027';
import { releaseModelTextures, textureOwnershipReport } from './render/texture_ownership.js';
import { validateFighterRig, isEquippedWeapon } from './rig_validation.js?v=browser-smash-phase3-v45-20261027';
import { resolveRig } from './anim/rig_map.js?v=browser-smash-phase3-v45-20261027';
import { createFinalValley } from './arenas/final_valley.js?v=browser-smash-phase3-v45-20261027';
import { setCinematicArena } from './arenas/cinematic_arenas.js?v=browser-smash-phase3-v45-20261027';
import { upgradeFighterModel, animateHumanFighter, applyHulkDebrisPose } from './human_fighter.js?v=browser-smash-phase3-v45-20261027';
import { attachAnimation } from './anim/animation_controller.js?v=browser-smash-phase3-v45-20261027';
import { attachSpiderLegs, updateSpiderLegs, spiderLegTips } from './anim/spider_legs.js?v=browser-smash-phase3-v45-20261027';
import { signatureFor } from './combat/character_identity.js';
import { describeModes } from './ui/game_modes.js';
import { createDestruction } from './world/destruction.js';
import { applyGraphicsPreset, describePresets, detectPreset, readStoredPreset } from './render/graphics_presets.js';
import { createPerformanceGovernor } from './render/performance_governor.js';
import { personalityFor } from './combat/ai_brain.js';
import { createTournament } from './combat/tournament.js';
import { initTournamentPanel } from './ui/tournament_panel.js';
import { installCombatAudio } from './audio/combat_audio.js?v=browser-smash-phase3-v45-20261027';
import { bootstrapAnimationPacks } from './anim/animation_loader.js?v=browser-smash-phase3-v45-20261027';
import { addCinematicEnvironment } from './cinematic_environment.js?v=browser-smash-phase3-v45-20261027';
import { skyEnvironment } from './sky_environment.js?v=browser-smash-phase3-v45-20261027';
import createCombatVFX from './combat_vfx.js?v=browser-smash-phase3-v45-20261027';
import { createMatch, resetMatch, evaluateRound, awardRound, nextRound, matchSummary } from './combat/combat_rules.js?v=browser-smash-phase3-v45-20261027';
import { sweptSphere, segmentSolid } from './combat/projectile_hit.js?v=browser-smash-phase3-v45-20261027';
import { blocksFromGroup as arenaCameraBlocks } from './world/camera_blocks.js?v=browser-smash-phase3-v45-20261027';
import { ARENA_LAYOUTS, layoutFor, spawnPoints, groundHeightAt, resolveCollision, clampToBounds, isOutOfBounds, solidAt } from './world/arena_layouts.js?v=browser-smash-phase3-v45-20261027';
import { initCharacterSelect } from './ui/character_select.js?v=browser-smash-phase3-v45-20261027';
import { initPauseMenu } from './ui/pause_menu.js?v=browser-smash-phase3-v45-20261027';
import { initTrainingPanel } from './ui/training_panel.js?v=browser-smash-phase3-v45-20261027';
import { skillFor, normalizeSkillLevel, DEFAULT_SKILL_LEVEL } from './combat/cpu_skill.js?v=browser-smash-phase3-v45-20261027';
import { applyEquipmentState } from './equipment_state.js';
import { worldLocation, worldGroups, WORLD_LOCATIONS, STAGE_LIGHTING } from './worlds/world_catalog.js?v=browser-smash-phase3-v45-20261027';
import { buildWorldGroup, disposeWorldGroup } from './worlds/world_builder.js?v=browser-smash-phase3-v45-20261027';
import { syncEquippedWeapons } from './models.js';
import { resolveProjectileOrigin, distanceFromBodyAxis } from './combat/projectile_origin.js';
import { applyTitleCamera, titleCameraState, clearTitleCamera } from './title_camera.js?v=browser-smash-phase3-v45-20261027';
const $=s=>document.querySelector(s);
window.__browserSmashAssets=window.__browserSmashAssets||{};
window.__browserSmashAssets.app={status:'initializing',frames:0};
const canvas=$('#gl');const scene=new THREE.Scene();scene.background=new THREE.Color(0x111b30);scene.fog=new THREE.FogExp2(0x253448,.012);
// Development-only combat volume overlay (F3). Pooled wireframe spheres, off by default.
const combatDebug=createCombatDebug(scene);
const {renderer,camera,composer,bloom,enableSSR}=createSmashRenderPipeline(canvas,scene);
window.__browserSmashScene=scene;window.__browserSmashThree=THREE;
// Arena switching hook: the verification needs to change arena inside a running match and check that
// nothing from the previous arena is left mounted. Same development surface as the scene handle above.
window.__browserSmashApplyMapState={key:null,seq:0,ok:null,error:null};window.__browserSmashApplyMapHistory=[];window.__browserSmashFloorState=()=>({key:window.__browserSmashApplyMapState?.key||activeLayoutKey,material:floor.material?.name||null,uuid:floor.material?.uuid||null,color:floor.material?.color?.getHexString?.()||null,tone:renderer.toneMappingExposure});window.__browserSmashApplyMap=(key)=>{const entry={key,seq:(window.__browserSmashApplyMapState?.seq||0)+1,ok:false,error:null,at:Date.now()};window.__browserSmashApplyMapState=entry;window.__browserSmashApplyMapError=null;try{const result=applyMap(key);entry.ok=true;return result;}catch(error){const message=String(error?.message||error);entry.error=message;entry.context='arena '+key+': '+message;window.__browserSmashApplyMapError=message;console.warn('[arena:'+key+'] switch failed',error);}finally{window.__browserSmashApplyMapHistory.push({...entry});if(window.__browserSmashApplyMapHistory.length>100)window.__browserSmashApplyMapHistory.shift();}};
const combatVFX=createCombatVFX(THREE,scene);
// Read-only handles for the visual gallery: the live effect meshes and the VFX layer's active
// list, so a capture can measure how much of a fighter an impact covers.
window.combatVFX=combatVFX;
window.__browserSmashEffects=()=>effects;
// Optional procedural combat audio. It stays silent until the first user gesture (autoplay
// policy) and never throws into the frame loop; Ctrl+M mutes, and the setting persists.
// One authoritative handle: every module imports this file without a cache-busting query, so the
// probe reads the same ownership counters the game writes.
window.__browserSmashTextureOwnership=textureOwnershipReport;
const combatAudio=installCombatAudio();
// Reused every frame so setting the audio listener does not allocate.
const audioForward=new THREE.Vector3();
// The registry is the one place that decides which modes the menu may offer, so a mode cannot be
// advertised by the markup without an entry point behind it. Exposed for tooling and tests.
window.__browserSmashModes=describeModes();
// Breakable arena props. Their colliders are pushed into the live layout's blocks array, which is
// exactly what solidAt/resolveCollision/solidBetween already read, so a crate blocks movement until
// it is destroyed and then stops blocking it with no changes to the collision code.
let destructibles=null;
function seedDestructibles(layout){
  if(destructibles){destructibles.clear?.();destructibles.stop?.();destructibles=null;}
  if(!layout?.blocks)return null;
  destructibles=createDestruction(THREE,scene,{colliders:layout.blocks,onDrop:(kind,prop)=>window.spawnItemDrop?.(kind,prop.position.x,prop.position.z),onBreak:()=>window.showCombatCallout?.('DESTRUCTIBLE SHATTERED','#ffd8a0')});
  const b=layout.bounds||{x0:-8,x1:8,z0:-8,z1:8};
  const cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2;
  const spanX=Math.max(1.5,(b.x1-b.x0)*0.24),spanZ=Math.max(1.5,(b.z1-b.z0)*0.24);
  destructibles.addProp({x:cx-spanX,z:cz-spanZ,hp:26,drops:'health',color:0x9c7a4e});
  destructibles.addProp({x:cx+spanX,z:cz-spanZ,hp:26,drops:'power',color:0x8a6f45});
  destructibles.addProp({x:cx-spanX,z:cz+spanZ,hp:34,drops:'shield',color:0x96795a});
  destructibles.addProp({x:cx+spanX,z:cz+spanZ,hp:34,drops:'blade',color:0x8d7251});
  window.__smashDestruction=destructibles;
  return destructibles;
}
// Sky-matched image-based lighting per arena instead of a photo-studio box, so armour
// and weapons reflect the same sky the fight is staged under.
scene.environment=skyEnvironment(renderer,'valley');
window.__browserSmashApplySky?.(scene,'valley');
const cinematicEnvironment=addCinematicEnvironment(THREE,scene);
const smashCamera=new SmashCamera(camera,{height:15,trailing:23,minHeight:12,maxHeight:48});window.smashCamera=smashCamera;
const hemisphere=new THREE.HemisphereLight(0xb5c7c2,0x4d5047,1.65);scene.add(hemisphere);window.__browserSmashHemisphere=hemisphere;
const sun=new THREE.DirectionalLight(0xffaa44,2.8);sun.position.set(-18,7,-20);sun.castShadow=true;sun.shadow.radius=3.5;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.near=.1;sun.shadow.camera.far=280;sun.shadow.camera.updateProjectionMatrix();scene.add(sun);
// ---- Graphics presets ----
// Quality is a player choice, not a constant: the renderer, the sun's shadow map and every loaded
// material are rescaled from one table (public/js/render/graphics_presets.js). The first run picks
// a preset from the device, then remembers the player's choice.
window.__browserSmashRenderer=renderer;window.__browserSmashSun=sun;
function applyQuality(name){
  const applied=applyGraphicsPreset(name,{renderer,sun,scene,shadowTypes:{soft:THREE.PCFSoftShadowMap,basic:THREE.PCFShadowMap}});
  if(applied){
    window.__graphicsPresetName=applied.name;
    window.__graphicsPixelRatioCap=applied.preset.pixelRatio;
    window.__graphicsParticleScale=applied.preset.particleScale;
    // Keep the settings control honest when the preset is changed from code (the probe, or a
    // saved preference): the menu must never claim a quality the renderer is not using.
    const control=document.querySelector('#graphicsQuality');
    if(control&&control.value!==applied.name)control.value=applied.name;
  }
  return applied;
}
window.setGraphicsPreset=applyQuality;
const initialQuality=readStoredPreset()||detectPreset({hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,devicePixelRatio:window.devicePixelRatio});
applyQuality(initialQuality);
// Automatic quality: the governor measures real frame pacing and steps one level down when the
// machine cannot hold the target, but it will never overrule a preset the player picked by hand.
const performanceGovernor=createPerformanceGovernor({
  getCurrentPreset:()=>window.__graphicsPresetName||initialQuality,
  onSuggestion:suggestion=>{
    if(suggestion.manual){
      window.showCombatCallout?.('PERFORMANCE · '+suggestion.suggestedPreset.toUpperCase()+' MAY RUN SMOOTHER','#ffd8a0');
      return;
    }
    window.setGraphicsPreset?.(suggestion.suggestedPreset);
    performanceGovernor?.noteApplied?.(suggestion.suggestedPreset);
    window.showCombatCallout?.('GRAPHICS AUTO · '+suggestion.suggestedPreset.toUpperCase(),'#bfe9ff');
  }
});
window.__performanceGovernor=performanceGovernor;
(function installGraphicsSettings(){
  const host=document.querySelector('#cameraSettings');
  if(!host||document.querySelector('#graphicsQuality'))return;
  const label=document.createElement('label');
  label.htmlFor='graphicsQuality';label.textContent='GRAPHICS QUALITY';
  label.style.cssText='display:block;margin-top:10px';
  const select=document.createElement('select');
  select.id='graphicsQuality';
  select.style.cssText='width:190px;display:block;margin-bottom:10px';
  for(const preset of describePresets()){
    const option=document.createElement('option');
    option.value=preset.id;option.textContent=preset.label+' · '+preset.hint;
    select.appendChild(option);
  }
  select.value=window.__graphicsPresetName||initialQuality;
  select.addEventListener('change',()=>{
    // A hand-picked preset outranks the governor for the rest of the session.
    window.__graphicsManualChoice=true;
    performanceGovernor?.setManual?.(true);
    const applied=applyQuality(select.value);
    window.showCombatCallout?.('GRAPHICS · '+(applied?.preset.label||select.value).toUpperCase(),'#bfe9ff');
  });
  host.append(label,select);
})();const rim=new THREE.DirectionalLight(0x218cff,2.5);rim.position.set(10,7,-12);scene.add(rim);
const mat=(color,metalness=.1,roughness=.8,emissive=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:1});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(700,700),createWetStoneMaterial(0x26313b));floor.rotation.x=-Math.PI/2;floor.position.y=-.04;floor.receiveShadow=true;scene.add(floor);
const platform=new THREE.Mesh(new THREE.BoxGeometry(700,.65,700),mat(0x343a42,.18,.78));platform.position.y=-.36;platform.receiveShadow=true;platform.visible=false;scene.add(platform);
// Contact shadow: a soft dark blob that stays on the floor under a fighter and shrinks with
// height. The directional shadow map spans a 220 m camera at 2048 px, so a fighter's own shadow
// is too diffuse to say where the feet are; this quad sits under them at every distance and is
// one transparent plane, so it costs nothing measurable on a Chromebook.
const contactShadowTexture=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');const grad=g.createRadialGradient(64,64,3,64,64,62);grad.addColorStop(0,'rgba(0,0,0,.62)');grad.addColorStop(.5,'rgba(0,0,0,.34)');grad.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=grad;g.fillRect(0,0,128,128);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();
function updateContactShadow(f){
  if(!f?.position||!f.model||f.model.visible===false){if(f?.contactShadow)f.contactShadow.visible=false;return;}
  let blob=f.contactShadow;
  if(!blob){blob=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:contactShadowTexture,transparent:true,depthWrite:false,opacity:.5,toneMapped:false}));blob.rotation.x=-Math.PI/2;blob.renderOrder=2;scene.add(blob);f.contactShadow=blob;}
  const height=Math.max(0,f.position.y-0.02);
  const lift=THREE.MathUtils.clamp(1-height/6.5,0,1);
  const scale=(f.model.userData?.visualScale||1)*(1.65+0.30*lift);
  blob.position.set(f.position.x,0.014,f.position.z);
  blob.scale.set(scale*(0.62+0.38*lift),scale*(0.62+0.38*lift),1);
  blob.material.opacity=0.52*lift*lift;
  blob.visible=lift>0.03;
}

// The old close-up rows of giant low-poly rocks and box towers were removed: they crowded the camera and obscured the valley.
const grassCanvas=document.createElement('canvas');grassCanvas.width=512;grassCanvas.height=512;const grassCtx=grassCanvas.getContext('2d');
grassCtx.fillStyle='#536d3b';grassCtx.fillRect(0,0,512,512);
for(let i=0;i<24000;i++){const x=Math.random()*512,y=Math.random()*512;const hue=75+Math.random()*38,light=22+Math.random()*35;grassCtx.strokeStyle='hsla('+hue+', '+(24+Math.random()*45)+'%, '+light+'%, '+(.12+Math.random()*.45)+')';grassCtx.lineWidth=.5+Math.random()*1.5;grassCtx.beginPath();grassCtx.moveTo(x,y);grassCtx.lineTo(x+(Math.random()-.5)*4,y-1-Math.random()*6);grassCtx.stroke();}
for(let i=0;i<380;i++){const x=Math.random()*512,y=Math.random()*512;grassCtx.fillStyle=i%3?'rgba(190,174,119,.12)':'rgba(22,37,22,.2)';grassCtx.beginPath();grassCtx.ellipse(x,y,2+Math.random()*8,1+Math.random()*4,Math.random(),0,Math.PI*2);grassCtx.fill();}
const grassTexture=new THREE.CanvasTexture(grassCanvas);grassTexture.colorSpace=THREE.SRGBColorSpace;grassTexture.wrapS=grassTexture.wrapT=THREE.RepeatWrapping;grassTexture.repeat.set(90,90);grassTexture.anisotropy=8;
const grassMaterial=new THREE.MeshStandardMaterial({map:grassTexture,color:0xffffff,roughness:1,metalness:0});
function makeArenaSurface(base,grid,accent,roughness=.82,metalness=.18){
 const c=document.createElement('canvas');c.width=256;c.height=256;const g=c.getContext('2d');
 g.fillStyle=base;g.fillRect(0,0,256,256);g.strokeStyle=grid;g.lineWidth=2;
 for(let p=0;p<=256;p+=32){g.beginPath();g.moveTo(p,0);g.lineTo(p,256);g.stroke();g.beginPath();g.moveTo(0,p);g.lineTo(256,p);g.stroke();}
 g.strokeStyle=accent;g.lineWidth=1;g.globalAlpha=.45;
 for(let p=16;p<256;p+=64){g.beginPath();g.moveTo(p,0);g.lineTo(p,256);g.stroke();}
 for(let i=0;i<850;i++){g.fillStyle='rgba(255,255,255,'+(Math.random()*.055)+')';g.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*3,1);}
 const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(42,42);texture.anisotropy=8;
 return new THREE.MeshStandardMaterial({map:texture,roughness,metalness});
}
function makeFinalValleyGround(){
 const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d');  g.fillStyle='#5f6653';g.fillRect(0,0,512,512);
 for(let i=0;i<18000;i++){const x=Math.random()*512,y=Math.random()*512;const shade=45+Math.random()*35;g.fillStyle='rgba('+shade+','+(shade+5)+','+(shade+1)+','+(.04+Math.random()*.15)+')';g.fillRect(x,y,1+Math.random()*4,.5+Math.random()*2);}
 for(let i=0;i<340;i++){const x=Math.random()*512,y=Math.random()*512;g.strokeStyle=i%3?'rgba(37,51,48,.15)':'rgba(196,202,185,.12)';g.lineWidth=.5+Math.random()*1.2;g.beginPath();g.moveTo(x,y);g.lineTo(x+(Math.random()-.5)*16,y+(Math.random()-.5)*4);g.stroke();}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(58,58);t.anisotropy=8;
 return new THREE.MeshStandardMaterial({map:t,roughness:1,metalness:0,color:0xffffff});
}
const arenaFloorMaterials={
 valley:grassMaterial,
 deathstar:makeArenaSurface('#454b56','#6d7580','#8bdcff',.72,.58),
 finalvalley:makeFinalValleyGround(),
 tournament:makeArenaSurface('#8c8067','#6b6150','#b9a888',.92,.04),
 starktower:makeArenaSurface('#30394b','#4e5c75','#35eaff',.62,.4),
 asgard:makeArenaSurface('#c1b99f','#918a78','#d9bd6b',.82,.08),
 hogwarts:makeArenaSurface('#3c3e43','#5c5952','#9c8450',.96,.02)
};
floor.material=grassMaterial;
const ssrPass=enableSSR(floor);
// Distant citadel silhouette and waterfall ribbons frame the contained combat platform.
const horizon=new THREE.Group();scene.add(horizon);
const citadelMat=mat(0x39465a,.55,.35,0x122b48);
for(let i=0;i<9;i++){const w=i===4?3.2:1.35,h=(i===4?11:5+Math.random()*5);const tower=new THREE.Mesh(new THREE.BoxGeometry(w,h,1.8),citadelMat);tower.position.set(-7+i*1.75,h*.5-1,-48);tower.castShadow=true;horizon.add(tower);const crown=new THREE.Mesh(new THREE.ConeGeometry(w*.72,2,4),new THREE.MeshStandardMaterial({color:0x65758a,metalness:.5,roughness:.28,emissive:0x173c61,emissiveIntensity:.6}));crown.position.set(tower.position.x,h-0.2,-48);crown.rotation.y=Math.PI/4;horizon.add(crown);}
for(const x of [-27,25]){const cliff=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),mat(0x303b4b,.12,.95));cliff.scale.set(8,13,5);cliff.position.set(x,4,-24);horizon.add(cliff);const water=new THREE.Mesh(new THREE.PlaneGeometry(2.3,13),new THREE.MeshBasicMaterial({color:0x53d8ff,transparent:true,opacity:.38,side:THREE.DoubleSide}));water.position.set(x*.82,1,-23);horizon.add(water);for(let j=0;j<5;j++){const stream=new THREE.Mesh(new THREE.BoxGeometry(.05,8,.05),new THREE.MeshBasicMaterial({color:0xa8f4ff,transparent:true,opacity:.45}));stream.position.set(x*.82+(Math.random()-.5)*1.5,1, -22.9+j*.08);horizon.add(stream);}}
// Traversable alien-world landmarks: an ancient gate, signal pylons and a glowing trail.
const explorationWorld=new THREE.Group();scene.add(explorationWorld);
const alienStone=mat(0x273b49,.62,.34,0x092f43);
const alienGlow=new THREE.MeshStandardMaterial({color:0x54eaff,emissive:0x12bfe8,emissiveIntensity:2.4,metalness:.3,roughness:.22});
const trailMat=new THREE.MeshStandardMaterial({color:0x334e5d,metalness:.25,roughness:.42});
for(let i=-8;i<=8;i++){const slab=new THREE.Mesh(new THREE.BoxGeometry(2.2,.08,1.25),trailMat);slab.position.set(i*2.4,.025,10+Math.sin(i*.22)*1.8);slab.rotation.y=Math.sin(i*.2)*.08;explorationWorld.add(slab);}
for(const [x,z,h] of [[-22,-16,8],[22,-18,10],[-36,8,12],[36,12,9],[-12,-32,7],[15,-38,11],[48,-5,13],[-50,-10,10]]){const pillar=new THREE.Mesh(new THREE.CylinderGeometry(.55,.9,h,6,1),alienStone);pillar.position.set(x,h/2,z);pillar.rotation.y=.25;pillar.castShadow=true;pillar.receiveShadow=true;explorationWorld.add(pillar);const seam=new THREE.Mesh(new THREE.BoxGeometry(.09,h*.68,.1),alienGlow);seam.position.set(x,h*.53,z+.82);explorationWorld.add(seam);}
const gate=new THREE.Group();gate.position.set(0,0,-28);explorationWorld.add(gate);
for(const x of [-4.2,4.2]){const p=new THREE.Mesh(new THREE.BoxGeometry(.8,9,.9),alienStone);p.position.set(x,4.5,0);p.castShadow=true;gate.add(p);const stripe=new THREE.Mesh(new THREE.BoxGeometry(.12,7,.12),alienGlow);stripe.position.set(x,4.5,.5);gate.add(stripe);}
const lintel=new THREE.Mesh(new THREE.BoxGeometry(9.2,.9,1),alienStone);lintel.position.y=9;gate.add(lintel);
const gateCore=new THREE.Mesh(new THREE.OctahedronGeometry(1.35,2),alienGlow);gateCore.position.set(0,4.7,.1);gate.add(gateCore);
const dust=new THREE.Group();scene.add(dust);for(let i=0;i<130;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.035,5,5),new THREE.MeshBasicMaterial({color:0xb6eaff,transparent:true,opacity:.48}));p.position.set((Math.random()-.5)*42,Math.random()*12-1,(Math.random()-.5)*25);p.userData.speed=.15+Math.random()*.45;dust.add(p);}
const input=new InputManager();window.fighters=[];const effects=[],projectiles=[],impactRings=[],signatureMoves=[];let clockDelta=1/60,remaining=105,started=false,practice=false,exploration=false,accumulator=0;
// Shared powers layer: the ultimate runner plus the rules for landing one. It resolves damage
// through the same combat_rules helpers as melee, so guarding, walls and invulnerability behave
// consistently. main.js only has to call update() and clear().
const combatPowers=createCombatPowers({
 scene,
 getLayout:()=>effectiveLayout(),
 solidAt,
 callout:(text,color)=>window.showCombatCallout?.(text,color),
 impact:(pos,intensity,color,kind)=>window.spawnImpact?.(pos,intensity,color,kind),
 camera:smashCamera,
 fighters:()=>window.fighters,
 showText:(text,color)=>window.showCombatCallout?.(text,color)
});
window.combatPowers=combatPowers;
// Test hook: the live match object and the real round transitions, so an automated test can
// push a fighter past maxPercent through actual damage and let the game's own KO / round-end /
// next-round / rematch path run, instead of setting `ko` by hand and calling that a KO.
import { spawnClones, updateClones, clearClones, cloneCount, cloneReport } from './combat/clones.js';
import { createPresenter } from './presentation/attack_events.js';
import { createDialogue } from './presentation/dialogue.js';
import { createCinematics } from './presentation/cinematics.js';
import { createMapScore } from './presentation/map_score.js';
import { createAsgardAtmosphere } from './world/asgard_atmosphere.js';
import { updateFormCostume, formCostumeReport } from './anim/form_costume.js';
import { applyAttackMotion, attackMotionReport } from './anim/attack_animator.js';
window.spawnShadowClones=(owner,count=2)=>spawnClones({scene,owner,count});
window.__browserSmashClones=()=>({count:cloneCount(),clones:cloneReport()});
window.__browserSmashCloneCount=()=>cloneCount();
window.__browserSmashClearClones=()=>{clearClones();return cloneCount();};
// Clones must land through the same resolver as everything else: guard, invulnerability, shield
// cost, hitstun and meter all come from applySignatureHit.
window.__browserSmashCloneHit=(owner,target,profile)=>applySignatureHit(owner,target,profile,'clone');
window.__browserSmashRound={
 get state(){return matchState;},
 resolveRoundEnd:()=>resolveRoundEnd(),
 beginNextRound:()=>beginNextRound(),
 reset:(practiceMode)=>reset(!!practiceMode)
};

window.ultimateContext=()=>combatPowers.context();
// Match, stage and presentation state shared by the simulation and the HUD.
let matchState=createMatch();let hitStop=0;let roundPause=0;let matchEndHold=0;let matchEndText='';let twoPlayer=false;let activeLayout=null;let activeLayoutKey='valley';
// Series configuration, the CPU skill level and the pause flag are module state rather than
// menu-only values: the round loop and the AI read them, so a setup change applies to the
// running match instead of only the next one.
let matchRules={roundsToWin:2,roundSeconds:80};let paused=false;
// Training mode state, the running training totals, and the per-match statistics the result
// screen reports. Damage is accumulated by sampling the live damage totals (see
// trackMatchSample), so every damage source is counted by one rule instead of per call site.
let training={dummy:'stand',invulnerable:false,dealt:0,hits:0,biggest:0};
let matchStats={time:0,dealt:[0,0],biggest:0,hits:0};let lastCpuPercent=0,lastPlayerPercent=0;
let cpuSkillLevel=normalizeSkillLevel((()=>{try{return localStorage.getItem('browserSmashCpuSkill');}catch(_error){return null;}})()||DEFAULT_SKILL_LEVEL);
const p2Input={getInputs:()=>input.getInputs(2)};
// Camera-relative movement (third-person controls). WASD is read around the camera's horizontal
// basis, not as four world axes, so W always means "away from the camera" and rotating the camera
// rotates forward. The body turns smoothly toward travel, except pure strafe and backpedal, which
// keep the camera-forward stance so the feet lead.
const cameraMoveForward=new THREE.Vector3();
const cameraMoveRight=new THREE.Vector3();
function cameraRelativeInputs(raw){
  if(!raw||!started||exploration)return raw;
  if(!(raw.left||raw.right||raw.up||raw.down))return raw;
  camera.getWorldDirection(cameraMoveForward);
  cameraMoveForward.y=0;
  if(cameraMoveForward.lengthSq()<1e-6)return raw;
  cameraMoveForward.normalize();
  // Screen right = forward x up. For forward (0,0,-1) this is (1,0,0), matching the camera.
  cameraMoveRight.set(-cameraMoveForward.z,0,cameraMoveForward.x);
  const forward=(raw.up?1:0)-(raw.down?1:0);
  const strafe=(raw.right?1:0)-(raw.left?1:0);
  let mx=cameraMoveForward.x*forward+cameraMoveRight.x*strafe;
  let mz=cameraMoveForward.z*forward+cameraMoveRight.z*strafe;
  const length=Math.hypot(mx,mz)||1;
  mx/=length;mz/=length;
  const faceYaw=forward<=0?Math.atan2(cameraMoveForward.x,cameraMoveForward.z):Math.atan2(mx,mz);
  // Only a pure forward run recenters the camera behind the body. Recentering during a diagonal
  // would rotate the basis that defines the diagonal, so the character would chase a moving target.
  const recenter=forward>0&&strafe===0;
  return {...raw,moveX:mx,moveZ:mz,faceYaw,recenter,cameraRelative:true};
}
const cameraPlayerInput={getInputs:()=>cameraRelativeInputs(input.getInputs(1))};
const cameraP2Input={getInputs:()=>cameraRelativeInputs(input.getInputs(2))};
// Hit-stop freezes the simulation for a few frames on a strong clean hit. VFX, camera
// shake and the render loop keep running, so the impact still reads as motion.
window.requestHitStop=(seconds)=>{hitStop=Math.max(hitStop,Math.min(.12,Number(seconds)||0));};
window.__browserSmashHitStop=()=>hitStop;
// Presentation flash: a single short vignette, gradable by hit weight. Kept out of the DOM during
// menus and pause so it never bleeds into selection screens or the pause overlay.
window.__browserSmashImpactFlash=(weight)=>{
 if(!started||paused)return;
 document.body.classList.remove('bb-impact-light','bb-impact-heavy');
 void document.body.offsetWidth;
 document.body.classList.add(weight==='heavy'?'bb-impact-heavy':'bb-impact-light');
 clearTimeout(window.__bbImpactFlashTimer);
 window.__bbImpactFlashTimer=setTimeout(()=>document.body.classList.remove('bb-impact-light','bb-impact-heavy'),180);
};
// Which controller owns each body right now: a control test needs to know it is actually on
// human input before judging a key. Read-only.
window.__browserSmashControlMode=()=>({twoPlayer,exploration,paused,started,roundPause,matchEndHold,hitStop,practice});
window.__browserSmashMatch=()=>({...matchSummary(matchState),maxPercent:matchState.rules.maxPercent,mode:twoPlayer?'2p':'1p',arena:activeLayoutKey,hitStop,twoPlayer,twoPlayerControls:true});

const combatCallout=document.createElement('div');combatCallout.id='combatCallout';combatCallout.setAttribute('aria-live','polite');Object.assign(combatCallout.style,{position:'fixed',left:'50%',top:'23%',zIndex:'7',pointerEvents:'none',opacity:'0',transform:'translateX(-50%)',font:'1000 clamp(22px,4vw,42px)/1 system-ui,sans-serif',letterSpacing:'.12em',textAlign:'center',whiteSpace:'nowrap',textShadow:'0 3px 0 #06111d,0 0 18px currentColor,0 0 34px #00131e',WebkitTextStroke:'1px #05111b',maxWidth:'96vw'});document.body.appendChild(combatCallout);window.showCombatCallout=(label,color='#a8f6ff')=>{combatCallout.textContent=label;combatCallout.style.color=color;combatCallout.animate([{opacity:0,transform:'translate(-50%,8px) scale(.82)'},{opacity:1,transform:'translate(-50%,0) scale(1.04)',offset:.18},{opacity:1,transform:'translate(-50%,0) scale(1)',offset:.62},{opacity:0,transform:'translate(-50%,-12px) scale(1.02)'}],{duration:760,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});};
const allRoster=[["Infantry","cyborg"],["The Rock","brawler"],["Samuel L. Jackson","cyborg"],["Bruce Lee","ninja"],["Jean-Claude Van Damme","warrior"],["Lucy Liu","ninja"],["Sigourney Weaver","cyborg"],["Keanu Reeves","ninja"],["Burt Reynolds","brawler"],["Grace Jones","ninja"],["Arnold Schwarzenegger","brawler"],["Superman","warrior"],["Iron Man (Tony Stark)","cyborg"],["Hulk (Bruce Banner)","brawler"],["Green Lantern (Hal Jordan)","mage"],["Wolverine (Logan)","ninja"],["Wonder Woman","warrior"],["Professor X (Charles Xavier)","mage"],["The Flash (Barry Allen)","ninja"],["Aquaman","warrior"],["Doctor Strange","mage"],["Goku","warrior"],["Naruto Uzumaki","ninja"],["Vegeta","warrior"],["Saitama","brawler"],["L (Death Note Style)","cyborg"],["Levi Ackerman","ninja"],["Edward Elric","mage"],["Roronoa Zoro","ninja"],["All Might","brawler"],["Jotaro Kujo","brawler"],["Mario","warrior"],["Luigi","ninja"],["Solid Snake","cyborg"],["Geralt of Rivia","warrior"],["Kratos","brawler"],["Link","ninja"],["Lara Croft","ninja"],["Sephiroth","mage"],["Master Chief","cyborg"],["Doom Slayer","brawler"],["Shrek","brawler"],["Aladdin","ninja"],["Ariel","mage"],["Ursula","mage"],["Edna Mode","cyborg"],["Captain Jack Sparrow","ninja"],["Sesshomaru","mage"],["Norman Bates","ninja"],["Han Solo","cyborg"],["Indiana Jones","ninja"],["Sasuke Uchiha","ninja"],["Hashirama Senju","warrior"],["Madara Uchiha","warrior"],["Lord Voldemort","mage"],["Thor","warrior"],["Aang","mage"],["Spider-Man","ninja"],["Iron Spider","cyborg"],["Kaze","warrior"]];const roster=[["Infantry","cyborg"],["Superman","warrior"],["Iron Man (Tony Stark)","cyborg"],["Hulk (Bruce Banner)","brawler"],["Green Lantern (Hal Jordan)","mage"],["Wolverine (Logan)","ninja"],["Wonder Woman","warrior"],["Professor X (Charles Xavier)","mage"],["The Flash (Barry Allen)","ninja"],["Aquaman","warrior"],["Doctor Strange","mage"],["Arnold Schwarzenegger","brawler"],["Goku","warrior"],["Naruto Uzumaki","ninja"],["Vegeta","warrior"],["Saitama","brawler"],["L (Death Note Style)","cyborg"],["All Might","brawler"],["Edward Elric","mage"],["Levi Ackerman","ninja"],["Mario","warrior"],["Luigi","ninja"],["Kratos","brawler"],["Link","ninja"],["Master Chief","cyborg"],["Geralt of Rivia","warrior"],["Doom Slayer","brawler"],["Thor","warrior"],["Aang","mage"],["Madara Uchiha","warrior"],["Hashirama Senju","warrior"],["Lord Voldemort","mage"],["Sasuke Uchiha","ninja"],["Edna Mode","cyborg"],["Captain Jack Sparrow","ninja"],["Spider-Man","ninja"],["Iron Spider","cyborg"],["Kaze","warrior"]];const dlcRoster=allRoster.filter(([name])=>!roster.some(([launchName])=>name===launchName));window.characterRosters={launch:roster,dlc:dlcRoster,all:allRoster};const flightCapable=new Set(["superman","iron_man_tony_stark","green_lantern_hal_jordan","wonder_woman","doctor_strange","goku","naruto_uzumaki","vegeta","thor","aang","madara_uchiha","lord_voldemort","sasuke_uchiha"]);const canCharacterFly=name=>flightCapable.has(String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''));const archetypes=['warrior','ninja','brawler','mage','cyborg'];const fighterNames={warrior:'Superman',ninja:'Naruto Uzumaki',brawler:'Hulk (Bruce Banner)',mage:'Doctor Strange',cyborg:'Iron Man (Tony Stark)'};const fighterArchetype=id=>allRoster.find(([name])=>name===id)?.[1]|| (archetypes.includes(id)?id:'warrior');const fighterDisplay=id=>allRoster.find(([name])=>name===id)?.[0]||fighterNames[id]||id;const normalizeFighter=id=>roster.some(([name])=>name===id)?id:(fighterNames[allRoster.find(([name])=>name===id)?.[1]]||fighterNames[id]||'Superman');let playerType=normalizeFighter(localStorage.getItem('browserSmashP1')||'Superman'),cpuType=normalizeFighter(localStorage.getItem('browserSmashCPU')||'Goku');
// Signature specials use distinct attack silhouettes and balance values instead of recolored generic bolts.
const SPECIAL_MOVES={...IMPORTED_SPECIAL_MOVES,
infantry:{label:'MARKSMAN SHOT',type:'orb',color:0xffd27a,damage:12,speed:44,cooldown:.9,stun:.36,knockback:4.2},
wolverine_logan:{label:'ADAMANTIUM CLAW',type:'spinning',color:0xff6b4a,damage:16,speed:28,cooldown:.70,stun:.42,knockback:5.4},
geralt_of_rivia:{label:'IGNI',type:'fireball',color:0xff8a3d,damage:17,speed:30,cooldown:.82,stun:.44,knockback:5.8},
doom_slayer:{label:'SUPER SHOTGUN',type:'orb',color:0xffd27a,damage:18,speed:36,cooldown:.95,stun:.38,knockback:5.6},
kaze:{label:'WIND CUTTER',type:'orb',color:0x7fe6cf,damage:15,speed:33,cooldown:.72,stun:.44,knockback:6.2},
superman:{label:'HEAT VISION',type:'beam',color:0xff372e,damage:18,speed:39,cooldown:.86,stun:.48,knockback:5.8},
iron_man_tony_stark:{label:'REPULSOR BLAST',type:'beam',color:0x36eaff,damage:14,speed:34,cooldown:.72,stun:.34,knockback:4.5},
hulk_bruce_banner:{label:'THUNDERCLAP',type:'shockwave',color:0xffa64b,damage:23,speed:19,cooldown:1.25,stun:.64,knockback:9.5,behavior:'shockwave',radius:6.4},
green_lantern_hal_jordan:{label:'CONSTRUCT BOLT',type:'construct',color:0x55ff95,damage:16,speed:27,cooldown:.88,stun:.42,knockback:5.4},
wonder_woman:{label:'AMAZON LASSO',type:'lasso',color:0xffd76c,damage:13,speed:31,cooldown:.9,stun:.78,knockback:2.7},
professor_x_charles_xavier:{label:'PSIONIC PULSE',type:'psychic',color:0xb5a0ff,damage:11,speed:22,cooldown:1.05,stun:.95,knockback:2.1},
the_flash_barry_allen:{label:'SPEED FORCE STRIKE',type:'lightning',color:0xffdf52,damage:17,speed:43,cooldown:.68,stun:.3,knockback:5.1,behavior:'dashStrike',dashSpeed:47,range:18},
aquaman:{label:'TIDAL TRIDENT',type:'water',color:0x4adfff,damage:17,speed:25,cooldown:.92,stun:.44,knockback:6.2},
doctor_strange:{label:'ELDRITCH BIND',type:'magic',color:0xffa54d,damage:15,speed:23,cooldown:.92,stun:.8,knockback:3.7},
arnold_schwarzenegger:{label:'CYBERNETIC CANNON',type:'bullet',color:0xff6c52,damage:19,speed:37,cooldown:1.05,stun:.4,knockback:7},
goku:{label:'KAMEHAMEHA',type:'beam',color:0x4b9dff,damage:22,speed:31,cooldown:1.12,stun:.52,knockback:8.2},
naruto_uzumaki:{label:'RASENSHURIKEN',type:'spinning',color:0x55bfff,damage:19,speed:28,cooldown:.9,stun:.5,knockback:7.2},
vegeta:{label:'GALICK GUN',type:'beam',color:0xc06bff,damage:22,speed:32,cooldown:1.1,stun:.52,knockback:8.4},
saitama:{label:'SERIOUS PUNCH',type:'shockwave',color:0xffe4a2,damage:27,speed:24,cooldown:1.32,stun:.46,knockback:12,behavior:'shockwave',radius:7.8},
l_death_note_style:{label:'DEATH NOTE HEX',type:'psychic',color:0xd4d6e0,damage:8,speed:18,cooldown:1.35,stun:1.05,knockback:1.2},
all_might:{label:'DETROIT SMASH',type:'shockwave',color:0xffdf78,damage:25,speed:22,cooldown:1.2,stun:.55,knockback:10.5,behavior:'shockwave',radius:7.1},
edward_elric:{label:'ALCHEMY SPIKE',type:'earth',color:0xff765f,damage:16,speed:25,cooldown:.88,stun:.48,knockback:5.6},
levi_ackerman:{label:'THUNDER SPEAR',type:'blade',color:0xe5f1ff,damage:17,speed:35,cooldown:.76,stun:.35,knockback:5.5,behavior:'dashStrike',dashSpeed:37,range:14},
mario:{label:'FIREBALL',type:'fireball',color:0xff632d,damage:13,speed:23,cooldown:.72,stun:.36,knockback:3.9},
luigi:{label:'POLTERGUST BURST',type:'wind',color:0x9dff9b,damage:11,speed:20,cooldown:.82,stun:.62,knockback:2.2},
kratos:{label:'LEVIATHAN AXE',type:'frost',color:0x8ee6ff,damage:21,speed:26,cooldown:1.05,stun:.54,knockback:8},
link:{label:'HERO ARROW',type:'arrow',color:0xffdc78,damage:15,speed:38,cooldown:.75,stun:.3,knockback:4.7},
master_chief:{label:'PLASMA GRENADE',type:'grenade',color:0x6effb0,damage:20,speed:18,cooldown:1.1,stun:.6,knockback:8.8},
thor:{label:'STORMBREAKER LIGHTNING',type:'lightning',color:0x7be6ff,damage:23,speed:34,cooldown:1.08,stun:.55,knockback:9.1,behavior:'thunderStrike',range:34},
kratos:{label:'LEVIATHAN AXE RUSH',type:'frost',color:0x8ee6ff,damage:22,speed:30,cooldown:1.05,stun:.55,knockback:9,behavior:'dashStrike',dashSpeed:35,range:13.5},
aang:{label:'AIR SCOOTER',type:'wind',color:0xb7fff0,damage:12,speed:27,cooldown:.72,stun:.36,knockback:4.2,behavior:'airScooter',dashSpeed:23,range:9.5,lift:5.2},
madara_uchiha:{label:'GREAT FIRE ANNIHILATION',type:'fireball',color:0xff4b2e,damage:22,speed:25,cooldown:1.12,stun:.55,knockback:8.7},
hashirama_senju:{label:'WOOD DRAGON',type:'wood',color:0x78d18a,damage:18,speed:22,cooldown:1.05,stun:.75,knockback:4.8},
lord_voldemort:{label:'AVADA KEDAVRA',type:'curse',color:0x55ff86,damage:20,speed:32,cooldown:1.12,stun:.7,knockback:7.4},
sasuke_uchiha:{label:'CHIDORI',type:'lightning',color:0x78d8ff,damage:20,speed:33,cooldown:.95,stun:.42,knockback:7.2,behavior:'dashStrike',dashSpeed:39,range:15.5},
edna_mode:{label:'FASHION EMERGENCY GADGET',type:'gadget',color:0xff5ca8,damage:9,speed:25,cooldown:.8,stun:.38,knockback:2.8},
captain_jack_sparrow:{label:'PIRATE PISTOL',type:'bullet',color:0xffd39a,damage:14,speed:40,cooldown:.9,stun:.32,knockback:4.5},
spider_man:{label:'WEB ZIP STRIKE',type:'web',color:0xf5fbff,damage:13,speed:34,cooldown:.78,stun:.62,knockback:5.4,behavior:'dashStrike',dashSpeed:43,range:16},
// Four articulated legs stab out of the back harness and sweep the ground around the
// fighter. Reuses the shockwave arc-hit formula, so damage/stun/knockback scale exactly
// like every other radial special; only the silhouette is new.
iron_spider:{label:'SPIDER-LEG ASSAULT',type:'legs',color:0xffc23d,damage:17,speed:26,cooldown:.9,stun:.55,knockback:6.4,behavior:'shockwave',radius:5.4,legs:4}
};
const COMBAT_PROFILES={...IMPORTED_COMBAT_PROFILES,hulk_bruce_banner:{damage:1.28,knockback:1.28,weight:1.35,launch:1.18},saitama:{damage:1.38,knockback:1.3,weight:1.18,launch:1.2},all_might:{damage:1.24,knockback:1.22,weight:1.24,launch:1.14},kratos:{damage:1.22,knockback:1.2,weight:1.25,launch:1.1},superman:{damage:1.12,knockback:1.12,weight:1.16,launch:1.1},goku:{damage:1.14,knockback:1.12,weight:1.04,launch:1.12},vegeta:{damage:1.12,knockback:1.1,weight:1.04,launch:1.1},the_flash_barry_allen:{damage:.92,knockback:.9,weight:.92,launch:.92},professor_x_charles_xavier:{damage:.86,knockback:.78,weight:.86,launch:.8},l_death_note_style:{damage:.78,knockback:.74,weight:.82,launch:.72},edna_mode:{damage:.8,knockback:.78,weight:.8,launch:.8},spider_man:{damage:.96,knockback:.9,weight:.92,launch:.92},thor:{damage:1.18,knockback:1.2,weight:1.18,launch:1.14},master_chief:{damage:1.1,knockback:1.08,weight:1.12,launch:1.08},iron_spider:{damage:1.02,knockback:1,weight:1.02,launch:1.02},wolverine_logan:{damage:1.10,knockback:1.08,weight:1.06,launch:1.04},geralt_of_rivia:{damage:1.06,knockback:1.04,weight:1.00,launch:1.02},doom_slayer:{damage:1.20,knockback:1.16,weight:1.24,launch:1.10}};
// Two bodies per fighter, in this order. The prefab library is the instant, guaranteed-mounted
// body and the source of each identity's signature weapon, so it still runs: it stands on the
// stage while the character's own exported GLB streams in, it is the fallback if that GLB is
// missing or rejected, and it keeps the prefab/weapon library counts and the lastCharacter
// diagnostic alive. The character body then replaces it, and the weapon is re-mounted on the new
// body so the fighter does not walk into the arena without its gear.
function upgradeFighterVisual(fighter){
  upgradeCharacterWithBlenderModel(fighter).catch(error=>{
    console.warn('Blender character prefab unavailable; keeping the procedural body.',error);
    return false;
  }).then(()=>upgradeFighterModel(fighter,fighter.archetype)).then(loaded=>{
    if(!loaded)return false;
    // The imported body is mounted now. Bind its clip owner in this same turn: waiting for the
    // next syncFighterAnimation left a window where a clip-less body showed only its two reaction
    // fallbacks, and the runtime smoke gate correctly rejected that state. Attaching here is the
    // same controller, just before anything can measure the half-mounted fighter.
    attachFighterAnimation(fighter);
    return equipCharacterWeapons(fighter).catch(error=>{
      console.warn('Weapon reattachment on the character body:',error);
      return false;
    });
  }).catch(error=>console.warn('Character-specific rig unavailable; retaining the Blender/procedural fallback.',error));
}
// Clip animation layer. The procedural pose in fighter3D.js stays as the fallback for rigs the
// clip system cannot bind; when a controller exists it writes the rig after the procedural pose,
// so real clip motion wins without deleting the older authored path.
let animationPackClips=null;
function attachFighterAnimation(f){
  if(!f?.model)return null;
  f.animationController?.dispose();
  const controller=attachAnimation(f.model,f,{isCombat:()=>started&&!exploration});
  if(controller&&animationPackClips?.size)controller.setExternalClips(animationPackClips,'pack');
  f.animationController=controller;
  // Remember which model this binding belongs to so a rig that legitimately stays on the
  // legacy mixer is not re-probed every frame.
  f.animationBindModel=f.model;
  return controller;
}
function syncFighterAnimation(f,dt){
  if(!f?.model)return;
  // A late-loading uploaded GLB replaces the model under the controller; rebind to the new rig.
  // This also binds the authored clip library to an uploaded skeleton that arrived with no
  // baked clips of its own, which previously kept such a fighter on the legacy overlay.
  // The prefab body is swapped in asynchronously, and the first attach can happen before the GLB (and
  // therefore a resolvable rig) exists. `attachAnimation` then returns nothing and the fighter is left
  // with no clip owner at all: ability casts stamp `abilityCast.motion`, the controller that would
  // compile and play `authored_<motion>` is absent, and the body stays in locomotion while the effect
  // fires. Re-attach when the model changes OR when no controller has been obtained yet, throttled so
  // a body that genuinely cannot be rigged is not re-probed every frame.
if(f.animationBindModel!==f.model)attachFighterAnimation(f);
  const controller=f.animationController;
  if(!controller)return;
  // Web-swinging used to suspend the controller, which left an imported body with no pose owner
  // at all (the procedural web-swing branch is skipped for characterAssetUrl rigs). The controller
  // now owns a looping pendulum clip, so it keeps driving the same skeleton through the swing.
  if(!controller.enabled)controller.resume();
  controller.update(dt);
  // The clip controller owns Hulk's rig and writes after animateHumanFighter. Apply the authored
  // debris reach/hold/throw beat after that write, never before it.
  applyHulkDebrisPose(f);
}
// Free a model's GPU resources before dropping it. `scene.remove` only detaches the object
// graph; its geometries and compiled materials stay resident until disposed, which is why repeated
// character switching used to grow the geometry count forever.
function disposeSubtree(root){
  if(!root)return;
  // The matched body is leaving the scene: hand its texture claims back before its materials go,
  // or every character change strands the maps the old body owned.
  // Detach before releasing. This body was still a child of the scene, and `scene` was listed as a
  // surviving owner, so every map it mounted was found again through the scene and skipped as "in
  // use" - which is why rematches climbed 36 -> 38 -> 40 -> 42 textures with released: 0 and
  // disposed: 0. Only owners that outlive the swap may be kept.
  if(root.parent)root.parent.remove(root);else scene.remove(root);
  releaseModelTextures(root,{keep:(window.fighters||[]).map(f=>f.model).filter(model=>model&&model!==root)});
  root.traverse?.(node=>{
    node.geometry?.dispose?.();
    const materials=Array.isArray(node.material)?node.material:(node.material?[node.material]:[]);
    for(const material of materials)material?.dispose?.();
  });
  if(root.parent)root.parent.remove(root);else scene.remove(root);
}
function spawn(name,x,archetype,player){const model=makeProceduralCharacter(archetype,name);model.position.set(x,0,0);scene.add(model);const identityKey=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');const combatProfile=COMBAT_PROFILES[identityKey]||{damage:1,knockback:1,weight:1,launch:1};const f=new Fighter3D({name,model,weight:(player?88:82)*combatProfile.weight,player});f.archetype=archetype;f.identity=name;f.identityKey=identityKey;f.combatProfile=combatProfile;f.specialProfile=SPECIAL_MOVES[identityKey]||{label:'SIGNATURE STRIKE',type:'orb',color:0x62caff,damage:14,speed:22,cooldown:.82,stun:.42,knockback:4.5};combatPowers.attachMoveset(f,f.specialProfile);f.canFly=canCharacterFly(name);f.canWebSwing=name==='Spider-Man';f.flightMode=false;f.webSwinging=false;window.fighters.push(f);f.characterModelLoaded=false;upgradeFighterVisual(f);attachFighterAnimation(f);return f;}
const player=spawn(fighterDisplay(playerType),-12,fighterArchetype(playerType),true),cpu=spawn(fighterDisplay(cpuType),12,fighterArchetype(cpuType),false);player.facing=1;cpu.facing=-1;
const combatItems=createCombatItems(THREE,scene,(fighter,item)=>{window.spawnImpact?.(fighter.position.clone().add(new THREE.Vector3(0,1,0)),8);window.showCombatCallout?.(fighter.name.toUpperCase()+' · '+item.label.toUpperCase(),'#b8ffd0');combatAudio.play('pickup',{position:{x:fighter.position.x,y:fighter.position.y+1,z:fighter.position.z}});});
// The CPU reads one skill profile per decision, so difficulty changes decision quality and
// never health or damage (see combat/cpu_skill.js).
const cpuSkill=()=>skillFor(cpuSkillLevel);
window.__browserSmashCpuSkill=()=>({...cpuSkill(),level:cpuSkillLevel});
window.__browserSmashAiPersona=(name)=>{const f=(window.fighters||[]).find(x=>x.identity===name);return personalityFor(name,f?.combatProfile||{},f?.specialProfile||{});};window.__browserSmashCpuPersona=()=>personalityFor(cpu.identity,cpu.combatProfile||{},cpu.specialProfile||{});
const NEUTRAL_INPUTS=()=>({left:false,right:false,up:false,down:false,run:false,sprint:false,jump:false,dodge:false,attack:false,special:false,shield:false,parry:false,ascend:false,descend:false,flightToggle:false});
// Training dummy: holds still, holds guard or paces instead of fighting back. The
// window.__browserSmashTrainingDummy hook tests already use still forces a passive opponent.
function dummyInputs(){
  const mode=(practice&&training.dummy!=='off')?training.dummy:(window.__browserSmashTrainingDummy?'stand':null);
  if(!mode)return null;
  const inputs=NEUTRAL_INPUTS();
  if(mode==='guard')inputs.shield=true;
  if(mode==='walk'){const right=Math.floor(performance.now()/900)%2===0;inputs.left=!right;inputs.right=right;}
  return inputs;
}
const ai={getInputs(){try{const dummy=dummyInputs();if(dummy)return dummy;if(exploration)return NEUTRAL_INPUTS();if(typeof window!=="undefined"&&window.__browserSmashFreezeAI)return NEUTRAL_INPUTS();const dx=player.position.x-cpu.position.x,dz=player.position.z-cpu.position.z,dist=Math.hypot(dx,dz);if(cpu.canFly&&(player.flightMode||player.position.y>3&&dist<11))cpu.flightMode=true;cpu.aiTimer-=clockDelta;const skill=cpuSkill();const persona=personalityFor(cpu.identity,cpu.combatProfile||{},cpu.specialProfile||{});// Declared after `persona`: reading it earlier is a temporal-dead-zone error that killed the AI.
const hurtRespect=cpu.percent>=(persona.retreatPercent||150)&&dist<3.2;const attack=dist<skill.range*persona.attackRangeScale&&cpu.aiTimer<=0&&!hurtRespect;if(attack)cpu.aiTimer=skill.cooldown+Math.random()*skill.cooldownJitter;const incoming=dist<skill.notice&&player.attackQueue.some(a=>!a.hit&&a.t<a.start&&a.start-a.t<skill.readAhead);const parry=incoming&&cpu.parryCooldown<=0&&Math.random()<skill.parry*persona.defenceBias;const shield=incoming&&!parry&&Math.random()<skill.block*persona.defenceBias;const dodge=incoming&&!parry&&!shield&&cpu.dodgeTimer<=0&&Math.random()<skill.dodge*persona.defenceBias;const specialReady=cpu.specialCooldown<=0;const formReady=!!(cpu.moveset?.form&&!cpu.transform&&(cpu.power||0)>=(cpu.moveset.form.cost||0)&&(cpu.transformCooldown||0)<=0&&dist<11&&Math.random()<skill.form);const wantUltimate=!!((cpu.meter||0)>=100&&dist>1.4&&dist<16&&Math.random()<skill.ultimate*persona.ultimateBias);const useSpecial=specialReady&&dist>2.8&&dist<12&&Math.random()<skill.special*persona.specialBias;return {left:dx< -1.1,right:dx>1.1,up:dz< -1.1,down:dz>1.1,run:dist>4.5*(2-persona.approachBias),sprint:dist>7,jump:!cpu.flightMode&&player.position.y>2.6&&cpu.position.y<1.5,ascend:cpu.flightMode&&player.position.y>cpu.position.y+1.0,descend:cpu.flightMode&&player.position.y<cpu.position.y-2.3,dodge,attack:attack&&Math.random()>skill.hesitation&&!shield,special:useSpecial,special2:!((cpu.abilityReadyAt?.[1]||0)>performance.now()/1000)&&dist>1.6&&dist<13&&Math.random()<skill.special*persona.specialBias*.8,shield,parry,flightToggle:false,transform:formReady,ultimate:wantUltimate};}catch(error){window.__browserSmashAiError=String(error&&error.message||error);return NEUTRAL_INPUTS();}}};
// Hit sparks. Small, additive and capped on purpose: a cluster of full-brightness spheres used
// to read as one opaque cloud sitting on the fighter, and the `bloom.strength` bump the effect
// used to set did nothing at all - the render pipeline's bloom is a disabled stub, so there was
// never any highlight rolloff to sell the hit. The impact reads through motion and colour now.
function burst(pos,color=0x58eaff,count=18,power=5,life=.4){
 const capped=Math.max(1,Math.min(34,Math.round(count)));
 const group=new THREE.Group();
 for(let i=0;i<capped;i++){
  const m=new THREE.Mesh(new THREE.SphereGeometry(.015+Math.random()*.03,6,5),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  m.position.copy(pos);
  m.userData.v=new THREE.Vector3((Math.random()-.5)*power,Math.random()*power*.8,(Math.random()-.5)*power*.4);
  group.add(m);
 }
 scene.add(group);effects.push({group,t:0,life});
}
window.spawnHitSparks=(pos,color=0xffd991,count=14,power=8)=>{
 const group=new THREE.Group();
 for(let i=0;i<count;i++){
   const velocity=new THREE.Vector3((Math.random()-.5)*power,Math.random()*power*.82,(Math.random()-.5)*power*.75);
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(.018,.018,.19+Math.random()*.12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.98}));
   mesh.position.copy(pos);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),velocity.clone().normalize());mesh.userData.v=velocity;group.add(mesh);
 }
 scene.add(group);effects.push({group,t:0,life:.28});
};
window.spawnImpact=(pos,intensity=5,impactColor=null,weaponKind='unarmed')=>{
 const color=impactColor??(intensity>10?0xff9a37:0x60eaff);
 // One sound per confirmed impact, scaled by the same intensity the VFX uses.
 combatAudio.play(intensity>=15?'impactHeavy':'impactLight',{intensity});
 combatVFX.impact(pos,{color,intensity,kind:weaponKind});
 // Impact weight. Everything a confirmed hit does now scales together - freeze, camera knock and
 // screen flash - so a launcher reads heavier than a jab instead of every hit landing the same.
 const impactWeight=intensity>=15?'heavy':intensity>=9?'medium':'light';
 if(weaponKind!=='land'&&weaponKind!=='landing'){
  window.requestHitStop(impactWeight==='heavy'?.085:impactWeight==='medium'?.055:.032);
  smashCamera?.impact?.(impactWeight==='heavy'?.42:impactWeight==='medium'?.26:.14);
 }
 window.__browserSmashImpactFlash?.(impactWeight);
 // Grade the spark load by how hard the hit was instead of firing 24 every time.
 const heavyHit=intensity>=15;
 burst(pos,color,heavyHit?18:12,7,heavyHit?.5:.34);
 if(intensity>5&&['stormbreaker','hammer','axe','sword','katana','cyber_blade','giant_sword','scimitar','trident','staff','war_fan','whip','nunchaku','knife','claws','energy_gauntlet','repulsor','lightning'].includes(weaponKind))window.spawnHitSparks?.(pos,color,intensity>15?22:14,intensity>15?10:7);
 // Expanding emissive shock rings make melee hits readable at a glance.
 for(let i=0;i<2;i++){
  const material=new THREE.MeshBasicMaterial({color:i?0x9b6dff:color,transparent:true,opacity:.66,blending:THREE.AdditiveBlending,depthWrite:false});
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(.72+i*.24,.026,6,32),material);
  mesh.position.copy(pos);mesh.position.y=Math.max(.18,pos.y-.55+i*.18);mesh.rotation.x=Math.PI/2;mesh.scale.setScalar(.35);
  scene.add(mesh);impactRings.push({mesh,t:0,life:.3+i*.08,max:1.5+Math.min(.7,intensity*.02)});
 }
 smashCamera.impact(Math.min(.9,intensity*.045));
};
function applySignatureHit(owner,target,profile,kind='dashStrike'){
 if(!owner||!target||target.model?.visible===false||target.invulnerable>0)return false;
 const guarded=target.guardHeld&&target.guardBreak<=0;
 if(guarded)combatAudio.play('guard',{pitch:signatureFor(owner).pitch});
 const damage=(Number(profile.damage)||12)*(target.incomingDamage??1);
 const signatureDealt=damage*(guarded?guardDamageScale(offhandOf(target),.32):1);
 target.percent+=signatureDealt;
 combatPowers.award(owner,target,signatureDealt,{guarded});
 target.hitstun=guarded?.12:(Number(profile.stun)||.42);
 const away=target.position.clone().sub(owner.position);
 away.y=0;
 if(away.lengthSq()<.001)away.set(owner.facing||1,0,owner.facingZ||0);
 away.normalize();
 const force=(Number(profile.knockback)||5)*(guarded?.24:1);
 target.velocity.x=away.x*force;
 target.velocity.z=away.z*force;
 target.velocity.y=guarded?1.0:(kind==='shockwave'?Math.max(3.2,force*.36):Math.max(2.5,force*.26));
 target.isGrounded=false;
 const impactPoint=target.position.clone().add(new THREE.Vector3(0,.22,0));
 window.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0,1.15,0)),damage,profile.color||0x79e9ff,owner.model?.userData?.weaponKind||'unarmed');
 const impactRing=new THREE.Mesh(new THREE.TorusGeometry(.42,.055,8,32),new THREE.MeshBasicMaterial({color:profile.color||0x79e9ff,transparent:true,opacity:.95,depthWrite:false}));
 impactRing.position.copy(impactPoint);impactRing.rotation.x=Math.PI/2;scene.add(impactRing);
 signatureMoves.push({kind:'impactPulse',age:0,life:.24,outer:impactRing});
 if(!guarded&&owner.comboWindow>0)owner.comboHitCount=Math.max(owner.comboHitCount,1);
 return true;
}
window.performSignatureMove=(owner,profile)=>{
 if(!owner||!profile?.behavior)return false;
 const target=(window.fighters||[]).find(f=>f!==owner&&f.model?.visible!==false);
 const facing=new THREE.Vector3(owner.facing,0,owner.facingZ);
 if(facing.lengthSq()<.001)facing.set(owner.player?1:-1,0,0);
 facing.normalize();
 owner.attackPose=1;
 const behavior=profile.behavior;
 if(behavior==='shockwave'){
   const outer=new THREE.Mesh(new THREE.TorusGeometry(1,.055,10,64),new THREE.MeshBasicMaterial({color:profile.color||0xffc05d,transparent:true,opacity:.62,depthWrite:false}));
   const inner=new THREE.Mesh(new THREE.TorusGeometry(.74,.032,8,48),new THREE.MeshBasicMaterial({color:0xffeec4,transparent:true,opacity:.44,depthWrite:false}));
   for(const mesh of [outer,inner]){mesh.position.copy(owner.position);mesh.position.y=.12;mesh.rotation.x=Math.PI/2;scene.add(mesh);}
   // The mechanical legs are a jointed rig that lives on the body (anim/spider_legs.js). Firing
   // the sweep drives that rig into its strike pose; the tips it throws out are the visible
   // source of the shockwave and also count as contact points in the hit test below.
   if(profile.legs>0)owner.legStrike=.7;
   signatureMoves.push({kind:'shockwave',owner,profile,age:0,life:.48,radius:profile.radius||6,origin:owner.position.clone(),direction:facing.clone(),outer,inner,hitTargets:new Set()});
   owner.velocity.x+=facing.x*1.5;owner.velocity.z+=facing.z*1.5;owner.velocity.y=Math.max(owner.velocity.y,1.1);
   burst(owner.position.clone().add(new THREE.Vector3(0,.18,0)),profile.color||0xffb764,18,4.8,.4);
   window.spawnImpact?.(owner.position.clone().add(new THREE.Vector3(0,.18,0)),12,profile.color||0xffb764);
   return true;
 }
 if(behavior==='thunderStrike'){
   if(!target||owner.position.distanceTo(target.position)>((profile.range)||34))return false;
   const strikePoint=target.position.clone().add(new THREE.Vector3(0,.5,0));
   const group=new THREE.Group();scene.add(group);
   const lightningMaterial=new THREE.LineBasicMaterial({color:profile.color||0x88e9ff,transparent:true,opacity:1});
   const hotMaterial=new THREE.LineBasicMaterial({color:0xf3fdff,transparent:true,opacity:.95});
   for(let bolt=0;bolt<5;bolt++){
     const side=(Math.random()-.5)*1.8;
     const points=[];
     points.push(strikePoint.clone().add(new THREE.Vector3(side,8+Math.random()*2,(Math.random()-.5)*1.2)));
     for(let step=1;step<6;step++){
       const t=step/6;
       points.push(new THREE.Vector3(strikePoint.x+side*(1-t)+(Math.random()-.5)*1.4,strikePoint.y+(8+Math.random()*2)*(1-t),strikePoint.z+(Math.random()-.5)*1.6));
     }
     points.push(strikePoint.clone());
     const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),bolt===0?hotMaterial:lightningMaterial);
     group.add(line);
   }
   const marker=new THREE.Mesh(new THREE.TorusGeometry(1.2,.1,8,32),new THREE.MeshBasicMaterial({color:profile.color||0x88e9ff,transparent:true,opacity:.88,emissive:profile.color||0x88e9ff,emissiveIntensity:1.5}));
   marker.rotation.x=Math.PI/2;marker.position.copy(strikePoint);group.add(marker);
   signatureMoves.push({kind:'thunderStrike',owner,target,profile,age:0,life:.48,visual:group});
   applySignatureHit(owner,target,profile,'thunderStrike');
   burst(strikePoint,profile.color||0x88e9ff,20,7,.44);
   return true;
 }
 if(behavior==='pull'){
   if(!target||owner.position.distanceTo(target.position)>((profile.range)||13))return false;
   const toward=target.position.clone().sub(owner.position);toward.y=0;
   if(toward.lengthSq()>.01&&facing.dot(toward.clone().normalize())<-.2)return false;
   const toOwner=owner.position.clone().sub(target.position);toOwner.y=0;
   const distance=toOwner.length()||1;
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([owner.position.clone().add(new THREE.Vector3(0,1.3,0)),target.position.clone().add(new THREE.Vector3(0,1.1,0))]),new THREE.LineBasicMaterial({color:profile.color||0xffffff,transparent:true,opacity:.95}));
   line.frustumCulled=false;scene.add(line);
   signatureMoves.push({kind:'webPull',owner,target,profile,age:0,life:.32,visual:line});
   applySignatureHit(owner,target,profile,'pull');
   const yank=Math.max(10,Math.min(22,distance*3.2));
   target.velocity.x=(toOwner.x/distance)*yank;
   target.velocity.z=(toOwner.z/distance)*yank;
   target.velocity.y=Math.max(target.velocity.y||0,2.4);
   target.isGrounded=false;
   target.hitstun=Math.max(target.hitstun||0,profile.stun||.9);
   burst(target.position.clone().add(new THREE.Vector3(0,1.1,0)),profile.color||0xffffff,10,3,.3);
   return true;
 }
 if(behavior==='dashStrike'||behavior==='airScooter'){
   const dashTarget=target&&owner.position.distanceTo(target.position)<(profile.range||15)+4?target:null;
   let direction=facing.clone();
   if(dashTarget){
     const d=dashTarget.position.clone().sub(owner.position);d.y=0;
     if(d.lengthSq()>.01)direction=d.normalize();
   }
   const origin=owner.position.clone();
   const meshColor=profile.color||0x72dfff;
   const trailMaterial=new THREE.LineBasicMaterial({color:meshColor,transparent:true,opacity:.85});
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin.clone().add(new THREE.Vector3(0,1.0,0)),origin.clone().add(new THREE.Vector3(0,1.0,0))]),trailMaterial);
   line.frustumCulled=false;scene.add(line);
   let ring=null;
   if(behavior==='airScooter'){
     ring=new THREE.Mesh(new THREE.TorusGeometry(.62,.11,8,32),new THREE.MeshBasicMaterial({color:meshColor,transparent:true,opacity:.78,emissive:meshColor,emissiveIntensity:1.4,depthWrite:false}));
     ring.rotation.x=Math.PI/2;scene.add(ring);
     owner.velocity.y=Math.max(owner.velocity.y,profile.lift||4.8);
   }
   owner.invulnerable=Math.max(owner.invulnerable,behavior==='dashStrike'?.08:0);
   owner.isGrounded=false;
   signatureMoves.push({kind:behavior,owner,target:dashTarget,profile,age:0,life:behavior==='airScooter'?.44:.42,range:profile.range||14,speed:profile.dashSpeed||(behavior==='airScooter'?22:38),traveled:0,direction:direction.clone(),origin,trail:line,ring,hit:false,lastBurst:0});
   return true;
 }
 return false;
};
window.updateSignatureMoves=(dt)=>{
 for(let i=signatureMoves.length-1;i>=0;i--){
   const move=signatureMoves[i];move.age+=dt;
   const profile=move.profile,owner=move.owner;
   let remove=move.age>=move.life;
   if(move.kind==='shockwave'){
     const t=Math.min(1,move.age/move.life),radius=move.radius*t;
     // Unit-sized geometry expanded to the gameplay radius: the front keeps a roughly constant
     // thickness in world units and fades, instead of a ~1 m near-white band over the fight.
     move.outer.scale.setScalar(Math.max(.08,radius));move.inner.scale.setScalar(Math.max(.08,radius*.74));
     move.outer.material.opacity=.62*(1-t);move.inner.material.opacity=.44*(1-t);
     if(profile.legs>0){
       // Sample the real leg tips: they are the strike, and a target touching one is hit even
       // outside the facing cone. Ground sparks fire once, where the tips land.
       const rig=owner.model?.userData?.spiderLegs;
       if(rig){
         move.tipBuffer=move.tipBuffer||[];
         spiderLegTips(rig,move.tipBuffer);
         if(!move.tipSparks){
           move.tipSparks=true;
           for(const tip of move.tipBuffer)window.spawnImpact?.(tip.clone(),7,profile.color||0xffc23d);
         }
       }
     }
     for(const other of (window.fighters||[])){
       if(other===owner||move.hitTargets.has(other)||other.model?.visible===false)continue;
       const offset=other.position.clone().sub(move.origin);const horizontal=Math.hypot(offset.x,offset.z);
       const facingDot=(offset.x*move.direction.x+offset.z*move.direction.z)/(horizontal||1);
       const chest=other.position.clone().add(new THREE.Vector3(0,1,0));
       const tipContact=Boolean(move.tipBuffer&&move.tipBuffer.some(tip=>tip.distanceTo(chest)<(other.hurtboxRadius||.7)+.9));
       if((horizontal<=radius+(other.hurtboxRadius||.7)&&Math.abs(offset.y)<3.5&&facingDot>-.38)||tipContact){
         move.hitTargets.add(other);applySignatureHit(owner,other,profile,'shockwave');
       }
     }
   }else if(move.kind==='impactPulse'){
     const t=Math.min(1,move.age/move.life);move.outer.scale.setScalar(1+t*3.8);move.outer.material.opacity=.95*(1-t);move.outer.position.y+=dt*.55;
   }else if(move.kind==='thunderStrike'){
     move.visual.traverse(node=>{if(node.material)node.material.opacity=Math.max(0,1-move.age/move.life);});
     if(move.visual.children[0])move.visual.children[0].geometry.computeBoundingSphere();
   }else if(move.kind==='dashStrike'||move.kind==='airScooter'){
     const target=move.target&&move.target.model?.visible!==false?move.target:null;
     if(target&&!move.hit){
       const toTarget=target.position.clone().sub(owner.position);toTarget.y=0;
       if(toTarget.length()<2.6){move.hit=applySignatureHit(owner,target,profile,move.kind);if(move.hit)remove=true;}
       else if(move.traveled<move.range){
         const direction=toTarget.lengthSq()>.01?toTarget.normalize():move.direction;
         const step=Math.min(move.speed*dt,move.range-move.traveled,Math.max(.25,owner.position.distanceTo(target.position)-1.65));
         owner.position.addScaledVector(direction,step);move.direction.copy(direction);move.traveled+=step;
         owner.velocity.x=direction.x*move.speed*.18;owner.velocity.z=direction.z*move.speed*.18;
       }
     }else if(!target&&move.traveled<move.range){
       const step=Math.min(move.speed*dt,move.range-move.traveled);
       owner.position.addScaledVector(move.direction,step);move.traveled+=step;
     }
     if(move.traveled>=move.range)remove=true;
     if(move.trail){
       const end=owner.position.clone().add(new THREE.Vector3(0,1.0,0));
       move.trail.geometry.setFromPoints([move.origin.clone().add(new THREE.Vector3(0,1.0,0)),end]);
       move.trail.geometry.computeBoundingSphere();
       move.trail.material.opacity=Math.max(0,1-move.age/move.life);
     }
     if(move.ring){move.ring.position.copy(owner.position);move.ring.position.y+=.7;move.ring.rotation.z+=dt*10;move.ring.material.opacity=Math.max(0,.82-move.age/move.life);}
     if(move.age>=move.lastBurst+.065){burst(owner.position.clone().add(new THREE.Vector3(0,1.15,0)),profile.color||0x78ddff,5,1.4);combatVFX.dash(owner.position.clone().add(new THREE.Vector3(0,.8,0)),move.direction,profile.color||0x78ddff);move.lastBurst=move.age;}
   }
   if(remove){
     if(move.outer){scene.remove(move.outer);move.outer.geometry.dispose();move.outer.material.dispose();}
     if(move.inner){scene.remove(move.inner);move.inner.geometry.dispose();move.inner.material.dispose();}
     if(move.legParts){for(const leg of move.legParts)scene.remove(leg.pivot);move.legGeometry?.dispose();move.legMaterial?.dispose();}
     if(move.visual){scene.remove(move.visual);move.visual.traverse(node=>{node.geometry?.dispose();if(node.material){if(Array.isArray(node.material))node.material.forEach(material=>material.dispose());else node.material.dispose();}});}
     if(move.trail){scene.remove(move.trail);move.trail.geometry?.dispose();move.trail.material?.dispose();}
     if(move.ring){scene.remove(move.ring);move.ring.geometry?.dispose();move.ring.material?.dispose();}
     signatureMoves.splice(i,1);
   }
 }
};
window.beginWebSwing=(fighter)=>{
 if(!fighter?.canWebSwing||fighter.webSwinging)return;
 const facing=new THREE.Vector3(fighter.facing,0,fighter.facingZ);
 if(facing.lengthSq()<.01)facing.set(fighter.player?1:-1,0,0);
 facing.normalize();
 const origin=fighter.position.clone().add(new THREE.Vector3(0,1.6,0));
 const up=new THREE.Vector3(0,1,0);
 const aims=[
   facing.clone().multiplyScalar(.9).addScaledVector(up,.44).normalize(),
   facing.clone().multiplyScalar(.55).addScaledVector(up,.84).normalize(),
   facing.clone().multiplyScalar(.18).addScaledVector(up,.98).normalize()
 ];
 const roots=[mapDecor,finalValleyArena.group,explorationWorld,horizon].filter(root=>root&&root.visible);
 const raycaster=new THREE.Raycaster();
 raycaster.near=2.2;
 raycaster.far=58;
 let anchorHit=null;
 scene.updateMatrixWorld(true);
 for(const aim of aims){
   raycaster.set(origin,aim);
   const hits=raycaster.intersectObjects(roots,true);
   anchorHit=hits.find(hit=>hit.object?.isMesh&&hit.distance>4&&hit.distance<54&&hit.point.y>origin.y+2.8);
   if(anchorHit)break;
 }
 const anchor=anchorHit
   ? anchorHit.point.clone().addScaledVector(anchorHit.face?.normal||up,.12)
   : fighter.position.clone().addScaledVector(facing,10).add(new THREE.Vector3(0,15,0));
 fighter.webSwingAnchor=anchor;
 const hand=fighter.position.clone().add(new THREE.Vector3(facing.x*.28,1.62,facing.z*.28));
 fighter.webSwingLength=Math.max(6.5,hand.distanceTo(anchor)*.96);
 const geometry=new THREE.BufferGeometry().setFromPoints([hand,anchor]);
 const material=new THREE.LineBasicMaterial({color:0xf5fbff,transparent:true,opacity:.98});
 const glowGeometry=new THREE.BufferGeometry().setFromPoints([hand,anchor]);
 const glowMaterial=new THREE.LineBasicMaterial({color:0x65cfff,transparent:true,opacity:.58,depthWrite:false});
 const glowLine=new THREE.Line(glowGeometry,glowMaterial);glowLine.frustumCulled=false;scene.add(glowLine);
 const line=new THREE.Line(geometry,material);line.frustumCulled=false;scene.add(line);
 fighter.webSwingLine=line;fighter.webSwingGlowLine=glowLine;
 fighter.webSwinging=true;fighter.isGrounded=false;
};
window.endWebSwing=(fighter,launch=false)=>{
 if(!fighter)return;
 for(const line of [fighter.webSwingLine,fighter.webSwingGlowLine]){
   if(line){scene.remove(line);line.geometry?.dispose();line.material?.dispose();}
 }
 fighter.webSwingLine=null;fighter.webSwingGlowLine=null;fighter.webSwingAnchor=null;fighter.webSwingLength=0;fighter.webSwinging=false;
 if(launch){
   fighter.velocity.y=Math.max(fighter.velocity.y,5.8);
   fighter.velocity.x+=fighter.facing*2.8;
   fighter.velocity.z+=fighter.facingZ*2.1;
   burst(fighter.position.clone().add(new THREE.Vector3(0,1.8,0)),0xf4faff,10,2.6,.3);
 }
};
window.updateWebSwing=(fighter,dt,inputs={})=>{
 if(!fighter?.webSwinging||!fighter.webSwingAnchor)return;
 const anchor=fighter.webSwingAnchor,offset=fighter.position.clone().sub(anchor),distance=offset.length();
 if(inputs.left)fighter.velocity.x-=2.2*dt;
 if(inputs.right)fighter.velocity.x+=2.2*dt;
 if(inputs.up)fighter.velocity.z-=2.2*dt;
 if(inputs.down)fighter.velocity.z+=2.2*dt;
 if(inputs.sprint){
   // Preserve momentum and pump the pendulum in 3D instead of forcing it into the x/y plane.
   const tangent=new THREE.Vector3(-offset.z,0,offset.x);
   if(tangent.lengthSq()>.01){tangent.normalize();fighter.velocity.addScaledVector(tangent,6.2*dt);}
 }
 if(distance>.001){
   const dir=offset.multiplyScalar(1/distance);
   if(distance>fighter.webSwingLength){
     fighter.position.copy(anchor).addScaledVector(dir,fighter.webSwingLength);
     const radial=fighter.velocity.dot(dir);
     if(radial>0)fighter.velocity.addScaledVector(dir,-radial);
   }
 }
 if(fighter.position.y<.3){window.endWebSwing(fighter,false);return;}
 const hand=fighter.position.clone().add(new THREE.Vector3(fighter.facing*.28,1.62,fighter.facingZ*.28));
 for(const line of [fighter.webSwingLine,fighter.webSwingGlowLine]){
   if(line){line.geometry.setFromPoints([hand,anchor]);line.geometry.computeBoundingSphere();}
 }
};
function debrisRockMesh(radius=.3){
  const group=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x6b6257,roughness:1,metalness:0,flatShading:true});
  for(const [x,y,z,r] of [[0,0,0,1],[.62,.18,.08,.55],[-.55,-.12,.18,.62],[.12,.66,-.22,.46],[-.20,-.62,-.10,.50]]){
    const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(radius*r,0),mat);
    mesh.position.set(x*radius,y*radius,z*radius);mesh.rotation.set(x*3,y*5,z*4);group.add(mesh);
  }
  return group;
}
function startHulkDebrisSequence(owner,options){
  const model=owner.model;
  const find=re=>{let hit=null;model?.traverse(n=>{if(!hit&&n.isBone&&re.test(n.name))hit=n;});return hit;};
  const hand=model?.userData?.rightHand||find(/R[ _]?Hand/i)||null;
  const start=owner.position.clone();
  const len=Math.hypot(owner.facing,owner.facingZ)||1;
  start.x+=owner.facing/len*.8;start.z+=owner.facingZ/len*.8;start.y=.16;
  const group=debrisRockMesh(.38);group.position.copy(start);scene.add(group);
  model.userData.debrisBones={upper:find(/R[ _]?UpperArm/i),fore:find(/R[ _]?Forearm/i),hand:find(/R[ _]?Hand/i),spine:find(/Spine[12]/i)};
  // A debris throw is aimed at the opponent, not at Hulk's current facing: a cinematic or a
  // turn during the pickup used to send the rock diagonally past the target.
  owner.debrisSequence={group,start,hand,options:{...options,aimAt:owner===player?cpu:player},t:0,phase:'pickup'};
  owner.debrisPose={phase:'pickup',t:0};
  // The duel camera sits behind the active fighter, which hid the reach and the rock behind
  // Hulk's own back. Hold a side inspection shot for the whole pickup/hold/release beat, then
  // hand the saved duel framing back. This is presentation only; combat state is untouched.
  owner.debrisCamera=true;owner.debrisCameraT=0;
  window.smashCamera?.spectate?.({fighter:owner,framing:'full',distance:5.4,yaw:90,pitch:5});
}
function updateHulkDebris(owner,dt){
  if(owner.debrisCamera){
    owner.debrisCameraT=(owner.debrisCameraT||0)+dt;
    if(owner.debrisCameraT>1.8){window.smashCamera?.endSpectate?.();owner.debrisCamera=false;}
  }
  const seq=owner.debrisSequence;if(!seq)return;
  seq.t+=dt;
  if(seq.phase==='pickup'){
    const p=Math.min(1,seq.t/.45);
    const target=seq.hand?seq.hand.getWorldPosition(new THREE.Vector3()):owner.position.clone().add(new THREE.Vector3(0,1.5,0));
    seq.group.position.lerpVectors(seq.start,target,p);
    if(p>=1){
      // The rock must ride the palm during the hold, not sit at the last sampled world point
      // while the arm moves underneath it.
      if(seq.hand){seq.hand.attach(seq.group);seq.group.position.set(0,.05,.02);}
      seq.phase='hold';seq.t=0;
    }
  }else if(seq.phase==='hold'&&seq.t>=.45){
    seq.group.parent?.remove(seq.group);owner.debrisSequence=null;
    window.spawnProjectile?.(owner,{...seq.options,type:'debris',debrisRelease:true});
    owner.debrisPose={phase:'throw',t:0};
  }
  if(owner.debrisPose)owner.debrisPose.t+=dt;
}
window.spawnProjectile=(owner,options={})=>{
 // A signature cast briefly frames its caster. Weapon fire is excluded: every bullet would pull the shot.
 if(options.source!=='weapon')window.smashCamera?.focus?.(owner,{seconds:.45,zoom:.12});
 const palette={warrior:0xff713c,ninja:0x16bfff,brawler:0xff8d36,mage:0x9d67ff,cyborg:0x26e8e0};
 const weaponKind=options.weaponKind||owner.model?.userData?.weaponKind||'';
 const profile=options.source==='special'?(owner.specialProfile||{}):options.source==='ability'?options:{};
 const moveType=profile.type||(options.source==='web'?'web':options.source==='weapon'?'weapon':owner.archetype==='mage'?'magic':owner.archetype==='ninja'?'spinning':'orb');
 if(moveType==='debris'&&!options.debrisRelease){startHulkDebrisSequence(owner,options);return;}
 const webShot=options.source==='web'||moveType==='web';
 const ballistic=options.source==='weapon'&&['blaster','rifle','shotgun','plasma_rifle','pistol'].includes(weaponKind);
 const color=profile.color||(webShot?0xf3f8ff:ballistic?(weaponKind==='plasma_rifle'?0x8bffc4:owner.player?0xffd18a:0xff635e):(palette[owner.archetype]||(owner.player?0x25dfff:0xff5a24)));
 const group=new THREE.Group(),basic=new THREE.MeshBasicMaterial({color,wireframe:webShot||moveType==='construct'});
 let core;
 if(moveType==='beam')core=new THREE.Mesh(new THREE.CylinderGeometry(.05,.15,2.6,16,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.4,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
 else if(moveType==='shockwave')core=new THREE.Mesh(new THREE.TorusGeometry(.7,.13,8,28),basic);
 else if(moveType==='lightning')core=new THREE.Mesh(new THREE.OctahedronGeometry(.32,1),basic);
 else if(moveType==='arrow')core=new THREE.Mesh(new THREE.ConeGeometry(.045,.4,10),basic);
 else if(moveType==='blade')core=new THREE.Mesh(new THREE.ConeGeometry(.16,.95,8),basic);
 else if(['fireball','frost','curse','grenade'].includes(moveType))core=new THREE.Mesh(new THREE.IcosahedronGeometry(moveType==='grenade'?.38:.32,2),basic);
 else if(['wind','lasso','water'].includes(moveType))core=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,10,40),basic);
 else if(['psychic','magic'].includes(moveType))core=new THREE.Mesh(new THREE.TorusGeometry(.42,.055,8,32),basic);
 else if(moveType==='wood'||moveType==='earth')core=new THREE.Mesh(new THREE.ConeGeometry(.32,.85,7),basic);
 else if(moveType==='gadget')core=new THREE.Mesh(new THREE.DodecahedronGeometry(.3,1),basic);
 else if(moveType==='debris'){
   // A real thrown rock, not a tinted orb: several broken chunks with a dusty silhouette.
   core=new THREE.Group();
   const rockMat=new THREE.MeshStandardMaterial({color:0x6b6257,roughness:1,metalness:0,flatShading:true});
   const chunks=[[0,0,0,.38],[.24,.08,.04,.24],[-.22,-.06,.08,.26],[.06,.27,-.12,.20],[-.10,-.24,-.06,.22]];
   for(const [x,y,z,r] of chunks){const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(r,0),rockMat);rock.position.set(x,y,z);rock.rotation.set(x*3,y*5,z*4);core.add(rock);}
   const dust=new THREE.Mesh(new THREE.TorusGeometry(.58,.055,6,26),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.35,blending:THREE.AdditiveBlending,depthWrite:false}));dust.rotation.set(1.1,.4,.7);core.add(dust);
   group.add(core);group.userData.spin=true;
 }
 else if(moveType==='rasengan')core=new THREE.Mesh(new THREE.IcosahedronGeometry(.3,2),basic);
 else if(ballistic)core=new THREE.Mesh(new THREE.BoxGeometry(.095,.095,weaponKind==='shotgun'?.42:.58),basic);
 else core=new THREE.Mesh(webShot?new THREE.IcosahedronGeometry(.17,1):owner.archetype==='mage'?new THREE.IcosahedronGeometry(.34,2):owner.archetype==='ninja'?new THREE.OctahedronGeometry(.32,1):new THREE.IcosahedronGeometry(.3,2),basic);
 if(moveType==='beam'){core.rotation.x=Math.PI/2;core.position.z=1.35;group.add(core);const inner=new THREE.Mesh(new THREE.CylinderGeometry(.022,.06,2.7,10,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.55,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));inner.rotation.x=Math.PI/2;inner.position.z=1.4;group.add(inner);const muzzleRing=new THREE.Mesh(new THREE.TorusGeometry(.13,.022,8,24),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));muzzleRing.position.z=.06;group.add(muzzleRing);const muzzleSpark=new THREE.Mesh(new THREE.ConeGeometry(.1,.3,12,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.6,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));muzzleSpark.rotation.x=Math.PI/2;muzzleSpark.position.z=.2;group.add(muzzleSpark);const outerGlow=new THREE.Mesh(new THREE.CylinderGeometry(.14,.3,2.9,18,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.13,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));outerGlow.rotation.x=Math.PI/2;outerGlow.position.z=1.45;group.add(outerGlow);}
 else if(moveType==='shockwave'){core.rotation.y=Math.PI/2;group.add(core);const ring2=new THREE.Mesh(new THREE.TorusGeometry(.48,.07,6,24),new THREE.MeshBasicMaterial({color:0xfff2d6,transparent:true,opacity:.8}));ring2.rotation.y=Math.PI/2;group.add(ring2);}
 else{if(moveType==='arrow'||moveType==='blade')core.rotation.x=Math.PI/2;if(['wind','water','lasso'].includes(moveType))core.rotation.y=Math.PI/2;group.add(core);if(['lasso','water','wind'].includes(moveType)){for(let i=1;i<=2;i++){const halo=new THREE.Mesh(new THREE.TorusGeometry(.34+i*.085,.014,6,34),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.34-i*.1,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));halo.rotation.y=Math.PI/2;group.add(halo);}}if(moveType==='arrow'||moveType==='blade'){const head=new THREE.Mesh(new THREE.ConeGeometry(.075,.26,4),new THREE.MeshBasicMaterial({color:0xf3f7ff}));head.rotation.x=Math.PI/2;head.position.z=.52;group.add(head);const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.017,.017,.86,6),new THREE.MeshBasicMaterial({color:0x7a5a33}));shaft.rotation.x=Math.PI/2;shaft.position.z=-.02;group.add(shaft);for(let i=0;i<3;i++){const a=(i/3)*Math.PI*2;const fin=new THREE.Mesh(new THREE.BoxGeometry(.008,.1,.2),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,side:THREE.DoubleSide}));fin.position.set(Math.sin(a)*.05,Math.cos(a)*.05,-.34);fin.rotation.z=a;group.add(fin);}const flare=new THREE.Mesh(new THREE.ConeGeometry(.05,.28,10,1,true),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.35,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));flare.rotation.x=-Math.PI/2;flare.position.z=-.52;group.add(flare);}}
 // Collision uses a .95 m swept sphere, so the additive halo has to read at that size: a
// smaller halo made a shot that connected look like it should have missed.
if(['lightning','fireball','frost','curse','grenade','wood','earth','gadget'].includes(moveType))group.add(new THREE.Mesh(new THREE.SphereGeometry(.82,12,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.19,blending:THREE.AdditiveBlending,depthWrite:false})));
 if(moveType==='rasengan'){
    // A Rasengan is a spinning sphere with a spiral shell and a wake, not a recoloured orb.
    const chakra=0x8fe4ff;
    group.add(new THREE.Mesh(new THREE.SphereGeometry(.42,18,14),new THREE.MeshBasicMaterial({color:chakra,transparent:true,opacity:.22,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false})));
    for(let i=0;i<3;i++){
      const spiral=new THREE.Mesh(new THREE.TorusGeometry(.30+i*.055,.018,7,34,Math.PI*1.35),new THREE.MeshBasicMaterial({color:i===0?0xffffff:chakra,transparent:true,opacity:.75-i*.18,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
      spiral.rotation.set(i*1.05,i*.85,i*.55);group.add(spiral);
    }
    const wake=new THREE.Mesh(new THREE.ConeGeometry(.22,1.05,16,1,true),new THREE.MeshBasicMaterial({color:chakra,transparent:true,opacity:.2,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    wake.rotation.x=-Math.PI/2;wake.position.z=-.62;group.add(wake);
    group.userData.spin=true;
  }
 if(moveType==='spinning'){
    // Rasenshuriken: four chakra blades around a core, wind rings and a shuriken silhouette. The
    // disc is sized against the caster's body: the old 2.7 m version was barely wider than
    // Naruto's shoulders on screen from the gameplay camera, so the move read as a glowing ring
    // rather than a thrown blade. Collision is unchanged - it is still the .95 m swept sphere.
    const ownerScale=Math.max(.85,Math.min(1.5,Number(owner.model?.userData?.visualScale||owner.model?.userData?.characterScale)||1));
    const shurikenScale=(Number(profile.projectileScale)||1)*ownerScale*1.02;
    const shuriken=new THREE.Group();
    shuriken.name='rasenshuriken';
    shuriken.scale.setScalar(shurikenScale);
    const bladeMat=new THREE.MeshBasicMaterial({color:0xa8e6ff,transparent:true,opacity:.74,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
    const edgeMat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.4,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
    for(let i=0;i<4;i++){
      const angle=(i/4)*Math.PI*2;
      const blade=new THREE.Mesh(new THREE.ConeGeometry(.30,1.62,4,1,true),bladeMat);
      blade.name='shuriken-blade';
      // The blade base sits on the core and the tip points outward; the old blade was centred on
      // the ring, so half of each blade hid behind the core.
      blade.position.set(Math.cos(angle)*1.02,Math.sin(angle)*1.02,0);
      blade.rotation.z=angle-Math.PI/2;
      blade.scale.set(1,1,.14);
      shuriken.add(blade);
      const edge=new THREE.Mesh(new THREE.ConeGeometry(.34,1.66,4,1,true),edgeMat);
      edge.name='shuriken-edge';
      edge.position.set(Math.cos(angle)*1.0,Math.sin(angle)*1.0,-.03);
      edge.rotation.z=angle-Math.PI/2;
      edge.scale.set(1,1,.085);
      shuriken.add(edge);
    }
    const shurikenCore=new THREE.Mesh(new THREE.SphereGeometry(.34,16,12),new THREE.MeshBasicMaterial({color:0xd8f6ff,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    shurikenCore.name='shuriken-core';
    shuriken.add(shurikenCore);
    for(let i=0;i<3;i++){
      const wind=new THREE.Mesh(new THREE.TorusGeometry(1.02+i*.20,.03,6,44),new THREE.MeshBasicMaterial({color:0x9fe8ff,transparent:true,opacity:.62-i*.16,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
      wind.name='shuriken-wind';
      wind.rotation.set(i*.5,i*.7,i*.3);shuriken.add(wind);
    }
    const wake=new THREE.Mesh(new THREE.ConeGeometry(.5,1.5,16,1,true),new THREE.MeshBasicMaterial({color:0x8fe4ff,transparent:true,opacity:.14,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
    wake.name='shuriken-wake';
    wake.rotation.x=-Math.PI/2;wake.position.z=-1.15;shuriken.add(wake);
    group.add(shuriken);
    group.userData.spin=true;
    group.userData.shurikenScale=+shurikenScale.toFixed(2);
  }
 if(['psychic','magic','construct'].includes(moveType))for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.38+i*.13,.025,6,28),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.86}));ring.rotation.set(i*.8,i*1.1,i*.45);group.add(ring);}
 if(ballistic){core.position.z=-.14;const tip=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,.16),new THREE.MeshBasicMaterial({color:0xfff3d5}));tip.position.z=-.47;group.add(tip);}
 if(webShot)group.add(new THREE.Mesh(new THREE.SphereGeometry(.26,10,8),new THREE.MeshBasicMaterial({color:0xf8fbff,wireframe:true})));
 if(webShot)group.add(new THREE.Mesh(new THREE.SphereGeometry(.7,10,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false})));
 const direction=new THREE.Vector3(owner.facing,0,owner.facingZ);if(options.aimAt?.position){direction.set(options.aimAt.position.x-owner.position.x,0,options.aimAt.position.z-owner.position.z);}if(direction.lengthSq()<.01)direction.set(owner.player?1:-1,0,0);direction.normalize();
 if(ballistic||['arrow','blade','beam'].includes(moveType))group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
 // A signature blast leaves the palm, not a point in front of the chest: the old origin sat
 // 1.05 m forward and 1.5 m up, about 0.69 m from the hand, which read as a detached shot.
 const palm=owner.model?.userData?.rightHand||owner.model?.userData?.leftHand||null;
const _origin=resolveProjectileOrigin({owner,options,direction});
const start=new THREE.Vector3(_origin.point.x,_origin.point.y,_origin.point.z);
window.__browserSmashLastShot={identity:owner.identity||null,source:options.source||'unknown',moveType,policy:_origin.policy,originObject:_origin.objectName,fallback:_origin.usedFallback,spawn:{x:+start.x.toFixed(3),y:+start.y.toFixed(3),z:+start.z.toFixed(3)},selfDistance:+distanceFromBodyAxis(start,owner).toFixed(3)};window.__browserSmashPresent?.('projectile',{owner,label:profile.label||profile.moveType||'SIGNATURE',color:profile.color,origin:start});
 group.position.copy(start);scene.add(group);
 const speed=profile.speed||(webShot?26:ballistic?(weaponKind==='shotgun'?22:weaponKind==='plasma_rifle'?24:30):17);
 const life=profile.life||(webShot?1.35:ballistic?1.28:1.6),damage=profile.damage||(webShot?7:ballistic?(weaponKind==='shotgun'?15:12):14);
 // Pitch varies by move type so a beam, a bullet and a fireball do not sound identical.
 combatAudio.play('projectile',{pitch:(moveType==='beam'?0.7:moveType==='bullet'||ballistic?1.5:1)*signatureFor(owner).pitch});
 window.browserSmashProjectiles=projectiles;
projectiles.push({owner,group,velocity:direction.multiplyScalar(speed),life,damage,color,webShot,moveType,stun:profile.stun||.42,knockback:profile.knockback||5,profile});
 burst(start,color,moveType==='web'?10:moveType==='beam'?14:ballistic?5:10,moveType==='shockwave'?4:2.6,.34);
  combatVFX.launch(start,color,moveType);
};
function detonateGrenade(projectile){
 const pos=projectile.group.position.clone(),color=projectile.color||0x75ffb3,radius=5.1;
 combatAudio.play('explosion',{intensity:projectile.damage||20,position:{x:pos.x,y:pos.y,z:pos.z}});
 burst(pos,color,30,9,.5);
 window.spawnImpact?.(pos,23,0xffe09b);
 // The blast ring stays thin: `emissive` on a MeshBasicMaterial is dead data (the material is
 // unlit), so the ring's readability comes from its tint and its growth, not a glow it never had.
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.055,8,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false}));
 ring.position.copy(pos);ring.rotation.x=Math.PI/2;scene.add(ring);impactRings.push({mesh:ring,t:0,life:.42,max:radius/.75});
 for(const target of (window.fighters||[])){
   if(target===projectile.owner||target.model?.visible===false||target.invulnerable>0)continue;
   const point=target.position.clone().add(new THREE.Vector3(0,1,0)),distance=point.distanceTo(pos);
   if(distance>radius)continue;
   const guarded=target.guardHeld&&target.guardBreak<=0;
   const falloff=Math.max(.35,1-distance/radius*.52);
   target.percent+=projectile.damage*falloff*(guarded?guardDamageScale(offhandOf(target),.3):1);
   target.hitstun=guarded?.1:Math.max(.38,projectile.stun||.6);
   const away=target.position.clone().sub(pos);away.y=0;if(away.lengthSq()<.01)away.set(projectile.owner?.facing||1,0,0);away.normalize();
   const force=(projectile.knockback||8)*falloff*(guarded?.25:1);
   target.velocity.x=away.x*force;target.velocity.z=away.z*force;target.velocity.y=guarded?1.2:4.2+falloff*1.8;target.isGrounded=false;
 }
 window.showCombatCallout?.('PLASMA GRENADE DETONATION','#b8ffc5');
}
window.camState={shake:0,targetZoom:19};let cameraMode=(()=>{const saved=localStorage.getItem('browserSmashCameraMode_v4');return ['third-person','overhead','over-p1','forward','classic'].includes(saved)?saved:'overhead';})();localStorage.setItem('browserSmashCameraMode_v3',cameraMode);const CAMERA_MODES=['third-person','overhead','over-p1','forward','classic'];
function setCameraMode(mode){
 const value=String(mode||'');
 if(!CAMERA_MODES.includes(value))return getCameraMode();
 cameraMode=value;
 if(cameraModeSelect)cameraModeSelect.value=value;
 localStorage.setItem('browserSmashCameraMode_v4',value);
 localStorage.setItem('browserSmashCameraMode_v3',value);
 localStorage.setItem('browserSmashCameraMode_v2',value);
 return getCameraMode();
}
function getCameraMode(){return cameraMode;}
function setCameraZoom(value){
 const z=Number(value);
 if(!Number.isFinite(z))return getCameraZoom();
 const min=Number(smashCamera.minZoom)||.7;
 const max=Number(smashCamera.maxZoom)||6;
 const next=Math.max(min,Math.min(max,z));
 smashCamera.setZoom(next);
 if(cameraZoom)cameraZoom.value=String(next);
 localStorage.setItem('browserSmashCameraZoom_v6',String(next));
 return getCameraZoom();
}
function getCameraZoom(){return smashCamera.zoom;}
const cameraModeSelect=$('#cameraMode');if(cameraModeSelect){cameraModeSelect.value=cameraMode;cameraModeSelect.addEventListener('change',()=>setCameraMode(cameraModeSelect.value));}const cameraZoom=$('#cameraZoom');if(cameraZoom){const savedZoom=Number(localStorage.getItem('browserSmashCameraZoom_v6'));if(Number.isFinite(savedZoom)&&savedZoom>=smashCamera.minZoom&&savedZoom<=smashCamera.maxZoom)smashCamera.setZoom(Math.max(0.9,savedZoom));cameraZoom.value=String(smashCamera.zoom);cameraZoom.addEventListener('input',()=>setCameraZoom(Number(cameraZoom.value)));}canvas.addEventListener('wheel',e=>{e.preventDefault();setCameraZoom(smashCamera.zoom*(e.deltaY>0?1.12:1/1.12));},{passive:false});// Mouse look belongs to free roam only: a match keeps its authored duel camera, so a drag
// there can never swing the shot off the fighters. Inside a world it is how you turn around.
let lookingAround=false,lastPointerX=0,lastPointerY=0;canvas.addEventListener('contextmenu',e=>e.preventDefault());const stopLooking=()=>{lookingAround=false;if(exploration)canvas.style.cursor='grab';};canvas.addEventListener('pointerdown',e=>{if((!exploration&&cameraMode!=='third-person')||(e.button!==0&&e.button!==2))return;lookingAround=true;lastPointerX=e.clientX;lastPointerY=e.clientY;canvas.style.cursor='grabbing';canvas.setPointerCapture?.(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!lookingAround||(!exploration&&cameraMode!=='third-person'))return;const dx=e.clientX-lastPointerX,dy=e.clientY-lastPointerY;lastPointerX=e.clientX;lastPointerY=e.clientY;smashCamera.orbit(-dx*.006,dy*.004);});canvas.addEventListener('pointerup',stopLooking);canvas.addEventListener('pointercancel',stopLooking);canvas.addEventListener('lostpointercapture',stopLooking);const $status=$('#status');
const characterSelects={p1:$('#p1Character'),cpu:$('#cpuCharacter')};
for(const [key,select] of Object.entries(characterSelects)){
 if(!select)continue;
 populateRoster(select,key==='p1'?playerType:cpuType);
 select.value=key==='p1'?playerType:cpuType;
 select.addEventListener('change',()=>applyFighterSelection(key,select.value));
}
function fighterTypeRefresh(){}
function applyFighterSelection(side,name){
 const key=side==='cpu'||side==='p2'?'cpu':'p1';
 const display=String(name||'');
 if(!roster.some(([fighter])=>fighter===display))return null;
 if(key==='p1')playerType=display;else cpuType=display;
 const select=characterSelects[key];
 if(select&&select.value!==display)select.value=display;
 localStorage.setItem(key==='p1'?'browserSmashP1':'browserSmashCPU',display);
 const fighter=key==='p1'?player:cpu;
 const archetype=fighterArchetype(display);
 const previous=fighter.model;
 disposeSubtree(previous);
 const fresh=makeProceduralCharacter(archetype,display);
 fresh.position.copy(fighter.position);
 scene.add(fresh);
 fighter.model=fresh;
 fighter.position=fresh.position;
 fighter.archetype=archetype;
 fighter.identity=display;
 fighter.identityKey=String(display||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
 fighter.combatProfile=COMBAT_PROFILES[fighter.identityKey]||{damage:1,knockback:1,weight:1,launch:1};
 fighter.specialProfile=SPECIAL_MOVES[fighter.identityKey]||{label:'SIGNATURE STRIKE',type:'orb',color:0x62caff,damage:14,speed:22,cooldown:.82,stun:.42,knockback:4.5};
 combatPowers.clear('swap');
 combatPowers.resetFighter(fighter,{keepMeter:false});
 combatPowers.attachMoveset(fighter,fighter.specialProfile);
 fighter.weight=(key==='p1'?88:82)*fighter.combatProfile.weight;
 fighter.name=fighterDisplay(display);
 fighter.canFly=canCharacterFly(display);
 fighter.canWebSwing=display==='Spider-Man';
 fighter.flightMode=false;
 fighter.webSwinging=false;
 window.endWebSwing?.(fighter,false);
 fighter.characterModelLoaded=false;
 fighter.animationController?.dispose();
 fighter.animationController=null;
 upgradeFighterVisual(fighter);
 attachFighterAnimation(fighter);
 // A character change never changes the arena; only re-apply if the live map has actually moved.
 if(mapSelect?.value&&mapSelect.value!==activeLayoutKey)applyArenaSelection(mapSelect.value);
 selectScreen?.setFighterState?.(key==='p1'?'p1':'p2',display);
 return getFighter(key);
}
function selectFighter(side,name){
 if(!['p1','cpu','p2'].includes(side))return null;
 return applyFighterSelection(side,name);
}
function getFighter(side){
 const key=side==='cpu'||side==='p2'?'cpu':'p1';
 if(side!=='p1'&&side!=='cpu'&&side!=='p2')return null;
 const fighter=key==='p1'?player:cpu;
 if(!fighter)return null;
 return {
  side:key,
  name:fighter.name,
  identity:fighter.identity,
  identityKey:fighter.identityKey,
  archetype:fighter.archetype,
  percent:Number(fighter.percent||0),
  ko:Boolean(fighter.ko),
  canFly:Boolean(fighter.canFly),
  modelLoaded:Boolean(fighter.characterModelLoaded),
  weapon:fighter.model?.userData?.weaponLabel||null,
  moveset:fighter.moveset?.key||null
 };
}
fighterTypeRefresh();
const mapDecor=new THREE.Group();scene.add(mapDecor);
// Large worlds are built once as merged per-material geometry and stay alive while the player
// fights in any of that world's locations. Leaving the world frees its merged geometry.
const worldStage=new THREE.Group();worldStage.name='world-stage';scene.add(worldStage);
// Lit rings mark the doorways that lead to a neighbouring stage, so a transition is a place
// the player can see rather than a hidden trigger.
const exitMarkers=new THREE.Group();exitMarkers.name='exit-markers';scene.add(exitMarkers);
function buildExitMarkers(location){
 while(exitMarkers.children.length){const node=exitMarkers.children.pop();node.traverse?.(child=>{child.geometry?.dispose?.();child.material?.dispose?.();});exitMarkers.remove(node);}
 if(!location)return;
 const ground=location.layout?.ground??0;
 for(const exit of (location.exits||[])){
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.6,.13,8,26),new THREE.MeshBasicMaterial({color:0x63e6ff}));
  ring.position.set(exit.x,ground+.1,exit.z);ring.rotation.x=Math.PI/2;exitMarkers.add(ring);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.8,1.4,3.4,14,1,true),new THREE.MeshBasicMaterial({color:0x63e6ff,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));
  beam.position.set(exit.x,ground+1.7,exit.z);exitMarkers.add(beam);
 }
}
let activeWorldGroup=null,activeWorldId=null;
function ensureWorldGroup(worldId){
 if(activeWorldId===worldId&&activeWorldGroup)return activeWorldGroup;
 if(activeWorldGroup){worldStage.remove(activeWorldGroup);disposeWorldGroup(activeWorldGroup);activeWorldGroup=null;activeWorldId=null;}
 activeWorldGroup=buildWorldGroup(worldId);
 activeWorldId=worldId;
 if(activeWorldGroup)worldStage.add(activeWorldGroup);
 return activeWorldGroup;
}
function applyWorldStage(key){
 const location=worldLocation(key);
 // The procedural valley skyline only belongs to the valley maps - and an authored Blender arena
 // (Asgard, Hogwarts, Death Star, ...) is not a valley either. This was the mounting defect: Asgard
 // has no world location, so `!location` came out true and 1 178 CinematicValleyEnvironment meshes
 // (ridges, city, forest, glints) stayed visible on top of the 559-mesh Asgard palace, while the
 // Final Valley group next to it was correctly hidden. Visibility is now decided by both facts.
 cinematicEnvironment.visible=!location&&!authoredArenaKeys.has(key);
 if(!location){
  worldStage.visible=false;floor.visible=true;buildExitMarkers(null);
  // An authored arena (asgard, deathstar, ...) has no world location, so it lands here - and this
  // line used to blank the stage back to a bare overhead shot. The authored GLB only streams in a
  // second later, so every match OPENED unframed: measured tilt 0, scale 1, zero collision volumes
  // and a 23.8 m spawn shot pointed into a palace wall. Keep the arena's own layout framing from the
  // first frame; syncAuthoredArena upgrades it with the mesh volumes once the file lands.
  const authoredStage=authoredArenaKeys.has(key)?ARENA_LAYOUTS[key]:null;
  smashCamera.setStageTilt?.(authoredStage?.16:0,authoredStage?1.0:1);
  smashCamera.setStageYaw?.(authoredStage?.camera?.yaw??0);
  smashCamera.setStageBounds?.(authoredStage?(authoredStage.bounds||null):null,authoredStage?(authoredStage.blocks||null):null);
  sun.castShadow=true;
  if(activeWorldGroup){worldStage.remove(activeWorldGroup);disposeWorldGroup(activeWorldGroup);activeWorldGroup=null;activeWorldId=null;}
  const classicLayout=ARENA_LAYOUTS[key];
  window.__browserSmashWorld={world:null,location:null,label:classicLayout?.label||key,ground:classicLayout?.ground??0,bounds:classicLayout?.bounds??null,exits:[]};
  smashCamera.snap?.();
  return;
 }
 worldStage.visible=true;
 ensureWorldGroup(location.world);
 buildExitMarkers(location);
 // Larger arenas get a lower, pulled-back shot so the architecture is visible.
 // Enclosed rooms get a steeper, higher shot: a shallow pitch over a long interior filled
 // the frame with table tops instead of the room.
 const tiltByWorld={asgard:.16,hogwarts:.07,deathstar:.1};
 // A stage can override its shot: tight interiors need a shorter reach than the default
 // wide pull-back, or the camera ends up outside the room looking at its roof.
 const camHint=location.camera||{};
 smashCamera.setStageTilt?.(camHint.tilt??tiltByWorld[location.world]??.19,camHint.scale??1.45);
 smashCamera.setStageYaw?.(camHint.yaw??0);
 // The layout's hand-authored blocks do not describe a built stage, so the camera is also given
 // the arena's own meshes as collision volumes (see world/camera_blocks.js).
 const arenaCameraVolumes=arenaCameraBlocks(activeWorldGroup,location.layout.bounds);
 smashCamera.setStageBounds?.(location.layout.bounds,arenaCameraVolumes.length?[...(location.layout.blocks||[]),...arenaCameraVolumes]:location.layout.blocks);
 floor.visible=false;platform.visible=false;mapDecor.visible=false;
 // Sky presets can leave scene.background as a Texture. Preserve the texture and tint only
 // a real Color; calling setHex() on a texture made every world location fail to load.
 if (scene.background?.isColor) scene.background.setHex(location.theme.sky);
 scene.fog.color.setHex(location.theme.fog);
 scene.fog.density=location.theme.density;
 sun.color.setHex(location.theme.light);
 // Open worlds are lit by a softer key than the small arenas: their materials are large
 // flat surfaces, and a 3.0 sun blew pale stone out to pure white.
 const lighting=STAGE_LIGHTING[location.world]||STAGE_LIGHTING.dbz;
 const lamp=location.interior?lighting.interior:lighting.exterior;
 scene.fog.density=location.theme.density*(lamp.fogScale||1);
 sun.intensity=lamp.sun;
 // Interior rooms have ceilings, so a shadow-casting key sun only lights the roof: indoors
 // the key is a non-shadowing fill and the room's own emissive strips carry the mood.
 sun.castShadow=lamp.shadow;
 rim.intensity=lamp.rim;
 rim.color.setHex(lamp.rimColor);
 hemisphere.color.setHex(lamp.hemiSky);
 hemisphere.groundColor.setHex(lamp.hemiGround);
 hemisphere.intensity=lamp.hemi;
 renderer.toneMappingExposure=lamp.exposure;
 // Interior stages are lit from above; open worlds get a low sun for long shadows.
 sun.position.set(...lamp.sunPos);
 rim.position.set(...lamp.rimPos);
 window.__browserSmashWorld={world:location.world,worldLabel:location.worldLabel,location:key,label:location.label,ground:location.layout.ground,bounds:location.layout.bounds,roamBounds:location.layout.roamBounds,roamFloor:location.layout.roamFloor,spawns:location.layout.spawns,exits:location.exits||[],blocks:location.layout.blocks.length,parts:activeWorldGroup?.userData.parts||0,drawCalls:activeWorldGroup?.userData.drawCalls||0};
 smashCamera.snap?.();
}
const finalValleyArena=createFinalValley(THREE);scene.add(finalValleyArena.group);finalValleyArena.group.visible=false;
const mapSelect=$('#mapSelect');const menuMapSelect=$('#menuMapSelect');
// Add the five reference worlds and every battle location to both map pickers.
if(mapSelect&&menuMapSelect)menuMapSelect.replaceChildren(...[...mapSelect.children].map(option=>option.cloneNode(true)));
for(const world of worldGroups()){
 for(const select of [mapSelect,menuMapSelect]){
  if(!select)continue;
  const heading=document.createElement('option');heading.disabled=true;heading.textContent='◆ '+world.label.toUpperCase()+' — '+world.subtitle.toUpperCase();select.appendChild(heading);
  for(const location of world.locations){
   const option=document.createElement('option');option.value=location.key;option.textContent=world.label+' · '+location.label;select.appendChild(option);
  }
 }
}
// The launch roster has 38 fighters, including the three recovered promotions (Wolverine,
// Geralt of Rivia and Doom Slayer); the rest remain in dlcRoster.
function populateRoster(select, selected){if(!select)return;select.replaceChildren();for(const [name] of roster){const option=document.createElement('option');option.value=name;option.textContent=name;select.appendChild(option);}select.value=roster.some(([name])=>name===selected)?selected:roster[0][0];}

const mapThemes={valley:{label:'VALLEY OF ECHOES · ANCIENT GATE',sky:0x111b30,fog:0x253448,floor:0x26313b,platform:0x343a42,ringA:0x287b9e,ringB:0x8e613e,light:0xffd2a1,sun:0xffb66f,density:.012},deathstar:{label:'DEATH STAR · BRIEFING ROOM & THRONE ROOM',sky:0x070b14,fog:0x202b3a,floor:0x424954,platform:0x262d38,ringA:0x78cfff,ringB:0xff453b,light:0xc8d9ff,sun:0x8799bb,density:.004},finalvalley:{label:'FINAL VALLEY · HASHIRAMA & MADARA · SHINOBI CLIFFS',sky:0x2c4460,fog:0xc08a5e,floor:0x5d6552,platform:0x4e5445,ringA:0x9fb4a6,ringB:0xb98a63,light:0xffc389,sun:0xff8f45,density:.006},tournament:{label:'DBZ WORLD TOURNAMENT · MARTIAL ARTS RING',sky:0x4a7596,fog:0x9ab5c5,floor:0xb7a17b,platform:0xd9d0b8,ringA:0x35c9ff,ringB:0xffb44f,light:0xffedc2,sun:0xffd08b,density:.003},starktower:{label:'AVENGERS HELICARRIER · NYC SKYDECK / STARK PENTHOUSE',sky:0x101a35,fog:0x303d61,floor:0x343947,platform:0x202735,ringA:0x35eaff,ringB:0xff563c,light:0x9dd8ff,sun:0xffa16c,density:.005},asgard:{label:'ASGARD · GOLDEN CITY & ROYAL PALACE',sky:0x7fa3c6,fog:0x8fa3b4,floor:0x8a8578,platform:0x5f6158,ringA:0x58d8ef,ringB:0xf4c65e,light:0xffe2b3,sun:0xffd6a1,density:.0055},hogwarts:{label:'HOGWARTS · THE GREAT HALL',sky:0x171a2d,fog:0x41414b,floor:0x3c3e43,platform:0x292b31,ringA:0xe3c477,ringB:0x9f252e,light:0xffd59b,sun:0xd5c4a1,density:.005}};
// The five reference worlds (Dragon Ball Z tournament island, Asgard, Death Star, Hogwarts,
// Konoha) register every one of their battle locations as a normal map, so map selection,
// lighting, HUD labels and match flow all keep using the existing map plumbing.
for(const location of WORLD_LOCATIONS){mapThemes[location.id]={label:location.worldLabel.toUpperCase()+' · '+location.label.toUpperCase(),sky:location.theme.sky,fog:location.theme.fog,floor:location.theme.floor,platform:location.theme.platform,ringA:location.theme.ringA,ringB:location.theme.ringB,light:location.theme.light,sun:location.theme.sun,density:location.theme.density,world:location.world};}
// Five maps also ship as authored Blender arenas (public/assets/arenas/*.glb). They are the
// same designs the procedural build inside applyMap() reproduces, so exactly one of the two
// is shown at a time: the authored GLB once it has loaded, and the procedural set dressing
// until then - or permanently if the file is missing, so a match never depends on it.
const authoredArenaKeys=new Set(['asgard','starktower','deathstar','hogwarts','tournament']);
let authoredArenaRequest=0;
function authoredArenaEnabled(){return window.__browserSmashAuthoredArenas!==false;}
async function syncAuthoredArena(key){
 const request=++authoredArenaRequest;
 if(!authoredArenaEnabled()){await setCinematicArena(null,scene);if(request!==authoredArenaRequest)return;mapDecor.visible=!worldLocation(key);return;}
 let group=null;
 if(authoredArenaKeys.has(key))group=await setCinematicArena(key,scene);
 else await setCinematicArena(null,scene);
 // A newer map choice arrived while this one was streaming; drop this result.
 if(request!==authoredArenaRequest)return;
 mapDecor.visible=!group&&!worldLocation(key);
 // An authored arena is built geometry, not layout data, so it never reached applyWorldStage():
 // measured at spawn with the palace map, the camera had stage tilt 0, scale 1 and ZERO collision
 // blocks, which is why the shot opened against a palace wall with nothing to shorten it. Give the
 // authored path the same treatment the world stages already get.
 if(group){
  const layoutHere=(window.__browserSmashLayout?.()||{});
  const arenaVolumes=arenaCameraBlocks(group,layoutHere.bounds||null);
  smashCamera.setStageTilt?.(.16,1.0);
  smashCamera.setStageYaw?.(ARENA_LAYOUTS[key]?.camera?.yaw??0);
  smashCamera.setStageBounds?.(layoutHere.bounds||null,arenaVolumes.length?[...(layoutHere.blocks||[]),...arenaVolumes]:null);
  window.__browserSmashCameraColliders={meshVolumes:arenaVolumes.length,layoutBlocks:(layoutHere.blocks||[]).length,
    used:smashCamera.collisionBlocks?.length??0,budget:arenaCameraBlocks.budget||null};
  // The opening bearing was chosen against the 14 hand-authored layout blocks, so it never saw the
  // palace column that only exists in the authored mesh - which is exactly the solid that split the
  // spawn frame in two. Re-pick the bearing now that the real volumes are known.
  smashCamera.snap?.();
 }
 window.__browserSmashAssets.authoredArena={key:group?key:null,status:group?'loaded':'procedural'};
}
function applyFloorFootprint(){const key=mapSelect?.value||'valley';const footprint=key==='starktower'?.17:key==='deathstar'?.18:1;floor.scale.set(footprint,1,footprint);}
function applyMap(key){activeLayout=null;window.__browserSmashApplySky?.(scene,key);const t=mapThemes[key]||mapThemes.valley;const worldHere=worldLocation(key);applyFloorFootprint();scene.environment=skyEnvironment(renderer,worldHere?.theme?.skyPreset||key);for(const fighter of (window.fighters||[])){const stageScale=key==='finalvalley'?1.16:key==='starktower'?.76:key==='deathstar'?.84:key==='asgard'?.96:key==='hogwarts'?.93:1;const scale=(fighter.model.userData.characterScale||1)*stageScale;fighter.model.userData.visualScale=scale;fighter.model.scale.setScalar(scale);}try{cinematicEnvironment.userData.setMap?.(key);}catch(error){window.__browserSmashArenaStageError=String(error?.message||error);console.warn('[arena:'+key+'] mount stage failed',error);}try{if(key!=='asgard'){const stone=tuneArchitecturalStone(cinematicEnvironment,key);window.__browserSmashStoneTuning=stone;}}catch(error){window.__browserSmashStoneError=String(error?.message||error);console.warn('[arena:'+key+'] stone pass failed',error);}window.__browserSmashSkyColour=t.sky;if(scene.background?.setHex)scene.background.setHex(t.sky);scene.fog.color.setHex(t.fog);scene.fog.density=t.density;floor.material=arenaFloorMaterials[key]||grassMaterial;floor.material.needsUpdate=true;if((key==='hogwarts'||key==='deathstar')&&floor.material){const tonedKey=key+'#floorToned';if(!arenaFloorMaterials[tonedKey]){const base=floor.material;const toned=base.clone();toned.name=(base.name||key)+'-toned';toned.color?.multiplyScalar(key==='hogwarts'?0.55:0.78);arenaFloorMaterials[tonedKey]=toned;}floor.material=arenaFloorMaterials[tonedKey];}explorationWorld.visible=key==='valley';horizon.visible=key==='valley';finalValleyArena.group.visible=key==='finalvalley';platform.material.color.setHex(t.platform);const interiorStage=key==='hogwarts'||key==='deathstar'||key==='starktower'||Boolean(worldHere?.interior);sun.color.setHex(t.light);sun.intensity=interiorStage?2.05:(key==='finalvalley'?3.1:2.75);rim.intensity=interiorStage?1.2:(key==='finalvalley'?1.6:1.75);rim.color.setHex(key==='finalvalley'?0x6f92b8:0x218cff);hemisphere.color.setHex(key==='finalvalley'?0x9fb8cf:0x9ecfff);hemisphere.groundColor.setHex(key==='finalvalley'?0x3a3529:0x191421);hemisphere.intensity=interiorStage?0.78:(key==='finalvalley'?0.86:0.72);renderer.toneMappingExposure=interiorStage?1.0:(key==='finalvalley'?1.06:key==='asgard'?.96:0.98);if(key==='deathstar'||key==='starktower'){renderer.toneMappingExposure=1.06;}if(key==='asgard'){sun.intensity=2.3;rim.intensity=1.15;hemisphere.intensity=0.62;renderer.toneMappingExposure=0.8;}if(key==='finalvalley'){sun.position.set(27,36,-54);rim.position.set(25,24,-82);}else{sun.position.set(-18,7,-20);rim.position.set(10,7,-12);}while(mapDecor.children.length){const o=mapDecor.children[mapDecor.children.length-1];mapDecor.remove(o);o.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){if(Array.isArray(n.material))n.material.forEach(x=>x.dispose());else n.material.dispose();}});}const addProp=(geometry,material,x,y,z,sx=1,sy=1,sz=1)=>{const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;mapDecor.add(o);return o;};
 // Large worlds bring their own geometry; the small-map procedural dressing below is skipped.
 if(!worldHere){
  if(key==='finalvalley'){
    const skyCanvas=document.createElement('canvas');skyCanvas.width=1024;skyCanvas.height=512;
    const skyCtx=skyCanvas.getContext('2d');
    const skyGrad=skyCtx.createLinearGradient(0,0,0,512);
    skyGrad.addColorStop(0,'#18253e');skyGrad.addColorStop(.34,'#536d83');skyGrad.addColorStop(.60,'#cc9a8a');skyGrad.addColorStop(.78,'#f5bd91');skyGrad.addColorStop(1,'#6f7780');
    skyCtx.fillStyle=skyGrad;skyCtx.fillRect(0,0,1024,512);
    for(let i=0;i<520;i++){
      const y=50+Math.random()*370,x=Math.random()*1024,w=28+Math.random()*180;
      skyCtx.strokeStyle='rgba(255,221,197,'+(.025+Math.random()*.075)+')';skyCtx.lineWidth=.7+Math.random()*4;
      skyCtx.beginPath();skyCtx.moveTo(x,y);skyCtx.lineTo(x+w,y+(Math.random()-.5)*15);skyCtx.stroke();
    }
    const skyTexture=new THREE.CanvasTexture(skyCanvas);skyTexture.colorSpace=THREE.SRGBColorSpace;skyTexture.wrapS=THREE.RepeatWrapping;skyTexture.wrapT=THREE.ClampToEdgeWrapping;
    const skyDome=addProp(new THREE.SphereGeometry(280,48,28),new THREE.MeshBasicMaterial({map:skyTexture,side:THREE.BackSide,depthWrite:false,fog:false}),0,0,0);
    skyDome.renderOrder=-20;skyDome.frustumCulled=false;skyDome.castShadow=false;skyDome.receiveShadow=false;
    const sunDisk=addProp(new THREE.SphereGeometry(6.3,32,20),new THREE.MeshBasicMaterial({color:0xffdda6,fog:false}),27,28,-124);
    sunDisk.castShadow=false;sunDisk.receiveShadow=false;
    const sunHalo=addProp(new THREE.SphereGeometry(10.5,32,20),new THREE.MeshBasicMaterial({color:0xffa76c,transparent:true,opacity:.18,depthWrite:false,fog:false}),27,28,-124);
    sunHalo.castShadow=false;sunHalo.receiveShadow=false;sunHalo.renderOrder=-10;
  }
  // The continuous high-detail grass material is the terrain surface; keep map landmarks on it without a flat low-poly patch.\n  // Each region gets an identifiable landmark rather than a circular fighting pad.
  if(key==='valley'){addProp(new THREE.TorusGeometry(4,.3,10,48),new THREE.MeshStandardMaterial({color:0x6beaff,emissive:0x126f9a,emissiveIntensity:1.4,metalness:.5,roughness:.3}),-35,8,-32,1,1,1).rotation.x=Math.PI/2;addProp(new THREE.BoxGeometry(9,.8,1),mat(0x3a4a58,.5,.4),-35,12,-32);}
  if(key!=='finalvalley'){for(let i=0;i<42;i++){const x=(Math.random()-.5)*230,z=-85+Math.random()*210,h=2+Math.random()*12;addProp(new THREE.DodecahedronGeometry(1,2),mat(0x384858,.15,.9),x,h*.35,z,2+Math.random()*4,h*.6,2+Math.random()*4);}}
 // Large landmark clusters give each region a recognizable destination beyond the combat start.
 const landmarkMat=mat(0x536477,.38,.48);
 const glowMat=new THREE.MeshStandardMaterial({color:t.ringA,emissive:t.ringA,emissiveIntensity:1.8,metalness:.3,roughness:.28});
 const landmark=(x,z,scale=1)=>{const base=addProp(new THREE.DodecahedronGeometry(1,2),landmarkMat,x,.25*scale,z,6*scale,.7*scale,5*scale);base.rotation.y=.2;for(let side=-1;side<=1;side+=2){const pillar=addProp(new THREE.BoxGeometry(1.3*scale,9*scale,1.5*scale),landmarkMat,x+side*4*scale,4.5*scale,z);pillar.rotation.z=side*.06;const seam=addProp(new THREE.BoxGeometry(.12*scale,7*scale,.15*scale),glowMat,x+side*4*scale,4.6*scale,z+.82*scale);seam.rotation.z=side*.06;}const arch=addProp(new THREE.BoxGeometry(10*scale,1.2*scale,1.5*scale),landmarkMat,x,9*scale,z);const beacon=addProp(new THREE.OctahedronGeometry(1.1*scale,2),glowMat,x,6*scale,z+.5*scale);beacon.rotation.y=.6;};
 if(key==='valley'){landmark(-92,-72,1.6);landmark(104,56,1.2);for(let i=0;i<18;i++){const x=-125+i*14,z=88+Math.sin(i*.4)*9;addProp(new THREE.CylinderGeometry(.35,.6,5+Math.random()*9,7),landmarkMat,x,3,z);}}
  // Iconic-world silhouettes are built from procedural geometry so each arena works offline without downloading copyrighted art.
 if(key==='deathstar'){
   // Exterior station silhouette.
   const stationMat=mat(0x68717d,.72,.42),darkPanel=mat(0x252d39,.55,.55),laserMat=new THREE.MeshBasicMaterial({color:0x79dfff});
   const sphere=addProp(new THREE.SphereGeometry(27,40,28),stationMat,0,29,-105,1,1,1);sphere.rotation.z=.18;
   addProp(new THREE.SphereGeometry(7,24,18),darkPanel,10,38,-80,1,1,1);
   for(let i=0;i<14;i++){const a=i*Math.PI*2/14;const rib=addProp(new THREE.BoxGeometry(1.4,25,.7),darkPanel,Math.cos(a)*24,29+Math.sin(a)*24,-105);rib.rotation.z=-a;}
   addProp(new THREE.TorusGeometry(5.7,.42,8,40),laserMat,10,38,-72).rotation.x=Math.PI/2;
   for(let i=0;i<8;i++){const col=addProp(new THREE.BoxGeometry(4,12,4),darkPanel,-28+i*8,6,-38);addProp(new THREE.BoxGeometry(4.1,.2,4.1),laserMat,col.position.x,12.2,-38);}
   // Interior one: Imperial briefing room, circular conference table and luminous wall panels.
   const panelGlow=new THREE.MeshBasicMaterial({color:0x9aaebf,transparent:true,opacity:.58});
   const briefingX=-38,briefingZ=-31;
   addProp(new THREE.BoxGeometry(35,.22,34),darkPanel,briefingX,-.13,briefingZ);
   for(let i=0;i<13;i++){
     const a=(i/13)*Math.PI*2,x=briefingX+Math.cos(a)*15,z=briefingZ+Math.sin(a)*15;
     const panel=addProp(new THREE.BoxGeometry(3.6,7.5,.35),darkPanel,x,3.8,z);panel.rotation.y=-a;
     addProp(new THREE.BoxGeometry(2.5,4.5,.06),panelGlow,x,4.1,z-Math.cos(a)*.22);
   }
   addProp(new THREE.CylinderGeometry(7.5,7.5,.35,48),stationMat,briefingX,.28,briefingZ);
   addProp(new THREE.CylinderGeometry(6.9,6.9,.15,48),darkPanel,briefingX,.52,briefingZ);
   addProp(new THREE.SphereGeometry(1.3,20,16),laserMat,briefingX,.9,briefingZ);
   for(let i=0;i<9;i++){
     const a=i*Math.PI*2/9,x=briefingX+Math.cos(a)*9,z=briefingZ+Math.sin(a)*9;
     addProp(new THREE.CylinderGeometry(.65,.8,1.6,10),darkPanel,x,.7,z);
     addProp(new THREE.BoxGeometry(1.2,1.2,.25),darkPanel,x,1.4,z-Math.sin(a)*.3);
   }
   // Interior two: Emperor's throne chamber with deep-space viewport and raised black throne.
   const throneX=39,throneZ=-32,starSteel=mat(0x7f90a5,.82,.28);
   addProp(new THREE.BoxGeometry(37,.22,38),darkPanel,throneX,-.13,throneZ);
   addProp(new THREE.BoxGeometry(29,18,.25),new THREE.MeshBasicMaterial({color:0x080d1a}),throneX,9,-51.1);
   for(let i=0;i<65;i++){
     const x=throneX+(Math.random()-.5)*26,y=2+Math.random()*14;
     addProp(new THREE.SphereGeometry(.04+Math.random()*.035,5,4),new THREE.MeshBasicMaterial({color:0xbed8ff}),x,y,-50.8);
   }
   addProp(new THREE.TorusGeometry(9,.24,8,72),starSteel,throneX,9,-50.5);
   addProp(new THREE.BoxGeometry(14,.7,8),stationMat,throneX,.32,-39);
   addProp(new THREE.BoxGeometry(5.6,6.8,.9),stationMat,throneX,4,-42.1);
   addProp(new THREE.BoxGeometry(7,.65,1.15),darkPanel,throneX,1.6,-41);
   for(const x of [throneX-3.7,throneX+3.7]){
     addProp(new THREE.BoxGeometry(1.0,2.8,1.1),stationMat,x,1.5,-39.4);
     addProp(new THREE.BoxGeometry(1.4,.22,1.15),starSteel,x,2.9,-39.4);
   }
  // Walkable connector between the Imperial briefing room and the Emperor's throne chamber.
  const corridor=mat(0x333d4b,.58,.48),wallPanel=mat(0x525e6d,.72,.32),doorGlow=new THREE.MeshBasicMaterial({color:0x8ecbdf});
  addProp(new THREE.BoxGeometry(40,.2,7),corridor,0,-.06,-31);
  for(let i=0;i<14;i++){const x=-19+i*2.9;addProp(new THREE.BoxGeometry(.15,.12,6.8),wallPanel,x,.09,-31);}
  for(const z of [-48.1,-14.0])addProp(new THREE.BoxGeometry(35,10,.3),wallPanel,-38,5,z);
  for(const z of [-42.3,-20.0])addProp(new THREE.BoxGeometry(.3,10,11.6),wallPanel,-20.3,5,z);
  addProp(new THREE.BoxGeometry(.3,10,34),wallPanel,-55.7,5,-31);
  for(let i=0;i<9;i++){const x=-53+i*3.75;addProp(new THREE.BoxGeometry(2.1,4.8,.08),darkPanel,x,4,-47.88);addProp(new THREE.BoxGeometry(1.5,.08,.08),doorGlow,x,6.5,-47.82);}
  for(const z of [-42.0,-20.0])addProp(new THREE.BoxGeometry(.3,10,9.4),wallPanel,20.4,5,z);
  addProp(new THREE.BoxGeometry(.3,10,38),wallPanel,57.6,5,-32);
  for(const x of [21.7,56.3])addProp(new THREE.BoxGeometry(3.1,10,.25),wallPanel,x,5,-50.8);
  for(let i=0;i<10;i++){const x=23+i*3.5;addProp(new THREE.BoxGeometry(1.8,4.6,.08),darkPanel,x,4,-50.7);addProp(new THREE.BoxGeometry(1.35,.08,.08),doorGlow,x,6.1,-50.63);}
  } else if(key==='tournament'){
   // Tenkaichi Budokai-inspired Papaya Island tournament grounds: tiled ring, temple gate, spectators and sea.
   const limestone=mat(0xe3dac6,.08,.78),shadowStone=mat(0x776e62,.15,.82),red=mat(0x8e3028,.2,.56),redLight=mat(0xb94735,.15,.5);
   const jade=mat(0x395a45,.52,.3),jadeLight=mat(0x588264,.4,.32),wood=mat(0x573927,.06,.88),gold=mat(0xd8b75c,.7,.25);
   const crowdMats=[mat(0x3d7290,.03,.9),mat(0xb14c3b,.03,.9),mat(0xe0bd70,.03,.9),mat(0x466b49,.03,.9),mat(0x8c6d9d,.03,.9),mat(0xd8d2bd,.03,.9)];
   const skinMats=[mat(0xd7aa8c,.02,.94),mat(0x8c624a,.02,.94),mat(0xe6c6a8,.02,.94),mat(0xb98b68,.02,.94)];
   addProp(new THREE.BoxGeometry(39,.72,34),shadowStone,0,-.36,-12);
   addProp(new THREE.BoxGeometry(37.5,.1,32.5),limestone,0,.04,-12);
   addProp(new THREE.BoxGeometry(35.8,.04,30.8),red,0,.11,-12);
   addProp(new THREE.BoxGeometry(34.9,.04,29.9),limestone,0,.15,-12);
   const grout=mat(0xafa18c,.03,.95);
   for(let x=-16;x<=16;x+=3.5)addProp(new THREE.BoxGeometry(.035,.012,28.4),grout,x,.176,-12);
   for(let z=-26;z<=2;z+=3.5)addProp(new THREE.BoxGeometry(33.2,.012,.035),grout,0,.176,z);
   for(const [x,z,w,h] of [[0,-26,32,.16],[0,2,32,.16],[-16,-12,.16,27.9],[16,-12,.16,27.9]])addProp(new THREE.BoxGeometry(w,.035,h),gold,x,.19,z);
   for(const x of [-19,19])for(const z of [-29,5]){
     addProp(new THREE.BoxGeometry(1.8,.65,1.8),shadowStone,x,.32,z);
     addProp(new THREE.BoxGeometry(.72,4.5,.72),red,x,2.55,z);
     addProp(new THREE.BoxGeometry(1.1,.25,1.1),gold,x,4.92,z);
     const finial=addProp(new THREE.ConeGeometry(.48,.8,4),redLight,x,5.45,z);finial.rotation.y=Math.PI/4;
   }
   for(const x of [-15,-7.5,0,7.5,15]){
     addProp(new THREE.BoxGeometry(.78,7.5,.82),red,x,3.75,-43);
     addProp(new THREE.BoxGeometry(1,.34,1.02),gold,x,7.5,-43);
     addProp(new THREE.BoxGeometry(1,.38,1),wood,x,.36,-43);
     addProp(new THREE.BoxGeometry(.08,5.8,.84),redLight,x,3.8,-42.56);
   }
   addProp(new THREE.BoxGeometry(34,.9,5.3),wood,0,8,-43);
   addProp(new THREE.BoxGeometry(39,.42,7.2),red,0,8.78,-43);
   addProp(new THREE.BoxGeometry(36,.5,6.1),jade,0,9.14,-43);
   addProp(new THREE.BoxGeometry(31,.18,4.9),jadeLight,0,9.48,-43);
   for(const side of [-1,1]){const eave=addProp(new THREE.BoxGeometry(10,.28,1.4),jadeLight,side*13,8.7,-43);eave.rotation.z=side*.14;const tip=addProp(new THREE.ConeGeometry(.55,1.4,4),gold,side*19.4,8.96,-43);tip.rotation.z=side*Math.PI/2;}
   const plaqueCanvas=document.createElement('canvas');plaqueCanvas.width=1024;plaqueCanvas.height=256;
   const plaqueCtx=plaqueCanvas.getContext('2d');plaqueCtx.fillStyle='#233a2e';plaqueCtx.fillRect(0,0,1024,256);plaqueCtx.strokeStyle='#d7b963';plaqueCtx.lineWidth=12;plaqueCtx.strokeRect(16,16,992,224);plaqueCtx.textAlign='center';plaqueCtx.textBaseline='middle';plaqueCtx.fillStyle='#f4dfa4';plaqueCtx.font='bold 104px serif';plaqueCtx.fillText('天下一武道会',512,94);plaqueCtx.font='bold 36px sans-serif';plaqueCtx.fillText('WORLD MARTIAL ARTS TOURNAMENT',512,188);
   const plaqueTexture=new THREE.CanvasTexture(plaqueCanvas);plaqueTexture.colorSpace=THREE.SRGBColorSpace;
   addProp(new THREE.BoxGeometry(10,3,.18),wood,0,3.2,-47.4);addProp(new THREE.PlaneGeometry(9.4,2.45),new THREE.MeshBasicMaterial({map:plaqueTexture}),0,3.2,-47.29);
   for(const side of [-1,1])for(let row=0;row<4;row++){
     const x=side*(23+row*2.1),height=1.1+row*.66;
     addProp(new THREE.BoxGeometry(2.25,height,43),shadowStone,x,height/2-1,-17);
     addProp(new THREE.BoxGeometry(2.35,.2,41),wood,x,height-.91,-17);
     for(let seat=0;seat<19;seat++){const z=-38+seat*2.3,y=height-.6;addProp(new THREE.BoxGeometry(.35,.48,.3),crowdMats[(seat+row+(side>0?2:0))%crowdMats.length],x,y,z);addProp(new THREE.SphereGeometry(.18,8,6),skinMats[(seat+row)%skinMats.length],x,y+.35,z);}
   }
   for(const side of [-1,1]){
     const x=side*51;addProp(new THREE.BoxGeometry(18,9,17),limestone,x,4.4,-43);addProp(new THREE.BoxGeometry(19,.6,18),red,x,9.05,-43);addProp(new THREE.ConeGeometry(9.5,5.5,4),jade,x,12,-43,1,.45,1);
     for(const wx of [-5,0,5])addProp(new THREE.BoxGeometry(1.8,3,.15),jadeLight,x+wx,4.2,-34.4);
   }
   for(let i=0;i<19;i++){const x=-158+i*17.5,z=-107-(i%4)*15,h=23+((i*13)%38),w=14+((i*7)%13);addProp(new THREE.ConeGeometry(w,h,8),mat(i%2?0x486b4f:0x70886a,.02,.98),x,h*.43,z,1,1.15,1);}
   addProp(new THREE.BoxGeometry(420,1,180),mat(0x428ca9,.18,.52),0,-4,-165);
   const blimp=addProp(new THREE.SphereGeometry(1,24,16),mat(0xddd5bf,.1,.7),31,43,-115,14,3.1,4.6);blimp.rotation.z=.04;addProp(new THREE.BoxGeometry(10,1.8,3.2),wood,31,40,-115);
 } else if(key==='starktower'){
   // Elevated Stark Tower rooftop: helipad, connected penthouse, open living room, visible glass elevator.
   const glass=mat(0x172d49,.78,.2),steel=mat(0x74849a,.76,.25),darkSteel=mat(0x202a39,.6,.38);
   const arc=new THREE.MeshBasicMaterial({color:0x36dfff});
   const heliPaint=new THREE.MeshBasicMaterial({color:0xe8f1fa});
   const windowGlass=new THREE.MeshPhysicalMaterial({color:0x8bc9ed,metalness:.18,roughness:.12,transparent:true,opacity:.19,side:THREE.DoubleSide,depthWrite:false});
   const wood=mat(0x5c4637,.08,.75),sofa=mat(0x3c485a,.08,.84),cushion=mat(0x8794a1,.03,.9);
   const warmLight=new THREE.MeshStandardMaterial({color:0xffd3a0,emissive:0xff8b48,emissiveIntensity:1.05});
   const plant=mat(0x2e6349,.02,.9),rug=mat(0x253a4d,.04,.98);
   // Continuous rooftop keeps the run from the pad to the penthouse fully walkable.
   addProp(new THREE.BoxGeometry(75,.55,58),darkSteel,0,-.29,-24);
   addProp(new THREE.BoxGeometry(73,.07,56),glass,0,.015,-24);
   // Helipad ring and H markings.
   addProp(new THREE.CylinderGeometry(10.8,10.8,.055,64),mat(0x111a28,.35,.6),-11,.075,-24);
   const padRing=addProp(new THREE.TorusGeometry(9.3,.13,10,64),heliPaint,-11,.12,-24);padRing.rotation.x=Math.PI/2;
   addProp(new THREE.BoxGeometry(.62,.035,5.2),heliPaint,-11,.12,-24);
   addProp(new THREE.BoxGeometry(4.2,.035,.62),heliPaint,-11,.12,-24);
   addProp(new THREE.BoxGeometry(.62,.035,2.5),heliPaint,-12.8,.12,-24);
   addProp(new THREE.BoxGeometry(.62,.035,2.5),heliPaint,-9.2,.12,-24);
   for(let i=0;i<32;i++){const a=i*Math.PI*2/32;addProp(new THREE.SphereGeometry(.13,8,6),i%4===0?warmLight:arc,-11+Math.cos(a)*11.1,.14,-24+Math.sin(a)*11.1);}
   for(let z=-49;z<=1;z+=10){addProp(new THREE.BoxGeometry(.15,.7,.15),steel,-36,.32,z);addProp(new THREE.BoxGeometry(.15,.7,.15),steel,36,.32,z);}
   // Low glass skybridge to the penthouse, set into the same roof plane.
   addProp(new THREE.BoxGeometry(20,.22,5.8),glass,10,.04,-24);
   for(const side of [-1,1])addProp(new THREE.BoxGeometry(20,.55,.18),steel,10,.36,-24+side*2.8);
   for(const x of [2,8,14,20])addProp(new THREE.BoxGeometry(.14,.04,5.3),arc,x,.18,-24);
   // Penthouse glazing: roofless and with an open front entrance so players can move inside.
   addProp(new THREE.BoxGeometry(39,.4,36),darkSteel,35,-.19,-24);
   addProp(new THREE.BoxGeometry(37,.06,34),glass,35,.04,-24);
   addProp(new THREE.BoxGeometry(37,.85,.25),steel,35,.43,-41.65);
   addProp(new THREE.BoxGeometry(37,.28,.25),steel,35,13.5,-41.65);
   for(let i=0;i<=8;i++){const x=16.5+i*4.625;addProp(new THREE.BoxGeometry(.13,13,.25),steel,x,7,-41.65);}
   for(let i=0;i<8;i++)addProp(new THREE.BoxGeometry(4.45,12.3,.07),windowGlass,18.8+i*4.625,7,-41.55);
   addProp(new THREE.BoxGeometry(.22,12,33),windowGlass,53.9,7,-24);
   for(let z=-40;z<=-8;z+=8)addProp(new THREE.BoxGeometry(.25,13,.22),steel,53.9,7,z);
   addProp(new THREE.BoxGeometry(.25,13,36),steel,54.2,7,-24);
   // Famous glass elevator, visible from the roof/living room: shaft ribs and split door panels.
   for(const x of [15.8,20.2])for(const z of [-26.2,-21.8])addProp(new THREE.BoxGeometry(.18,9,.18),steel,x,4.5,z);
   addProp(new THREE.BoxGeometry(4.4,.18,.18),steel,18,9,-24);
   addProp(new THREE.BoxGeometry(4.4,.18,.18),steel,18,.18,-24);
   addProp(new THREE.BoxGeometry(.12,8.5,.12),arc,15.6,4.45,-24);
   addProp(new THREE.BoxGeometry(.12,8.5,.12),arc,20.4,4.45,-24);
   addProp(new THREE.BoxGeometry(4.15,8.5,.05),windowGlass,18,4.45,-26.2);
   addProp(new THREE.BoxGeometry(4.15,8.5,.05),windowGlass,18,4.45,-21.8);
   addProp(new THREE.BoxGeometry(1.35,7.2,.12),steel,17.2,4.1,-21.7);
   addProp(new THREE.BoxGeometry(1.35,7.2,.12),steel,18.8,4.1,-21.7);
   addProp(new THREE.BoxGeometry(2.8,.12,2.8),steel,18,.12,-24);
   addProp(new THREE.BoxGeometry(.35,1.7,.12),arc,20.65,1.7,-21.35);
   addProp(new THREE.BoxGeometry(.18,.62,.12),warmLight,20.65,1.85,-21.35);
   // Furnished living room with sectional sofa, coffee table, lounge chair, plant pots and bar.
   addProp(new THREE.BoxGeometry(13,.035,9),rug,33,.085,-31);
   addProp(new THREE.BoxGeometry(8.8,.6,1.35),sofa,32,.47,-28.7);
   addProp(new THREE.BoxGeometry(8.8,1.15,.42),sofa,32,1.12,-28.15);
   for(const x of [27.7,36.3])addProp(new THREE.BoxGeometry(.55,1.05,1.35),cushion,x,.78,-28.7);
   for(const x of [29.4,32,34.6])addProp(new THREE.BoxGeometry(2.35,.12,1.02),cushion,x,.8,-28.8);
   addProp(new THREE.BoxGeometry(5.2,.22,2.1),wood,32,.48,-33.5);
   addProp(new THREE.BoxGeometry(5.05,.08,1.95),steel,32,.63,-33.5);
   for(const x of [30,34])addProp(new THREE.CylinderGeometry(.07,.07,.45,10),steel,x,.23,-33.5);
   addProp(new THREE.BoxGeometry(2.35,.45,2.1),sofa,43,.43,-30);
   addProp(new THREE.BoxGeometry(2.35,.9,.28),sofa,43,.91,-29.1);
   addProp(new THREE.BoxGeometry(1.45,.48,1.15),wood,43,.42,-26.6);
   addProp(new THREE.CylinderGeometry(.08,.08,.38,10),steel,43,.2,-26.6);
   addProp(new THREE.BoxGeometry(9,.72,1.3),wood,44,.56,-14.5);
   addProp(new THREE.BoxGeometry(9.1,.1,1.4),steel,44,.96,-14.5);
   for(const x of [41,44,47]){addProp(new THREE.CylinderGeometry(.32,.34,.13,12),sofa,x,.5,-12.7);addProp(new THREE.CylinderGeometry(.06,.06,.5,10),steel,x,.24,-12.7);}
   for(const x of [41,44,47]){addProp(new THREE.CylinderGeometry(.055,.055,1.5,8),steel,x,12.7,-14.5);addProp(new THREE.SphereGeometry(.28,12,8),warmLight,x,11.9,-14.5);}
   for(const x of [22,49]){
     addProp(new THREE.CylinderGeometry(.56,.62,.65,12),wood,x,.33,-12.5);
     for(let leaf=0;leaf<5;leaf++){const leafMesh=addProp(new THREE.ConeGeometry(.18,1.8,6),plant,x+Math.sin(leaf*1.25)*.38,1.35,-12.5+Math.cos(leaf*1.25)*.38);leafMesh.rotation.z=Math.sin(leaf*1.25)*.3;}
   }
   // Airborne Helicarrier underside and turbine housings sit below the walkable skydeck.
   const carrierHullMat=mat(0x3f5267,.82,.3),carrierEdge=mat(0x90a5bb,.78,.24);
   addProp(new THREE.SphereGeometry(1,48,28),carrierHullMat,0,-4,-24,41,6.2,26);
   addProp(new THREE.BoxGeometry(70,.26,17),carrierEdge,0,-1.5,-24);
   addProp(new THREE.BoxGeometry(48,.16,4.4),arc,0,-1.31,-24);
   for(const side of [-1,1])for(const x of [-29,29]){addProp(new THREE.CylinderGeometry(3.1,3.6,4.8,24),darkSteel,side*36,-4.7,-24+x*.22);const rotor=addProp(new THREE.TorusGeometry(2.7,.24,10,32),arc,side*36,-2.3,-24+x*.22);rotor.rotation.x=Math.PI/2;}
   for(let i=0;i<22;i++){const x=-31+i*2.95;addProp(new THREE.BoxGeometry(.08,.035,10.5),i%3===0?warmLight:arc,x,-1.26,-24);}
   // Manhattan city canyon: layered skyscrapers and hundreds of warm/cool office window strips.
   for(let i=0;i<48;i++){
     const x=-108+i*4.55,z=-82-(i%6)*10,h=8+((i*17)%37),w=2.2+(i%4)*.72;
     addProp(new THREE.BoxGeometry(w,h,w),glass,x,h/2-2,z);
     for(let y=3;y<h-1;y+=3.1)for(const offset of [-.55,.55])addProp(new THREE.BoxGeometry(.1,.85,.045),i%3===0?warmLight:arc,x+offset*w*.45,y,z+w/2+.035);
     if(i%5===0)addProp(new THREE.ConeGeometry(.45,4,5),steel,x,h+1,z);
   }
   addProp(new THREE.BoxGeometry(6,42,5),glass,-2,19,-119);
   addProp(new THREE.ConeGeometry(1.1,13,6),steel,-2,46,-119);
   for(let row=0;row<5;row++)addProp(new THREE.BoxGeometry(6.1,.09,5.1),arc,-2,5+row*7,-119);
 } else if(key==='asgard'){
   // Civilian-level Asgard plaza and living city; enormous polished-gold palace rises behind it.
   const gold=mat(0xd7aa42,.78,.2),lightGold=mat(0xf3d77d,.84,.18),marble=mat(0xaaa59b,.32,.5),stone=mat(0x6d777d,.22,.64),roof=mat(0x81746b,.5,.42);
   const rainbow=new THREE.MeshStandardMaterial({color:0x4ddfff,emissive:0x1b8bff,emissiveIntensity:1.25,metalness:.4,roughness:.25});
   addProp(new THREE.BoxGeometry(24,.25,108),marble,0,-.18,-36);
   addProp(new THREE.BoxGeometry(116,.2,84),stone,0,-.26,5);
   // Broad avenue and foreground plaza populated with small Norse-style homes and workshops.
   for(const side of [-1,1])for(let i=0;i<7;i++){
     const x=side*(18+(i%3)*7),z=26-i*10,h=6+(i%4)*1.5,w=7+(i%2)*2;
     addProp(new THREE.BoxGeometry(w,h,w*.9),i%2?marble:roof,x,h*.5,z);
     addProp(new THREE.ConeGeometry(w*.75,3.8,6),gold,x,h+1.8,z);
     addProp(new THREE.BoxGeometry(w*.2,3.6,.18),lightGold,x,h*.42,z+w*.46);
     addProp(new THREE.BoxGeometry(1.4,2.3,.22),gold,x,.65,z+w*.47);
     for(let win=-1;win<=1;win+=2)addProp(new THREE.BoxGeometry(.65,.9,.1),rainbow,x+win*w*.23,h*.62,z+w*.47);
   }
   // Decorative streetlamps, fountain basins and stairs make the foreground read as a lived-in city.
   for(let i=0;i<9;i++){
     const z=28-i*10;
     addProp(new THREE.CylinderGeometry(.13,.22,5,8),gold,sideFix(i)*5,2.5,z);
     addProp(new THREE.SphereGeometry(.32,12,8),lightGold,sideFix(i)*5,5.2,z);
   }
   function sideFix(i){return i%2?1:-1;}
   addProp(new THREE.CylinderGeometry(3.5,4,.65,32),marble,-12,.2,3);
   addProp(new THREE.CylinderGeometry(2.6,2.8,.35,32),gold,-12,.65,3);
   addProp(new THREE.SphereGeometry(1.0,20,16),rainbow,-12,1.55,3);
   // The Bifrost is a road through the settlement to the distant royal district.
   addProp(new THREE.BoxGeometry(10,.22,88),rainbow,0,.035,-48);
   for(let i=0;i<10;i++){
     const z= -91+i*9.5;
     for(let side of [-1,1]){
       addProp(new THREE.CylinderGeometry(.75,1.2,8,10),marble,side*8,4,z);
       addProp(new THREE.CylinderGeometry(1.2,1.0,.9,12),gold,side*8,8.4,z);
       addProp(new THREE.SphereGeometry(.25,10,8),lightGold,side*8,9.2,z);
     }
   }
   // Huge golden palace with repeated wings, domes, columns, and dozens of needle spires.
   addProp(new THREE.BoxGeometry(64,5,27),gold,0,8.5,-108);
   addProp(new THREE.BoxGeometry(50,4,23),lightGold,0,13,-107);
   addProp(new THREE.BoxGeometry(36,4,19),gold,0,17,-106);
   addProp(new THREE.CylinderGeometry(8,11,3,18),lightGold,0,20,-105);
   addProp(new THREE.SphereGeometry(7,24,16),gold,0,23,-105,1,.55,1);
   for(const side of [-1,1])for(let i=0;i<9;i++){
     const x=side*(13+i*4.4),h=18+(i%4)*7;
     addProp(new THREE.BoxGeometry(5,h,5),i%2?gold:lightGold,x,h/2+6,-107+(i%3)*3);
     addProp(new THREE.ConeGeometry(2.4,10+(i%3)*2,6),gold,x,h+11,-107+(i%3)*3);
     addProp(new THREE.SphereGeometry(.8,12,10),lightGold,x,h+16,-107+(i%3)*3);
   }
   for(let i=0;i<13;i++){
     const x=-30+i*5;
     addProp(new THREE.CylinderGeometry(.42,.56,12,10),lightGold,x,8,-93);
     addProp(new THREE.CylinderGeometry(.8,.7,1,10),gold,x,14,-93);
   }
   // Added monumental skyline: towering central keep, gold wings and needle-like palace spires.
   addProp(new THREE.BoxGeometry(154,10,52),gold,0,7,-153);
   addProp(new THREE.BoxGeometry(142,5,48),lightGold,0,14,-151);
   addProp(new THREE.BoxGeometry(126,11,43),gold,0,22,-150);
   addProp(new THREE.BoxGeometry(102,8,37),lightGold,0,31,-149);
   addProp(new THREE.BoxGeometry(82,14,31),gold,0,42,-148);
   addProp(new THREE.BoxGeometry(47,28,29),lightGold,0,61,-147);
   addProp(new THREE.CylinderGeometry(13,17,8,32),lightGold,0,90,-147);
   addProp(new THREE.SphereGeometry(15,36,24),gold,0,96,-147,1,.65,1);
   const centralNeedle=addProp(new THREE.ConeGeometry(3.3,31,8),lightGold,0,120,-147);centralNeedle.rotation.y=Math.PI/8;
   for(const side of [-1,1])for(let i=0;i<5;i++){
     const x=side*(25+i*16),z=-150+(i%2)*4,h=48+(i%3)*17,w=i===0?12:9;
     addProp(new THREE.BoxGeometry(w,h,w),i%2?gold:lightGold,x,h/2+10,z);
     addProp(new THREE.BoxGeometry(w+2.3,3,w+2.3),lightGold,x,h+10,z);
     addProp(new THREE.CylinderGeometry(w*.48,w*.68,5,24),gold,x,h+14,z);
     addProp(new THREE.SphereGeometry(w*.42,24,18),lightGold,x,h+17,z,1,.72,1);
     addProp(new THREE.ConeGeometry(w*.29,15+(i%2)*5,8),gold,x,h+30,z);
     for(let band=0;band<5;band++){const ring=addProp(new THREE.TorusGeometry(w*.58,.14,8,40),lightGold,x,14+band*(h/5.7),z);ring.rotation.x=Math.PI/2;}
     for(let win=0;win<5;win++){const y=18+win*(h/6.4);addProp(new THREE.BoxGeometry(w*.14,3.3,.1),rainbow,x,y,z+w*.51);addProp(new THREE.BoxGeometry(w*.14,3.3,.1),rainbow,x,y,z-w*.51);}
   }

} else if(key==='hogwarts'){
   // Hogwarts Great Hall: a long stone nave, pointed arches, four house tables, floating candles, banners.
   const stone=mat(0x55545a,.06,.96),stoneDark=mat(0x34353d,.08,.95),wood=mat(0x49352b,.04,.9),gold=mat(0xb49a60,.62,.28);
   const candle=new THREE.MeshStandardMaterial({color:0xffdca0,emissive:0xffb95c,emissiveIntensity:1.7});
   const windowMat=new THREE.MeshBasicMaterial({color:0x8ab6d4,transparent:true,opacity:.35,side:THREE.DoubleSide});
   const roomX=0,roomZ=-32;
   addProp(new THREE.BoxGeometry(48,.5,94),stoneDark,roomX,-.28,roomZ);
   // Long nave columns and peaked stone arch braces.
   for(let i=0;i<9;i++){
     const z=-77+i*11.3;
     for(const side of [-1,1]){
       const x=side*20;
       addProp(new THREE.BoxGeometry(2.2,14,2.2),stone,x,7,z);
       addProp(new THREE.CylinderGeometry(1.4,1.8,1,8),stone,x,14.5,z);
       const brace=addProp(new THREE.BoxGeometry(1.0,9,1.0),stone,x-side*4.8,15,z);
       brace.rotation.z=side*.66;
       const window=addProp(new THREE.BoxGeometry(.16,7.5,3.9),windowMat,x-side*.3,8.8,z+.2);
     }
     addProp(new THREE.BoxGeometry(38,1.0,1.7),stone,0,18.3,z);
   }
   // Four long house tables, benches, plates, and warm candlelight.
   for(const x of [-12,-4,4,12]){
     addProp(new THREE.BoxGeometry(3.2,.52,67),wood,x,.95,-32);
     addProp(new THREE.BoxGeometry(3.7,.18,67.5),gold,x,1.28,-32);
     for(let z=-61;z<=-3;z+=8){
       for(const side of [-1,1]){
         addProp(new THREE.BoxGeometry(1.0,.75,3.6),wood,x+side*2.6,.38,z);
         addProp(new THREE.CylinderGeometry(.15,.15,.045,12),gold,x+side*.6,1.42,z);
       }
     }
   }
   // Teacher dais and raised chair at the far end.
   addProp(new THREE.BoxGeometry(29,.5,8),stone,0,.1,-78);
   for(let i=0;i<7;i++){addProp(new THREE.BoxGeometry(3,.6,2.2),wood,-9+i*3,1,-79);addProp(new THREE.BoxGeometry(1.1,2.2,.3),gold,-9+i*3,2.2,-80);}
   // Starry enchanted ceiling dome and suspended candles, visible above the hall.
   addProp(new THREE.SphereGeometry(37,32,18,0,Math.PI*2,0,Math.PI*.5),new THREE.MeshBasicMaterial({color:0x101629,side:THREE.BackSide}),0,16,-32);
   for(let i=0;i<56;i++){
     const x=(Math.random()-.5)*34,z=-76+Math.random()*82,y=10+Math.random()*7;
     addProp(new THREE.CylinderGeometry(.045,.06,.55,8),gold,x,y,z);
     addProp(new THREE.SphereGeometry(.11,10,8),candle,x,y+.34,z);
     addProp(new THREE.SphereGeometry(.055,8,6),new THREE.MeshBasicMaterial({color:0xfff3c4}),x,y+.42,z);
   }
   // Four tall house banners down the nave.
   const bannerColors=[0x9e1f2e,0x1d426d,0xc2a438,0x2b623d];
   for(let i=0;i<4;i++){
     const x=-15+i*10,color=bannerColors[i];
     addProp(new THREE.BoxGeometry(3.1,8,.16),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}),x,11.5,-72+(i%2)*21);
     addProp(new THREE.ConeGeometry(.16,1.5,4),gold,x,7.2,-72+(i%2)*21);
   }
   // Hand-laid flagstone joints, warm sconces and extra candle pools for the Great Hall nave.
   const flagstoneLine=mat(0x76716a,.02,.98);
   for(let x=-22;x<=22;x+=4)addProp(new THREE.BoxGeometry(.045,.025,90),flagstoneLine,x,.006,-32);
   for(let z=-76;z<=10;z+=6)addProp(new THREE.BoxGeometry(46,.025,.045),flagstoneLine,0,.006,z);
   for(let i=0;i<7;i++){
     const z=-70+i*12;
     for(const side of [-1,1]){
       const x=side*18.2;
       addProp(new THREE.BoxGeometry(.6,1.7,.35),gold,x,4.8,z);
       addProp(new THREE.SphereGeometry(.2,10,8),candle,x,5.8,z);
       addProp(new THREE.SphereGeometry(.1,8,6),new THREE.MeshBasicMaterial({color:0xfff0ba}),x,6.0,z);
     }
   }

   // The enchanted ceiling appears to continue beyond the rafters as a starry night sky.
   const enchantedSkyCanvas=document.createElement('canvas');enchantedSkyCanvas.width=1024;enchantedSkyCanvas.height=512;
   const enchantedCtx=enchantedSkyCanvas.getContext('2d'),enchantedGradient=enchantedCtx.createLinearGradient(0,0,0,512);
   enchantedGradient.addColorStop(0,'#101a32');enchantedGradient.addColorStop(.45,'#172443');enchantedGradient.addColorStop(1,'#54789d');enchantedCtx.fillStyle=enchantedGradient;enchantedCtx.fillRect(0,0,1024,512);
   for(let star=0;star<520;star++){const x=Math.random()*1024,y=Math.random()*512,r=.5+Math.random()*1.8;enchantedCtx.fillStyle='rgba(255,244,210,'+(.18+Math.random()*.7)+')';enchantedCtx.beginPath();enchantedCtx.arc(x,y,r,0,Math.PI*2);enchantedCtx.fill();}
   const enchantedTexture=new THREE.CanvasTexture(enchantedSkyCanvas);enchantedTexture.colorSpace=THREE.SRGBColorSpace;
   const enchantedDome=addProp(new THREE.SphereGeometry(56,48,24,0,Math.PI*2,0,Math.PI*.5),new THREE.MeshBasicMaterial({map:enchantedTexture,side:THREE.BackSide,depthWrite:false,fog:false}),0,11,-32);
   enchantedDome.renderOrder=-5;enchantedDome.frustumCulled=false;enchantedDome.castShadow=false;enchantedDome.receiveShadow=false;
   // Another row of floating candles helps fill the vertical space over the house tables.
   for(let row=0;row<7;row++)for(let col=0;col<7;col++){const x=-18+col*6,z=-75+row*14.1,y=15.3+((row+col)%3)*.72;addProp(new THREE.CylinderGeometry(.055,.065,.58,8),gold,x,y,z);addProp(new THREE.CylinderGeometry(.032,.04,.42,7),candle,x,y+.32,z);addProp(new THREE.SphereGeometry(.06,8,6),new THREE.MeshBasicMaterial({color:0xfff0bf}),x,y+.56,z);}
 }
 }
 applyArenaLayout();applyWorldStage(key);
 combatItems.seed(key);$status.textContent=t.label+' · ROUND 01';localStorage.setItem('browserSmashMap',key);syncAuthoredArena(key).catch(error=>{console.warn('Authored arena unavailable; procedural arena remains active:',key,error);mapDecor.visible=!worldHere;});}
// Arena geometry lives in world/arena_layouts.js: per-map playable bounds, solid volumes and
// the walkable height of platforms. Final Valley adds its authored obstacle list at runtime.
function effectiveLayout(){
 const key=mapSelect?.value||'valley';
 if(activeLayout&&activeLayoutKey===key)return activeLayout;
 const base=layoutFor(key);
 const blocks=(base.blocks||[]).slice();
 if(key==='finalvalley')for(const [x,z,r] of (finalValleyArena.obstacles||[]))blocks.push({x,z,r,top:26});
 activeLayout={...base,blocks};
 activeLayoutKey=key;
 return activeLayout;
}
function applyArenaLayout(){
 const layout=effectiveLayout();
 // A reset rebuilds the arena without re-running the map's streaming camera setup. Leaving
 // training (or starting a fresh match) therefore snapped the duel camera back to the default
 // +Z side, which in the Hogwarts hall is the entrance wall three metres behind the fighters.
 // Apply the arena's authored bearing on every reset, including rounds and spawn resets.
 const cameraLocation=worldLocation(mapSelect?.value||'valley');
 const cameraHint=cameraLocation?.camera||layout.camera||null;
 smashCamera.setStageYaw?.(cameraHint?.yaw??0);
 // Ring-out stages deliberately have no fence: a fighter thrown past the edge has to be
 // able to fall. Every other location fences the fighter inside its own stage rectangle.
 // Free roam is the exception: there the fence is the whole world (every battle location in
 // it plus a margin), so walking out of one stage into the next is just walking.
 for(const f of (window.fighters||[])){
  f.bounds=exploration?(layout.roamBounds||null):(layout.ringOut?null:layout.bounds);
 }
 return {layout,spawns:spawnPoints(layout)};
}
function resolveArenaCollision(fighter){
 const layout=effectiveLayout();
 // Hand the stage's solid volumes to the fighter so melee cover checks can use them.
 fighter.layout=layout;
 resolveCollision(fighter.position,fighter.velocity,fighter.hurtboxRadius||.7,layout);
 if(!exploration&&!layout.ringOut)clampToBounds(fighter.position,fighter.velocity,fighter.hurtboxRadius||.7,layout);
 // Stand on stages, steps and jumpable platforms instead of dropping through them.
 const ground=groundHeightAt(fighter.position.x,fighter.position.z,layout,fighter.position.y);
 fighter.groundLevel=ground;
 if(fighter.position.y<ground){fighter.position.y=ground;if(fighter.velocity.y<0)fighter.velocity.y=0;fighter.isGrounded=true;}
 else if(fighter.position.y<=ground+.02)fighter.isGrounded=true;
}
if(mapSelect){const savedMap=localStorage.getItem('browserSmashMap');mapSelect.value=(savedMap&&mapSelect.querySelector('option[value="'+savedMap+'"]'))?savedMap:'finalvalley';mapSelect.addEventListener('change',()=>applyArenaSelection(mapSelect.value));if(menuMapSelect){menuMapSelect.value=mapSelect.value;menuMapSelect.addEventListener('change',()=>applyArenaSelection(menuMapSelect.value));}window.__browserSmashApplyMap(mapSelect.value);}
const selectScreen=initCharacterSelect({roster,specials:SPECIAL_MOVES,themes:mapThemes,worlds:worldGroups(),arenas:Object.keys(ARENA_LAYOUTS).map(key=>[key,ARENA_LAYOUTS[key]]).filter(([key])=>document.querySelector('#menuMapSelect option[value="'+key+'"]')||document.querySelector('#mapSelect option[value="'+key+'"]')),onFighter:(side,name)=>applyFighterSelection(side,name),onArena:(key)=>applyArenaSelection(key),onMode:(mode)=>{twoPlayer=mode==='2p';fighterTypeRefresh();updateHud();},rules:matchRules,difficulty:cpuSkillLevel,onRules:applyMatchRules,onDifficulty:setCpuSkill,modes:window.__browserSmashModes.all});
function getArena(){return activeLayoutKey;}
function applyArenaSelection(key){
 const value=String(key||'');
 if(!value||!(mapThemes[value]||ARENA_LAYOUTS[value]||worldLocation(value)))return false;
 if(mapSelect&&mapSelect.value!==value)mapSelect.value=value;
 if(menuMapSelect&&menuMapSelect.value!==value)menuMapSelect.value=value;
 window.__browserSmashApplyMap(value);
 if(window.__browserSmashApplyMapState?.ok===false)return false;
 activeLayoutKey=value;
 if(exploration)startExploration();
 localStorage.setItem('browserSmashMap',value);
 selectScreen?.setArenaState?.(value);
 return getArena()===value;
}
function setArena(key){return applyArenaSelection(key);}

// ---- Tournament mode ----
// The bracket is real data (combat/tournament.js) and every round is a real match: starting a round
// picks the CPU opponent the bracket named, sets the round's difficulty, and clicks the same PLAY
// button a player would. Results come back through the 'browsersmash:matchend' event, so the mode
// cannot drift from what the match actually decided.
let tournament=null,tournamentActive=false;
const tournamentPanel=initTournamentPanel({
  onStart:()=>startTournamentMatch(),
  onExit:()=>leaveTournament()
});
function tournamentEntrants(){
  const playerName=playerType;
  const pool=(roster||[]).map(entry=>Array.isArray(entry)?entry[0]:entry).filter(name=>name&&name!==playerName);
  return [playerName,...pool.slice(0,7)];
}
function startTournament(){
  // A bracket is not a training session: leaving the practice dummy HUD up over the bracket was
  // exactly the kind of developer residue this pass is removing.
  practice=false;trainingPanel?.setVisible(false);
  // The status line still said PRACTICE MODE while the bracket was open: it is the same residue.
  if($('#status')&&!document.body.classList.contains('in-menu'))$('#status').textContent='TOURNAMENT · QUARTER-FINAL';
  tournament=createTournament({entrants:tournamentEntrants(),player:playerType,seed:(Date.now()%99991)+7});
  tournamentActive=true;
  tournamentPanel?.bind(tournament);
  tournamentPanel?.open();
  return tournament.describe();
}
function startTournamentMatch(){
  const match=tournament?.pending;
  if(!match)return false;
  if(!selectFighter('cpu',match.opponent))return false;
  setCpuSkill(match.difficulty);
  return startMatch();
}
function leaveTournament(){
  tournamentActive=false;
  tournament=null;
  tournamentPanel?.close();
  selectScreen?.show?.();
}
window.__browserSmashTournament=()=>tournament?.describe?.()||null;
window.__browserSmashTournamentStart=()=>startTournament();
window.__browserSmashTournamentFight=()=>startTournamentMatch();
window.__browserSmashTournamentLeave=()=>leaveTournament();
window.addEventListener('browsersmash:matchend',event=>{
  if(!tournamentActive||!tournament)return;
  const won=String(event.detail?.text||'').toUpperCase().startsWith('VICTORY')||event.detail?.winner==='p1';
  tournament.reportPlayerResult(won);
  tournamentPanel?.refresh();
});
window.__browserSmashSelect=selectScreen;
// ------------------------------------------------------------------ pause / rules / CPU skill
// One place that knows how to stop a match, how the series is configured, and which skill profile
// the CPU is running. Escape is owned here rather than by the overlay, so one press cannot both
// open and close the menu.
const pauseMenu=initPauseMenu({
  audio:combatAudio,
  getStats:()=>({round:matchState.round,wins:[...matchState.wins],arena:(mapThemes[activeLayoutKey]?.label||activeLayoutKey).split(' · ')[0],mode:practice?'PRACTICE MODE':(twoPlayer?'LOCAL TWO-PLAYER':'VS CPU'),rules:{...matchState.rules},skill:twoPlayer?'':skillFor(cpuSkillLevel).label}),
  onResume:()=>setPaused(false),
  onRestart:()=>{setPaused(false);reset(false);},
  onQuitToSelect:()=>{setPaused(false);finish('');},
  onQuitToTitle:()=>{setPaused(false);returnToTitle();}
});
function setPaused(next){
  const want=Boolean(next)&&started&&!exploration;
  if(want===paused)return paused;
  paused=want;
  // Keys pressed around the pause are stale once play resumes: the edge-trigger buffers are
  // cleared so a queued attack cannot fire on the first frame back.
  try{if(input.buffers?.[1])input.buffers[1].clear();if(input.buffers?.[2])input.buffers[2].clear();if(Array.isArray(input.buffer))input.buffer.length=0;if(input.keys)input.keys={};}catch(_error){}
  combatAudio.setPaused?.(paused);
  if(paused)pauseMenu?.open();else pauseMenu?.close();
  return paused;
}
function applyMatchRules(next={}){
  const rounds=Number(next.roundsToWin),seconds=Number(next.roundSeconds);
  if(Number.isFinite(rounds)&&rounds>=1)matchRules.roundsToWin=Math.min(5,Math.round(rounds));
  if(Number.isFinite(seconds)&&seconds>=15)matchRules.roundSeconds=Math.min(300,Math.round(seconds));
  // The live match reads its rules from matchState, which resetMatch() re-creates from these.
  matchState.rules.roundsToWin=matchRules.roundsToWin;
  matchState.rules.roundSeconds=matchRules.roundSeconds;
  matchState.timer=(!started||matchState.status!=='fighting')?matchRules.roundSeconds:Math.min(matchState.timer,matchRules.roundSeconds);
  remaining=matchState.timer;
  selectScreen?.setRules?.({...matchRules});
  updateHud();
  return {...matchRules};
}
function setCpuSkill(level){
  cpuSkillLevel=normalizeSkillLevel(level);
  try{localStorage.setItem('browserSmashCpuSkill',cpuSkillLevel);}catch(_error){}
  selectScreen?.setDifficulty?.(cpuSkillLevel);
  return cpuSkillLevel;
}
window.__browserSmashPause={open:()=>setPaused(true),close:()=>setPaused(false),toggle:()=>setPaused(!paused),get paused(){return paused;},get menuOpen(){return Boolean(pauseMenu?.isOpen);},get stats(){return pauseMenu?pauseMenu.root.querySelector('[data-role="stats"]').textContent:'';}};
window.__browserSmashRules=()=>({...matchState.rules,remaining:matchState.timer,skill:cpuSkillLevel});
window.__browserSmashSetRules=next=>applyMatchRules(next);
window.__browserSmashSetCpuSkill=level=>setCpuSkill(level);
// --------------------------------------------------------------------- training mode
const trainingPanel=initTrainingPanel({
  onDummyChange:mode=>{training.dummy=mode;return training.dummy;},
  onInvulnerableChange:on=>{training.invulnerable=Boolean(on);return training.invulnerable;},
  onResetPositions:()=>resetTrainingPositions(),
  onResetDamage:()=>resetTrainingDamage(),
  onExit:()=>{setPaused(false);finish('');}
});
/**
 * The dummy's damage, hits and biggest hit are sampled from the live damage total rather than
 * from every place a hit can land, so a melee swing, a projectile, a signature move and an
 * ultimate are all counted once each and a future damage source cannot be forgotten here.
 */
function trackMatchSample(dt){
  if(!started||exploration)return;
  const cpuGain=Math.max(0,cpu.percent-lastCpuPercent);
  const playerGain=Math.max(0,player.percent-lastPlayerPercent);
  if(cpuGain>0){training.dealt+=cpuGain;training.hits+=1;training.biggest=Math.max(training.biggest,cpuGain);}
  matchStats.dealt[0]+=cpuGain;matchStats.dealt[1]+=playerGain;
  if(cpuGain>0||playerGain>0){matchStats.hits+=cpuGain>0?1:0;matchStats.biggest=Math.max(matchStats.biggest,cpuGain,playerGain);}
  lastCpuPercent=cpu.percent;lastPlayerPercent=player.percent;
  if(!practice&&!exploration)matchStats.time+=dt;
  if(practice&&training.invulnerable)cpu.invulnerable=Math.max(cpu.invulnerable,1/30);
}
function resetTrainingPositions(){
  const {spawns}=applyArenaLayout();
  placeFightersAtSpawns(spawns);
  for(const f of [player,cpu]){
    f.velocity.set(0,0,0);f.hitstun=0;f.attackQueue.length=0;f.hitboxes.length=0;
    f.attackBuffer=0;f.comboStep=0;f.comboWindow=0;f.invulnerable=0;
  }
  while(projectiles.length){const shot=projectiles.pop();scene.remove(shot.group);}
  window.showCombatCallout?.('POSITIONS RESET','#bfe9ff');
}
function resetTrainingDamage(){
  training.dealt=0;training.hits=0;training.biggest=0;
  player.percent=0;cpu.percent=0;lastCpuPercent=0;lastPlayerPercent=0;
  window.showCombatCallout?.('DAMAGE RESET','#bfe9ff');
}
function resetMatchStats(){matchStats={time:0,dealt:[0,0],biggest:0,hits:0};lastCpuPercent=0;lastPlayerPercent=0;}
window.__browserSmashTraining={state:()=>({...training}),setDummy:mode=>{training.dummy=mode;trainingPanel?.setState({dummy:mode});return training.dummy;},setInvulnerable:on=>{training.invulnerable=Boolean(on);trainingPanel?.setState({invulnerable:training.invulnerable});return training.invulnerable;},resetPositions:()=>resetTrainingPositions(),resetDamage:()=>resetTrainingDamage(),panelVisible:()=>Boolean(trainingPanel?.isVisible)};
window.__browserSmashStats=()=>({...matchStats,dealt:[...matchStats.dealt],wins:[...matchState.wins],round:matchState.round,roundsToWin:matchState.rules.roundsToWin});
window.__browserSmashCombatDebug={toggle:()=>combatDebug.toggle(),set:value=>combatDebug.setEnabled(value),refresh:()=>combatDebug.update(window.fighters),state:()=>({enabled:combatDebug.enabled,visible:combatDebug.group.visible,objects:combatDebug.group.children.filter(child=>child.visible).length})};
window.__browserSmashTickHud=()=>updateHud();
// Test hook: the live input handler, so the gamepad mapping can be verified with a fake pad.
window.__browserSmashInput=input;
// Test hooks for the projectile pipeline: the wall predicate, the live layout and the live
// projectile list, so a browser test can prove a shot stops at geometry instead of only that
// the code mentions it.
window.__browserSmashSolidAt=(x,y,z)=>solidAt(x,y,z,effectiveLayout());
window.__browserSmashLayout=()=>effectiveLayout();
window.__browserSmashPowers=(side)=>side?combatPowers.snapshot(side==='p2'?cpu:player):{p1:combatPowers.snapshot(player),p2:combatPowers.snapshot(cpu)};
window.__browserSmashTryForm=(side)=>combatPowers.tryTransform(side==='p2'?cpu:player);
window.__browserSmashTryUltimate=(side)=>combatPowers.tryUltimate(side==='p2'?cpu:player);
window.__browserSmashPowersApi=()=>combatPowers;
window.__browserSmashProjectiles=()=>projectiles.map(p=>({x:p.group.position.x,y:p.group.position.y,z:p.group.position.z,owner:p.owner===player?'p1':'p2'}));
// Test hook: the same structural gate the roster swap applies to a prefab, so audit:roster
// can assert the mounted fighter is renderable instead of only that a swap happened.
window.__browserSmashRigCheck=(fighter=player)=>{
 if(!fighter?.model)return {ok:false,issues:['no fighter model'],metrics:{}};
 const model=fighter.model;
 model.updateMatrixWorld(true);
 // A prefab carries eleven named joint handles on userData; a character loaded from the
 // manifest (see human_fighter.js) instead has a real skeleton. Both must pass the structural
 // gate, so an imported model is validated without the joint-handle requirement and then has
 // to bind all eleven canonical bones through the same rig mapper the clips use.
 // The branch follows the body, not the joint bag: an imported character exposes the canonical
 // joint names as well as its real skeleton, and it has to be held to the skeleton rules.
 if(!model.userData?.characterAssetUrl&&model.userData?.pelvis&&model.userData?.head){
   return validateFighterRig(model,{ground:fighter.position?.y??0,ignore:isEquippedWeapon});
 }
 const ground=fighter.position?.y??0;
 const validation=validateFighterRig(model,{ground,ignore:isEquippedWeapon,requireJoints:false});
 const rig=resolveRig(model);
 const issues=[...validation.issues];
 if(!rig||rig.kind!=='bone')issues.push('imported model has no skeleton');
 else if(rig.missing?.length)issues.push('skeleton is missing canonical bones: '+rig.missing.join(', '));
 // The same head-above-pelvis measurement the prefab gate reports, taken from the resolved
 // bones so a skinned character is held to the identical proportion rule.
 const metrics={...validation.metrics};
 const headBone=rig?.joints?.head,pelvisBone=rig?.joints?.pelvis;
 if(headBone&&pelvisBone){
   const a=headBone.getWorldPosition(new window.__browserSmashThree.Vector3());
   const b=pelvisBone.getWorldPosition(new window.__browserSmashThree.Vector3());
   metrics.headAbovePelvis=+(a.y-b.y).toFixed(2);
   if(metrics.headAbovePelvis<0.35)issues.push('head is only '+metrics.headAbovePelvis+' m above the pelvis');
 }
 return {...validation,metrics,ok:validation.ok&&issues.length===0,issues,
   rig:{kind:rig?.kind||null,bound:rig?.boundCount||0,missing:rig?.missing||[],
     bones:rig?.bones?Object.keys(rig.bones):null,model:model.name,asset:model.userData?.characterAssetUrl||null}};
};
roundHud();
function clearFighterCombatState(f){
 f.velocity.set(0,0,0);f.percent=0;f.hitstun=0;f.attackQueue=[];f.attackBuffer=0;f.hitboxes=[];
 f.comboStep=0;f.comboWindow=0;f.comboHitCount=0;f.specialCooldown=0;f.guardBreak=0;f.invulnerable=0;
 f.dodgeTimer=0;f.dashCooldown=0;f.dashTimer=0;f.flightMode=false;f.isGrounded=true;f.jumps=0;f.airDashUsed=false;
 f.groundLevel=0;f.webSwinging=false;f.parryTimer=0;f.counterWindow=0;f.shield=100;f.guardRegenDelay=0;f.guardBreakFlash=0;f.guardStun=0;f.grabAim='forward';f.grabbedBy=null;f.grabTarget=null;f.grabHold=0;f.grabEscapeTimer=0;f.heldThrow=null;f.lastThrow=null;f.airHits=0;f.activeMoveId=null;f.state='idle';f.ko=false;f.victoryPose=0;f.casting=null;
}
// Test hook: place both fighters on the active stage's real spawn points without restarting a match.
window.__browserSmashSpawnFighters=()=>{const {spawns}=applyArenaLayout();placeFightersAtSpawns(spawns);return spawns;};
function placeFightersAtSpawns(spawns){
 const list=spawns&&spawns.length?spawns:[{x:-6,z:0,y:0},{x:6,z:0,y:0}];
 const [a,b]=list;
 player.position.set(a.x,a.y||0,a.z);cpu.position.set(b.x,b.y||0,b.z);
 clearFighterCombatState(player);clearFighterCombatState(cpu);combatPowers.clear('round');combatPowers.resetFighter(player);combatPowers.resetFighter(cpu);
 player.facing=Math.sign(cpu.position.x-player.position.x)||1;player.facingZ=Math.sign(cpu.position.z-player.position.z);
 cpu.facing=-player.facing;cpu.facingZ=-player.facingZ;
 resolveArenaCollision(player);resolveArenaCollision(cpu);
}
function roundHud(){
 const el=document.querySelector('#roundScore');
 if(el)el.textContent='ROUND '+matchState.round+' · '+matchState.wins[0]+' - '+matchState.wins[1]+' · FIRST TO '+matchState.rules.roundsToWin;
}
function beginNextRound(){
 nextRound(matchState);
 const {spawns}=applyArenaLayout();
 placeFightersAtSpawns(spawns);
 player.invulnerable=matchState.rules.respawnInvulnerability;
 cpu.invulnerable=matchState.rules.respawnInvulnerability;
 remaining=matchState.timer;
 window.showCombatCallout?.('ROUND '+matchState.round,'#bff3ff');
 roundHud();
}
function resolveRoundEnd(){
 const layout=effectiveLayout();
 const outcome=evaluateRound(matchState,[
   {percent:player.percent,outOfBounds:isOutOfBounds(player.position,layout)},
   {percent:cpu.percent,outOfBounds:isOutOfBounds(cpu.position,layout)}
 ]);
 if(!outcome)return;
 const result=awardRound(matchState,outcome);
 // A round that ends while an ultimate is still on screen handed the frame to the cinematic for the
 // whole round-over banner: the cast, its camera, the hidden HUD and the finisher record all survived
 // until the next round started. A round end is a KO/round cleanup, so run it here, immediately.
 combatPowers.clear("ko");
 combatAudio.play('ko');
 // A finished round stops being a fight: queued attacks, live hitboxes and shots still in
 // flight are cleared, so nothing lands during the round-over banner or carries into the
 // next round. The pause already stops the fighters from simulating.
 for(const f of [player,cpu]){f.attackQueue.length=0;f.hitboxes.length=0;f.attackBuffer=0;f.comboStep=0;f.comboWindow=0;f.comboHitCount=0;}
 while(projectiles.length){const shot=projectiles.pop();scene.remove(shot.group);}
 window.showCombatCallout?.(result.banner,outcome==='p2'?'#ffb678':'#a8f6ff');
 roundHud();
 if(result.matchOver){
   // Hand the end of the match to the baked victory/defeat states. Neither was reachable
   // before: `ko` was only ever cleared, so every match ended on a frozen neutral pose
   // under the banner instead of a win or a loss.
   const winner=matchState.winner==='p1'?player:matchState.winner==='p2'?cpu:null;
   for(const f of [player,cpu]){f.ko=false;f.victoryPose=0;}
   if(winner){const loser=winner===player?cpu:player;winner.victoryPose=4;winner.hitstun=0;loser.ko=true;}
   else{player.ko=true;cpu.ko=true;}
   {const cw=matchState.winner;for(const f of [player,cpu]){const u=f.model?.userData;if(!u?.humanMixer)continue;const act=cw==='p1'?(f===player?u.victoryAction:u.defeatAction):cw==='p2'?(f===cpu?u.victoryAction:u.defeatAction):u.victoryAction;if(!act)continue;f.model.visible=true;for(const a of Object.values(u.animationActions||{}))if(a&&a!==act)a.fadeOut(.18);const isWinner=cw==='p1'?f===player:cw==='p2'?f===cpu:false;if(isWinner){act.setLoop(THREE.LoopRepeat,Infinity);act.clampWhenFinished=false;}else{act.setLoop(THREE.LoopOnce,1);act.clampWhenFinished=true;}act.reset().setEffectiveTimeScale(1).fadeIn(.18).play();}}{const cw=matchState.winner;for(const f of [player,cpu]){const c=f.model?.userData?.animationController;if(c)c.celebrate(cw==='p1'?(f===player?'victory':'defeat'):cw==='p2'?(f===cpu?'victory':'defeat'):'victory');}}
   const resultText=matchState.winner==='p1'?'VICTORY · '+fighterDisplay(playerType).toUpperCase():matchState.winner==='p2'?'DEFEAT · '+fighterDisplay(cpuType).toUpperCase():'DRAW';
   const framed=matchState.winner==='p2'?cpu:player;
   const hulkLoser=framed===player?cpu:framed===cpu?player:null;
   if(hulkLoser?.identityKey==='hulk_bruce_banner'){
     // Hulk's defeat is a presentation too: the generic branch framed the winner, called finish()
     // immediately and left only a wall behind the result panel. Use the same body-following camera
     // for the loser, with the winner as the occlusion subject, then hold the die clip before the panel.
     stageHulkPresentation(hulkLoser,{handsFree:false,anchor:{x:2,z:-6}});
     hulkLoser.forceDefeatPose=true;
     smashCamera.hulkVictory?.(hulkLoser,{opponent:framed,floorY:hulkLoser.groundLevel??0,distance:5.0,pitch:8,fov:52});
     matchEndHold=3;
     matchEndText=resultText;
     window.__browserSmashVictoryTrace=(window.__browserSmashVictoryTrace||[]);
     window.__browserSmashVictoryTrace.push({where:'defeat-set',hold:matchEndHold,started,paused,result:document.querySelector('#result')?.textContent||''});
   }else if(framed?.identityKey==='hulk_bruce_banner'){
     stageHulkPresentation(framed,{anchor:{x:6,z:-6}});
     // Hulk's skill04 carries root displacement. Use the body-following presentation camera and
     // let the 3.6 s celebration play before handing the frame to the result panel. These are the
     // exact lens parameters the acceptance suite frames at this bank position; the arena block
     // set shifted the bearing and put a foreground boulder over the legs.
     smashCamera.hulkVictory?.(framed,{opponent:framed===player?cpu:player,floorY:framed.groundLevel??0,distance:6.4,pitch:5,fov:52});
     matchEndHold=3.8;
     matchEndText=resultText;
     window.__browserSmashVictoryTrace=(window.__browserSmashVictoryTrace||[]);
     window.__browserSmashVictoryTrace.push({where:'set',hold:matchEndHold,started,paused,result:document.querySelector('#result')?.textContent||''});
   }else{
     // Same presentation contract as Hulk, for every other fighter: the authored victory/defeat
     // clip plays on the body-following camera while the result panel waits. The old branch called
     // finish() on the same frame, so the menu covered the pose before it could be seen.
     const layout=effectiveLayout();
     const blocks=[...(layout.blocks||[]),...arenaCameraBlocks(finalValleyArena.group,layout.bounds)];
     const occluders=presentationOccluders();
     const defeat=matchState.winner==='p2';
     const subject=defeat?player:framed;
     const opponent=subject===player?cpu:player;
     // The defeat clip only plays while the body reads as grounded; a match can end mid-air, so
     // opt the loser into the defeat pose instead of leaving the last hit reaction on screen.
     if(defeat)subject.forceDefeatPose=true;
     stagePresentationRoot(subject);
     smashCamera.victoryShot?.(subject,{opponent,floorY:subject.groundLevel??0,bounds:layout.bounds,blocks,occluders,distance:defeat?4.2:5.2,pitch:defeat?26:7,fov:52,facingCorrection:presentationFacing(subject)});
     matchEndHold=defeat?2.6:2.8;
     matchEndText=resultText;
     window.__browserSmashVictoryTrace=(window.__browserSmashVictoryTrace||[]);
     window.__browserSmashVictoryTrace.push({where:defeat?'roster-defeat':'roster-victory',subject:subject?.identityKey||null,hold:matchEndHold});
   }
 }else{
   roundPause=1.8;
 }
}
function clearHulkDebrisPresentation(f){
 // The debris rock is parented to Hulk's hand for the pickup/hold beat. If the KO lands during
 // that beat, the prop and its arm overlay outlive the match and sit on top of the victory clip.
 // Remove only Hulk's presentation prop (and put the arm back under the authored clip); this
 // does not touch the model, the animation mixer or any other fighter.
 if(!f) return;
 const group=f.debrisSequence?.group;
 if(group) group.parent?.remove(group);
 f.debrisSequence=null;
 f.debrisPose=null;
 f.debrisCamera=false;
 f.debrisCameraT=0;
 f.heldThrow=null;
 if(f.model?.userData) delete f.model.userData.debrisBones;
}
function stageHulkPresentation(f,{handsFree=true,anchor=null}={}){
 clearHulkDebrisPresentation(f);
 // Clean-handed celebration: the gauntlet is stowed for the shot through the equipment system
 // (EQUIPMENT_STATES.HIDDEN). reset() clears the flag, so a rematch re-equips the weapon.
 if(f?.model?.userData){if(handsFree)f.model.userData.presentationHandsFree=true;else delete f.model.userData.presentationHandsFree;applyEquipmentState(f,0);}
 // Final Valley's playable rectangle extends past the side tree band. A match can therefore end
 // with Hulk inside the foliage, where no camera can see him and every mesh raycast reports the
 // lens as surrounded. Move the Hulk-only presentation root back into the open bank, keeping his
 // authored pose and animation untouched; every other fighter stays exactly where the match left it.
 if(!f?.position) return;
 const b=effectiveLayout?.()?.bounds||null;
 if(!b) return;
 // A fixed presentation anchor in the open bank, not the match-end coordinate: at x=-6 the
 // celebration landed behind a foreground boulder that covered Hulk from the waist down. x=6,
 // z=-6 is the bank position the acceptance suite frames with a clear full body; this move is
 // presentation-only, and the authored pose, clip and mixer are untouched.
 const x=anchor?THREE.MathUtils.clamp(anchor.x,-34,34):THREE.MathUtils.clamp(f.position.x,-34,34);
 const z=anchor?THREE.MathUtils.clamp(anchor.z,b.z0+7,b.z1-7):THREE.MathUtils.clamp(-4,b.z0+7,b.z1-7);
 if(Math.hypot(x-f.position.x,z-f.position.z)<.01) return;
 const groundY=Math.max(0,Number.isFinite(f.groundLevel)?f.groundLevel:0);
 f.position.set(x,groundY,z);
 f.model?.position?.set?.(x,groundY,z);
 f.velocity?.set?.(0,0,0);
 f.isGrounded=true;
 f.groundLevel=groundY;
 f.forceDefeatPose=f.forceDefeatPose||false;
}
function presentationOccluders(){
 // Two roots matter for a presentation shot: the procedurally built arena and the destructible
 // props, which sit near the centre of the stage exactly where a downed body comes to rest.
 const roots=[finalValleyArena.group.visible?finalValleyArena.group:null,destructibles?.group||destructibles?.root||destructibles?.container||null].filter(Boolean);
 return roots.length?roots:null;
}
function presentationFacing(f){
 // Imported roster bodies are authored facing -Z while the fighter's logical heading is +Z, so
 // the general convention puts the lens behind them. Hulk already opted into the correction; the
 // rest of the imported roster needs it too, while procedural prefab bodies keep the general one.
 const u=f?.model?.userData;
 return Boolean(u?.assetUrl||u?.importedStrikeSet||u?.importedCharacter||u?.characterScale);
}
function stagePresentationRoot(f){
 // Final Valley's playable rectangle extends into the foreground tree band, where a body is
 // hidden from every bearing. Move the fighter being presented back into the open bank; the
 // authored pose, clip and mixer are untouched, and no other arena moves anybody.
 if(!f?.position||activeLayoutKey!=='finalvalley')return;
 const b=effectiveLayout?.()?.bounds||null;if(!b)return;
 const x=THREE.MathUtils.clamp(f.position.x,-34,34);
 const z=THREE.MathUtils.clamp(-4,b.z0+7,b.z1-7);
 const groundY=Math.max(0,Number.isFinite(f.groundLevel)?f.groundLevel:0);
 f.position.set(x,groundY,z);
 f.model?.position?.set?.(x,groundY,z);
 f.velocity?.set?.(0,0,0);
 f.isGrounded=true;
 f.groundLevel=groundY;
}
function reset(isPractice=false){player.forceDefeatPose=false;cpu.forceDefeatPose=false;player.victoryPose=0;cpu.victoryPose=0;for(const presented of [player,cpu]){if(presented.model?.userData)delete presented.model.userData.presentationHandsFree;applyEquipmentState(presented,0);}matchEndHold=0;matchEndText='';exploration=false;player.roamMode=false;player.flightMode=false;cpu.flightMode=false;window.endWebSwing?.(player,false);window.endWebSwing?.(cpu,false);player.attackBuffer=0;cpu.attackBuffer=0;cpu.model.visible=true;applyFloorFootprint();platform.scale.set(1,1,1);platform.visible=false;$('#timer').style.display='';$('#exploreHint').style.display='none';exitMarkers.visible=true;canvas.style.cursor='';lookingAround=false;smashCamera.endSpectate?.();smashCamera.resetOrbit?.();player.roamMode=true;cpu.roamMode=true;const arenaLayoutNow=applyArenaLayout();const {spawns}=arenaLayoutNow;placeFightersAtSpawns(spawns);for(const f of [player,cpu])combatPowers.attachMoveset(f,f.specialProfile);seedDestructibles(arenaLayoutNow);resetMatch(matchState);combatPowers.resetFighter(player,{keepMeter:false});combatPowers.resetFighter(cpu,{keepMeter:false});hitStop=0;roundPause=0;remaining=matchState.timer;started=true;paused=false;clearTitleCamera();smashCamera.snap?.();pauseMenu?.close();combatAudio.setPaused?.(false);combatAudio.startAmbience?.(activeLayoutKey==='hogwarts'||activeLayoutKey==='deathstar'?'interior':'outdoor');combatAudio.startMusic?.();presentation.score.start(activeLayoutKey||'valley');
 if(!isPractice&&introsEnabled()){const introSeconds=presentation.cinematics.playIntro({p1:player,p2:cpu,arena:(mapThemes[mapSelect?.value||'valley']?.label||'VALLEY OF ECHOES'),seconds:window.__browserSmashIntroSeconds});if(introSeconds){presentation.introHold=true;roundPause=Math.max(roundPause,introSeconds);}}
 practice=isPractice;training.dealt=0;training.hits=0;training.biggest=0;training.invulnerable=false;resetMatchStats();if(!isPractice)training.dummy='stand';trainingPanel?.setState({dummy:training.dummy,invulnerable:false});trainingPanel?.setVisible(Boolean(isPractice));document.body.classList.remove('in-menu');$('#menu').classList.add('hidden');selectScreen?.clearResult?.();$status.textContent=isPractice?'PRACTICE MODE · POWERS ENABLED':(mapThemes[mapSelect?.value||'valley']?.label||'VALLEY OF ECHOES')+' · ROUND 01';}
// ---------------------------------------------------------------------------------------------
// Presentation: one pipeline for attack timelines, dialogue, cinematics and the per-map score.
// Combat code calls `__browserSmashPresent(kind, {...})`; only this layer decides how a move is
// presented, so a new fighter gets presentation through data rather than new branches.
const presentation=(()=>{
  const vfx=window.__browserSmashEffects?.()||null;
  const audio=window.combatAudio||combatAudio;
  const dialogue=createDialogue();
  const presenter=createPresenter({vfx,audio,resolveVfx:()=>combatVFX,resolveAudio:()=>combatAudio,camera:smashCamera,dialogue});
  const cinematics=createCinematics({camera:smashCamera,dialogue});
  const score=createMapScore();
  const skip=()=>{if(!cinematics.active)return false;cinematics.skip();roundPause=0;return true;};
  window.__browserSmashPresentation={presenter,dialogue,cinematics,score,skip,
    report:()=>({presenter:presenter.describe(),dialogue:dialogue.report(),intro:cinematics.report(),score:score.report()})};
  window.__browserSmashPresent=(kind,opts)=>presenter.start(kind,{three:THREE,...opts});
  window.__browserSmashSkipCinematic=skip;
  // Skippable by Escape, Space, Enter or any pointer press, exactly like the intro.
  window.addEventListener('keydown',event=>{if(['Escape',' ','Enter'].includes(event.key))skip();},true);
  window.addEventListener('pointerdown',()=>skip(),true);
  return {vfx,audio,dialogue,presenter,cinematics,score,skip};
})();
// Automation defaults to no intro so existing suites are unaffected; `window.__browserSmashIntros=true`
// forces it on, and a real player (no webdriver) always gets it.
// Asgard weather, brazier lighting and breakable props, created only while Asgard is the stage.
let asgardAtmosphere=null;
function syncAsgardAtmosphere(){
  // Debug/capture switch: the loop re-created the atmosphere one frame after a toggle-off, so a
  // before/after pair showed the same scene twice. The flag makes "off" mean off.
  const wanted=activeLayoutKey==='asgard'&&started&&!window.__browserSmashAsgardDisabled;
  if(wanted&&!asgardAtmosphere){
    const quality=(document.querySelector('#qualitySelect')?.value||'medium').toLowerCase();
    asgardAtmosphere=createAsgardAtmosphere({scene,renderer,quality:['low','medium','high'].includes(quality)?quality:'medium',ground:(window.__browserSmashWorld?.ground||0)+.55});
  } else if(!wanted&&asgardAtmosphere){asgardAtmosphere.dispose();asgardAtmosphere=null;}
}
window.__browserSmashAsgard=()=>asgardAtmosphere?.report()||null;
window.__browserSmashFormCostume=()=>({p1:formCostumeReport(player),p2:formCostumeReport(cpu)});
window.__browserSmashAttackMotion=()=>({p1:attackMotionReport(player),p2:attackMotionReport(cpu)});
// The loop calls this every frame; exposing it lets verification drive the exact same path
// deterministically instead of racing the render loop's frame budget.
window.__browserSmashAttackTick=()=>{const a=applyAttackMotion(player);applyAttackMotion(cpu);return a;};
window.__browserSmashAsgardToggle=(on)=>{if(!on&&asgardAtmosphere){asgardAtmosphere.dispose();asgardAtmosphere=null;return false;}syncAsgardAtmosphere();return Boolean(asgardAtmosphere);};
const introsEnabled=()=>window.__browserSmashIntros===true||(window.__browserSmashIntros!==false&&!navigator.webdriver);
$('#play').addEventListener('click',()=>startMatch());$('#practice').addEventListener('click',()=>startTraining());const exploreButton=$('#explore');if(exploreButton)exploreButton.addEventListener('click',()=>startExplore());
/**
 * Free roam: no round, no opponent, no stage fence. The fighter is dropped on the chosen
 * stage's own spawn and can then walk the whole built world - every street, terrace and
 * rooftop between the battle locations - because the fence is the world's roam rectangle and
 * doorway travel is disabled (see nearbyWorldExit). The camera drops to a third-person
 * walk-around rig, and dragging the mouse looks around.
 */
let exploreSpawn=null;
function startExploration(){
 exploration=true;practice=true;started=true;
 const {layout,spawns}=applyArenaLayout();
 const spawn=spawns[0]||{x:0,z:0,y:layout.ground};
 exploreSpawn={x:spawn.x,y:spawn.y??layout.ground??0,z:spawn.z};
 player.roamMode=true;
 player.position.set(spawn.x,spawn.y??layout.ground??0,spawn.z);
 player.velocity.set(0,0,0);
 player.facing=1;
 player.isGrounded=true;
 player.flightMode=false;
 player.hitstun=0;
 window.endWebSwing?.(player,false);
 // The camera has to see buildings and rooftops now, not a duel: give it the world's solid
 // volumes so it cannot end up inside a wall on the far side of the map.
 smashCamera.setStageBounds?.(layout.roamBounds,layout.blocks);
 smashCamera.resetOrbit?.();
 smashCamera.setStageTilt?.(0,1);
 smashCamera.setStageYaw?.(0);
 cpu.model.visible=false;
 // Doorway rings are matches' travel affordance; in free roam they would only invite the
 // location change this mode exists to remove.
 exitMarkers.visible=false;
 canvas.style.cursor='grab';
 applyFloorFootprint();
 platform.visible=false;
 remaining=0;
 document.body.classList.remove('in-menu');
 $('#menu').classList.add('hidden');


 $('#timer').style.display='none';

 $('#exploreHint').style.display='block';
 $('#status').textContent='FREE ROAM · '+(mapThemes[mapSelect?.value||'valley']?.label||'VALLEY OF ECHOES');
 window.__browserSmashExploreState=()=>({exploring:exploration,location:window.__browserSmashWorld?.location,bounds:player.bounds?{...player.bounds}:null,spawn:exploreSpawn?{...exploreSpawn}:null,exitsVisible:exitMarkers.visible,position:{x:player.position.x,y:player.position.y,z:player.position.z},cameraMode:exploration?'explore':cameraMode,cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},orbitYaw:smashCamera.orbitYaw,orbitPitch:smashCamera.orbitPitch});
}
window.__browserSmashExplore=()=>{startExploration();return window.__browserSmashExploreState();};
window.__browserSmashLeaveExplore=()=>leaveExploration();
/**
 * Leave free roam and return to the menu, restoring everything the mode hid: the opponent,
 * the travel rings, the default cursor and the stage's own camera bounds.
 */
function leaveExploration(){
 if(!exploration)return false;
 exploration=false;player.roamMode=false;player.bounds=null;cpu.model.visible=true;trainingPanel?.setVisible(false);
 exitMarkers.visible=true;canvas.style.cursor='';lookingAround=false;
 applyFloorFootprint();platform.scale.set(1,1,1);

 $('#timer').style.display='';$('#exploreHint').style.display='none';
 started=false;smashCamera.resetOrbit?.();
 const back=worldLocation(mapSelect?.value||'valley');
 if(back)smashCamera.setStageBounds?.(back.layout.bounds,back.layout.blocks);else smashCamera.setStageBounds?.(null,null);
 document.body.classList.add('in-menu');$('#menu').classList.remove('hidden');
 return true;
}
addEventListener('keydown',e=>{if(e.key==='Escape'){if(exploration){leaveExploration();return;}if(started){e.preventDefault();setPaused(!paused);}return;}if(started&&practice&&!exploration&&(e.key==='r'||e.key==='R')){resetTrainingPositions();return;}if(started&&practice&&!exploration&&(e.key==='t'||e.key==='T')){resetTrainingDamage();return;}if(e.key==='F3'){e.preventDefault();const on=combatDebug.toggle();window.showCombatCallout?.(on?'HITBOX / HURTBOX DEBUG ON':'HITBOX / HURTBOX DEBUG OFF','#9bffb0');}});
/**
 * Walking off the island edge, out of the Death Star hull or off a Konoha roof would drop an
 * explorer forever. Put them back on the seat they started from instead.
 */
function respawnExplorer(){
 const seat=exploreSpawn||{x:0,y:effectiveLayout().ground??0,z:0};
 player.position.set(seat.x,seat.y,seat.z);
 player.velocity.set(0,0,0);
 player.hitstun=0;
 player.isGrounded=true;
 player.flightMode=false;
 window.endWebSwing?.(player,false);
 window.showCombatCallout?.('RETURNED TO SOLID GROUND','#bfe9ff');
}
function updateTitleView(dt){
  const active=!started&&!exploration&&!paused;
  if(!active){if(titleCameraState().active)clearTitleCamera();return;}
  applyTitleCamera(camera,(mapSelect?.value)||activeLayoutKey);
}
window.__browserSmashTitleCamera=()=>({...titleCameraState(),started,exploration,paused,map:(mapSelect?.value)||activeLayoutKey});
window.__browserSmashVictoryState=()=>({hold:matchEndHold,text:matchEndText,started,paused,result:document.querySelector('#result')?.textContent||'',spectating:Boolean(smashCamera.spectateState),trace:window.__browserSmashVictoryTrace||[]});
window.__browserSmashReturnToTitle=()=>returnToTitle();
function finish(text){window.__browserSmashVictoryTrace=(window.__browserSmashVictoryTrace||[]);window.__browserSmashVictoryTrace.push({where:'finish',text,started,paused,result:document.querySelector('#result')?.textContent||''});matchEndHold=0;matchEndText='';const outcome=String(text||'');combatAudio.play(outcome.startsWith('VICTORY')?'victory':outcome.startsWith('DEFEAT')?'defeat':'ko');combatPowers.clear('round');exploration=false;player.roamMode=false;cpu.model.visible=true;hitStop=0;roundPause=0;applyFloorFootprint();platform.scale.set(1,1,1);exitMarkers.visible=true;canvas.style.cursor='';lookingAround=false;$('#timer').style.display='';$('#exploreHint').style.display='none';started=false;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);trainingPanel?.setVisible(false);combatAudio.stopMusic?.();presentation.score.stop();presentation.score.sting(outcome.startsWith('VICTORY')?'victory':'defeat');presentation.dialogue.cancel();presentation.cinematics.end();const payload={text:String(text||''),winner:matchState.winner,markup:resultMarkup(text),stats:{...matchStats,dealt:[...matchStats.dealt],wins:[...matchState.wins],round:matchState.round}};window.__browserSmashLastResult=payload;selectScreen?.showResult?.(payload);window.dispatchEvent(new CustomEvent('browsersmash:matchend',{detail:payload}));trainingPanel?.setVisible(false);}
/** The result screen: the headline plus the real numbers the match produced. */
function resultMarkup(text){
  const total=Math.max(0,Math.round(matchStats.time));
  const clock=Math.floor(total/60)+':'+String(total%60).padStart(2,'0');
  const cell=(label,value)=>'<span style="display:inline-block;margin:3px 14px 3px 0"><b style="color:#eafaff">'+label+'</b> '+value+'</span>';
  return '<div style="font-size:19px;font-weight:950;color:#7af2ff;letter-spacing:.05em">'+(text||'MATCH ENDED')+'</div>'
    +'<div style="margin-top:7px;font:800 11px/1.7 system-ui,sans-serif;letter-spacing:.1em;color:#a8cfe4">'
    +cell('ROUNDS',matchState.wins[0]+' – '+matchState.wins[1])
    +cell('MATCH TIME',clock)
    +cell('DAMAGE DEALT',Math.round(matchStats.dealt[0])+'%')
    +cell('DAMAGE TAKEN',Math.round(matchStats.dealt[1])+'%')
    +cell('BIGGEST HIT',Math.round(matchStats.biggest)+'%')
    +cell('HITS LANDED',String(matchStats.hits))
    +'</div>';
}
function returnToTitle(){
 if(exploration)leaveExploration();
 matchEndHold=0;matchEndText='';started=false;paused=false;exploration=false;practice=false;roundPause=0;hitStop=0;
 player.roamMode=false;cpu.roamMode=false;player.flightMode=false;cpu.flightMode=false;
 window.endWebSwing?.(player,false);window.endWebSwing?.(cpu,false);
 combatPowers.clear('title');
 combatAudio.stopMusic?.();
 presentation.dialogue.cancel();
 presentation.cinematics.end();
 trainingPanel?.setVisible(false);
 document.body.classList.add('in-menu');
 $('#exploreHint').style.display='none';
 $('#menu')?.classList.remove('hidden');
 selectScreen?.showTitle?.();
 return true;
}
function startMatch(){reset(false);return started;}
function startTraining(){reset(true);return started;}
function startExplore(){startExploration();return exploration;}
function rematch(){return startMatch();}
function onResult(listener){
 if(typeof listener!=='function')return ()=>{};
 const handler=event=>listener(event.detail);
 window.addEventListener('browsersmash:matchend',handler);
 return ()=>window.removeEventListener('browsersmash:matchend',handler);
}
const gameplayApi={
 getArena,setArena,
 startMatch,startTraining,startExplore,rematch,returnToTitle,
 selectFighter,getFighter,
 onResult,
 setCameraZoom,getCameraZoom,setCameraMode,getCameraMode,
 setGraphicsPreset:preset=>window.setGraphicsPreset?.(preset)
};
window.BrowserSmash=gameplayApi;
window.__browserSmashGame=gameplayApi;
function updateHud(){
 const seconds=Math.max(0,Math.ceil(remaining||0));
 const timer=$('#timer');
 if(timer)timer.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
 const combo=$('#comboNotice');
 if(combo){const show=player.comboHitCount>=2&&player.comboWindow>0;combo.textContent=show?(player.comboStep>=5?'AIR / GROUND FINISHER · '+player.comboHitCount+' HITS':player.comboHitCount+' HIT COMBO'):'';combo.classList.toggle('show',show);}
 trainingPanel?.refresh({player,cpu,training,practice,started,exploration});
 combatPowers.drawHud([['p1',player],['p2',cpu]]);
}
const groundedState=new WeakMap();
const clock=new THREE.Clock();
// One fixed 60 Hz gameplay tick, separate from the render loop so automated tests can
// advance the simulation deterministically without GPU acceleration.
// ---- World travel -----------------------------------------------------------
// Each world location can carry a few exits: lit doorways at the edge of a stage that lead to
// the neighbouring stage in the same world. Walking into one moves the match there - a
// deliberate transition rather than a pretence of one seamless open world.
let exitCooldown=0;
function nearbyWorldExit(){
 const exits=window.__browserSmashWorld?.exits;
 if(!started||exploration||!exits||!exits.length)return null;
 for(const exit of exits){
   const range=exit.range||2.6;
   if(Math.hypot(player.position.x-exit.x,player.position.z-exit.z)<=range)return exit;
 }
 return null;
}
function travelToLocation(key,label){
 if(!worldLocation(key))return false;
 exitCooldown=2.2;
 window.showCombatCallout?.('TRAVEL · '+String(label||key).toUpperCase(),'#bfe9ff');
 applyArenaSelection(key);
 window.__browserSmashSpawnFighters?.();
 player.invulnerable=Math.max(player.invulnerable||0,.8);
 return true;
}
function updateWorldTravel(dt){
 exitCooldown=Math.max(0,exitCooldown-dt);
 if(exitCooldown>0)return;
 const exit=nearbyWorldExit();
 if(exit)travelToLocation(exit.to,exit.label);
}
window.__browserSmashTravel=(key,label)=>travelToLocation(key,label);
window.__browserSmashExits=()=>(window.__browserSmashWorld?.exits||[]);
window.__browserSmashExitMarkers=()=>exitMarkers.children.length;
window.__browserSmashNearbyExit=()=>{const exit=nearbyWorldExit();return exit?{...exit}:null;};

function simulationStep(dt){
  // A paused match is frozen: no fighters, no clock, no projectiles. Rendering continues, so the
  // player keeps seeing the frozen frame instead of a black screen.
  if(paused)return;
  if(started&&hitStop>0){
    // Impact freeze: bodies stop, sparks and camera shake keep moving.
    hitStop=Math.max(0,hitStop-dt);
    return;
  }
  if(!started)return;
  // A match-ending celebration is allowed to play on the real animation clock before the result
  // panel covers it. The simulation is frozen; the render loop still advances the mixer, camera
  // and effects, so Hulk's authored victory pose remains the subject of the shot.
  if(matchEndHold>0){
    matchEndHold=Math.max(0,matchEndHold-dt);
    if(matchEndHold===0){const text=matchEndText;matchEndText='';finish(text);}
    return;
  }
  if(roundPause>0){
    roundPause=Math.max(0,roundPause-dt);
    if(roundPause===0)beginNextRound();
  }else{
    player.simulate(dt,cameraPlayerInput);
    cpu.simulate(dt,twoPlayer&&!exploration?cameraP2Input:ai);
    updateWorldTravel(dt);
    // Appendage pose belongs to the simulation: the sweep's leg-tip hit test reads the tips this
    // step, so the pose cannot wait for a render frame (that would lag a hit behind the visual).
    for(const f of window.fighters){if(f.identityKey==='iron_spider'&&!f.model.userData.spiderLegs)attachSpiderLegs(f.model);updateSpiderLegs(f,dt);}
    window.updateSignatureMoves?.(dt);
    combatPowers.update(dt);
    // The debris reach/hold/release beat is simulation state, not a render effect. Advancing it in
    // the fixed step keeps a deterministic test tick and a real frame on the same clock.
    for(const f of [player,cpu])updateHulkDebris(f,dt);
    resolveArenaCollision(player);
    if(exploration&&player.position.y<(effectiveLayout().roamFloor??-40))respawnExplorer();
    if(!exploration)resolveArenaCollision(cpu);
  }
  trackMatchSample(dt);
  if(!practice&&!exploration){
    matchState.timer=Math.max(0,matchState.timer-dt);
    remaining=matchState.timer;
    if(roundPause<=0)resolveRoundEnd();
  }
  updateHud();
}
// Deterministic advance for tests and balance checks: __browserSmashStep(0.5)
// Read-only control probe: verifies what the input layer delivers to a player, so a control
// acceptance test can tell "the game ignored the key" apart from "the browser never sent it".
window.__browserSmashInputs=(player=1)=>{const i=input.getInputs(player);return {shield:Boolean(i.shield),parry:Boolean(i.parry),left:Boolean(i.left),right:Boolean(i.right),attack:Boolean(i.attack),jump:Boolean(i.jump)};};
window.__browserSmashStep=(seconds=1)=>{
  const steps=Math.max(1,Math.min(1200,Math.round(seconds*60)));
  // Advance the camera on the same fixed step: it damps toward its target inside the render
  // loop, so an automated probe that only advanced the simulation used to judge a shot that
  // was still in flight (much more so on a software renderer running at a few fps).
  for(let i=0;i<steps;i++){input.update();combatPowers.updateCinematic?.(1/60);simulationStep((1/60)*(started?(combatPowers.cinematicTimeScale?.()??1):1));updateProjectiles(1/60);for(const f of (window.fighters||[])){animateHumanFighter(f,1/60);if(started||exploration)syncFighterAnimation(f,1/60);syncEquippedWeapons(f.model);}combatPowers.applyCinematicPose?.(1/60);smashCamera.update(player,exploration?player:cpu,1/60,exploration?'explore':cameraMode);updateTitleView(1/60);}
  return window.__browserSmashMatch();
};

// Test-only freeze: a screenshot must show the frame the probe just measured, not the simulation
// racing ahead while the image is encoded. This toggles the same paused flag the pause menu uses.
window.__browserSmashSetPaused=value=>{paused=!!value;if(paused)accumulator=0;return paused;};

function updateProjectiles(dt){
for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.life-=dt;if(p.moveType==='grenade'||p.moveType==='debris')p.velocity.y-=10.5*dt;else if(['beam','lightning','fireball','frost','curse','web','wood'].includes(p.moveType)){p.trailT=(p.trailT||0)+dt;if(p.trailT>=.065){burst(p.group.position,p.color,3,p.moveType==='beam'?1.3:2.1);p.trailT=0;}}const previousPos=p.group.position.clone();p.group.position.addScaledVector(p.velocity,dt);p.group.rotation.x+=dt*4;p.group.rotation.y+=dt*7;const target=p.owner===player?cpu:player;p.traveled=(p.traveled||0)+p.velocity.length()*dt;if(p.traveled>1.6&&destructibles&&destructibles.damageSegment(previousPos,p.group.position,p.damage||10,p.group.position.clone())){burst(p.group.position,p.color,12,2.6);scene.remove(p.group);projectiles.splice(i,1);continue;}if(p.traveled>1.6&&segmentSolid(previousPos,p.group.position,(x,y,z)=>solidAt(x,y,z,effectiveLayout()))){burst(p.group.position,p.color,10,2.4);scene.remove(p.group);projectiles.splice(i,1);continue;}if(!(target.invulnerable>0)&&sweptSphere(previousPos,p.group.position,target.position.clone().add(new THREE.Vector3(0,1.1,0)),.95)){if(target.parryTimer>0&&target.hitstun<=0&&target.guardBreak<=0){target.parryTimer=0;target.counterWindow=1.2;target.counterFlash=.52;target.invulnerable=Math.max(target.invulnerable,.16);p.owner=target;p.velocity.multiplyScalar(-1);p.life=Math.max(p.life,.85);p.color=0x75f5ff;p.group.traverse(o=>{if(o.material?.color)o.material.color.setHex(p.color);if(o.material?.emissive)o.material.emissive.setHex(p.color);});p.group.position.addScaledVector(p.velocity.clone().normalize(),.35);window.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0,1.2,0)),8);window.showCombatCallout?.('PROJECTILE REFLECTED!','#75f5ff');continue;}if(p.moveType==='grenade'){detonateGrenade(p);scene.remove(p.group);projectiles.splice(i,1);continue;}if(target.grabTarget)target.dropGrab?.();if(target.grabbedBy)target.escapeGrab?.();const guarded=target.guardHeld&&target.guardBreak<=0;const shotDealt=p.damage*(guarded?guardDamageScale(offhandOf(target),.3):1)*(target.incomingDamage??1);window.__browserSmashLastImpact={at:{x:+p.group.position.x.toFixed(2),y:+p.group.position.y.toFixed(2),z:+p.group.position.z.toFixed(2)},normalized:!!guarded,dealt:+shotDealt.toFixed(2),identity:p.owner?.identity||null,type:p.moveType};
 target.percent+=shotDealt;combatPowers.award(p.owner,target,shotDealt,{guarded});target.hitstun=guarded?.1:(p.webShot?Math.max(.8,p.stun||.8):(p.stun||.42));const launchScale=guarded?.25:(p.knockback||5),speedScale=p.velocity.length()||20;target.velocity.x=p.velocity.x/speedScale*launchScale;target.velocity.z=p.velocity.z/speedScale*launchScale;target.velocity.y=guarded?1.2:(p.moveType==='shockwave'?5.2:p.moveType==='psychic'?1.2:p.moveType==='web'?1.1:3.2+Math.min(2,launchScale*.12));if(!guarded&&p.moveType==='lasso'){const pull=p.owner.position.clone().sub(target.position);pull.y=0;if(pull.lengthSq()>.01){pull.normalize();target.velocity.x=pull.x*5.8;target.velocity.z=pull.z*5.8;target.velocity.y=1.1;}}if(!guarded&&p.moveType==='wood'){target.velocity.x*=.55;target.velocity.z*=.55;target.hitstun+=.18;}target.isGrounded=false;const sparkCount=guarded?8:p.moveType==='lightning'?20:p.moveType==='fireball'?18:p.moveType==='shockwave'?22:p.moveType==='frost'?14:16;const sparkPower=guarded?2:p.moveType==='shockwave'?8:p.moveType==='lightning'?6.2:7;burst(p.group.position,p.color,sparkCount,sparkPower,guarded?.3:.44);
  if(!['shockwave','beam','lightning','fireball','frost'].includes(p.moveType))combatVFX.impact(target.position.clone().add(new THREE.Vector3(0,1.1,0)),{color:p.color,intensity:guarded?3:9,kind:guarded?'guard':p.moveType});if(!guarded&&['shockwave','beam','lightning','fireball','frost'].includes(p.moveType))window.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0,1.1,0)),p.moveType==='shockwave'?18:12);window.showCombatCallout?.(p.profile?.label||(p.webShot?'WEB SNARE':'SPECIAL HIT'),guarded?'#a4bfff':'#ffe6a8');scene.remove(p.group);projectiles.splice(i,1);continue;}if(p.life<=0||Math.abs(p.group.position.x)>320||Math.abs(p.group.position.z)>320){if(p.moveType==='grenade'&&p.life<=0)detonateGrenade(p);scene.remove(p.group);projectiles.splice(i,1);}}

}
function frame(){requestAnimationFrame(frame);window.__browserSmashFrames=(window.__browserSmashFrames||0)+1;window.__browserSmashLastElapsed=0;const elapsed=Math.min(clock.getDelta(),.2);clockDelta=elapsed;accumulator+=elapsed;
let __stepsRun=0;while(accumulator>=1/60&&__stepsRun<12){input.update();const cinematicScale=started?(combatPowers.cinematicTimeScale?.()??1):1;simulationStep((1/60)*cinematicScale);for(const f of (window.fighters||[]))syncEquippedWeapons(f.model);accumulator-=1/60;__stepsRun++;}
if(paused){accumulator=0;composer.render();const pausedDiagnostics=window.__browserSmashAssets;if(pausedDiagnostics){pausedDiagnostics.app=pausedDiagnostics.app||{};pausedDiagnostics.app.status='running';pausedDiagnostics.app.frames=(pausedDiagnostics.app.frames||0)+1;}return;}

// The cinematic clock is real time and independent of the hit-stop freeze and the fixed-step
// accumulator, so a sequence can always reach its own final beat and hand control back.
if(started)combatPowers.updateCinematic?.(__stepsRun/60);
combatItems.update(elapsed,[player,cpu],started&&!exploration,mapSelect?.value||'valley');
updateClones(clockDelta,{fighters:[player,cpu],hit:(owner,target,profile)=>applySignatureHit(owner,target,profile,'clone')});
presentation.presenter.update(clockDelta);presentation.cinematics.update(clockDelta);syncAsgardAtmosphere();asgardAtmosphere?.update(clockDelta,[player,cpu]);updateFormCostume(player,clockDelta);updateFormCostume(cpu,clockDelta);applyAttackMotion(player);applyAttackMotion(cpu);if(presentation.introHold&&!presentation.cinematics.active){presentation.introHold=false;roundPause=0;}presentation.score.setIntensity(started?'combat':'explore');
// Before the bell (menu and attract screen) the simulation is paused, which used to leave
// both fighters frozen in their T-pose bind pose. Keep them breathing and shifting weight
// so the menu is a living shot rather than a mannequin display.
if(!started&&!exploration){const idleInputs={left:false,right:false,up:false,down:false,run:false,sprint:false,jump:false,dodge:false,attack:false,special:false,shield:false,parry:false,ascend:false,descend:false,flightToggle:false};for(const f of window.fighters){f.t+=elapsed;f.updateProceduralPose(idleInputs,elapsed);syncFighterAnimation(f,elapsed);}}
for(const f of window.fighters){const wasGrounded=groundedState.get(f);animateHumanFighter(f,elapsed);if(started||exploration)syncFighterAnimation(f,elapsed);
  syncEquippedWeapons(f.model);if(wasGrounded===false&&f.isGrounded&&f.position.y<.9){const color=f.identityKey==='goku'?0x4b9dff:f.identityKey==='iron_man_tony_stark'?0x36eaff:0xffc978;combatVFX.landing(f.position,color);combatAudio.play('land',{intensity:f===player?7:4});}
  // Footsteps are driven by distance actually travelled, not by the clock, so a standing fighter
  // is silent and a sprinting one keeps a steady cadence; the voice's own throttle absorbs the
  // frames where the step interval is crossed.
  if((started||exploration)&&f.isGrounded&&!f.ko){const speed=Math.hypot(f.velocity.x,f.velocity.z);f.stepPhase=(f.stepPhase||0)+elapsed*speed;if(speed>2.4&&f.stepPhase>=1.9){f.stepPhase=0;const surface=activeLayoutKey==='deathstar'||activeLayoutKey==='starktower'||activeLayoutKey==='asgard'?'metal':activeLayoutKey==='valley'||activeLayoutKey==='finalvalley'?'grass':'stone';combatAudio.play('footstep',{position:{x:f.position.x,y:f.position.y+.1,z:f.position.z},surface});}if(speed<.6)f.stepPhase=0;}
  groundedState.set(f,!!f.isGrounded);updateContactShadow(f);}
// Signature choreography writes the rig AFTER the animation controller and the procedural pose in
// this same frame, otherwise the clip playing underneath would overwrite the pose.
combatPowers.applyCinematicPose?.(elapsed);
if(combatDebug.enabled)combatDebug.update(window.fighters);
cinematicEnvironment.userData.update(elapsed,clock.elapsedTime,camera);
finalValleyArena.update(elapsed,clock.elapsedTime);
for(const p of dust.children){p.position.y+=p.userData.speed*elapsed;p.position.x+=Math.sin(p.position.y)*elapsed*.15;if(p.position.y>12)p.position.y=-1;}
updateProjectiles(elapsed);
for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.t+=elapsed;for(const p of e.group.children){p.position.addScaledVector(p.userData.v,elapsed);p.userData.v.y-=7*elapsed;p.scale.setScalar(Math.max(.01,1-e.t/e.life));}if(e.t>=e.life){scene.remove(e.group);e.group.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});effects.splice(i,1);}}
for(let i=impactRings.length-1;i>=0;i--){
 const ring=impactRings[i];ring.t+=elapsed;const p=Math.min(1,ring.t/ring.life);
 ring.mesh.scale.setScalar(.35+(ring.max-.35)*p);ring.mesh.material.opacity=.92*(1-p);
 if(p>=1){scene.remove(ring.mesh);ring.mesh.geometry.dispose();ring.mesh.material.dispose();impactRings.splice(i,1);}
}
combatVFX.update(elapsed);smashCamera.update(player,exploration?player:cpu,elapsed,exploration?'explore':cameraMode);updateTitleView(elapsed);camera.getWorldDirection(audioForward);combatAudio.setListener(camera.position,audioForward);composer.render();const assetDiagnostics=window.__browserSmashAssets;if(assetDiagnostics){assetDiagnostics.app=assetDiagnostics.app||{};assetDiagnostics.app.status='running';assetDiagnostics.app.frames=(assetDiagnostics.app.frames||0)+1;}}
addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(devicePixelRatio||1,window.__graphicsPixelRatioCap||1.65));composer.setSize(innerWidth,innerHeight);});
const loadingLabel=$('#loading');let loadingNoticeIssued=false;
function checkAssetLoadingStatus(){
 const assets=window.__browserSmashAssets||{};
 const critical=[assets.characters,assets.weapons,assets.finalValley];
 const failed=critical.some(a=>a&&['error','fallback','partial'].includes(a.status));
 const pending=critical.some(a=>!a||a.status==='loading');
 if(failed){
   const names=[['CHARACTERS',assets.characters],['WEAPONS',assets.weapons],['FINAL VALLEY',assets.finalValley]];
   const details=names.filter(([,a])=>a&&['error','fallback','partial'].includes(a.status)).map(([name,a])=>name+' '+a.status.toUpperCase()).join(' · ');
   loadingLabel.textContent='ASSET FALLBACK ACTIVE · '+details;
   if(!loadingNoticeIssued){loadingNoticeIssued=true;setTimeout(()=>loadingLabel.style.opacity='0',4800);}
   return;
 }
 if(assets.app?.status==='running'&&!pending&&critical.every(a=>a.status==='loaded')){
   loadingLabel.textContent='3D WORLD + FIGHTER ASSETS READY';
   if(!loadingNoticeIssued){loadingNoticeIssued=true;setTimeout(()=>loadingLabel.style.opacity='0',1900);}
   return;
 }
 const status=(a)=>a?.status?.toUpperCase()||'WAITING';
 loadingLabel.textContent='LOADING 3D ASSETS · CHARACTERS '+status(assets.characters)+' · WEAPONS '+status(assets.weapons)+' · VALLEY '+status(assets.finalValley);
 setTimeout(checkAssetLoadingStatus,400);
}
frame();
// Downloaded Mixamo/Sketchfab packs (only when the user has installed the files) replace the
// matching procedural clips; a missing pack leaves the authored library in place and is reported.
bootstrapAnimationPacks().then(({clips,report,manifest})=>{
  window.__browserSmashAssets.animationPacks=report||null;
  window.__browserSmashAssets.animationLibrary=manifest?.ok?{clips:(manifest.clips||[]).length,packs:(manifest.packs||[]).length}:{available:false};
  if(clips?.size){animationPackClips=clips;for(const f of window.fighters)f.animationController?.setExternalClips(clips,'pack');}
}).catch(error=>{window.__browserSmashAssets.animationPacks={manifest:'error',error:String(error?.message||error)};});
checkAssetLoadingStatus();

try { installOnlineCharacters({ onImported: () => window.__browserSmashOnlineImported = true }); } catch (error) { console.warn('online character browser unavailable', error); }
