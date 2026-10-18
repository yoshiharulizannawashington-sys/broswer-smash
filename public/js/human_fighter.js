// Loads a rigged humanoid with real skeletal animation. Procedural fighter remains as a safe fallback.
const MODEL_URL='https://threejs.org/examples/models/gltf/Soldier.glb';
let loaderPromise;
async function getLoader(){if(!loaderPromise)loaderPromise=import('https://esm.sh/three@0.152.2/examples/jsm/loaders/GLTFLoader.js');return loaderPromise;}
const palette={warrior:0x9a3e34,ninja:0x343b50,brawler:0x9a672e,mage:0x4c3b91,cyborg:0x247b91};
export async function upgradeFighterModel(fighter,archetype='warrior'){
 const {GLTFLoader}=await getLoader();
 const gltf=await new Promise((resolve,reject)=>new GLTFLoader().load(MODEL_URL,resolve,undefined,reject));
 const root=gltf.scene;root.scale.setScalar(1.45);root.rotation.y=Math.PI;root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material=o.material.clone();if(o.material.color)o.material.color.lerp(new (o.material.color.constructor)(palette[archetype]||palette.warrior),.26);if('roughness' in o.material)o.material.roughness=Math.min(.72,Math.max(.3,o.material.roughness??.5));}}});
 root.position.copy(fighter.position);root.userData.humanAnimations={};
 const mixer=new (await import('https://esm.sh/three@0.152.2/build/three.module.js')).AnimationMixer(root);
 for(const clip of gltf.animations){const key=clip.name.toLowerCase();root.userData.humanAnimations[key]=mixer.clipAction(clip);}
 const find=prefix=>Object.entries(root.userData.humanAnimations).find(([n])=>n.includes(prefix))?.[1];
 const idle=find('idle')||gltf.animations[0]&&mixer.clipAction(gltf.animations[0]);const walk=find('walk');const run=find('run');
 if(idle){idle.play();root.userData.activeAction=idle;}
 const previous=fighter.model;const parent=previous.parent;root.position.copy(fighter.position);root.userData.humanMixer=mixer;root.userData.walkAction=walk;root.userData.runAction=run;root.userData.idleAction=idle;root.userData.lastMoveAction=idle;
 if(parent){parent.add(root);parent.remove(previous);}else if(typeof window!=='undefined'&&window.__smashScene)window.__smashScene.add(root);
 fighter.model=root;return root;
}
export function animateHumanFighter(fighter,dt){const root=fighter.model;if(!root?.userData?.humanMixer)return;root.userData.humanMixer.update(dt);const speed=Math.hypot(fighter.velocity.x,fighter.velocity.z);const target=speed>8?root.userData.runAction:speed>.45?root.userData.walkAction:root.userData.idleAction;if(target&&target!==root.userData.lastMoveAction){const old=root.userData.lastMoveAction;target.reset().fadeIn(.18).play();if(old&&old!==target)old.fadeOut(.18);root.userData.lastMoveAction=target;}}
