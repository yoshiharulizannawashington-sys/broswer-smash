// Fighter simulation: camera-independent movement, AI, combat windows and articulated procedural animation.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
const rad=d=>d*Math.PI/180;
export default class Fighter3D {
 constructor({name='Fighter',model,weight=85,player=false}) {
  this.name=name;this.model=model;this.weight=weight;this.player=player;this.position=model.position;this.velocity=new THREE.Vector3();
  this.percent=0;this.isGrounded=true;this.hitstun=0;this.hurtboxRadius=.7;this.attackQueue=[];this.hitboxes=[];this.t=Math.random()*10;this.facing=player?1:-1;this.aiTimer=0;this.lastAttack=0;
 }
 simulate(dt,inputHandler) {
  this.t+=dt; const inputs=inputHandler.getInputs();
  if(this.hitstun>0)this.hitstun=Math.max(0,this.hitstun-dt);
  if(this.hitstun<=0)this.handleInput(inputs,dt);
  this.velocity.y-=24*dt;this.position.addScaledVector(this.velocity,dt);
  if(this.position.y<=0){this.position.y=0;this.velocity.y=Math.max(0,this.velocity.y);this.isGrounded=true;}else this.isGrounded=false;
  this.position.x=THREE.MathUtils.clamp(this.position.x,-17,17);
  this.velocity.x*=Math.pow(this.isGrounded?.82:.985,dt*60);
  this.updateProceduralPose(inputs,dt);this.updateAttackQueue(dt);this.updateHitboxes();
 }
 handleInput(i,dt) {
  const movingLeft=!!i.left,movingRight=!!i.right;
  if(movingLeft||movingRight){
   const dir=(movingRight?1:0)-(movingLeft?1:0);this.velocity.x=THREE.MathUtils.damp(this.velocity.x,dir*(i.sprint?10:i.run?7:4.3),12,dt);
   this.facing=dir;
  } else this.velocity.x=THREE.MathUtils.damp(this.velocity.x,0,9,dt);
  if(i.jump&&this.isGrounded){this.velocity.y=9.5;this.isGrounded=false;}
  if(i.dodge&&this.isGrounded){this.velocity.x=this.facing*-this.facing*10;this.velocity.y=2.5;}
  if(i.attack&&this.attackQueue.length===0)this.attackQueue.push({total:.34,t:0,start:.09,end:.18,damage:7,angle:32,kbs:70});
  if(i.special&&this.attackQueue.length===0)this.attackQueue.push({total:.55,t:0,start:.16,end:.27,damage:13,angle:55,kbs:100});
 }
 updateProceduralPose(i,dt) {
  const u=this.model.userData, speed=Math.min(1,Math.abs(this.velocity.x)/7), phase=this.t*(5+speed*9);
  if(u.leftLeg){u.leftLeg.rotation.x=Math.sin(phase)*.68*speed;u.rightLeg.rotation.x=-Math.sin(phase)*.68*speed;u.leftShin.rotation.x=Math.max(0,-Math.sin(phase))*.55*speed;u.rightShin.rotation.x=Math.max(0,Math.sin(phase))*.55*speed;
   u.leftArm.rotation.x=-Math.sin(phase)*.5*speed;u.rightArm.rotation.x=Math.sin(phase)*.5*speed;
   u.leftFore.rotation.x=-.2;u.rightFore.rotation.x=-.2;
  }
  if(u.torso){u.torso.rotation.z=-this.velocity.x*.018;u.torso.position.y=.28+(this.isGrounded?Math.sin(this.t*3)*.018:0);}
  if(u.head)u.head.rotation.y=this.facing<0?Math.PI:0;
  this.model.rotation.y=this.facing<0?Math.PI:0;
  if(this.attackQueue.length&&u.rightArm)u.rightArm.rotation.x=-1.35;
  if(i.shield&&u.leftArm)u.leftArm.rotation.x=-1;
 }
 updateAttackQueue(dt){
  for(let n=this.attackQueue.length-1;n>=0;n--){const a=this.attackQueue[n];a.t+=dt;if(!a.hit&&a.t>=a.start&&a.t<=a.end){a.hit=true;this.spawnHitbox(a);}if(a.t>=a.total)this.attackQueue.splice(n,1);}
 }
 spawnHitbox(a){const forward=new THREE.Vector3(this.facing,0,0);const pos=this.position.clone().addScaledVector(forward,1.05).add(new THREE.Vector3(0,1.35,0));this.hitboxes.push({pos,radius:1.05,damage:a.damage,angle:a.angle,kbs:a.kbs,lifetime:.12});}
 updateHitboxes(){
  for(let n=this.hitboxes.length-1;n>=0;n--){const h=this.hitboxes[n];h.lifetime-=1/60;let hit=false;
   for(const other of (window.fighters||[])){if(other===this)continue;const d=h.pos.distanceTo(other.position.clone().add(new THREE.Vector3(0,1,0)));if(d<h.radius+other.hurtboxRadius){other.percent+=h.damage;other.hitstun=.28+Math.min(.8,other.percent/180);other.velocity.x=this.facing*h.kbs*(.035+other.percent/1200);other.velocity.y=Math.max(other.velocity.y,2.4+h.kbs*.025);other.isGrounded=false;window.spawnImpact?.(h.pos,h.damage);hit=true;break;}}
   if(hit||h.lifetime<=0)this.hitboxes.splice(n,1);
  }
 }
 updateAnimations(){}
}
