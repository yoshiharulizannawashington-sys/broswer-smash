// Actual root-site entrypoint loads this scene. Cinematic arena, powers and visible impacts.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSmashRenderPipeline, createWetStoneMaterial } from './smash_render_pipeline.js?v=browser-smash-combat-v23-20261018';
import SmashCamera from './SmashCamera.js?v=browser-smash-combat-v23-20261018';
import InputManager from './InputManager.js?v=browser-smash-combat-v23-20261018';
import Fighter3D from './fighter3D.js?v=browser-smash-combat-v23-20261018';
import { createCombatItems } from './combat_items.js?v=browser-smash-combat-v23-20261018';
import { makeProceduralCharacter, upgradeCharacterWithBlenderModel } from './models.js?v=browser-smash-combat-v23-20261018';
import { createFinalValley } from './arenas/final_valley.js?v=browser-smash-combat-v23-20261018';
import { upgradeFighterModel, animateHumanFighter } from './human_fighter.js?v=browser-smash-combat-v23-20261018';
import { addCinematicEnvironment } from './cinematic_environment.js?v=browser-smash-combat-v23-20261018';
const $=s=>document.querySelector(s);
window.__browserSmashAssets=window.__browserSmashAssets||{};
window.__browserSmashAssets.app={status:'initializing',frames:0};
const canvas=$('#gl');const scene=new THREE.Scene();scene.background=new THREE.Color(0x111b30);scene.fog=new THREE.FogExp2(0x253448,.012);
const {renderer,camera,composer,bloom,enableSSR}=createSmashRenderPipeline(canvas,scene);
const studioPMREM=new THREE.PMREMGenerator(renderer);
const studioRoom=new RoomEnvironment();
const studioTarget=studioPMREM.fromScene(studioRoom,.035);
scene.environment=studioTarget.texture;
studioRoom.dispose();
studioPMREM.dispose();
const cinematicEnvironment=addCinematicEnvironment(THREE,scene);
const smashCamera=new SmashCamera(camera,{height:12,trailing:18,minHeight:10,maxHeight:38});
const hemisphere=new THREE.HemisphereLight(0xb5c7c2,0x4d5047,1.65);scene.add(hemisphere);
const sun=new THREE.DirectionalLight(0xffaa44,2.8);sun.position.set(-18,7,-20);sun.castShadow=true;sun.shadow.radius=3.5;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.camera.near=.1;sun.shadow.camera.far=280;sun.shadow.camera.updateProjectionMatrix();scene.add(sun);const rim=new THREE.DirectionalLight(0x218cff,2.5);rim.position.set(10,7,-12);scene.add(rim);
const mat=(color,metalness=.1,roughness=.8,emissive=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:1});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(700,700),createWetStoneMaterial(0x26313b));floor.rotation.x=-Math.PI/2;floor.position.y=-.04;floor.receiveShadow=true;scene.add(floor);
const platform=new THREE.Mesh(new THREE.BoxGeometry(700,.65,700),mat(0x343a42,.18,.78));platform.position.y=-.36;platform.receiveShadow=true;platform.visible=false;scene.add(platform);
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
 const c=document.createElement('canvas');c.width=512;c.height=512;const g=c.getContext('2d');
 g.fillStyle='#68756b';g.fillRect(0,0,512,512);
 for(let i=0;i<18000;i++){const x=Math.random()*512,y=Math.random()*512;const shade=45+Math.random()*35;g.fillStyle='rgba('+shade+','+(shade+5)+','+(shade+1)+','+(.04+Math.random()*.15)+')';g.fillRect(x,y,1+Math.random()*4,.5+Math.random()*2);}
 for(let i=0;i<340;i++){const x=Math.random()*512,y=Math.random()*512;g.strokeStyle=i%3?'rgba(37,51,48,.15)':'rgba(196,202,185,.12)';g.lineWidth=.5+Math.random()*1.2;g.beginPath();g.moveTo(x,y);g.lineTo(x+(Math.random()-.5)*16,y+(Math.random()-.5)*4);g.stroke();}
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(58,58);t.anisotropy=8;
 return new THREE.MeshStandardMaterial({map:t,roughness:1,metalness:0,color:0xffffff});
}
const arenaFloorMaterials={
 valley:grassMaterial,
 volcano:makeArenaSurface('#302629','#5d3934','#ff5426',.96,.08),
 ice:makeArenaSurface('#8bbdcc','#b8f3ff','#52cfff',.34,.16),
 neon:makeArenaSurface('#17162b','#39305c','#ff32db',.62,.32),
 deathstar:makeArenaSurface('#454b56','#6d7580','#8bdcff',.72,.58),
 finalvalley:makeFinalValleyGround(),
 tournament:makeArenaSurface('#c9b895','#8f7d63','#e7d6b6',.9,.04),
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
const combatCallout=document.createElement('div');combatCallout.setAttribute('aria-live','polite');Object.assign(combatCallout.style,{position:'fixed',left:'50%',top:'23%',zIndex:'7',pointerEvents:'none',opacity:'0',transform:'translateX(-50%)',font:'1000 clamp(22px,4vw,42px)/1 system-ui,sans-serif',letterSpacing:'.12em',textAlign:'center',whiteSpace:'nowrap',textShadow:'0 3px 0 #06111d,0 0 18px currentColor,0 0 34px #00131e',WebkitTextStroke:'1px #05111b',maxWidth:'96vw'});document.body.appendChild(combatCallout);window.showCombatCallout=(label,color='#a8f6ff')=>{combatCallout.textContent=label;combatCallout.style.color=color;combatCallout.animate([{opacity:0,transform:'translate(-50%,8px) scale(.82)'},{opacity:1,transform:'translate(-50%,0) scale(1.04)',offset:.18},{opacity:1,transform:'translate(-50%,0) scale(1)',offset:.62},{opacity:0,transform:'translate(-50%,-12px) scale(1.02)'}],{duration:760,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});};
const allRoster=[["The Rock","brawler"],["Samuel L. Jackson","cyborg"],["Bruce Lee","ninja"],["Jean-Claude Van Damme","warrior"],["Lucy Liu","ninja"],["Sigourney Weaver","cyborg"],["Keanu Reeves","ninja"],["Burt Reynolds","brawler"],["Grace Jones","ninja"],["Arnold Schwarzenegger","brawler"],["Superman","warrior"],["Iron Man (Tony Stark)","cyborg"],["Hulk (Bruce Banner)","brawler"],["Green Lantern (Hal Jordan)","mage"],["Wolverine (Logan)","ninja"],["Wonder Woman","warrior"],["Professor X (Charles Xavier)","mage"],["The Flash (Barry Allen)","ninja"],["Aquaman","warrior"],["Doctor Strange","mage"],["Goku","warrior"],["Naruto Uzumaki","ninja"],["Vegeta","warrior"],["Saitama","brawler"],["L (Death Note Style)","cyborg"],["Levi Ackerman","ninja"],["Edward Elric","mage"],["Roronoa Zoro","ninja"],["All Might","brawler"],["Jotaro Kujo","brawler"],["Mario","warrior"],["Luigi","ninja"],["Solid Snake","cyborg"],["Geralt of Rivia","warrior"],["Kratos","brawler"],["Link","ninja"],["Lara Croft","ninja"],["Sephiroth","mage"],["Master Chief","cyborg"],["Doom Slayer","brawler"],["Shrek","brawler"],["Aladdin","ninja"],["Ariel","mage"],["Ursula","mage"],["Edna Mode","cyborg"],["Captain Jack Sparrow","ninja"],["Sesshomaru","mage"],["Norman Bates","ninja"],["Han Solo","cyborg"],["Indiana Jones","ninja"],["Sasuke Uchiha","ninja"],["Hashirama Senju","warrior"],["Madara Uchiha","warrior"],["Lord Voldemort","mage"],["Thor","warrior"],["Aang","mage"],["Spider-Man","ninja"]];const roster=[["Superman","warrior"],["Iron Man (Tony Stark)","cyborg"],["Hulk (Bruce Banner)","brawler"],["Green Lantern (Hal Jordan)","mage"],["Wonder Woman","warrior"],["Professor X (Charles Xavier)","mage"],["The Flash (Barry Allen)","ninja"],["Aquaman","warrior"],["Doctor Strange","mage"],["Arnold Schwarzenegger","brawler"],["Goku","warrior"],["Naruto Uzumaki","ninja"],["Vegeta","warrior"],["Saitama","brawler"],["L (Death Note Style)","cyborg"],["All Might","brawler"],["Edward Elric","mage"],["Levi Ackerman","ninja"],["Mario","warrior"],["Luigi","ninja"],["Kratos","brawler"],["Link","ninja"],["Master Chief","cyborg"],["Thor","warrior"],["Aang","mage"],["Madara Uchiha","warrior"],["Hashirama Senju","warrior"],["Lord Voldemort","mage"],["Sasuke Uchiha","ninja"],["Edna Mode","cyborg"],["Captain Jack Sparrow","ninja"],["Spider-Man","ninja"]];const dlcRoster=allRoster.filter(([name])=>!roster.some(([launchName])=>name===launchName));window.characterRosters={launch:roster,dlc:dlcRoster,all:allRoster};const flightCapable=new Set(["superman","iron_man_tony_stark","green_lantern_hal_jordan","wonder_woman","doctor_strange","goku","naruto_uzumaki","vegeta","thor","aang","madara_uchiha","lord_voldemort","sasuke_uchiha"]);const canCharacterFly=name=>flightCapable.has(String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''));const archetypes=['warrior','ninja','brawler','mage','cyborg'];const fighterNames={warrior:'Superman',ninja:'Naruto Uzumaki',brawler:'Hulk (Bruce Banner)',mage:'Doctor Strange',cyborg:'Iron Man (Tony Stark)'};const fighterArchetype=id=>allRoster.find(([name])=>name===id)?.[1]|| (archetypes.includes(id)?id:'warrior');const fighterDisplay=id=>allRoster.find(([name])=>name===id)?.[0]||fighterNames[id]||id;const normalizeFighter=id=>roster.some(([name])=>name===id)?id:(fighterNames[allRoster.find(([name])=>name===id)?.[1]]||fighterNames[id]||'Superman');let playerType=normalizeFighter(localStorage.getItem('browserSmashP1')||'Superman'),cpuType=normalizeFighter(localStorage.getItem('browserSmashCPU')||'Goku');
// Signature specials use distinct attack silhouettes and balance values instead of recolored generic bolts.
const SPECIAL_MOVES={
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
spider_man:{label:'WEB ZIP STRIKE',type:'web',color:0xf5fbff,damage:13,speed:34,cooldown:.78,stun:.62,knockback:5.4,behavior:'dashStrike',dashSpeed:43,range:16}
};
const COMBAT_PROFILES={hulk_bruce_banner:{damage:1.28,knockback:1.28,weight:1.35,launch:1.18},saitama:{damage:1.38,knockback:1.3,weight:1.18,launch:1.2},all_might:{damage:1.24,knockback:1.22,weight:1.24,launch:1.14},kratos:{damage:1.22,knockback:1.2,weight:1.25,launch:1.1},superman:{damage:1.12,knockback:1.12,weight:1.16,launch:1.1},goku:{damage:1.14,knockback:1.12,weight:1.04,launch:1.12},vegeta:{damage:1.12,knockback:1.1,weight:1.04,launch:1.1},the_flash_barry_allen:{damage:.92,knockback:.9,weight:.92,launch:.92},professor_x_charles_xavier:{damage:.86,knockback:.78,weight:.86,launch:.8},l_death_note_style:{damage:.78,knockback:.74,weight:.82,launch:.72},edna_mode:{damage:.8,knockback:.78,weight:.8,launch:.8},spider_man:{damage:.96,knockback:.9,weight:.92,launch:.92},thor:{damage:1.18,knockback:1.2,weight:1.18,launch:1.14},master_chief:{damage:1.1,knockback:1.08,weight:1.12,launch:1.08}};
function spawn(name,x,archetype,player){const model=makeProceduralCharacter(archetype,name);model.position.set(x,0,0);scene.add(model);const identityKey=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');const combatProfile=COMBAT_PROFILES[identityKey]||{damage:1,knockback:1,weight:1,launch:1};const f=new Fighter3D({name,model,weight:(player?88:82)*combatProfile.weight,player});f.archetype=archetype;f.identity=name;f.identityKey=identityKey;f.combatProfile=combatProfile;f.specialProfile=SPECIAL_MOVES[identityKey]||{label:'SIGNATURE STRIKE',type:'orb',color:0x62caff,damage:14,speed:22,cooldown:.82,stun:.42,knockback:4.5};f.canFly=canCharacterFly(name);f.canWebSwing=name==='Spider-Man';f.flightMode=false;f.webSwinging=false;window.fighters.push(f);upgradeCharacterWithBlenderModel(f).catch(err=>console.warn('Blender model upgrade unavailable; keeping fallback:',err));return f;}
const player=spawn(fighterDisplay(playerType),-12,fighterArchetype(playerType),true),cpu=spawn(fighterDisplay(cpuType),12,fighterArchetype(cpuType),false);player.facing=1;cpu.facing=-1;
const combatItems=createCombatItems(THREE,scene,(fighter,item)=>{window.spawnImpact?.(fighter.position.clone().add(new THREE.Vector3(0,1,0)),8);const status=$('#status');if(status)status.textContent=fighter.name.toUpperCase()+' PICKED UP '+item.label;});
const ai={getInputs(){if(exploration)return {left:false,right:false,up:false,down:false,run:false,sprint:false,jump:false,dodge:false,attack:false,special:false,shield:false,parry:false,ascend:false,descend:false,flightToggle:false};const dx=player.position.x-cpu.position.x,dz=player.position.z-cpu.position.z,dist=Math.hypot(dx,dz);if(cpu.canFly&&(player.flightMode||player.position.y>3&&dist<11))cpu.flightMode=true;cpu.aiTimer-=clockDelta;const attack=dist<2.25&&cpu.aiTimer<=0;if(attack)cpu.aiTimer=.62+Math.random()*.5;const incoming=dist<4.8&&player.attackQueue.some(a=>!a.hit&&a.t<a.start&&a.start-a.t<.2);const parry=incoming&&cpu.parryCooldown<=0&&Math.random()<.13;const shield=incoming&&!parry&&Math.random()<.72;const dodge=incoming&&!parry&&!shield&&cpu.dodgeTimer<=0&&Math.random()<.28;const specialReady=cpu.specialCooldown<=0;const useSpecial=specialReady&&dist>2.8&&dist<12&&Math.random()<.018;return {left:dx< -1.1,right:dx>1.1,up:dz< -1.1,down:dz>1.1,run:dist>4.5,sprint:dist>7,jump:!cpu.flightMode&&player.position.y>2.6&&cpu.position.y<1.5,ascend:cpu.flightMode&&player.position.y>cpu.position.y+1.0,descend:cpu.flightMode&&player.position.y<cpu.position.y-2.3,dodge,attack:attack&&Math.random()>.22&&!shield,special:useSpecial,shield,parry,flightToggle:false};}};
function burst(pos,color=0x58eaff,count=18,power=5){const group=new THREE.Group();for(let i=0;i<count;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.065,6,5),new THREE.MeshBasicMaterial({color,transparent:true}));m.position.copy(pos);m.userData.v=new THREE.Vector3((Math.random()-.5)*power,Math.random()*power*.8,(Math.random()-.5)*power*.4);group.add(m);}scene.add(group);effects.push({group,t:0,life:.55});bloom.strength=.95;}
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
 burst(pos,color,24,7);
 if(intensity>5&&['stormbreaker','hammer','axe','sword','katana','cyber_blade','giant_sword','scimitar','trident','staff','war_fan','whip','nunchaku','knife','claws','energy_gauntlet','repulsor','lightning'].includes(weaponKind))window.spawnHitSparks?.(pos,color,intensity>15?22:14,intensity>15?10:7);
 // Expanding emissive shock rings make melee hits readable at a glance.
 for(let i=0;i<2;i++){
  const material=new THREE.MeshBasicMaterial({color:i?0x9b6dff:color,transparent:true,opacity:.92,blending:THREE.AdditiveBlending,depthWrite:false});
  const mesh=new THREE.Mesh(new THREE.TorusGeometry(.72+i*.24,.035,6,32),material);
  mesh.position.copy(pos);mesh.position.y=Math.max(.18,pos.y-.55+i*.18);mesh.rotation.x=Math.PI/2;mesh.scale.setScalar(.35);
  scene.add(mesh);impactRings.push({mesh,t:0,life:.3+i*.08,max:1.8+Math.min(1.2,intensity*.035)});
 }
 smashCamera.impact(Math.min(.9,intensity*.045));
};
function applySignatureHit(owner,target,profile,kind='dashStrike'){
 if(!owner||!target||target.model?.visible===false||target.invulnerable>0)return false;
 const guarded=target.guardHeld&&target.guardBreak<=0;
 const damage=Number(profile.damage)||12;
 target.percent+=damage*(guarded?.32:1);
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
   const outer=new THREE.Mesh(new THREE.TorusGeometry(.78,.145,10,48),new THREE.MeshBasicMaterial({color:profile.color||0xffc05d,transparent:true,opacity:.95,emissive:profile.color||0xffc05d,emissiveIntensity:1.7,depthWrite:false}));
   const inner=new THREE.Mesh(new THREE.TorusGeometry(.46,.065,8,40),new THREE.MeshBasicMaterial({color:0xfff2ca,transparent:true,opacity:.9,emissive:0xffe6a0,emissiveIntensity:1.1,depthWrite:false}));
   for(const mesh of [outer,inner]){mesh.position.copy(owner.position);mesh.position.y=.12;mesh.rotation.x=Math.PI/2;scene.add(mesh);}
   signatureMoves.push({kind:'shockwave',owner,profile,age:0,life:.48,radius:profile.radius||6,origin:owner.position.clone(),direction:facing.clone(),outer,inner,hitTargets:new Set()});
   owner.velocity.x+=facing.x*1.5;owner.velocity.z+=facing.z*1.5;owner.velocity.y=Math.max(owner.velocity.y,1.1);
   burst(owner.position.clone().add(new THREE.Vector3(0,.18,0)),profile.color||0xffb764,28,4.8);
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
   burst(strikePoint,profile.color||0x88e9ff,34,7.2);
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
     const scale=radius/.78;
     move.outer.scale.setScalar(Math.max(.08,scale));move.inner.scale.setScalar(Math.max(.08,scale*.78));
     move.outer.material.opacity=.95*(1-t);move.inner.material.opacity=.9*(1-t);
     for(const other of (window.fighters||[])){
       if(other===owner||move.hitTargets.has(other)||other.model?.visible===false)continue;
       const offset=other.position.clone().sub(move.origin);const horizontal=Math.hypot(offset.x,offset.z);
       const facingDot=(offset.x*move.direction.x+offset.z*move.direction.z)/(horizontal||1);
       if(horizontal<=radius+(other.hurtboxRadius||.7)&&Math.abs(offset.y)<3.5&&facingDot>-.38){
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
     if(move.age>=move.lastBurst+.065){burst(owner.position.clone().add(new THREE.Vector3(0,1.15,0)),profile.color||0x78ddff,5,1.4);move.lastBurst=move.age;}
   }
   if(remove){
     if(move.outer){scene.remove(move.outer);move.outer.geometry.dispose();move.outer.material.dispose();}
     if(move.inner){scene.remove(move.inner);move.inner.geometry.dispose();move.inner.material.dispose();}
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
   burst(fighter.position.clone().add(new THREE.Vector3(0,1.8,0)),0xf4faff,12,2.6);
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
window.spawnProjectile=(owner,options={})=>{
 const palette={warrior:0xff713c,ninja:0x16bfff,brawler:0xff8d36,mage:0x9d67ff,cyborg:0x26e8e0};
 const weaponKind=options.weaponKind||owner.model?.userData?.weaponKind||'';
 const profile=options.source==='special'?(owner.specialProfile||{}):{};
 const moveType=profile.type||(options.source==='web'?'web':options.source==='weapon'?'weapon':owner.archetype==='mage'?'magic':owner.archetype==='ninja'?'spinning':'orb');
 const webShot=options.source==='web'||moveType==='web';
 const ballistic=options.source==='weapon'&&['blaster','rifle','shotgun','plasma_rifle','pistol'].includes(weaponKind);
 const color=profile.color||(webShot?0xf3f8ff:ballistic?(weaponKind==='plasma_rifle'?0x8bffc4:owner.player?0xffd18a:0xff635e):(palette[owner.archetype]||(owner.player?0x25dfff:0xff5a24)));
 const group=new THREE.Group(),basic=new THREE.MeshBasicMaterial({color,wireframe:webShot||moveType==='construct'});
 let core;
 if(moveType==='beam')core=new THREE.Mesh(new THREE.CylinderGeometry(.22,.34,2.7,14,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.76,side:THREE.DoubleSide}));
 else if(moveType==='shockwave')core=new THREE.Mesh(new THREE.TorusGeometry(.7,.13,8,28),basic);
 else if(moveType==='lightning')core=new THREE.Mesh(new THREE.OctahedronGeometry(.32,1),basic);
 else if(moveType==='arrow'||moveType==='blade')core=new THREE.Mesh(new THREE.ConeGeometry(.16,.95,8),basic);
 else if(['fireball','frost','curse','grenade'].includes(moveType))core=new THREE.Mesh(new THREE.IcosahedronGeometry(moveType==='grenade'?.38:.32,2),basic);
 else if(['wind','lasso','water'].includes(moveType))core=new THREE.Mesh(new THREE.TorusGeometry(.38,.09,8,26),basic);
 else if(['psychic','magic'].includes(moveType))core=new THREE.Mesh(new THREE.TorusGeometry(.42,.055,8,32),basic);
 else if(moveType==='wood'||moveType==='earth')core=new THREE.Mesh(new THREE.ConeGeometry(.32,.85,7),basic);
 else if(moveType==='gadget')core=new THREE.Mesh(new THREE.DodecahedronGeometry(.3,1),basic);
 else if(ballistic)core=new THREE.Mesh(new THREE.BoxGeometry(.095,.095,weaponKind==='shotgun'?.42:.58),basic);
 else core=new THREE.Mesh(webShot?new THREE.IcosahedronGeometry(.17,1):owner.archetype==='mage'?new THREE.IcosahedronGeometry(.34,2):owner.archetype==='ninja'?new THREE.OctahedronGeometry(.32,1):new THREE.IcosahedronGeometry(.3,2),basic);
 if(moveType==='beam'){core.rotation.x=Math.PI/2;core.position.z=-1.05;group.add(core);const inner=new THREE.Mesh(new THREE.CylinderGeometry(.08,.12,2.9,10),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.9}));inner.rotation.x=Math.PI/2;inner.position.z=-1.05;group.add(inner);}
 else if(moveType==='shockwave'){core.rotation.y=Math.PI/2;group.add(core);const ring2=new THREE.Mesh(new THREE.TorusGeometry(.48,.07,6,24),new THREE.MeshBasicMaterial({color:0xfff2d6,transparent:true,opacity:.8}));ring2.rotation.y=Math.PI/2;group.add(ring2);}
 else{if(moveType==='arrow'||moveType==='blade')core.rotation.x=Math.PI/2;if(['wind','water','lasso'].includes(moveType))core.rotation.y=Math.PI/2;group.add(core);}
 if(['lightning','fireball','frost','curse','grenade','wood','earth','gadget'].includes(moveType))group.add(new THREE.Mesh(new THREE.SphereGeometry(.48,12,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.19,blending:THREE.AdditiveBlending,depthWrite:false})));
 if(['psychic','magic','construct','spinning'].includes(moveType))for(let i=0;i<3;i++){const ring=new THREE.Mesh(new THREE.TorusGeometry(.38+i*.13,.025,6,28),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.86}));ring.rotation.set(i*.8,i*1.1,i*.45);group.add(ring);}
 if(ballistic){core.position.z=-.14;const tip=new THREE.Mesh(new THREE.BoxGeometry(.06,.06,.16),new THREE.MeshBasicMaterial({color:0xfff3d5}));tip.position.z=-.47;group.add(tip);}
 if(webShot)group.add(new THREE.Mesh(new THREE.SphereGeometry(.26,10,8),new THREE.MeshBasicMaterial({color:0xf8fbff,wireframe:true})));
 const direction=new THREE.Vector3(owner.facing,0,owner.facingZ);if(direction.lengthSq()<.01)direction.set(owner.player?1:-1,0,0);direction.normalize();
 if(ballistic||['arrow','blade','beam'].includes(moveType))group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
 const start=owner.position.clone().add(direction.clone().multiplyScalar(1.05)).add(new THREE.Vector3(0,1.5,0));group.position.copy(start);scene.add(group);
 const speed=profile.speed||(webShot?26:ballistic?(weaponKind==='shotgun'?22:weaponKind==='plasma_rifle'?24:30):17);
 const life=profile.life||(webShot?1.35:ballistic?1.28:1.6),damage=profile.damage||(webShot?7:ballistic?(weaponKind==='shotgun'?15:12):14);
 projectiles.push({owner,group,velocity:direction.multiplyScalar(speed),life,damage,color,webShot,moveType,stun:profile.stun||.42,knockback:profile.knockback||5,profile});
 burst(start,color,moveType==='web'?14:moveType==='beam'?18:ballistic?5:14,moveType==='shockwave'?5:2.8);
};
function detonateGrenade(projectile){
 const pos=projectile.group.position.clone(),color=projectile.color||0x75ffb3,radius=5.1;
 burst(pos,color,70,11);
 window.spawnImpact?.(pos,23,0xffe09b);
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.12,8,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95,emissive:color,emissiveIntensity:1.9,depthWrite:false}));
 ring.position.copy(pos);ring.rotation.x=Math.PI/2;scene.add(ring);impactRings.push({mesh:ring,t:0,life:.42,max:radius/.75});
 for(const target of (window.fighters||[])){
   if(target===projectile.owner||target.model?.visible===false)continue;
   const point=target.position.clone().add(new THREE.Vector3(0,1,0)),distance=point.distanceTo(pos);
   if(distance>radius)continue;
   const guarded=target.guardHeld&&target.guardBreak<=0;
   const falloff=Math.max(.35,1-distance/radius*.52);
   target.percent+=projectile.damage*falloff*(guarded?.3:1);
   target.hitstun=guarded?.1:Math.max(.38,projectile.stun||.6);
   const away=target.position.clone().sub(pos);away.y=0;if(away.lengthSq()<.01)away.set(projectile.owner?.facing||1,0,0);away.normalize();
   const force=(projectile.knockback||8)*falloff*(guarded?.25:1);
   target.velocity.x=away.x*force;target.velocity.z=away.z*force;target.velocity.y=guarded?1.2:4.2+falloff*1.8;target.isGrounded=false;
 }
 window.showCombatCallout?.('PLASMA GRENADE DETONATION','#b8ffc5');
}
window.camState={shake:0,targetZoom:19};let cameraMode='over-p1';localStorage.setItem('browserSmashCameraMode',cameraMode);const cameraModeSelect=$('#cameraMode');if(cameraModeSelect){cameraModeSelect.value=cameraMode;cameraModeSelect.addEventListener('change',()=>{cameraMode=cameraModeSelect.value;localStorage.setItem('browserSmashCameraMode',cameraMode);});}const cameraZoom=$('#cameraZoom');if(cameraZoom){const savedZoom=Number(localStorage.getItem('browserSmashCameraZoom_v5'));if(Number.isFinite(savedZoom)&&savedZoom>=smashCamera.minZoom&&savedZoom<=smashCamera.maxZoom)smashCamera.setZoom(savedZoom);cameraZoom.value=String(smashCamera.zoom);cameraZoom.addEventListener('input',()=>{smashCamera.setZoom(Number(cameraZoom.value));localStorage.setItem('browserSmashCameraZoom_v5',String(smashCamera.zoom));});}canvas.addEventListener('wheel',e=>{e.preventDefault();smashCamera.setZoom(smashCamera.zoom*(e.deltaY>0?1.12:1/1.12));if(cameraZoom)cameraZoom.value=String(smashCamera.zoom);localStorage.setItem('browserSmashCameraZoom_v5',String(smashCamera.zoom));},{passive:false});let lookingAround=false,lastPointerX=0,lastPointerY=0;canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(e.button!==2)return;lookingAround=true;lastPointerX=e.clientX;lastPointerY=e.clientY;canvas.setPointerCapture?.(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!lookingAround)return;const dx=e.clientX-lastPointerX,dy=e.clientY-lastPointerY;lastPointerX=e.clientX;lastPointerY=e.clientY;smashCamera.orbit(-dx*.006,dy*.004);});const stopLooking=()=>{lookingAround=false;};canvas.addEventListener('pointerup',stopLooking);canvas.addEventListener('pointercancel',stopLooking);canvas.addEventListener('lostpointercapture',stopLooking);const $status=$('#status');
const characterSelects={p1:$('#p1Character'),cpu:$('#cpuCharacter')};
for(const [key,select] of Object.entries(characterSelects)){if(select){populateRoster(select,key==='p1'?playerType:cpuType);select.value=key==='p1'?playerType:cpuType;select.addEventListener('change',()=>{if(key==='p1')playerType=select.value;else cpuType=select.value;localStorage.setItem(key==='p1'?'browserSmashP1':'browserSmashCPU',select.value);const fighter=key==='p1'?player:cpu;const archetype=fighterArchetype(select.value);const previous=fighter.model;scene.remove(previous);const fresh=makeProceduralCharacter(archetype,select.value);fresh.position.copy(fighter.position);scene.add(fresh);fighter.model=fresh;fighter.position=fresh.position;fighter.archetype=archetype;fighter.identity=select.value;fighter.identityKey=String(select.value||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');fighter.combatProfile=COMBAT_PROFILES[fighter.identityKey]||{damage:1,knockback:1,weight:1,launch:1};fighter.specialProfile=SPECIAL_MOVES[fighter.identityKey]||{label:'SIGNATURE STRIKE',type:'orb',color:0x62caff,damage:14,speed:22,cooldown:.82,stun:.42,knockback:4.5};fighter.weight=(key==='p1'?88:82)*fighter.combatProfile.weight;fighter.name=fighterDisplay(select.value);fighter.canFly=canCharacterFly(select.value);fighter.canWebSwing=select.value==='Spider-Man';fighter.flightMode=false;fighter.webSwinging=false;window.endWebSwing?.(fighter,false);upgradeCharacterWithBlenderModel(fighter).catch(err=>console.warn('Blender model upgrade unavailable; keeping fallback:',err));applyMap(mapSelect?.value||'valley');fighterTypeRefresh();});}}
function fighterTypeRefresh(){const labels=document.querySelectorAll('.fighter .name');if(labels[0])labels[0].textContent='P1 · '+fighterDisplay(playerType).toUpperCase();if(labels[1])labels[1].textContent=fighterDisplay(cpuType).toUpperCase()+' · CPU';const specialLabel=$('#specialLabel');if(specialLabel)specialLabel.textContent=player.specialProfile?.label||'SIGNATURE MOVE';}
fighterTypeRefresh();
const mapDecor=new THREE.Group();scene.add(mapDecor);
const finalValleyArena=createFinalValley(THREE);scene.add(finalValleyArena.group);finalValleyArena.group.visible=false;
const mapSelect=$('#mapSelect');const menuMapSelect=$('#menuMapSelect');
// The launch roster has 32 fighters including Spider-Man; the rest remain in dlcRoster.
function populateRoster(select, selected){if(!select)return;select.replaceChildren();for(const [name] of roster){const option=document.createElement('option');option.value=name;option.textContent=name;select.appendChild(option);}select.value=roster.some(([name])=>name===selected)?selected:roster[0][0];}

const mapThemes={valley:{label:'VALLEY OF ECHOES · ANCIENT GATE',sky:0x111b30,fog:0x253448,floor:0x26313b,platform:0x343a42,ringA:0x287b9e,ringB:0x8e613e,light:0xffd2a1,sun:0xffb66f,density:.012},volcano:{label:'OBSIDIAN VOLCANO · LAVA CALDERA',sky:0x230d16,fog:0x5b1d1c,floor:0x251d20,platform:0x3b2929,ringA:0xff4c20,ringB:0xffb13b,light:0xff8b52,sun:0xff4428,density:.013},ice:{label:'FROSTFALL CITADEL · CRYSTAL KEEP',sky:0x071c35,fog:0x315b78,floor:0x7bafc6,platform:0x31566e,ringA:0x73f5ff,ringB:0xc4eaff,light:0xc5f3ff,sun:0x9cecff,density:.007},neon:{label:'NEON MEGACITY · SKYLINE DISTRICT',sky:0x08051e,fog:0x25205a,floor:0x17172b,platform:0x24213c,ringA:0xff32db,ringB:0x31eaff,light:0xb2a1ff,sun:0xff4dd8,density:.006},deathstar:{label:'DEATH STAR · BRIEFING ROOM & THRONE ROOM',sky:0x070b14,fog:0x202b3a,floor:0x424954,platform:0x262d38,ringA:0x78cfff,ringB:0xff453b,light:0xc8d9ff,sun:0x8799bb,density:.004},finalvalley:{label:'FINAL VALLEY · HASHIRAMA & MADARA · SHINOBI CLIFFS',sky:0x35484b,fog:0x73817b,floor:0x68746a,platform:0x536158,ringA:0x879f94,ringB:0xa88978,light:0xd2d6c9,sun:0xb6c2c5,density:.007},tournament:{label:'DBZ WORLD TOURNAMENT · MARTIAL ARTS RING',sky:0x4a7596,fog:0x9ab5c5,floor:0xb7a17b,platform:0xd9d0b8,ringA:0x35c9ff,ringB:0xffb44f,light:0xffedc2,sun:0xffd08b,density:.003},starktower:{label:'AVENGERS HELICARRIER · NYC SKYDECK / STARK PENTHOUSE',sky:0x101a35,fog:0x303d61,floor:0x343947,platform:0x202735,ringA:0x35eaff,ringB:0xff563c,light:0x9dd8ff,sun:0xffa16c,density:.005},asgard:{label:'ASGARD · GOLDEN CITY & ROYAL PALACE',sky:0x8cb1d2,fog:0x9eb3c0,floor:0xc1b99f,platform:0x77776e,ringA:0x58d8ef,ringB:0xf4c65e,light:0xffe2b3,sun:0xffd6a1,density:.003},hogwarts:{label:'HOGWARTS · THE GREAT HALL',sky:0x171a2d,fog:0x41414b,floor:0x3c3e43,platform:0x292b31,ringA:0xe3c477,ringB:0x9f252e,light:0xffd59b,sun:0xd5c4a1,density:.005}};
function applyFloorFootprint(){const key=mapSelect?.value||'valley';const footprint=key==='starktower'?.17:key==='deathstar'?.18:1;floor.scale.set(footprint,1,footprint);}
function applyMap(key){const t=mapThemes[key]||mapThemes.valley;applyFloorFootprint();for(const fighter of (window.fighters||[])){const stageScale=key==='finalvalley'?1.16:key==='starktower'?.76:key==='deathstar'?.84:key==='asgard'?.96:key==='hogwarts'?.93:1;const scale=(fighter.model.userData.characterScale||1)*stageScale;fighter.model.userData.visualScale=scale;fighter.model.scale.setScalar(scale);}cinematicEnvironment.userData.setMap?.(key);scene.background.setHex(t.sky);scene.fog.color.setHex(t.fog);scene.fog.density=t.density;floor.material=arenaFloorMaterials[key]||grassMaterial;floor.material.needsUpdate=true;explorationWorld.visible=key==='valley';horizon.visible=key==='valley';finalValleyArena.group.visible=key==='finalvalley';platform.material.color.setHex(t.platform);sun.color.setHex(t.light);sun.intensity=key==='finalvalley'?3.0:2.8;rim.intensity=key==='finalvalley'?1.85:2.5;rim.color.setHex(key==='finalvalley'?0x8eaaa0:0x218cff);hemisphere.color.setHex(key==='finalvalley'?0xbac8bf:0x9ecfff);hemisphere.groundColor.setHex(key==='finalvalley'?0x4a4a40:0x191421);hemisphere.intensity=key==='finalvalley'?1.75:1.5;renderer.toneMappingExposure=key==='finalvalley'?1.12:1.08;if(key==='finalvalley'){sun.position.set(27,36,-54);rim.position.set(25,24,-82);}else{sun.position.set(-18,7,-20);rim.position.set(10,7,-12);}while(mapDecor.children.length){const o=mapDecor.children[mapDecor.children.length-1];mapDecor.remove(o);o.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){if(Array.isArray(n.material))n.material.forEach(x=>x.dispose());else n.material.dispose();}});}const addProp=(geometry,material,x,y,z,sx=1,sy=1,sz=1)=>{const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.castShadow=true;o.receiveShadow=true;mapDecor.add(o);return o;};
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
  if(key==='volcano'){addProp(new THREE.ConeGeometry(10,23,7),mat(0x292124,.15,.96),-32,8,-38,1,1,1);addProp(new THREE.ConeGeometry(4,1.2,7),new THREE.MeshBasicMaterial({color:0xff5a1e}),-32,19,-38,1,1,1);}
  if(key==='ice'){const citadel=addProp(new THREE.CylinderGeometry(5,8,18,6),mat(0x456c85,.35,.32),-34,9,-35);for(let i=0;i<6;i++)addProp(new THREE.ConeGeometry(1.2,7,5),mat(0xbdefff,.25,.2),-39+i*2,19,-35);}
  if(key==='neon'){for(let i=0;i<5;i++){const tower=addProp(new THREE.BoxGeometry(5,18+i*3,5),mat(0x1a2340,.65,.25),-38+i*9,(18+i*3)/2,-38);addProp(new THREE.BoxGeometry(5.1,.12,5.1),new THREE.MeshBasicMaterial({color:i%2?0xff32db:0x31eaff}),tower.position.x,tower.position.y+tower.geometry.parameters.height/2+.1,-38);}}
  if(key==='valley'){addProp(new THREE.TorusGeometry(4,.3,10,48),new THREE.MeshStandardMaterial({color:0x6beaff,emissive:0x126f9a,emissiveIntensity:1.4,metalness:.5,roughness:.3}),-35,8,-32,1,1,1).rotation.x=Math.PI/2;addProp(new THREE.BoxGeometry(9,.8,1),mat(0x3a4a58,.5,.4),-35,12,-32);}
  if(key==='volcano'){for(let i=0;i<22;i++){const x=(Math.random()-.5)*45,z=-18+Math.random()*10,h=2+Math.random()*7;addProp(new THREE.ConeGeometry(1.4+Math.random()*1.5,h,5),mat(0x292124,.2,.95),x,h*.35,z,1,.7,1);if(i%2===0)addProp(new THREE.BoxGeometry(.12,h*.8,.12),new THREE.MeshBasicMaterial({color:0xff4b18}),x,h*.35,z+.8,1,1,1);}}else if(key==='ice'){for(let i=0;i<26;i++){const x=(Math.random()-.5)*44,z=-20+Math.random()*18,h=2+Math.random()*7;const crystal=addProp(new THREE.OctahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:i%2?0x75dfff:0xd3f7ff,metalness:.25,roughness:.2,emissive:0x1d7399,emissiveIntensity:.35}),x,h*.35,z,.45,h*.65,.45);crystal.rotation.z=(Math.random()-.5)*.3;}}else if(key==='neon'){for(let i=0;i<30;i++){const x=(Math.random()-.5)*48,z=-23+Math.random()*14,h=4+Math.random()*12,w=1.2+Math.random()*2;addProp(new THREE.BoxGeometry(w,h,1.5),mat(i%2?0x252043:0x172e4a,.6,.3),x,h/2-1,z);for(let row=1;row<h;row+=1.7)addProp(new THREE.BoxGeometry(w*.55,.07,.04),new THREE.MeshBasicMaterial({color:i%2?0xff32db:0x31eaff}),x,row,z+.8);}}else if(key!=='finalvalley'){for(let i=0;i<42;i++){const x=(Math.random()-.5)*230,z=-85+Math.random()*210,h=2+Math.random()*12;addProp(new THREE.DodecahedronGeometry(1,2),mat(0x384858,.15,.9),x,h*.35,z,2+Math.random()*4,h*.6,2+Math.random()*4);}}
 // Large landmark clusters give each region a recognizable destination beyond the combat start.
 const landmarkMat=mat(key==='volcano'?0x41272a:key==='ice'?0x9dd9e9:key==='neon'?0x252044:0x536477,.38,.48);
 const glowMat=new THREE.MeshStandardMaterial({color:t.ringA,emissive:t.ringA,emissiveIntensity:1.8,metalness:.3,roughness:.28});
 const landmark=(x,z,scale=1)=>{const base=addProp(new THREE.DodecahedronGeometry(1,2),landmarkMat,x,.25*scale,z,6*scale,.7*scale,5*scale);base.rotation.y=.2;for(let side=-1;side<=1;side+=2){const pillar=addProp(new THREE.BoxGeometry(1.3*scale,9*scale,1.5*scale),landmarkMat,x+side*4*scale,4.5*scale,z);pillar.rotation.z=side*.06;const seam=addProp(new THREE.BoxGeometry(.12*scale,7*scale,.15*scale),glowMat,x+side*4*scale,4.6*scale,z+.82*scale);seam.rotation.z=side*.06;}const arch=addProp(new THREE.BoxGeometry(10*scale,1.2*scale,1.5*scale),landmarkMat,x,9*scale,z);const beacon=addProp(new THREE.OctahedronGeometry(1.1*scale,2),glowMat,x,6*scale,z+.5*scale);beacon.rotation.y=.6;};
 if(key==='valley'){landmark(-92,-72,1.6);landmark(104,56,1.2);for(let i=0;i<18;i++){const x=-125+i*14,z=88+Math.sin(i*.4)*9;addProp(new THREE.CylinderGeometry(.35,.6,5+Math.random()*9,7),landmarkMat,x,3,z);}}
 else if(key==='volcano'){landmark(-90,-65,1.4);for(let i=0;i<28;i++){const x=(Math.random()-.5)*230,z=(Math.random()-.5)*230,h=3+Math.random()*13;addProp(new THREE.ConeGeometry(3+Math.random()*5,h,7),landmarkMat,x,h*.35,z);if(i%2===0)addProp(new THREE.BoxGeometry(.18,h*.8,.18),glowMat,x,h*.4,z+2);}}
 else if(key==='ice'){landmark(95,-75,1.5);for(let i=0;i<36;i++){const x=(Math.random()-.5)*230,z=(Math.random()-.5)*230,h=4+Math.random()*18;const crystal=addProp(new THREE.OctahedronGeometry(1,1),glowMat,x,h*.32,z,1.1,h*.9,1.1);crystal.rotation.z=(Math.random()-.5)*.3;}}
 else if(key==='neon'){landmark(0,-100,1.8);for(let i=0;i<45;i++){const x=(Math.random()-.5)*220,z=(Math.random()-.5)*220,h=8+Math.random()*28,w=2+Math.random()*5;addProp(new THREE.BoxGeometry(w,h,w),landmarkMat,x,h/2,z);for(let row=2;row<h;row+=2.5)addProp(new THREE.BoxGeometry(w*.6,.09,.06),glowMat,x,row,z+w/2+.04);}}
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
 combatItems.seed(key);$status.textContent=t.label+' · ROUND 01';localStorage.setItem('browserSmashMap',key);}
// Lightweight arena collision proxies keep fighters from walking through major landmarks while preserving free-roam movement.
const arenaCollision={
 valley:[[-27,-24,8],[25,-24,8],[-7,-48,2.2],[-3.5,-48,1.8],[0,-48,1.8],[3.5,-48,1.8],[7,-48,2.2],[-22,-16,2],[22,-18,2],[-36,8,2.5],[36,12,2.5],[-12,-32,2],[15,-38,2]],
 volcano:[[-32,-38,12],[-90,-65,11]],
 ice:[[-34,-35,9],[95,-75,12]],
 neon:[[0,-100,12]],
 deathstar:[[10,-80,8]],
 finalvalley:[],
 tournament:[[-15,-20,1.2],[-15,-4,1.2],[15,-20,1.2],[15,-4,1.2]],
 starktower:[[32,-28,2.2],[43,-30,1.7],[44,-14,1.9]],
 asgard:[[-10,-78,2.2],[-10,-66,2.2],[-10,-54,2.2],[-10,-42,2.2],[-10,-30,2.2],[-10,-18,2.2],[-10,-6,2.2],[10,-78,2.2],[10,-66,2.2],[10,-54,2.2],[10,-42,2.2],[10,-30,2.2],[10,-18,2.2],[10,-6,2.2]],
 hogwarts:[[-20,-32,1.1],[20,-32,1.1]]
};
function resolveArenaCollision(fighter){
 const key=mapSelect?.value||'valley', obstacles=[...(arenaCollision[key]||[]),...(key==='finalvalley'?finalValleyArena.obstacles:[])];
 for(const [ox,oz,radius] of obstacles){
  const dx=fighter.position.x-ox,dz=fighter.position.z-oz,d=Math.hypot(dx,dz);
  const min=radius+(fighter.hurtboxRadius||.7);
  if(d<min){
   const nx=d>.001?dx/d:1,nz=d>.001?dz/d:0;
   fighter.position.x=ox+nx*min;fighter.position.z=oz+nz*min;
   const inward=fighter.velocity.x*nx+fighter.velocity.z*nz;
   if(inward<0){fighter.velocity.x-=inward*nx;fighter.velocity.z-=inward*nz;}
  }
 }
}
if(mapSelect){const savedMap=localStorage.getItem('browserSmashMap');mapSelect.value=(savedMap&&savedMap!=='valley')?savedMap:'finalvalley';mapSelect.addEventListener('change',()=>{applyMap(mapSelect.value);if(exploration)$status.textContent='FREE ROAM · '+mapThemes[mapSelect.value].label;if(menuMapSelect)menuMapSelect.value=mapSelect.value;});if(menuMapSelect){menuMapSelect.value=mapSelect.value;menuMapSelect.addEventListener('change',()=>{mapSelect.value=menuMapSelect.value;applyMap(menuMapSelect.value);if(exploration)$status.textContent='FREE ROAM · '+mapThemes[menuMapSelect.value].label;});}applyMap(mapSelect.value);}
function reset(isPractice=false){exploration=false;player.roamMode=false;player.flightMode=false;cpu.flightMode=false;window.endWebSwing?.(player,false);window.endWebSwing?.(cpu,false);player.attackBuffer=0;cpu.attackBuffer=0;cpu.model.visible=true;applyFloorFootprint();platform.scale.set(1,1,1);platform.visible=false;document.querySelectorAll('.fighter').forEach(n=>n.style.display='');$('#timer').style.display='';if($('#energyHUD'))$('#energyHUD').style.opacity='1';$('#exploreHint').style.display='none';player.roamMode=true;cpu.roamMode=true;const arenaKey=mapSelect?.value||'valley';const stageCenterZ=({valley:0,volcano:-20,ice:-20,neon:-20,deathstar:-31,finalvalley:-30,tournament:-12,starktower:-24,asgard:-26,hogwarts:-32})[arenaKey]??0;const stageCenterX=0;const startGap=arenaKey==='finalvalley'?6.2:5.4;player.position.set(stageCenterX-startGap,0,stageCenterZ);cpu.position.set(stageCenterX+startGap,0,stageCenterZ+.7);player.velocity.set(0,0,0);cpu.velocity.set(0,0,0);player.facing=Math.sign(cpu.position.x-player.position.x)||1;player.facingZ=Math.sign(cpu.position.z-player.position.z);cpu.facing=-player.facing;cpu.facingZ=-player.facingZ;player.percent=cpu.percent=0;player.hitstun=cpu.hitstun=0;player.attackQueue=[];cpu.attackQueue=[];player.attackBuffer=0;cpu.attackBuffer=0;player.hitboxes=[];cpu.hitboxes=[];remaining=105;started=true;practice=isPractice;$('#menu').classList.add('hidden');$('#cameraSettings').style.display='block';$('#result').textContent='';$status.textContent=isPractice?'PRACTICE MODE · POWERS ENABLED':(mapThemes[mapSelect?.value||'valley']?.label||'VALLEY OF ECHOES')+' · ROUND 01';}
$('#play').addEventListener('click',()=>reset(false));$('#practice').addEventListener('click',()=>reset(true));const exploreButton=$('#explore');if(exploreButton)exploreButton.addEventListener('click',()=>{exploration=true;practice=true;started=true;player.roamMode=true;const roamKey=mapSelect?.value||'valley';const roamStart=({valley:[0,0],finalvalley:[0,-24],starktower:[0,-24],deathstar:[0,-22],asgard:[0,-20],hogwarts:[0,-26],tournament:[0,-12]})[roamKey]||[0,0];player.position.set(roamStart[0],0,roamStart[1]);player.velocity.set(0,0,0);cpu.model.visible=false;applyFloorFootprint();platform.visible=false;remaining=0;$('#menu').classList.add('hidden');$('#cameraSettings').style.display='block';document.querySelectorAll('.fighter').forEach(n=>n.style.display='none');$('#timer').style.display='none';if($('#energyHUD'))$('#energyHUD').style.opacity='0';$('#exploreHint').style.display='block';$('#status').textContent='FREE ROAM · '+(mapThemes[mapSelect?.value||'valley']?.label||'VALLEY OF ECHOES');});addEventListener('keydown',e=>{if(e.key==='Escape'&&exploration){exploration=false;player.roamMode=false;cpu.model.visible=true;applyFloorFootprint();platform.scale.set(1,1,1);document.querySelectorAll('.fighter').forEach(n=>n.style.display='');$('#timer').style.display='';$('#exploreHint').style.display='none';started=false;$('#menu').classList.remove('hidden');$('#cameraSettings').style.display='none';}});
function finish(text){exploration=false;player.roamMode=false;cpu.model.visible=true;applyFloorFootprint();platform.scale.set(1,1,1);document.querySelectorAll('.fighter').forEach(n=>n.style.display='');$('#timer').style.display='';$('#exploreHint').style.display='none';started=false;$('#menu').classList.remove('hidden');$('#cameraSettings').style.display='none';$('#result').textContent=text;$('#play').textContent='REMATCH';}
function updateHud(){const p1damage=$('#p1damage'),p2damage=$('#p2damage'),p1name=$('#p1name'),p2name=$('#p2name'),p1special=$('#p1special'),p2special=$('#p2special');if(p1damage)p1damage.textContent=Math.floor(player.percent)+'%';if(p2damage)p2damage.textContent=Math.floor(cpu.percent)+'%';if(p1name)p1name.textContent='P1 · '+fighterDisplay(playerType).toUpperCase();if(p2name)p2name.textContent=fighterDisplay(cpuType).toUpperCase()+' · CPU';const p1profile=player.specialProfile||SPECIAL_MOVES[player.identityKey]||{label:'SIGNATURE STRIKE'},p2profile=cpu.specialProfile||SPECIAL_MOVES[cpu.identityKey]||{label:'SIGNATURE STRIKE'};if(p1special)p1special.textContent=(player.specialCooldown<=0?'READY · ':'RECHARGING · ')+p1profile.label;if(p2special)p2special.textContent=(cpu.specialCooldown<=0?'CPU READY · ':'CPU RECHARGING · ')+p2profile.label;$('#p1bar').style.width=Math.max(0,100-player.percent*.72)+'%';$('#p2bar').style.width=Math.max(0,100-cpu.percent*.72)+'%';const seconds=Math.ceil(remaining);$('#timer').textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');const energy=Math.max(0,Math.min(100,(1-player.specialCooldown/.82)*100));const ef=$('#energyFill'),eh=$('#energyHUD');if(ef)ef.style.width=energy+'%';if(eh){eh.classList.toggle('ready',player.specialCooldown<=0);eh.style.opacity=exploration?'0':'1';}const combo=$('#comboNotice');if(combo){const show=player.comboHitCount>=2&&player.comboWindow>0;if(show){combo.textContent=player.comboStep===3?'AIR / GROUND FINISHER · '+player.comboHitCount+' HITS':player.comboHitCount+' HIT COMBO';combo.classList.add('show');}else combo.classList.remove('show');}}
const clock=new THREE.Clock();
function frame(){requestAnimationFrame(frame);const elapsed=Math.min(clock.getDelta(),.05);clockDelta=elapsed;accumulator+=elapsed;
while(accumulator>=1/60){input.update();if(started){player.simulate(1/60,input);cpu.simulate(1/60,ai);window.updateSignatureMoves?.(1/60);resolveArenaCollision(player);if(!exploration)resolveArenaCollision(cpu);if(!practice&&!exploration)remaining=Math.max(0,remaining-1/60);if(!exploration&&cpu.percent>=140)finish('VICTORY · '+fighterDisplay(playerType).toUpperCase());else if(!exploration&&player.percent>=140)finish('DEFEAT · '+fighterDisplay(cpuType).toUpperCase());else if(!exploration&&remaining<=0)finish(player.percent<=cpu.percent?'TIME UP · YOU WIN':'TIME UP · CPU WINS');updateHud();}accumulator-=1/60;}

combatItems.update(elapsed,[player,cpu],started&&!exploration,mapSelect?.value||'valley');
for(const f of window.fighters)animateHumanFighter(f,elapsed);
cinematicEnvironment.userData.update(elapsed,clock.elapsedTime,camera);
finalValleyArena.update(elapsed,clock.elapsedTime);
for(const p of dust.children){p.position.y+=p.userData.speed*elapsed;p.position.x+=Math.sin(p.position.y)*elapsed*.15;if(p.position.y>12)p.position.y=-1;}
for(let i=projectiles.length-1;i>=0;i--){const p=projectiles[i];p.life-=elapsed;if(p.moveType==='grenade')p.velocity.y-=10.5*elapsed;else if(['beam','lightning','fireball','frost','curse','web','wood'].includes(p.moveType)){p.trailT=(p.trailT||0)+elapsed;if(p.trailT>=.065){burst(p.group.position,p.color,3,p.moveType==='beam'?1.3:2.1);p.trailT=0;}}p.group.position.addScaledVector(p.velocity,elapsed);p.group.rotation.x+=elapsed*4;p.group.rotation.y+=elapsed*7;const target=p.owner===player?cpu:player;if(p.group.position.distanceTo(target.position.clone().add(new THREE.Vector3(0,1.1,0)))<.95){if(target.parryTimer>0&&target.hitstun<=0&&target.guardBreak<=0){target.parryTimer=0;target.counterWindow=1.2;target.counterFlash=.52;target.invulnerable=Math.max(target.invulnerable,.16);p.owner=target;p.velocity.multiplyScalar(-1);p.life=Math.max(p.life,.85);p.color=0x75f5ff;p.group.traverse(o=>{if(o.material?.color)o.material.color.setHex(p.color);if(o.material?.emissive)o.material.emissive.setHex(p.color);});p.group.position.addScaledVector(p.velocity.clone().normalize(),.35);window.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0,1.2,0)),8);window.showCombatCallout?.('PROJECTILE REFLECTED!','#75f5ff');continue;}if(p.moveType==='grenade'){detonateGrenade(p);scene.remove(p.group);projectiles.splice(i,1);continue;}const guarded=target.guardHeld&&target.guardBreak<=0;target.percent+=p.damage*(guarded?.3:1);target.hitstun=guarded?.1:(p.webShot?Math.max(.8,p.stun||.8):(p.stun||.42));const launchScale=guarded?.25:(p.knockback||5),speedScale=p.velocity.length()||20;target.velocity.x=p.velocity.x/speedScale*launchScale;target.velocity.z=p.velocity.z/speedScale*launchScale;target.velocity.y=guarded?1.2:(p.moveType==='shockwave'?5.2:p.moveType==='psychic'?1.2:p.moveType==='web'?1.1:3.2+Math.min(2,launchScale*.12));if(!guarded&&p.moveType==='lasso'){const pull=p.owner.position.clone().sub(target.position);pull.y=0;if(pull.lengthSq()>.01){pull.normalize();target.velocity.x=pull.x*5.8;target.velocity.z=pull.z*5.8;target.velocity.y=1.1;}}if(!guarded&&p.moveType==='wood'){target.velocity.x*=.55;target.velocity.z*=.55;target.hitstun+=.18;}target.isGrounded=false;const sparkCount=guarded?10:p.moveType==='lightning'?44:p.moveType==='fireball'?38:p.moveType==='shockwave'?48:p.moveType==='frost'?28:32;const sparkPower=guarded?2:p.moveType==='shockwave'?9:p.moveType==='lightning'?6.8:8;burst(p.group.position,p.color,sparkCount,sparkPower);if(!guarded&&['shockwave','beam','lightning','fireball','frost'].includes(p.moveType))window.spawnImpact?.(target.position.clone().add(new THREE.Vector3(0,1.1,0)),p.moveType==='shockwave'?18:12);window.showCombatCallout?.(p.profile?.label||(p.webShot?'WEB SNARE':'SPECIAL HIT'),guarded?'#a4bfff':'#ffe6a8');scene.remove(p.group);projectiles.splice(i,1);continue;}if(p.life<=0||Math.abs(p.group.position.x)>320||Math.abs(p.group.position.z)>320){if(p.moveType==='grenade'&&p.life<=0)detonateGrenade(p);scene.remove(p.group);projectiles.splice(i,1);}}
for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.t+=elapsed;for(const p of e.group.children){p.position.addScaledVector(p.userData.v,elapsed);p.userData.v.y-=7*elapsed;p.scale.setScalar(Math.max(.01,1-e.t/e.life));}if(e.t>=e.life){scene.remove(e.group);e.group.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});effects.splice(i,1);}}
for(let i=impactRings.length-1;i>=0;i--){
 const ring=impactRings[i];ring.t+=elapsed;const p=Math.min(1,ring.t/ring.life);
 ring.mesh.scale.setScalar(.35+(ring.max-.35)*p);ring.mesh.material.opacity=.92*(1-p);
 if(p>=1){scene.remove(ring.mesh);ring.mesh.geometry.dispose();ring.mesh.material.dispose();impactRings.splice(i,1);}
}
smashCamera.update(player,exploration?player:cpu,elapsed,exploration?'over-p1':cameraMode);composer.render();const assetDiagnostics=window.__browserSmashAssets;if(assetDiagnostics){assetDiagnostics.app=assetDiagnostics.app||{};assetDiagnostics.app.status='running';assetDiagnostics.app.frames=(assetDiagnostics.app.frames||0)+1;}}
addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.65));composer.setSize(innerWidth,innerHeight);});
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
frame();checkAssetLoadingStatus();
