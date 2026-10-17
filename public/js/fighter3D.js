// public/js/fighter3D.js — state machine, procedural animation, hitboxes, KB, VFX hooks
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

const toRad = deg => deg * Math.PI / 180;
export default class Fighter3D{
  constructor({name='F',model,weight=85}){
    this.name = name; this.model = model; this.weight = weight; this.position = model.position; this.velocity = new THREE.Vector3(); this.percent = 0; this.isGrounded = true; this.hitstun = 0; this.hurtboxRadius = 0.92; this.hitboxes = []; this.attackQueue=[]; this.t = Math.random()*1000; this.weight = weight;}

  simulate(dt,inputHandler){
    const inputs = inputHandler.getInputs(); this.t += dt*60;
    if(this.hitstun>0) this.hitstun = Math.max(0,this.hitstun-1);
    if(this.hitstun===0) this.handleInput(inputs);
    // physics
    this.velocity.y -= 30*dt; this.position.addScaledVector(this.velocity,dt);
    if(this.position.y<=0){ this.position.y=0; this.velocity.y=0; this.isGrounded=true; } else this.isGrounded=false;
    this.updateProceduralPose(); this.updateAttackQueue(); this.updateHitboxes();
  }

  handleInput(inputs){
    if(inputs.left){ this.velocity.x = -6; this.model.rotation.y = Math.PI; }
    else if(inputs.right){ this.velocity.x = 6; this.model.rotation.y = 0; }
    else this.velocity.x *= 0.86;
    if(inputs.jump && this.isGrounded){ this.velocity.y = 12; this.isGrounded=false; }
    if(inputs.attack){ if(this.attackQueue.length===0) this.attackQueue.push({ total:20, frame:0, hitStart:6, hitEnd:10, dmg:7, angle:35, bkb:4, kbs:90 }); }
    if(inputs.special){ if(this.attackQueue.length===0) this.attackQueue.push({ total:28, frame:0, hitStart:10, hitEnd:14, dmg:11, angle:60, bkb:8, kbs:110 }); }
  }

  updateProceduralPose(){
    const bob = Math.sin(this.t*0.08)*0.04; this.model.children.forEach(part=>{ if(part.geometry && part.geometry.type==='SphereGeometry') part.position.y = 2.6 + bob; });
    this.model.children.forEach((c,i)=>{ if(c.geometry && c.geometry.type==='CylinderGeometry') c.rotation.z = Math.sin(this.t*0.12 + i)*0.26; });
  }

  updateAttackQueue(){
    for(let i=this.attackQueue.length-1;i>=0;i--){ const a=this.attackQueue[i]; a.frame++; if(a.frame===a.hitStart) this.spawnHitbox({damage:a.dmg,angle:a.angle,bkb:a.bkb,kbs:a.kbs||90,radius:1.05,lifetime:a.hitEnd-a.hitStart+1}); if(a.frame>=a.total) this.attackQueue.splice(i,1); }
  }

  spawnHitbox({damage=5,angle=0,bkb=4,kbs=85,radius=1.0,lifetime=6}){
    const forward = new THREE.Vector3(1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0), this.model.rotation.y);
    const pos = this.position.clone().add(forward.clone().multiplyScalar(1.2)).add(new THREE.Vector3(0,1.15,0));
    this.hitboxes.push({owner:this,pos, radius, damage, angle, bkb, kbs, lifetime});
  }

  updateHitboxes(){
    for(let i=this.hitboxes.length-1;i>=0;i--){ const hb=this.hitboxes[i]; hb.lifetime--; if(hb.lifetime<=0){ this.hitboxes.splice(i,1); continue; } for(const other of window.fighters){ if(other===this) continue; const d=hb.pos.distanceTo(other.position.clone().add(new THREE.Vector3(0,1.0,0))); if(d < hb.radius + other.hurtboxRadius){ this.applyHitTo(other,hb); this.hitboxes.splice(i,1); break; } } }
  }

  applyHitTo(target,hb){
    target.percent += hb.damage; const kb = Fighter3D.calculateKnockback(target.percent, hb.damage, target.weight||85, hb.bkb, hb.kbs);
    let angle = hb.angle; if(angle===361) angle = (this.position.x < target.position.x)?180:0;
    Fighter3D.applyLaunchVector(target, angle, kb);
    target.hitstun = Math.max(1, Math.floor(kb*0.22));
    // visual flash
    const head = target.model.children.find(c=>c.geometry && c.geometry.type==='SphereGeometry'); if(head){ head.material.emissive = new THREE.Color(0xffcc99); setTimeout(()=>{ head.material.emissive.setHex(0x000000); }, 120); }
    // camera impact
    if(window && window.camState){ window.camState.shake = Math.max(window.camState.shake || 0, Math.min(1.5, kb*0.03)); window.camState.targetZoom = Math.max(9, 16 - Math.min(6, kb*0.08)); setTimeout(()=>{ window.camState.targetZoom = 16; }, 380); }
    // spawn impact particles if present
    if(window.spawnImpact) window.spawnImpact(hb.pos, hb.damage);
  }

  updateAnimations(dt){}

  static calculateKnockback(percent, baseDamage, weight, bkb, kbs){ const p = percent + baseDamage; const weightFactor = 200 / (weight + 100); const kb = (((((p/10) + (p*baseDamage/20)) * weightFactor * 1.4) + 18) * (kbs/100)) + bkb; return kb; }

  static applyLaunchVector(fighter, knockbackAngle, knockbackValue){ const rad = toRad(knockbackAngle); fighter.velocity.x = Math.cos(rad) * knockbackValue * 0.12; fighter.velocity.y = Math.sin(rad) * knockbackValue * 0.12; fighter.isGrounded = false; }
}
