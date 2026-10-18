// Active fighter simulation with responsive movement, articulated animation, guarding and combat.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

export default class Fighter3D {
  constructor({ name = 'Fighter', model, weight = 85, player = false }) {
    this.name = name;
    this.model = model;
    this.weight = weight;
    this.player = player;
    this.position = model.position;
    this.velocity = new THREE.Vector3();
    this.percent = 0;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.hitstun = 0;
    this.hurtboxRadius = 0.7;
    this.attackQueue = [];
    this.hitboxes = [];
    this.t = Math.random() * 10;
    this.facing = player ? 1 : -1;
    this.facingZ = 0;
    this.aiTimer = 0;
    this.specialCooldown = 0;
    this.dodgeTimer = 0;
    this.attackPose = 0;
    this.landPulse = 0;
    this.guardBreak = 0;
    this.guardHeld = false;
    this.roamMode = false;
    this.comboStep = 0;
    this.comboWindow = 0;
    this.invulnerable = 0;
    this.runBlend = 0;
    this.moveBlend = 0;
    this.dashCooldown = 0;
    this.dashTimer = 0;
  }

  simulate(dt, inputHandler) {
    this.t += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    if (this.comboWindow <= 0) this.comboStep = 0;
    const inputs = inputHandler.getInputs();
    this.guardHeld = !!inputs.shield && this.hitstun <= 0 && this.guardBreak <= 0;
    this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    this.guardBreak = Math.max(0, this.guardBreak - dt);
    this.attackPose = Math.max(0, this.attackPose - dt * 4.5);
    this.landPulse = Math.max(0, this.landPulse - dt * 3.5);
    if (this.hitstun > 0) this.hitstun = Math.max(0, this.hitstun - dt);
    if (this.hitstun <= 0) this.handleInput(inputs, dt);

    this.wasGrounded = this.isGrounded;
    this.velocity.y -= (this.roamMode ? 19 : 24) * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y <= 0) {
      if (!this.wasGrounded && this.velocity.y < -3) this.landPulse = 1;
      this.position.y = 0;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    this.position.x = THREE.MathUtils.clamp(this.position.x, this.roamMode ? -85 : -17, this.roamMode ? 85 : 17);
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.roamMode ? -55 : -8, this.roamMode ? 55 : 8);
    this.velocity.x *= Math.pow(this.isGrounded ? (this.roamMode ? 0.91 : 0.84) : 0.992, dt * 60);
    this.velocity.z *= Math.pow(this.isGrounded ? (this.roamMode ? 0.91 : 0.84) : 0.992, dt * 60);
    this.updateProceduralPose(inputs, dt);
    this.updateAttackQueue(dt);
    this.updateHitboxes(dt);
  }

  handleInput(i, dt) {
    const x = (i.right ? 1 : 0) - (i.left ? 1 : 0);
    const z = (i.down ? 1 : 0) - (i.up ? 1 : 0);
    const len = Math.hypot(x, z);
    const nx = len ? x / len : 0;
    const nz = len ? z / len : 0;
    const topSpeed = i.sprint ? (this.roamMode ? 15.5 : 12.5) : i.run ? (this.roamMode ? 10.8 : 8.8) : (this.roamMode ? 6.8 : 5.1);
    this.moveBlend = THREE.MathUtils.damp(this.moveBlend, len ? 1 : 0, len ? 5.5 : 9, dt);
    this.runBlend = THREE.MathUtils.damp(this.runBlend, len ? (i.sprint ? 1 : i.run ? .65 : .25) : 0, 8, dt);

    if (len) {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, nx * topSpeed, this.isGrounded ? 16 : 7, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, nz * topSpeed, this.isGrounded ? 16 : 7, dt);
      if (Math.abs(nx) > 0.1) this.facing = Math.sign(nx);
      if (Math.abs(nz) > 0.1) this.facingZ = Math.sign(nz);
    } else {
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, this.isGrounded ? 11 : 2.5, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, this.isGrounded ? 11 : 2.5, dt);
    }

    if (i.jump && this.isGrounded) {
      this.velocity.y = this.roamMode ? 9.4 : 10.8;
      this.velocity.x *= 1.08;
      this.isGrounded = false;
      this.velocity.x *= 1.08;
      this.velocity.z *= 1.08;
    }

    if (i.dodge && this.isGrounded && this.dodgeTimer <= 0) {
      const mag = Math.hypot(this.facing, this.facingZ) || 1;
      this.velocity.x = (len ? nx : this.facing / mag) * (this.roamMode ? 17 : 13);
      this.velocity.z = (len ? nz : this.facingZ / mag) * (this.roamMode ? 17 : 13);
      this.velocity.y = 2.1;
      this.invulnerable = .2;
      this.dodgeTimer = this.roamMode ? .62 : .48;
      this.dashTimer = this.roamMode ? .24 : .16;
      this.dashCooldown = this.roamMode ? .55 : .4;
    }

    if (i.attack && this.attackQueue.length === 0 && this.guardBreak <= 0) {
      const style = {
        warrior:{reach:1.12,damage:1.12,windup:1,combo:.62,cooldown:.82},
        ninja:{reach:1.28,damage:.86,windup:.72,combo:.48,cooldown:.68},
        brawler:{reach:1.04,damage:1.32,windup:1.28,combo:.72,cooldown:1.02},
        mage:{reach:1.18,damage:1.02,windup:1.08,combo:.66,cooldown:.9},
        cyborg:{reach:1.22,damage:1.04,windup:.88,combo:.56,cooldown:.76}
      }[this.archetype] || {reach:1,damage:1,windup:1,combo:.62,cooldown:.82};
      const heavy = !!i.run;
      if (this.comboWindow <= 0) this.comboStep = 0;
      this.comboStep = (this.comboStep % 3) + 1;
      const finisher = this.comboStep === 3;
      this.comboWindow = style.combo;
      const baseDamage = heavy ? 17 : finisher ? 20 : 8 + this.comboStep;
      this.attackQueue.push({
        kind: heavy || finisher ? 'heavy' : (this.archetype === 'ninja' ? 'slash' : this.archetype === 'mage' ? 'arcane' : 'melee'),
        total: (heavy || finisher ? .56 : .34) * style.windup,
        t: 0,
        start: (heavy || finisher ? .14 : .065) * style.windup,
        end: (heavy || finisher ? .31 : .19) * style.windup,
        damage: baseDamage * style.damage,
        reach: style.reach,
        kbs: (heavy || finisher ? 112 : 76 + this.comboStep * 4) * (this.archetype === 'brawler' ? 1.15 : 1),
        hit: false
      });
      this.attackPose = 1;
    }

    if (i.special && this.specialCooldown <= 0 && this.guardBreak <= 0) {
      window.spawnProjectile?.(this);
      const cooldowns = {warrior:.82,ninja:.68,brawler:1.02,mage:.9,cyborg:.76};
      this.specialCooldown = cooldowns[this.archetype] || .82;
      this.attackPose = Math.max(this.attackPose, 0.65);
    }
  }

  updateProceduralPose(i, dt) {
    const u = this.model.userData;
    const speed = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / 7);
    const phase = this.t * (5 + speed * 9);
    const dodge = this.dodgeTimer > 0 ? Math.sin((this.dodgeTimer / 0.48) * Math.PI) : 0;
    const hit = this.hitstun > 0 ? Math.sin(this.t * 36) * Math.min(1, this.hitstun * 2) : 0;
    const airborne = !this.isGrounded;
    const guard = !!i.shield && this.hitstun <= 0 && this.guardBreak <= 0;

    if (u.leftLeg) {
      const stride = Math.sin(phase) * 0.68 * speed;
      u.leftLeg.rotation.x = airborne ? -0.3 : stride;
      u.rightLeg.rotation.x = airborne ? 0.45 : -stride;
      u.leftShin.rotation.x = airborne ? 0.25 : Math.max(0, -Math.sin(phase)) * 0.55 * speed;
      u.rightShin.rotation.x = airborne ? 0.25 : Math.max(0, Math.sin(phase)) * 0.55 * speed;
      u.leftArm.rotation.x = -Math.sin(phase) * 0.5 * speed;
      u.rightArm.rotation.x = Math.sin(phase) * 0.5 * speed;
      u.leftFore.rotation.x = -0.2;
      u.rightFore.rotation.x = -0.2;

      if (guard) {
        u.leftArm.rotation.x = -1.15;
        u.rightArm.rotation.x = -1.15;
        u.leftArm.rotation.z = 0.45;
        u.rightArm.rotation.z = -0.45;
      } else {
        u.leftArm.rotation.z = 0;
        u.rightArm.rotation.z = 0;
      }
      if (this.attackPose > 0) {
        const punch = Math.sin(Math.min(1, this.attackPose) * Math.PI);
        u.rightArm.rotation.x = -1.45 * punch - 0.2;
        u.rightFore.rotation.x = -0.65 * punch;
        u.torso.rotation.x = -0.14 * punch;
      }
      if (dodge > 0) {
        u.leftArm.rotation.x -= dodge * 0.45;
        u.rightArm.rotation.x -= dodge * 0.45;
      }
    }

    if (u.torso) {
      const breathing = Math.sin(this.t * 2.7) * 0.018;
      u.torso.rotation.z = -this.velocity.x * 0.018 + hit * 0.12;
      if (!(this.attackPose > 0)) u.torso.rotation.x = airborne ? -0.12 : 0;
      u.torso.position.y = 0.28 + (this.isGrounded ? breathing : 0.03);
    }
    if (u.pelvis) {
      u.pelvis.rotation.x = airborne ? -0.12 : 0;
      u.pelvis.position.y = 1.02 - this.landPulse * 0.12;
      u.pelvis.scale.y = 1 + this.landPulse * 0.08;
    }
    if (u.head) {
      u.head.rotation.x = airborne ? 0.12 : Math.sin(this.t * 1.8) * 0.025;
      u.head.rotation.z = hit * 0.16;
    }
    this.model.rotation.y = Math.atan2(this.facingZ, this.facing);
    this.model.position.y += 0; // root stays grounded; vertical motion remains in the physics body
    this.model.rotation.z = THREE.MathUtils.damp(this.model.rotation.z, dodge * -0.2 + hit * 0.12, 12, dt);
    this.model.scale.y = THREE.MathUtils.damp(this.model.scale.y, 1 - this.landPulse * 0.08, 14, dt);
  }

  updateAttackQueue(dt) {
    for (let n = this.attackQueue.length - 1; n >= 0; n--) {
      const a = this.attackQueue[n];
      a.t += dt;
      if (!a.hit && a.t >= a.start && a.t <= a.end) {
        a.hit = true;
        this.spawnHitbox(a);
      }
      if (a.t >= a.total) this.attackQueue.splice(n, 1);
    }
  }

  spawnHitbox(a) {
    const dir = new THREE.Vector3(this.facing, 0, this.facingZ);
    if (dir.lengthSq() < 0.01) dir.set(this.player ? 1 : -1, 0, 0);
    dir.normalize();
    const pos = this.position.clone().add(dir.multiplyScalar(a.reach || (a.kind === 'heavy' ? 1.25 : 1.05))).add(new THREE.Vector3(0, 1.25, 0));
    this.hitboxes.push({ pos, radius: a.kind === 'heavy' ? 1.3 : a.kind === 'slash' ? 1.25 : 1.15, damage: a.damage, kbs: a.kbs, lifetime: 0.15, hit: false });
  }

  updateHitboxes(dt) {
    for (let n = this.hitboxes.length - 1; n >= 0; n--) {
      const h = this.hitboxes[n];
      h.lifetime -= dt;
      let remove = h.lifetime <= 0;
      for (const other of (window.fighters || [])) {
        if (other === this || h.hit) continue;
        const targetPoint = other.position.clone().add(new THREE.Vector3(0, 1, 0));
        const d = h.pos.distanceTo(targetPoint);
        if (d < h.radius + other.hurtboxRadius) {
          h.hit = true;
          if (other.invulnerable > 0) continue;
          const guarding = other.guardHeld && other.guardBreak <= 0;
          const damageScale = guarding ? 0.28 : 1;
          other.percent += h.damage * damageScale;
          other.hitstun = guarding ? 0.1 : 0.28 + Math.min(0.8, other.percent / 180);
          other.guardBreak = guarding ? Math.max(other.guardBreak, 0.08) : other.guardBreak;
          const knockbackScale = guarding ? 0.25 : 1;
          other.velocity.x = this.facing * h.kbs * (0.035 + other.percent / 1200) * knockbackScale;
          other.velocity.z = this.facingZ * h.kbs * (0.035 + other.percent / 1200) * knockbackScale;
          other.velocity.y = Math.max(other.velocity.y, guarding ? 1.2 : 3.4);
          other.isGrounded = false;
          window.spawnImpact?.(h.pos, guarding ? 3 : h.damage);
          remove = true;
          break;
        }
      }
      if (remove) this.hitboxes.splice(n, 1);
    }
  }
}
