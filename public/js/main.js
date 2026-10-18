// Browser Smash cinematic arena. Uses original locally generated fighters; remote assets are optional, never required.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.152.2/examples/jsm/postprocessing/UnrealBloomPass.js';
import SmashInputHandler from './smash_input.js';
import Fighter3D from './fighter3D.js';
import { makeProceduralCharacter } from './models.js';

const canvas=document.querySelector('#gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x111b30);scene.fog=new THREE.FogExp2(0x253448,.009);
const camera=new THREE.PerspectiveCamera(46,innerWidth/innerHeight,.1,400);camera.position.set(0,8,19);
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.52,.45,.78);composer.addPass(bloom);
scene.add(new THREE.HemisphereLight(0x9ecfff,0x191421,1.4));
const sun=new THREE.DirectionalLight(0xffd2a1,3.2);sun.position.set(-8,16,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-24;sun.shadow.camera.right=24;sun.shadow.camera.top=24;sun.shadow.camera.bottom=-24;scene.add(sun);
const rim=new THREE.DirectionalLight(0x218cff,2.1);rim.position.set(10,7,-12);scene.add(rim);
const mat=(color,metalness=.1,roughness=.8,emissive=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:1});
const ground=new THREE.Mesh(new THREE.PlaneGeometry(48,30),mat(0x26313b,.24,.68));ground.rotation.x=-Math.PI/2;ground.position.y=-.04;ground.receiveShadow=true;scene.add(ground);
const platform=new THREE.Mesh(new THREE.BoxGeometry(38,.55,19),mat(0x343a42,.4,.52));platform.position.y=-.34;platform.receiveShadow=true;platform.castShadow=true;scene.add(platform);
// Inlaid arena rings and radial seams.
for(let r=2;r<=17;r+=3){const ring=new THREE.Mesh(new THREE.TorusGeometry(r,.025,5,120),new THREE.MeshStandardMaterial({color:r%2?0x287b9e:0x8e613e,emissive:r%2?0x063d63:0x3a1b09,emissiveIntensity:.7,metalness:.7,roughness:.3}));ring.rotation.x=Math.PI/2;ring.position.y=.012;scene.add(ring);}
for(let x=-16;x<=16;x+=4){const seam=new THREE.Mesh(new THREE.BoxGeometry(.025,.012,18),mat(0x667786,.55,.35));seam.position.set(x,.015,0);scene.add(seam);}
// Layered cliffs, pillars, waterfall-like glowing energy falls, distant skyline.
for(let side of [-1,1]){
 for(let i=0;i<11;i++){const h=3+Math.random()*8,w=1.2+Math.random()*2.8;const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),mat(i%3?0x303b4b:0x4a4147,.12,.93));rock.scale.set(w,h*.72,2+Math.random()*3);rock.position.set(side*(21+Math.random()*8),h*.45-1,-15+i*3);rock.rotation.set(Math.random(),Math.random(),Math.random()*.2);rock.castShadow=true;scene.add(rock);}
 for(let i=0;i<5;i++){const pillar=new THREE.Mesh(new THREE.BoxGeometry(.65,4+Math.random()*5,.65),mat(0x263d54,.45,.45,0x061a2c));pillar.position.set(side*(8+i*2.8),2,-11-Math.random()*5);pillar.castShadow=true;scene.add(pillar);const light=new THREE.Mesh(new THREE.BoxGeometry(.08,2,.08),new THREE.MeshBasicMaterial({color:0x39dfff}));light.position.set(pillar.position.x,2.3,pillar.position.z+.36);scene.add(light);}
}
const sunBall=new THREE.Mesh(new THREE.SphereGeometry(2.1,24,16),new THREE.MeshBasicMaterial({color:0xffb66f}));sunBall.position.set(-11,10,-45);scene.add(sunBall);
const halo=new THREE.Mesh(new THREE.TorusGeometry(3.2,.09,8,64),new THREE.MeshBasicMaterial({color:0xff8c4d}));halo.position.copy(sunBall.position);halo.rotation.x=.9;scene.add(halo);
const skylineMat=mat(0x17283e,.45,.5);
for(let i=0;i<22;i++){const h=3+Math.random()*12;const b=new THREE.Mesh(new THREE.BoxGeometry(1+Math.random()*2,h,1+Math.random()*2),skylineMat);b.position.set(-30+i*2.8,h/2-1,-34-Math.random()*15);scene.add(b);if(i%3===0){const l=new THREE.Mesh(new THREE.BoxGeometry(.06,h*.5,.06),new THREE.MeshBasicMaterial({color:0x28cfff}));l.position.set(b.position.x,h*.65,b.position.z+.6);scene.add(l);}}
const dust=new THREE.Group();scene.add(dust);const dustMat=new THREE.MeshBasicMaterial({color:0xb6eaff,transparent:true,opacity:.48});
for(let i=0;i<110;i++){const p=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.035,5,5),dustMat);p.position.set((Math.random()-.5)*42,Math.random()*12-1,(Math.random()-.5)*25);p.userData.speed=.15+Math.random()*.45;dust.add(p);}
const input=new SmashInputHandler();window.fighters=[];
function spawn(name,x,archetype,player){const model=makeProceduralCharacter(archetype);model.position.set(x,0,0);scene.add(model);const f=new Fighter3D({name,model,weight:player?88:82,player});window.fighters.push(f);return f;}
const player=spawn('Crimson Vanguard',-4,'warrior',true),cpu=spawn('Shadow Shinobi',4,'ninja',false);player.facing=1;cpu.facing=-1;
const ai={getInputs(){const dx=player.position.x-cpu.position.x,dist=Math.abs(dx);cpu.aiTimer-=clockDelta;const attack=dist<2.1&&cpu.aiTimer<=0;if(attack)cpu.aiTimer=.8+Math.random()*.55;return {left:dx< -1.5,right:dx>1.5,run:dist>5,sprint:dist>8,jump:false,dodge:false,attack:attack&&Math.random()>.32,special:attack&&Math.random()>.78,shield:dist<2&&Math.random()<.015,up:false,down:false};}};
window.camState={shake:0,targetZoom:19};
window.spawnImpact=(pos,intensity=5)=>{const group=new THREE.Group();for(let i=0;i<9;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.035+Math.random()*.05,5,5),new THREE.MeshBasicMaterial({color:i%2?0x53eaff:0xffbd72}));m.position.copy(pos);m.userData.v=new THREE.Vector3((Math.random()-.5)*5,Math.random()*4,(Math.random()-.5)*2);group.add(m);}scene.add(group);effects.push({group,t:0,life:.38});bloom.strength=Math.min(.9,.5+intensity*.02);};
const effects=[];let clockDelta=1/60,remaining=99,started=false,ended=false,practice=false,lastSecond=99;
const $=s=>document.querySelector(s);
function reset(isPractice=false){player.position.set(-4,0,0);cpu.position.set(4,0,0);player.velocity.set(0,0,0);cpu.velocity.set(0,0,0);player.percent=cpu.percent=0;player.hitstun=cpu.hitstun=0;player.attackQueue=[];cpu.attackQueue=[];remaining=99;started=true;ended=false;practice=isPractice;$('#menu').classList.add('hidden');$('#result').textContent='';$('#status').textContent=isPractice?'PRACTICE MODE · TRAINING ACTIVE':'VALLEY OF ECHOES · ROUND 01';}
$('#play').addEventListener('click',()=>reset(false));$('#practice').addEventListener('click',()=>reset(true));
function finish(text){ended=true;started=false;$('#menu').classList.remove('hidden');$('#result').textContent=text;$('#play').textContent='REMATCH';}
function updateHud(){ $('#p1bar').style.width=Math.max(0,100-player.percent*.72)+'%';$('#p2bar').style.width=Math.max(0,100-cpu.percent*.72)+'%';$('#timer').textContent=String(Math.ceil(remaining)).padStart(2,'0');}
const clock=new THREE.Clock();let accumulator=0;
function frame(){requestAnimationFrame(frame);const elapsed=Math.min(clock.getDelta(),.05);clockDelta=elapsed;accumulator+=elapsed;
 while(accumulator>=1/60){if(started){player.simulate(1/60,input);cpu.simulate(1/60,ai);if(!practice)remaining=Math.max(0,remaining-1/60);if(cpu.percent>=140)finish('VICTORY · CRIMSON VANGUARD');else if(player.percent>=140)finish('DEFEAT · SHADOW SHINOBI');else if(remaining<=0)finish(player.percent<=cpu.percent?'TIME UP · YOU WIN':'TIME UP · CPU WINS');updateHud();}accumulator-=1/60;}
 for(const p of dust.children){p.position.y+=p.userData.speed*elapsed;p.position.x+=Math.sin(p.position.y)*elapsed*.15;if(p.position.y>12)p.position.y=-1;}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.t+=elapsed;for(const p of e.group.children){p.position.addScaledVector(p.userData.v,elapsed);p.userData.v.y-=7*elapsed;p.scale.setScalar(Math.max(.01,1-e.t/e.life));}if(e.t>=e.life){scene.remove(e.group);e.group.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});effects.splice(i,1);}}
 const mid=(player.position.x+cpu.position.x)/2;const distance=Math.abs(player.position.x-cpu.position.x);const z=THREE.MathUtils.damp(camera.position.z,Math.max(15,17+distance*.45),3,elapsed);camera.position.set(THREE.MathUtils.damp(camera.position.x,mid*.3,3,elapsed),THREE.MathUtils.damp(camera.position.y,6.6,3,elapsed),z);camera.lookAt(mid*.45,2.2,-2.5);
 composer.render();
}
addEventListener('resize',()=>{renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();composer.setSize(innerWidth,innerHeight);bloom.setSize(innerWidth,innerHeight);});
$('#loading').textContent='READY · ORIGINAL FIGHTERS LOADED';setTimeout(()=>$('#loading').style.opacity='0',2200);
frame();
