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
    this.attackBuffer = 0;
    this.hitboxes = [];
    this.t = Math.random() * 10;
    this.facing = player ? 1 : -1;
    this.facingZ = 0;
    this.aiTimer = 0;
    this.specialCooldown = 0;
    this.grabCooldown = 0;
    this.dodgeTimer = 0;
    this.attackPose = 0;
    this.landPulse = 0;
    this.guardBreak = 0;
    this.guardHeld = false;
    this.roamMode = false;
    this.comboStep = 0;
    this.comboWindow = 0;
    this.comboHitCount = 0;
    this.comboHitFlash = 0;
    this.invulnerable = 0;
    this.parryTimer = 0;
    this.parryCooldown = 0;
    this.counterWindow = 0;
    this.counterFlash = 0;
    this.runBlend = 0;
    this.moveBlend = 0;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.canFly = false;
    this.flightMode = false;
    this.canWebSwing = false;
    this.webSwinging = false;
    this.webSwingAnchor = null;
    this.webSwingLine = null;
    this.webSwingGlowLine = null;
    this.webSwingLength = 0;
    this.airChaseTime = 0;
  }

  simulate(dt, inputHandler) {
    this.t += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.parryTimer = Math.max(0, this.parryTimer - dt);
    this.parryCooldown = Math.max(0, this.parryCooldown - dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.counterFlash = Math.max(0, this.counterFlash - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.comboHitFlash = Math.max(0, this.comboHitFlash - dt);
    if (this.comboWindow <= 0) { this.comboStep = 0; this.comboHitCount = 0; }
    const inputs = inputHandler.getInputs();
    if (this.canFly && inputs.flightToggle && this.hitstun <= 0) {
      this.flightMode = !this.flightMode;
      if (this.flightMode) {
        this.isGrounded = false;
        this.velocity.y = Math.max(this.velocity.y, 2.6);
      } else {
        // Release flight gracefully rather than snapping to the floor.
        this.velocity.y = Math.max(this.velocity.y, -1.2);
      }
    }
    if (this.canWebSwing && this.hitstun <= 0) {
      if (inputs.webSwing && !this.webSwinging) window.beginWebSwing?.(this);
      else if (!inputs.webSwing && this.webSwinging) window.endWebSwing?.(this, false);
      if (this.webSwinging && inputs.jump) window.endWebSwing?.(this, true);
    } else if (this.webSwinging) {
      window.endWebSwing?.(this, false);
    }
    this.guardHeld = !!inputs.shield && this.hitstun <= 0 && this.guardBreak <= 0;
    if (inputs.parry && this.parryCooldown <= 0 && this.hitstun <= 0 && this.guardBreak <= 0) {
      this.parryTimer = 0.22;
      this.parryCooldown = 0.32;
    }
    this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    this.grabCooldown = Math.max(0, this.grabCooldown - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    this.guardBreak = Math.max(0, this.guardBreak - dt);
    this.attackPose = Math.max(0, this.attackPose - dt * 4.5);
    this.landPulse = Math.max(0, this.landPulse - dt * 3.5);
    if (this.hitstun > 0) this.hitstun = Math.max(0, this.hitstun - dt);
    if (this.hitstun <= 0) this.handleInput(inputs, dt);

    this.wasGrounded = this.isGrounded;
    const assistedFlight = this.canFly && this.flightMode && this.hitstun <= 0;
    if (assistedFlight) {
      const needsTakeoff = this.position.y < 1.25 && !inputs.descend;
      const verticalTarget = inputs.ascend ? (inputs.sprint ? 13 : 8.5)
        : inputs.descend ? -7.5 : needsTakeoff ? 4.2 : 0;
      this.velocity.y = THREE.MathUtils.damp(this.velocity.y, verticalTarget,
        inputs.ascend || inputs.descend ? 5.5 : 3.2, dt);
    } else {
      this.velocity.y -= (this.roamMode ? 19 : 24) * dt;
    }
    this.position.addScaledVector(this.velocity, dt);
    if (this.webSwinging) window.updateWebSwing?.(this, dt, inputs);
    if (this.position.y <= 0) {
      if (!this.wasGrounded && this.velocity.y < -3) this.landPulse = 1;
      this.position.y = 0;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }
    if (this.canFly && this.flightMode && this.hitstun <= 0) {
      const altitudeLimit = this.roamMode ? 72 : 14;
      if (this.position.y > altitudeLimit) {
        this.position.y = altitudeLimit;
        this.velocity.y = Math.min(0, this.velocity.y);
      }
    }

    this.position.x = THREE.MathUtils.clamp(this.position.x, this.roamMode ? -125 : -17, this.roamMode ? 125 : 17);
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.roamMode ? -125 : -8, this.roamMode ? 125 : 8);
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
      if (!this.webSwinging) {
        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, this.isGrounded ? 11 : 2.5, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, this.isGrounded ? 11 : 2.5, dt);
      }
    }

    if (i.jump && this.isGrounded && !this.flightMode) {
      this.velocity.y = this.roamMode ? 9.4 : 10.8;
      this.velocity.x *= 1.08;
      this.isGrounded = false;
      this.velocity.x *= 1.08;
      this.velocity.z *= 1.08;
    }

    if (i.dodge && this.dashCooldown <= 0 && this.dodgeTimer <= 0) {
      const mag = Math.hypot(this.facing, this.facingZ) || 1;
      this.velocity.x = (len ? nx : this.facing / mag) * (this.roamMode ? 17 : 13);
      this.velocity.z = (len ? nz : this.facingZ / mag) * (this.roamMode ? 17 : 13);
      if (this.isGrounded) this.velocity.y = 2.1;
      else this.velocity.y = Math.max(this.velocity.y, 1.0);
      this.invulnerable = .2;
      this.dodgeTimer = this.roamMode ? .62 : .48;
      this.dashTimer = this.roamMode ? .24 : .16;
      this.dashCooldown = this.roamMode ? .55 : .4;
    }

    if (i.attack && this.guardBreak <= 0) this.attackBuffer = Math.max(this.attackBuffer, .62);
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    if (this.attackBuffer > 0 && this.attackQueue.length === 0 && this.guardBreak <= 0) {
      this.attackBuffer = 0;
      const style = this.canWebSwing ? {reach:1.75,damage:.94,windup:.72,combo:.9,cooldown:.56} : {
        warrior:{reach:1.65,damage:1.12,windup:1,combo:.82,cooldown:.72},
        ninja:{reach:1.8,damage:.86,windup:.72,combo:.88,cooldown:.62},
        brawler:{reach:1.5,damage:1.32,windup:1.18,combo:.86,cooldown:.88},
        mage:{reach:1.72,damage:1.02,windup:1.02,combo:.84,cooldown:.78},
        cyborg:{reach:1.7,damage:1.04,windup:.84,combo:.82,cooldown:.7}
      }[this.archetype] || {reach:1.6,damage:1,windup:1,combo:.82,cooldown:.74};
      const heavy = !!i.run;
      const aerial = !this.isGrounded;
      const weaponKind=this.model?.userData?.weaponKind||'unarmed';
      const rangedWeapon=['blaster','rifle','shotgun','plasma_rifle','pistol'].includes(weaponKind);
      const weaponReachBonus={sword:.42,katana:.5,cyber_blade:.48,giant_sword:.8,scimitar:.46,trident:.62,staff:.38,axe:.5,hammer:.42,war_fan:.34,whip:1.15,tentacle:.62,knife:.22,claws:.24,nunchaku:.42};
      const reachBonus=weaponReachBonus[weaponKind]||0;
      if (this.comboWindow <= 0) { this.comboStep = 0; this.comboHitCount = 0; }
      this.comboStep = (this.comboStep % 3) + 1;
      const finisher = this.comboStep === 3;
      const countering = this.counterWindow > 0;
      const launcher = (finisher && !aerial && !heavy) || (countering && !aerial);
      this.comboWindow = style.combo;
      const baseDamage = heavy ? 17 : finisher ? 20 : 8 + this.comboStep;
      const reach = aerial ? (finisher ? 6.0 : 4.6) + reachBonus*.62 : (finisher ? style.reach * 1.42 : style.reach) + reachBonus;
      this.attackQueue.push({
        kind: countering ? 'counter-strike' : aerial ? (finisher ? 'air-finisher' : 'air-strike') : heavy || finisher ? 'heavy' : (this.archetype === 'ninja' ? 'slash' : this.archetype === 'mage' ? 'arcane' : 'melee'),
        total: (aerial ? (finisher ? .56 : .43) : (heavy || finisher || countering ? .56 : .34)) * style.windup,
        t: 0,
        start: countering ? .035 : (aerial ? .08 : (heavy || finisher ? .14 : .065)) * style.windup,
        end: countering ? .34 : (aerial ? (finisher ? .40 : .31) : (heavy || finisher ? .31 : .19)) * style.windup,
        damage: baseDamage * style.damage * (aerial ? 1.12 : 1) * (countering ? 1.42 : 1) * (this.itemDamageMultiplier || 1),
        reach: reach + (countering ? .25 : 0),
        kbs: (heavy || finisher || countering ? 112 : 76 + this.comboStep * 4) * (this.archetype === 'brawler' ? 1.15 : 1) * (aerial ? 1.12 : 1) * (countering ? 1.32 : 1),
        aerial,
        launcher,
        countering,
        launchY: aerial ? (finisher ? 11.2 : 7.2) : (countering ? 9.2 : (launcher ? 8.6 : 3.4)),
        comboStep: this.comboStep,
        weaponKind,
        hit: false
      });
      if (countering) {
        this.counterWindow = 0;
        window.showCombatCallout?.('COUNTER STRIKE', '#ffe18a');
      }
      const dirX = this.facing || (this.player ? 1 : -1);
      const dirZ = this.facingZ || 0;
      if (aerial) {
        // Air attacks actively chase a launched rival, creating a followable juggle instead
        // of whiffing when the opponent has drifted away from the attacker.
        const target = (window.fighters || []).find(f => f !== this && f.model?.visible !== false);
        let chased = false;
        if (target) {
          const dx = target.position.x - this.position.x;
          const dz = target.position.z - this.position.z;
          const horizontal = Math.hypot(dx, dz);
          if (horizontal > 1.6 && horizontal < 14) {
            const chaseSpeed = finisher ? 5.2 : 3.6;
            this.velocity.x += dx / horizontal * chaseSpeed;
            this.velocity.z += dz / horizontal * chaseSpeed;
            if (Math.abs(dx) > .2) this.facing = Math.sign(dx);
            if (Math.abs(dz) > .2) this.facingZ = Math.sign(dz);
            const heightGap = target.position.y - this.position.y;
            this.velocity.y = Math.max(this.velocity.y, heightGap > .8
              ? Math.min(10.5, 4.2 + heightGap * .5) : 2.8);
            chased = true;
          }
        }
        if (!chased) {
          this.velocity.x += dirX * (finisher ? 3.4 : 2.0);
          this.velocity.z += dirZ * (finisher ? 2.8 : 1.6);
        }
      } else if (launcher) {
        this.velocity.x += dirX * 1.2;
        this.velocity.y = Math.max(this.velocity.y, .9);
      }
      if(rangedWeapon&&!heavy&&!aerial) window.spawnProjectile?.(this,{source:'weapon',weaponKind});
      this.attackPose = 1;
    }

    if (i.grab && this.grabCooldown <= 0 && this.attackQueue.length === 0 && this.guardBreak <= 0) {
      this.attackQueue.push({kind:'grab',total:.48,t:0,start:.1,end:.27,damage:16,kbs:126,reach:1.45,hit:false});
      this.grabCooldown=.85;
      this.attackPose=1;
    }

    if (i.special && this.specialCooldown <= 0 && this.guardBreak <= 0) {
      window.spawnProjectile?.(this, this.canWebSwing ? {source:'web',weaponKind:'webshooters'} : {});
      const cooldowns = {warrior:.82,ninja:.68,brawler:1.02,mage:.9,cyborg:.76};
      this.specialCooldown = this.canWebSwing ? .72 : cooldowns[this.archetype] || .82;
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
    if (u.rightArm) u.rightArm.rotation.y = 0;
    if (u.rightFore) { u.rightFore.rotation.y = 0; u.rightFore.rotation.z = 0; }

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
      if (this.attackPose > 0 || this.attackQueue.length > 0) {
        const activeAttack=this.attackQueue[this.attackQueue.length-1];
        const progress=activeAttack?THREE.MathUtils.clamp(activeAttack.t/activeAttack.total,0,1):Math.min(1,this.attackPose);
        const punch=activeAttack?(progress<.24?-(progress/.24):progress<.62?((progress-.24)/.38):(1-progress)/.38):Math.sin(progress*Math.PI);
        const archetype = this.archetype || 'warrior';
        const combo = this.comboStep || 1;
        const weaponKind=this.model.userData.weaponKind||'unarmed';
        const bladed=['sword','katana','cyber_blade','giant_sword','scimitar','trident','staff','axe','hammer','stormbreaker','war_fan','whip','nunchaku','knife','claws','tentacle'].includes(weaponKind);
        const ranged=['blaster','rifle','shotgun','plasma_rifle','pistol'].includes(weaponKind);
        const slash = archetype === 'ninja' || combo === 3 || bladed;
        const heavy = archetype === 'brawler' || combo === 3 || weaponKind === 'stormbreaker';
        const arc = archetype === 'mage';
        const mechanical = archetype === 'cyborg';
        const aerialAttack=!!activeAttack?.aerial;
        const swing = Math.sin(progress * Math.PI);
        // Long anticipation, shoulder-led sweep, and a real follow-through arc keep weapons
        // readable at distance; Stormbreaker has a heavier two-stage cut.
        u.rightArm.rotation.x = (heavy ? -2.05 : arc ? -1.15 : ranged ? -1.0 : bladed ? -1.86 : aerialAttack ? -1.72 : -1.5) * punch - 0.18;
        u.rightArm.rotation.z = (slash ? -0.62 : mechanical ? -0.12 : 0.08) * punch
          + (weaponKind === 'stormbreaker' ? .34 * swing : 0);
        u.rightArm.rotation.y = (weaponKind === 'stormbreaker' ? .86 : bladed ? .48 : .12) * swing * (combo % 2 ? 1 : -1);
        u.rightFore.rotation.x = (ranged ? -.32 : slash ? -1.0 : arc ? -0.25 : bladed ? -1.08 : aerialAttack ? -1.08 : -0.68) * punch;
        u.rightFore.rotation.y = (weaponKind === 'stormbreaker' ? -.58 : bladed ? -.25 : 0) * swing;
        u.rightFore.rotation.z = weaponKind === 'stormbreaker' ? -.42 * punch : slash ? -0.3 * punch : 0;
        u.leftArm.rotation.x = -0.25 - (heavy ? 0.55 : arc ? 0.15 : 0.3) * punch;
        u.leftArm.rotation.z = (slash ? 0.45 : 0.18) * punch;
        u.leftFore.rotation.x = -0.25 - 0.25 * punch;
        u.torso.rotation.x = -(heavy ? 0.28 : aerialAttack ? 0.20 : 0.14) * punch;
        u.torso.rotation.y = (slash || bladed ? 0.42 : mechanical ? 0.08 : -0.17) * punch * (combo % 2 ? 1 : -1);
        if(aerialAttack){u.leftLeg.rotation.x=-.55-.18*punch;u.rightLeg.rotation.x=.62+.24*punch;u.leftShin.rotation.x=.25;u.rightShin.rotation.x=.3;u.pelvis.rotation.x=-.16-.09*punch;}
        if (heavy) {
          u.leftLeg.rotation.x = -0.35 * punch;
          u.rightLeg.rotation.x = 0.55 * punch;
          u.pelvis.rotation.x = 0.12 * punch;
        }
      } else if (u.torso) {
        u.torso.rotation.y = THREE.MathUtils.damp(u.torso.rotation.y, 0, 10, dt);
      }
      if (dodge > 0) {
        u.leftArm.rotation.x -= dodge * 0.45;
        u.rightArm.rotation.x -= dodge * 0.45;
      }
      if (this.flightMode && this.attackQueue.length === 0 && !guard) {
        // A stable superhero hover/glide silhouette while the flight controls hold altitude.
        u.leftArm.rotation.x = -0.62;
        u.rightArm.rotation.x = -0.72;
        u.leftArm.rotation.z = .36;
        u.rightArm.rotation.z = -.36;
        u.leftLeg.rotation.x = -.43;
        u.rightLeg.rotation.x = .52;
        u.leftShin.rotation.x = .34;
        u.rightShin.rotation.x = .24;
      }
      if (this.webSwinging) {
        // Web-swing silhouette: wrists overhead, knees tucked, torso leaned into the pendulum.
        u.leftArm.rotation.x = -2.38;
        u.rightArm.rotation.x = -2.52;
        u.leftArm.rotation.z = .26;
        u.rightArm.rotation.z = -.26;
        u.leftFore.rotation.x = -.65;
        u.rightFore.rotation.x = -.78;
        u.leftLeg.rotation.x = -.66 + Math.sin(this.t*7)*.12;
        u.rightLeg.rotation.x = .72 + Math.sin(this.t*7+1.2)*.16;
        u.leftShin.rotation.x = .32;
        u.rightShin.rotation.x = .22;
        u.torso.rotation.x = -.18;
        u.pelvis.rotation.x = -.19;
      }
    }

    if (u.torso) {
      const breathing = Math.sin(this.t * 2.7) * 0.018;
      u.torso.rotation.z = -this.velocity.x * 0.018 + hit * 0.12;
      if (!(this.attackPose > 0)) u.torso.rotation.x = this.flightMode ? THREE.MathUtils.clamp(-this.velocity.y * .018, -.22, .12) : airborne ? -0.12 : 0;
      u.torso.position.y = 0.28 + (this.isGrounded ? breathing : 0.03);
    }
    if (u.pelvis) {
      u.pelvis.rotation.x = this.flightMode ? -.16 : airborne ? -0.12 : 0;
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
    const visualScale=this.model.userData.visualScale||this.model.userData.characterScale||1;
    this.model.scale.y = THREE.MathUtils.damp(this.model.scale.y, visualScale * (1 - this.landPulse * 0.08), 14, dt);
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
    const reach = a.reach || (a.kind === 'heavy' ? 1.45 : 1.2);
    const target = (window.fighters || []).find(other => other !== this && other.model?.visible !== false);
    const verticalTrack = a.aerial && target
      ? THREE.MathUtils.clamp((target.position.y - this.position.y) * .82, -2, 4) : 0;
    const height = (a.aerial ? 1.32 : a.launcher ? 1.38 : 1.25) + verticalTrack;
    const pos = this.position.clone().add(dir.clone().multiplyScalar(reach)).add(new THREE.Vector3(0, height, 0));
    this.hitboxes.push({
      pos, owner: this, reach, height, facingDir: dir.clone(),
      radius: a.aerial ? (a.comboStep===3 ? 2.45 : 2.05) : a.launcher ? 1.48 : a.kind === 'heavy' ? 1.35 : a.kind === 'slash' ? 1.3 : a.kind === 'grab' ? 1.05 : 1.2,
      damage: a.damage, kbs: a.kbs, launchY: a.launchY || 3.4, aerial: !!a.aerial,
      launcher: !!a.launcher, countering: !!a.countering, comboStep: a.comboStep || this.comboStep, lifetime: a.aerial ? .26 : .15, hit: false
    });
  }

  updateHitboxes(dt) {
    for (let n = this.hitboxes.length - 1; n >= 0; n--) {
      const h = this.hitboxes[n];
      h.lifetime -= dt;
      if (h.aerial && h.owner) {
        const owner = h.owner;
        const direction = new THREE.Vector3(owner.facing, 0, owner.facingZ);
        if (direction.lengthSq() < .01) direction.set(owner.player ? 1 : -1, 0, 0);
        direction.normalize();
        const target = (window.fighters || []).find(other => other !== owner && other.model?.visible !== false);
        const verticalTrack = target
          ? THREE.MathUtils.clamp((target.position.y - owner.position.y) * .82, -2, 4) : 0;
        h.pos.copy(owner.position).add(direction.multiplyScalar(h.reach))
          .add(new THREE.Vector3(0, 1.32 + verticalTrack, 0));
      }
      let remove = h.lifetime <= 0;
      for (const other of (window.fighters || [])) {
        if (other === this || h.hit) continue;
        const targetPoint = other.position.clone().add(new THREE.Vector3(0, 1, 0));
        const d = h.pos.distanceTo(targetPoint);
        if (d < h.radius + other.hurtboxRadius) {
          h.hit = true;
          if (other.invulnerable > 0) continue;
          if (other.parryTimer > 0 && other.hitstun <= 0 && other.guardBreak <= 0) {
            other.parryTimer = 0;
            other.counterWindow = 1.2;
            other.counterFlash = 0.52;
            other.invulnerable = Math.max(other.invulnerable, 0.16);
            this.hitstun = Math.max(this.hitstun, 0.48);
            this.attackQueue.length = 0;
            const recoilX = this.position.x - other.position.x;
            const recoilZ = this.position.z - other.position.z;
            const recoilLength = Math.hypot(recoilX, recoilZ) || 1;
            this.velocity.x = recoilX / recoilLength * 7.2;
            this.velocity.z = recoilZ / recoilLength * 7.2;
            this.velocity.y = Math.max(this.velocity.y, 3.6);
            this.isGrounded = false;
            window.spawnImpact?.(h.pos, 18);
            window.showCombatCallout?.('PERFECT PARRY', '#75f5ff');
            remove = true;
            break;
          }
          const guarding = other.guardHeld && other.guardBreak <= 0;
          const damageScale = guarding ? 0.28 : 1;
          other.percent += h.damage * damageScale;
          this.comboHitCount = (this.comboWindow > 0 && this.comboHitCount > 0) ? this.comboHitCount + 1 : 1;
          this.comboHitFlash = .7;
          this.comboWindow = Math.max(this.comboWindow, .82);
          if (h.countering) window.showCombatCallout?.('COUNTER HIT!', '#ffe18a');
          else if (h.comboStep >= 3 && !guarding) window.showCombatCallout?.('COMBO FINISHER!', '#ffbd72');
          else if (this.comboHitCount >= 2 && !guarding) window.showCombatCallout?.(`${this.comboHitCount} HIT COMBO`, '#b9f7ff');
          other.hitstun = guarding ? 0.1 : .3 + Math.min(1.05, other.percent / 165) + (h.aerial || h.launcher ? .12 : 0);
          other.guardBreak = guarding ? Math.max(other.guardBreak, 0.08) : other.guardBreak;
          const knockbackScale = guarding ? 0.25 : 1;
          other.velocity.x = this.facing * h.kbs * (0.035 + other.percent / 1200) * knockbackScale;
          other.velocity.z = this.facingZ * h.kbs * (0.035 + other.percent / 1200) * knockbackScale;
          other.velocity.y = Math.max(other.velocity.y, guarding ? 1.2 : h.launchY);
          if (h.aerial && !guarding) { other.velocity.x += this.facing * 1.1; other.velocity.y += .85; }
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
