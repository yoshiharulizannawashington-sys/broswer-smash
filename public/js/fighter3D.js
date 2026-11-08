// Active fighter simulation with responsive movement, articulated animation, guarding and combat.
import * as THREE from 'three';
import { groundHeightAt } from './world/arena_layouts.js';
import { damageFor, knockbackFor, launchFor, hitstunFor, shieldTick, shieldAfterHit, offhandOf, SHIELD } from './combat/combat_rules.js';
import { tickTransform, beginTransform, updateAura, REFUSAL } from './combat/transformation.js';
import { startUltimate, ULTIMATE_REFUSAL, awardCombatMeter } from './combat/ultimate.js';
import { ultimateFor } from './combat/movesets.js';
import { resolveMoveId, buildAttack, canCancel, styleFor, WEAPON_REACH, GRAB } from './combat/move_data.js';
import { locomotionFor, speedTarget, jumpImpulse, gravityFor } from './combat/locomotion.js';
import { stateOf, attackPhase, armourActive, reactionFor, STATE } from './combat/fighter_state.js';
import { COMBO, afterHit, airHitstun } from './combat/combo.js';
import { solidBetween } from './world/arena_layouts.js';
import { signatureFor } from './combat/character_identity.js';
import {
  flightFor, flightSpeed, flightThrust, flightVerticalTarget, flightVerticalLambda,
  clampFlightAltitude, flightTakeoffImpulse, flightLandingIntensity, damp as flightDamp
} from './combat/flight.js';
import { castAbility } from './combat/ability_runtime.js';
import { lightLabelFor, heavyLabelFor } from './combat/ability_kit.js';

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
    // Guard is a resource: it drains while held, a blocked hit spends it, and an empty
    // shield breaks the guard. The numbers live in combat_rules.js (SHIELD).
    this.shield = SHIELD.max;
    this.guardRegenDelay = 0;
    this.guardBreakFlash = 0;
    // Block stun: the brief locked animation after a blocked hit, separate from a guard break.
    this.guardStun = 0;
    this.grabAim = 'forward';
    // Grab hold: the victim has a short window to struggle out before the throw resolves.
    this.grabHold = 0;
    this.grabTarget = null;
    this.grabEscapeTimer = 0;
    this.grabbedBy = null;
    this.heldThrow = null;
    this.lastThrow = null;
    // Canonical state and the move currently resolving, both read by the debug overlay/tests.
    this.state = STATE.IDLE;
    this.activeMoveId = null;
    this.airHits = 0;
    this.ko = false;
    this.layout = null;
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
    // Stage geometry: `bounds` is the arena's playable rectangle and `groundLevel` the
    // surface height under the fighter, so platforms and raised stages are solid ground.
    this.bounds = null;
    this.groundLevel = 0;
    // Air options. A jump is spent on take-off, the second one in mid-air; the air dash is
    // once per airtime. Both reset on landing.
    this.jumps = 0;
    this.airDashUsed = false;
    this.throwChain = 0;
    this.recovery = 0;
    this.lastHitBy = null;
    // ---- transformation / ultimate ------------------------------------------------------
    // `meter` fills from real damage events and is spent once per ultimate; `power` is the
    // separate resource a form spends. Both are read by the HUD and the debug overlay.
    this.meter = 0;
    this.power = 0;
    this.transform = null;
    this.transformMods = null;
    this.transformCooldown = 0;
    this.formLock = 0;
    this.incomingDamage = 1;
    this.baseSpecialProfile = null;
    this.moveset = null;
    this.ultimateDef = null;
    this.casting = null;
    this.aura = null;
  }

  simulate(dt, inputHandler) {
    this.t += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);    this.parryTimer = Math.max(0, this.parryTimer - dt);
    this.parryCooldown = Math.max(0, this.parryCooldown - dt);
    this.counterWindow = Math.max(0, this.counterWindow - dt);
    this.counterFlash = Math.max(0, this.counterFlash - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.comboHitFlash = Math.max(0, this.comboHitFlash - dt);
    if (this.comboWindow <= 0) { this.comboStep = 0; this.comboHitCount = 0; this.airHits = 0; }
    // A form ticks every frame so its duration, drain and cooldown cannot stall.
    tickTransform(this, dt);
    updateAura(this);
    const inputs = inputHandler.getInputs();
    // Optional control trace: records exactly what each simulated body received, so a control
    // test can tell a lost key apart from a body that is not on human input.
    if (typeof window !== 'undefined' && window.__browserSmashInputTrace) {
      window.__browserSmashInputTrace(this, inputs);
    }
    // ---- grabbed: the victim is held, can struggle, and otherwise cannot act -------------
    if (this.grabbedBy) {
      this.grabEscapeTimer = Math.max(0, this.grabEscapeTimer - dt);
      if (this.grabEscapeTimer > 0 && (inputs.dodge || inputs.attack || inputs.jump)) this.escapeGrab();
      this.state = stateOf(this);
      this.updateAttackQueue(dt);
      this.updateHitboxes(dt);
      return;
    }
    // ---- grabber: hold, then resolve the throw ------------------------------------------
    if (this.grabHold > 0 && this.grabTarget) {
      this.grabHold = Math.max(0, this.grabHold - dt);
      if (this.grabHold === 0) this.releaseThrow();
    }
    // ---- transformation / ultimate inputs ------------------------------------------------
    // Both are edge-triggered by the input layer and both refuse cleanly instead of silently
    // doing nothing, so the player learns why nothing happened.
    if (inputs.transform) {
      const result = beginTransform(this);
      if (!result.ok) window.showCombatCallout?.(REFUSAL[result.reason] || 'FORM NOT READY', '#a9b7c9');
    }
    if (inputs.ultimate) {
      // The ultimate definition follows the active form, so a transformed fighter casts its
      // empowered variant (label, damage and colour) without a second table.
      this.ultimateDef = ultimateFor(this);
      const cast = startUltimate(this, window.ultimateContext?.() || {});
      // An ultimate gets a slightly longer, slightly stronger push than a special.
      if (cast && cast.ok !== false) window.smashCamera?.focus?.(this, { seconds: .6, zoom: .16, bias: .26 });
      if (cast && cast.ok === false) {
        window.showCombatCallout?.(ULTIMATE_REFUSAL[cast.reason] || 'ULTIMATE NOT READY', '#a9b7c9');
      }
    }
    if (this.canFly && inputs.flightToggle && this.hitstun <= 0) {
      this.flightMode = !this.flightMode;
      if (this.flightMode) {
        this.isGrounded = false;
        // Take-off is a lift, not a jump cut, and it kicks dust off the floor as it engages.
        this.velocity.y = Math.max(this.velocity.y, flightTakeoffImpulse(flightFor(this)));
        window.spawnImpact?.(this.position.clone().add(new THREE.Vector3(0, .12, 0)), 3, 0xcfd8e6, 'takeoff');
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
    this.guardHeld = !!inputs.shield && this.hitstun <= 0 && this.guardBreak <= 0 && this.shield > 0;
    if (inputs.parry && this.parryCooldown <= 0 && this.hitstun <= 0 && this.guardBreak <= 0) {
      this.parryTimer = 0.22;
      this.parryCooldown = 0.32;
    }
    this.specialCooldown = Math.max(0, this.specialCooldown - dt);
    this.grabCooldown = Math.max(0, this.grabCooldown - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    this.guardBreakFlash = Math.max(0, this.guardBreakFlash - dt * 1.8);
    this.guardStun = Math.max(0, this.guardStun - dt);
    this.guardRegenDelay = Math.max(0, this.guardRegenDelay - dt);
    if (this.guardBreak > 0) {
      this.guardBreak = Math.max(0, this.guardBreak - dt);
      this.shield = 0;
      if (this.guardBreak === 0) {
        // The break hands a little shield back, so a player who was broken can guard again
        // instead of being defenceless for the rest of the round.
        this.shield = SHIELD.breakRecover;
        this.guardRegenDelay = SHIELD.regenDelay;
      }
    } else {
      this.shield = this.guardRegenDelay > 0
        ? this.shield
        : shieldTick(this.shield, dt, { guarding: this.guardHeld, offhand: offhandOf(this) });
      if (this.guardHeld && this.shield <= 0) this.breakGuard();
    }
    this.attackPose = Math.max(0, this.attackPose - dt * 4.5);
    this.landPulse = Math.max(0, this.landPulse - dt * 3.5);
    if (this.hitstun > 0) this.hitstun = Math.max(0, this.hitstun - dt);
    // Casting an ultimate replaces ordinary input with the move's own movement; control comes
    // back the moment the record ends (including on interruption).
    if (this.casting) {
      const damp = Math.pow(.86, dt * 60);
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    } else if (this.hitstun <= 0) {
      this.handleInput(inputs, dt);
    }

    this.wasGrounded = this.isGrounded;
    const assistedFlight = this.canFly && this.flightMode && this.hitstun <= 0;
    if (assistedFlight) {
      const flightProfile = flightFor(this);
      // A fighter still on the deck lifts off when flight engages; once airborne, releasing the
      // stick holds altitude instead of sinking.
      const needsTakeoff = this.position.y < 1.25 && !inputs.ascend && !inputs.descend;
      const verticalTarget = needsTakeoff
        ? flightTakeoffImpulse(flightProfile)
        : flightVerticalTarget(inputs, flightProfile);
      const lambda = needsTakeoff ? flightProfile.climbDamp : flightVerticalLambda(inputs, flightProfile);
      this.velocity.y = flightDamp(this.velocity.y, verticalTarget, lambda, dt);
      // Held brake kills vertical drift as well, so a fighter can hold station precisely.
      if (inputs.brake) this.velocity.y = flightDamp(this.velocity.y, 0, flightProfile.brake, dt);
      // Passive air resistance on the horizontal axes, independent of the steering above.
      this.velocity.x = flightDamp(this.velocity.x, 0, flightProfile.airResist, dt);
      this.velocity.z = flightDamp(this.velocity.z, 0, flightProfile.airResist, dt);
    } else {
      this.velocity.y -= gravityFor(locomotionFor(this), { roam: this.roamMode }) * dt;
    }
    this.position.addScaledVector(this.velocity, dt);
    if (this.webSwinging) window.updateWebSwing?.(this, dt, inputs);
    // The walkable surface under the fighter right now, not the one it stood on last frame.
    // A cached height snapped a fighter that walked off a balcony or teleported a floor down
    // straight back up onto the old floor, which made every multi-floor interior (the Hogwarts
    // range, the Death Star catwalks) impossible to descend.
    const floor = this.layout
      ? groundHeightAt(this.position.x, this.position.z, this.layout, this.position.y + .08)
      : (this.groundLevel || 0);
    if (this.position.y <= floor) {
      const landingSpeed = this.velocity.y;
      if (!this.wasGrounded && landingSpeed < -3) this.landPulse = 1;
      // A flight landing that arrives hard throws a shockwave; a controlled descent does not.
      if (!this.wasGrounded && this.flightMode && landingSpeed < -4) {
        window.spawnImpact?.(this.position.clone().add(new THREE.Vector3(0, .1, 0)),
          flightLandingIntensity(flightFor(this), landingSpeed), 0xbfd7ff, 'landing');
      }
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.isGrounded = true;
      this.jumps = 0;
      this.airDashUsed = false;
      // Holding descend through touchdown is a controlled landing: flight disengages on contact.
      if (this.flightMode && inputs.descend) this.flightMode = false;
    } else {
      this.isGrounded = false;
    }
    if (this.canFly && this.flightMode && this.hitstun <= 0) {
      // The tall ceiling belongs to free roam, not to "roamMode": a staged match also runs with
      // roamMode on (faster ground speed, triple jump), so keying the ceiling on it let an arena
      // fight climb to 72 m - the aerial test caught a duel at 57 m inside the tournament ring.
      // A fighter with a stage rectangle is in a bounded arena and keeps the fight ceiling.
      const ceiling = clampFlightAltitude(this.position.y, this.velocity.y, flightFor(this),
        { roam: this.roamMode && !this.bounds });
      this.position.y = ceiling.y;
      this.velocity.y = ceiling.vy;
    }

    if (this.bounds) {
      // Per-arena playable rectangle. This has to win over the roam movement set: a match
      // runs with roamMode on (faster ground speed, triple jump), and stages such as the
      // Asgard throne hall sit entirely outside the legacy ±125 box. Clamping to that box
      // first pinned every fighter to its edge and left the arena's own clamp fighting it.
      const pad = this.hurtboxRadius;
      this.position.x = THREE.MathUtils.clamp(this.position.x, this.bounds.x0 + pad, this.bounds.x1 - pad);
      this.position.z = THREE.MathUtils.clamp(this.position.z, this.bounds.z0 + pad, this.bounds.z1 - pad);
    } else {
      // Legacy arenas and free roam have no stage rectangle; keep the wide exploration box.
      this.position.x = THREE.MathUtils.clamp(this.position.x, this.roamMode ? -125 : -17, this.roamMode ? 125 : 17);
      this.position.z = THREE.MathUtils.clamp(this.position.z, this.roamMode ? -125 : -8, this.roamMode ? 125 : 8);
    }
    this.velocity.x *= Math.pow(this.isGrounded ? (this.roamMode ? 0.91 : 0.84) : 0.992, dt * 60);
    this.velocity.z *= Math.pow(this.isGrounded ? (this.roamMode ? 0.91 : 0.84) : 0.992, dt * 60);
    this.updateProceduralPose(inputs, dt);
    this.updateAttackQueue(dt);
    this.updateHitboxes(dt);
  }

  /**
   * Apply an active form's multipliers to a queued attack. `startup` scales every phase of the
   * move (wind-up, active, recovery) so a speed form genuinely attacks faster instead of only
   * looking quicker, and `damage`/`kbs` scale the hit itself.
   */
  scaleAttack(attack) {
    const mods = this.transformMods;
    if (!mods || !attack) return attack;
    attack.damage *= mods.damage ?? 1;
    attack.kbs *= mods.kbs ?? 1;
    attack.launchY *= mods.kbs ?? 1;
    const speed = mods.startup ?? 1;
    if (speed !== 1) {
      attack.start *= speed;
      attack.end *= speed;
      attack.total *= speed;
      attack.armorFrom = (attack.armorFrom ?? attack.start) * speed;
      attack.armorTo = (attack.armorTo ?? attack.end) * speed;
    }
    return attack;
  }

  handleInput(i, dt) {
    // An authored signature fires on its release frame, not on the key press: the projectile is
    // held for the wind-up the clip actually plays so the beam leaves the palms as they punch,
    // instead of the body gathering energy after the shot has already flown.
    if (this.pendingSignature) {
      this.pendingSignature.timer -= dt;
      if (this.pendingSignature.timer <= 0) {
        const spawn = this.pendingSignature.spawn;
        this.pendingSignature = null;
        window.spawnProjectile?.(this, spawn);
      }
    }
    // Camera-relative movement. `main.js` resolves WASD against the camera's horizontal basis and
    // hands over a world-space vector plus the yaw the body should face. AI and unit tests keep
    // the old axis inputs, so they are unaffected by the camera.
    //
    // The old path wrote the world axes straight into velocity and snapped `facing` to sign(x),
    // which is why a diagonal key press produced a 45-degree body but an axis-aligned sprint, and
    // why the character never turned smoothly.
    const cameraRelative = Number.isFinite(i.moveX) && Number.isFinite(i.moveZ);
    this.cameraRecenter = cameraRelative && i.recenter === true;
    let x = cameraRelative ? i.moveX : (i.right ? 1 : 0) - (i.left ? 1 : 0);
    let z = cameraRelative ? i.moveZ : (i.down ? 1 : 0) - (i.up ? 1 : 0);
    // A power-up plants the fighter. `formLock` was set on activation but never read, so the
    // wind-up could be steered and attacked out of; now it is a real commitment.
    const formLocked = (this.formLock || 0) > 0;
    if (formLocked) { x = 0; z = 0; }
    // Free-roam uses GTA-like camera-relative steering; arena fights retain precise stage axes.
    if (this.roamMode && !cameraRelative) {
      const yaw = Number(window.smashCamera?.orbitYaw) || 0;
      const localX = x, localZ = z;
      x = localX * Math.cos(yaw) + localZ * Math.sin(yaw);
      z = -localX * Math.sin(yaw) + localZ * Math.cos(yaw);
    }
    const len = Math.hypot(x, z);
    const nx = len ? x / len : 0;
    const nz = len ? z / len : 0;
    // Per-character locomotion (combat/locomotion.js). This replaced one generic speed table with
    // two hard-coded identity checks (The Flash, Spider-Man) and nothing else: every identity now
    // has its own top speeds, acceleration, braking, air control, jump and reversal commitment.
    // Resolved every frame rather than cached: the same fighter instance is reused when the
    // player switches characters, so a cached profile would keep the last character's movement.
    const profile = locomotionFor(this);
    // Flight is its own movement mode: it replaces ground/air steering with the fighter's flight
    // profile instead of borrowing air control from the locomotion table.
    const flying = this.canFly && this.flightMode && this.hitstun <= 0;
    const flightProfile = flying ? flightFor(this) : null;
    const mode = i.sprint ? 'sprint' : i.run ? 'run' : 'walk';
    const topSpeed = flying
      ? flightSpeed(flightProfile, { boost: i.sprint || i.run }) * (this.transformMods?.speed || 1)
      : speedTarget(profile, { mode, roam: this.roamMode })*(this.transformMods?.speed||1);
    this.moveBlend = THREE.MathUtils.damp(this.moveBlend, len ? 1 : 0, len ? 5.5 : 9, dt);
    this.runBlend = THREE.MathUtils.damp(this.runBlend, len ? (i.sprint ? 1 : i.run ? .65 : .25) : 0, 8, dt);

    if (len) {
      // Turning against your own momentum costs more than extending it, and how much is the
      // fighter's own `turn` factor: The Flash leaves a direction instantly, Hulk commits to it.
      const opposing = nx * this.velocity.x + nz * this.velocity.z < 0;
      const steer = flying
        ? flightThrust(flightProfile, { boost: i.sprint || i.run })
        : (this.isGrounded ? profile.accel : profile.airAccel) * (opposing ? profile.turn : 1);
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, nx * topSpeed, steer, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, nz * topSpeed, steer, dt);
      if (cameraRelative) {
        // Smooth 360-degree turn toward the travel direction. Pure strafe and backpedal hand over
        // the camera's forward yaw instead, so the body keeps its stance while the feet move
        // sideways or backwards. Shortest-arc wrap stops a turn across the +-PI seam spinning the
        // long way round.
        if (Number.isFinite(i.faceYaw)) {
          const current = Math.atan2(this.facing, this.facingZ);
          let delta = i.faceYaw - current;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          const maxTurn = (this.isGrounded ? 11 : 7) * dt;
          const next = current + THREE.MathUtils.clamp(delta, -maxTurn, maxTurn);
          this.facing = Math.sin(next);
          this.facingZ = Math.cos(next);
        }
      } else {
        if (Math.abs(nx) > 0.1) this.facing = Math.sign(nx);
        if (Math.abs(nz) > 0.1) this.facingZ = Math.sign(nz);
      }
      this.cameraRelativeMove = cameraRelative;
    } else {
      if (!this.webSwinging) {
        // Braking is per-character too: an armoured or heavy fighter carries its momentum.
        const stop = flying
          ? flightThrust(flightProfile, { braking: true })
          : (this.isGrounded ? profile.brake : profile.airBrake);
        this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, stop, dt);
        this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, stop, dt);
      }
    }

    if (i.jump && !this.flightMode && this.hitstun <= 0 && !formLocked) {
      const maxJumps = this.roamMode ? 3 : 2;
      if (this.isGrounded) {
        this.velocity.y = jumpImpulse(profile, { roam: this.roamMode }) * (this.transformMods?.jump || 1);
        this.velocity.x *= 1.08;
        this.velocity.z *= 1.08;
        window.combatAudio?.play?.('jump');
        this.isGrounded = false;
        this.jumps = 1;
        this.airDashUsed = false;
      } else if (this.jumps < maxJumps) {
        // Double (and in free roam, triple) jump: a fresh impulse plus air control toward
        // the direction being held, so a juggled fighter can reposition before landing.
        this.jumps++;
        // The air jump keeps the shipped ratio to the ground jump, scaled by the fighter's
        // own take-off impulse so a heavy fighter's second jump stays heavy.
        this.velocity.y = Math.max(this.velocity.y, (this.roamMode ? 8.6 : 9.2) * (profile.jump / 10.8) * (this.transformMods?.jump || 1));
        if (len) {
          const airSpeed = Math.max(6.5, Math.hypot(this.velocity.x, this.velocity.z));
          this.velocity.x = THREE.MathUtils.damp(this.velocity.x, nx * airSpeed, 9, dt);
          this.velocity.z = THREE.MathUtils.damp(this.velocity.z, nz * airSpeed, 9, dt);
        }
        window.spawnImpact?.(this.position.clone().add(new THREE.Vector3(0, .3, 0)), 2, 0xbde9ff);
      }
    }

    // An attack buffered on the same frame as the sprint press is a heavy, not a dash: Shift is
    // both the dash button and the heavy modifier, and the dash used to lift the fighter off the
    // floor first, so every Shift+J came out as an aerial kick instead of the heavy.
    if (i.dodge && !i.attack && this.dashCooldown <= 0 && this.dodgeTimer <= 0 && (!this.isGrounded || !this.airDashUsed) && !formLocked) {
      const mag = Math.hypot(this.facing, this.facingZ) || 1;
      this.velocity.x = (len ? nx : this.facing / mag) * (this.roamMode ? 17 : 13);
      this.velocity.z = (len ? nz : this.facingZ / mag) * (this.roamMode ? 17 : 13);
      if (this.isGrounded) this.velocity.y = 2.1;
      else this.velocity.y = Math.max(this.velocity.y, 1.0);
      this.invulnerable = .2;
      this.dodgeTimer = this.roamMode ? .62 : .48;
      this.dashTimer = this.roamMode ? .24 : .16;
      this.dashCooldown = this.roamMode ? .55 : .4;
      if (!this.isGrounded) this.airDashUsed = true;
      // A successful dodge is the only thing that plays this voice: the input is consumed here.
      window.combatAudio?.play?.('dodge', { position: this.position });
    }

    if (i.attack && this.guardBreak <= 0 && !formLocked) {
      // A buffered link has to survive the previous attack's recovery. At this renderer's frame
      // pacing a press can wait most of a second before the next move is allowed to start; keeping
      // only the .62 s attack buffer let the combo window expire in between, so the queued press
      // began a brand-new string (the three-press test measured one hit). Refresh both: the buffer
      // carries the press, the window carries the chain.
      this.attackBuffer = Math.max(this.attackBuffer, .8);
      this.comboWindow = Math.max(this.comboWindow, styleFor(this).combo);
    }
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    if (this.attackBuffer > 0 && this.guardBreak <= 0) {
      const style = styleFor(this);
      // Shift is both the dash button and the heavy modifier. When the dash fires on the Shift
      // press and J lands a frame or two later, the dash has already lifted the fighter off the
      // floor, so the heavy resolved as an AERIAL light (and could miss). A dodge that started
      // within the last ~0.12 s is cancelled by the heavy modifier and the fighter is put back on
      // the ground, which makes Shift+J deterministic instead of frame-dependent.
      if (i.run && this.dodgeTimer > .36 && this.position.y < .45) {
        this.dodgeTimer = 0; this.dashTimer = 0; this.velocity.y = 0;
        if (!this.isGrounded) { this.position.y = 0; this.isGrounded = true; }
      }
      const heavy = !!i.run;
      const aerial = !this.isGrounded;
      // Directional attacks: UP + attack is an anti-air launcher, DOWN + attack in the air
      // is a dive kick that drives the attacker at the floor instead of chasing upward.
      // UP+light is the anti-air; UP+heavy is the launcher. Without this guard the anti-air branch
      // resolved first, so every UP+heavy press came out as the anti-air move instead.
      const antiAir = !aerial && !heavy && (i.vertical === 1 || !!i.up);
      const dive = aerial && (i.vertical === -1 || !!i.down);
      const weaponKind = this.model?.userData?.weaponKind || 'unarmed';
      const rangedWeapon = ['blaster', 'rifle', 'shotgun', 'plasma_rifle', 'pistol'].includes(weaponKind);
      const weaponReachBonus = WEAPON_REACH[weaponKind] || 0;
      if (this.comboWindow <= 0) { this.comboStep = 0; this.comboHitCount = 0; this.airHits = 0; }
      const nextStep = (this.comboStep % COMBO.chainLength) + 1;
      const finisher = nextStep === COMBO.chainLength && !aerial;
      const airFinisher = aerial && nextStep >= 3;
      const countering = this.counterWindow > 0;
      // Three heavies: UP+heavy launches, DOWN+heavy is the ground slam, neutral is the forward
      // blow. Each resolves to its own move id, frames and hitbox.
      const heavyVariant = !aerial && heavy
        ? ((i.vertical === 1 || i.up) ? 'launcher' : (i.vertical === -1 || i.down) ? 'slam' : 'forward')
        : 'forward';
      const moveId = resolveMoveId({ aerial, finisher, heavy, heavyVariant, antiAir, dive, countering, comboStep: nextStep, airFinisher });
      // A new attack may only be queued while the previous one is in recovery, and only when
      // the cancel table allows that pair. This is what makes light strings and launcher
      // follow-ups real instead of pressing buttons after the animation ends.
      const current = this.attackQueue[this.attackQueue.length - 1] || null;
      const inRecovery = current ? current.t >= current.end : true;
      const free = !current || (inRecovery && canCancel(current.id || current.kind, moveId));
      if (free) {
        this.attackBuffer = 0;
        this.comboStep = nextStep;
        this.comboWindow = style.combo;
        const attack = buildAttack({
          moveId, fighter: this, comboStep: nextStep, aerial, countering, antiAir, dive,
          itemMultiplier: this.itemDamageMultiplier || 1, weaponReachBonus
        });
        this.attackQueue.push(this.scaleAttack(attack));
        {
          // The string is this character's own five-hit chain, a heavy is named by the variant that
          // actually came out, and an aerial keeps the body's authored aerial name instead of the
          // generic move-table label.
          const last = this.attackQueue[this.attackQueue.length - 1];
          last.label = aerial
            ? (this.moveset?.aerial || attack.label)
            : moveId.startsWith('light') || moveId === 'finisher'
              ? lightLabelFor(this, nextStep, this.moveset?.lights || [], attack.label)
              : heavyLabelFor(this, moveId, this.moveset?.heavy || [], attack.label);
        }
        this.activeMoveId = moveId;
        if (countering) {
          this.counterWindow = 0;
          window.showCombatCallout?.('COUNTER STRIKE', '#ffe18a');
        }
        const dirX = this.facing || (this.player ? 1 : -1);
        const dirZ = this.facingZ || 0;
        if (dive) {
          // A dive kick commits downward and forward: predicted impact, not a chase.
          this.velocity.x = dirX * 6.4;
          this.velocity.z = dirZ * 6.4;
          this.velocity.y = Math.min(this.velocity.y, -9.5);
        } else if (aerial) {
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
        } else if (attack.launcher) {
          this.velocity.x += dirX * 1.2;
          this.velocity.y = Math.max(this.velocity.y, .9);
        }
        if (rangedWeapon && !heavy && !aerial) window.spawnProjectile?.(this, { source: 'weapon', weaponKind });
        // The slam commits the body forward; the launcher keeps its small hop from the launcher branch.
        if (moveId === 'heavySlam') {
          this.velocity.x = dirX * 5.6;
          this.velocity.z = dirZ * 5.6;
        }
        this.attackPose = 1;
      }
    }

    if (i.grab && this.grabCooldown <= 0 && this.attackQueue.length === 0 && this.guardBreak <= 0 && !formLocked) {
      // Directional throw: the direction held as the grab starts decides where the victim goes.
      this.grabAim = (i.vertical === 1 || i.up) ? 'up' : (i.vertical === -1 || i.down) ? 'down' : 'forward';
      this.attackQueue.push({ ...buildAttack({ moveId: 'grab', fighter: this }), aim: this.grabAim });
      this.grabCooldown = .85;
      this.attackPose = 1;
      this.activeMoveId = 'grab';
    }

    if (i.special && this.specialCooldown <= 0 && this.guardBreak <= 0 && !formLocked) {
      const profile=this.specialProfile||{};
      // A web-slinger's signature is not automatically a projectile. Spider-Man's Web Zip is a
      // dashStrike and must reach the authored-move resolver; otherwise a web identity's signature
      // was silently converted to a web ball, skipped the dash, and dealt no damage at close range.
      const moveHandled=profile.behavior?window.performSignatureMove?.(this,profile):false;
      const spawn=this.canWebSwing?{source:'special',weaponKind:'webshooters',...profile,type:'web'}:{source:'special',...profile};
      // A body that owns an authored signature clip drives its own projectile: the clip's wind-up
      // is the release delay, so the pose and the beam agree on the frame the palms drive.
      const authored=this.model?.userData?.authoredSpecialAction;
      if(moveHandled){/* the behaviour resolved its own damage and VFX */}
      else if(authored){
        const clip=authored.getClip?.();
        const windup=Math.max(.18,Math.min(.42,(clip?.duration||.9)*.34));
        this.pendingSignature={timer:windup,spawn,clip:clip?.name||null};
      }
      else window.spawnProjectile?.(this,spawn);
      // Recorded on the fighter, not inferred from the cooldown: the animation layer reads this id
      // to start the authored clip. A cooldown delta could not restart a cast whose timer was
      // already raised, which is why the Kamehameha stayed bound and silent.
      this.specialCast={
        id:(this.specialCast?.id||0)+1,at:Math.round((this.t||0)*1000),
        clip:authored?.getClip?.().name||null,releaseIn:this.pendingSignature?.timer??0
      };
      const cooldowns = {warrior:.82,ninja:.68,brawler:1.02,mage:.9,cyborg:.76};
      this.specialCooldown = this.specialProfile?.cooldown || (this.canWebSwing ? .72 : cooldowns[this.archetype] || .82);
      window.showCombatCallout?.(this.specialProfile?.label || 'SPECIAL ATTACK', '#9deeff');
      this.attackPose = Math.max(this.attackPose, 0.65);
    }

    // Kit abilities: two character-specific casts beyond the signature, each on its own cooldown
    // and executed through the same live projectile / signature-behaviour pipeline.
    const kitInputs = [i.special2, i.special3, i.special4, i.special5];
    for (let slot = 1; slot <= kitInputs.length; slot++) {
      if (kitInputs[slot - 1] && this.guardBreak <= 0) castAbility(this, slot);
    }
  }

  updateProceduralPose(i, dt) {
    const u = this.model.userData;
    // A character loaded from the model manifest is a real skinned rig with its own clips: it
    // has no procedural joint handles (and if a partial set exists, writing them fights the
    // mixer). Its pose belongs to animateHumanFighter/animation controller, so leave it alone.
    if (u.characterAssetUrl) return;
    // Which skeleton this pose writer is allowed to touch. The pose below was authored for
    // the procedural body: it writes absolute joint positions (pelvis at y=1.02, torso at
    // y=0.28) and assumes a T-pose bind. The Blender prefab is the same skeleton exported
    // Z-up, so its joint offsets live on local Z under a +90 degree root rotation - writing
    // those Y positions moved every limb about a metre off its parent and tore the body
    // apart. A prefab keeps its authored hierarchy and only takes rotations.
    const rigKind = this.model.userData.rigKind
      || (this.model.userData.blenderRigVersion ? 'prefab' : 'procedural');
    const proceduralRig = rigKind === 'procedural';
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
        const heavy = archetype === 'brawler' || combo >= 4 || weaponKind === 'stormbreaker';
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
        // Individual combo choreography: the same three-hit input chain reads differently
        // for an acrobatic web-slinger, speedster, dual-blade scout, and martial-arts lead.
        const identity=this.identityKey||'';
        if(identity==='spider_man'){
          if(aerialAttack){
            // Compact mid-air tuck on the first hit, then a broad twisting kick finisher.
            u.torso.rotation.z=(combo===3?.48:-.28)*punch;
            u.leftArm.rotation.x=-1.15*punch;u.leftArm.rotation.z=.72*punch;
            u.rightArm.rotation.x=-.72*punch;u.rightArm.rotation.z=-.55*punch;
            u.leftLeg.rotation.x=combo===3?-1.35:-.75;
            u.rightLeg.rotation.x=combo===3?-.1:.88;
            u.leftShin.rotation.x=.55;u.rightShin.rotation.x=.18;
            u.pelvis.rotation.x=-.28*punch;
          }else if(combo===2){
            u.rightArm.rotation.x=-1.1*punch;u.rightArm.rotation.z=-.84*punch;
            u.leftArm.rotation.x=-1.9*punch;u.leftArm.rotation.z=.32*punch;
            u.torso.rotation.y=.65*punch;u.pelvis.rotation.y=-.22*punch;
          }else if(combo===3){
            u.rightArm.rotation.x=-1.95*punch;u.rightArm.rotation.z=-.5*punch;
            u.leftArm.rotation.x=-1.55*punch;u.leftArm.rotation.z=.5*punch;
            u.rightLeg.rotation.x=.95*punch;u.leftLeg.rotation.x=-.4*punch;
            u.torso.rotation.y=-.72*punch;
          }
        }else if(identity==='the_flash_barry_allen'){
          // A lightning-fast alternating one-two into a short forward dash strike.
          const side=combo%2?1:-1;
          u.rightArm.rotation.x=(side>0?-2.2:-.45)*punch;
          u.leftArm.rotation.x=(side>0?-.45:-2.2)*punch;
          u.rightFore.rotation.x=-.74*punch;u.leftFore.rotation.x=-.74*punch;
          u.torso.rotation.x=-.25*punch;u.torso.rotation.y=.26*side*punch;
          u.leftLeg.rotation.x=combo===3?-.82:-.24;
          u.rightLeg.rotation.x=combo===3?1.0:.33;
          if(combo===3){u.pelvis.rotation.x=-.24*punch;u.rightArm.rotation.z=-.25*punch;}
        }else if(identity==='levi_ackerman'){
          // Compact ODM-style cross cuts alternate shoulders; the third hit commits to a
          // longer diagonal slash so the hit spark and launch read as a true finisher.
          const side=combo%2?1:-1;
          u.leftArm.rotation.x=(side>0?-1.7:-.8)*punch;
          u.rightArm.rotation.x=(side>0?-.8:-1.7)*punch;
          u.leftArm.rotation.z=.48*side*punch;u.rightArm.rotation.z=-.48*side*punch;
          u.leftFore.rotation.x=-1.12*punch;u.rightFore.rotation.x=-1.12*punch;
          u.torso.rotation.y=.52*side*punch;u.pelvis.rotation.y=-.24*side*punch;
          if(aerialAttack){u.leftLeg.rotation.x=-.9;u.rightLeg.rotation.x=.74;u.torso.rotation.x=-.25*punch;}
        }else if(identity==='goku'||identity==='vegeta'){
          // Martial-arts strings: straight punch, cross, then a rising strike that launches.
          if(combo===1){u.rightArm.rotation.x=-2.0*punch;u.rightFore.rotation.x=-.88*punch;u.torso.rotation.y=.24*punch;}
          else if(combo===2){u.leftArm.rotation.x=-1.95*punch;u.leftFore.rotation.x=-.92*punch;u.torso.rotation.y=-.32*punch;}
          else{u.leftArm.rotation.x=-1.5*punch;u.rightArm.rotation.x=-2.18*punch;u.leftLeg.rotation.x=-.55*punch;u.rightLeg.rotation.x=.88*punch;u.pelvis.rotation.x=-.28*punch;}
          if(aerialAttack){u.leftLeg.rotation.x=-.78;u.rightLeg.rotation.x=.95;u.torso.rotation.x=-.22*punch;}
        }else if(identity==='aang'){
          // Staff-driven redirection and a circular airbending spin rather than a generic fist.
          if(weaponKind==='staff'){
            u.rightArm.rotation.y=.72*Math.sin(progress*Math.PI*2)*punch;
            u.leftArm.rotation.y=-.52*Math.sin(progress*Math.PI*2)*punch;
            u.rightFore.rotation.y=.34*Math.sin(progress*Math.PI*2)*punch;
            u.torso.rotation.y=.34*Math.sin(progress*Math.PI*2)*punch;
          }
          if(aerialAttack){u.leftArm.rotation.x=-.8;u.rightArm.rotation.x=-1.0;u.leftLeg.rotation.x=-.85;u.rightLeg.rotation.x=.65;}
        }else if(['hulk_bruce_banner','saitama','all_might'].includes(identity)){
          // Heavier shoulder-first hooks with more planted legs; the finisher drives upward.
          u.torso.rotation.x=-(combo===3?.42:.25)*punch;
          u.torso.rotation.y=(combo%2?.36:-.36)*punch;
          u.leftLeg.rotation.x=-.36*punch;u.rightLeg.rotation.x=.48*punch;
          u.pelvis.rotation.x=combo===3?-.18*punch:.12*punch;
          if(combo===3){u.rightArm.rotation.x=-2.3*punch;u.rightFore.rotation.x=-1.28*punch;}
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

    // Character-specific locomotion silhouettes: Spider-Man sprints low and springy,
    // Thor carries a heavy weapon-ready stride, and Aang uses a light, balanced airbender run.
    if(this.attackQueue.length===0&&!guard&&speed>.12&&!airborne){
      const identity=this.identityKey||'';
      const sprint=THREE.MathUtils.clamp(speed/10,0,1);
      if(identity==='spider_man'){
        u.torso.rotation.x=THREE.MathUtils.damp(u.torso.rotation.x,-.16-.22*sprint,9,dt);
        u.leftArm.rotation.x=-.38+Math.sin(phase+Math.PI)*.22;
        u.rightArm.rotation.x=-.48+Math.sin(phase)*.22;
        u.leftArm.rotation.z=.18;u.rightArm.rotation.z=-.18;
        u.leftLeg.rotation.x=Math.sin(phase)*.82;
        u.rightLeg.rotation.x=-Math.sin(phase)*.82;
        u.leftShin.rotation.x=Math.max(0,-Math.sin(phase))*.58;
        u.rightShin.rotation.x=Math.max(0,Math.sin(phase))*.58;
      }else if(identity==='thor'){
        u.torso.rotation.x=-.04-.06*sprint;
        u.leftArm.rotation.x=-.2+Math.sin(phase)*.2;
        u.rightArm.rotation.x=-.48+Math.sin(phase+Math.PI)*.16;
        u.rightArm.rotation.z=-.12;
        u.leftLeg.rotation.x=Math.sin(phase)*.55;
        u.rightLeg.rotation.x=-Math.sin(phase)*.55;
      }else if(identity==='aang'){
        u.torso.rotation.x=-.025;
        u.leftArm.rotation.x=-.24+Math.sin(phase+Math.PI)*.18;
        u.rightArm.rotation.x=-.24+Math.sin(phase)*.18;
        u.leftArm.rotation.z=.14;u.rightArm.rotation.z=-.14;
        u.leftLeg.rotation.x=Math.sin(phase)*.74;
        u.rightLeg.rotation.x=-Math.sin(phase)*.74;
      }
    }
    if(this.attackQueue.length===0&&!guard){
      const identity=this.identityKey||'';
      if(identity==='spider_man'){
        if(airborne||this.webSwinging){
          u.torso.rotation.z=THREE.MathUtils.damp(u.torso.rotation.z,.12,7,dt);
          u.leftArm.rotation.x=-1.0;u.leftArm.rotation.z=.58;
          u.rightArm.rotation.x=-.72;u.rightArm.rotation.z=-.6;
          u.leftLeg.rotation.x=-.65;u.rightLeg.rotation.x=.72;
          u.leftShin.rotation.x=.35;u.rightShin.rotation.x=.12;
        }else{
          u.torso.rotation.z=THREE.MathUtils.damp(u.torso.rotation.z,0,8,dt);
          u.leftArm.rotation.x-=.08;u.rightArm.rotation.x-=.08;
        }
      }else if(identity==='the_flash_barry_allen'){
        const burstLean=Math.min(.42,Math.hypot(this.velocity.x,this.velocity.z)*.022);
        u.torso.rotation.x=-burstLean;
        u.leftArm.rotation.x=-.4+Math.sin(this.t*24)*.16;
        u.rightArm.rotation.x=-.4-Math.sin(this.t*24)*.16;
        u.leftLeg.rotation.x=Math.sin(this.t*20)*.65;
        u.rightLeg.rotation.x=-Math.sin(this.t*20)*.65;
      }else if(['hulk_bruce_banner','saitama','all_might','kratos'].includes(identity)){
        const plant=THREE.MathUtils.clamp(Math.hypot(this.velocity.x,this.velocity.z)/11,0,1);
        u.pelvis.rotation.x=THREE.MathUtils.damp(u.pelvis.rotation.x,plant*.08,6,dt);
        u.leftArm.rotation.x=-.12;u.rightArm.rotation.x=-.12;
        u.leftLeg.rotation.x=-.05;u.rightLeg.rotation.x=.08;
      }else if(identity==='goku'||identity==='vegeta'||identity==='naruto_uzumaki'||identity==='sasuke_uchiha'){
        const power= .035+.025*Math.sin(this.t*7);
        u.leftArm.rotation.x=-.28-power;u.rightArm.rotation.x=-.34-power;
        u.leftFore.rotation.x=-.46;u.rightFore.rotation.x=-.46;
      }
    }
    if (u.torso) {
      const breathing = Math.sin(this.t * 2.7) * 0.018;
      u.torso.rotation.z = -this.velocity.x * 0.018 + hit * 0.12;
      if (!(this.attackPose > 0)) u.torso.rotation.x = this.flightMode ? THREE.MathUtils.clamp(-this.velocity.y * .018, -.22, .12) : airborne ? -0.12 : 0;
      if (proceduralRig) u.torso.position.y = 0.28 + (this.isGrounded ? breathing : 0.03);
    }
    if (u.pelvis) {
      u.pelvis.rotation.x = this.flightMode ? -.16 : airborne ? -0.12 : 0;
      if (proceduralRig) {
        u.pelvis.position.y = 1.02 - this.landPulse * 0.12;
        u.pelvis.scale.y = 1 + this.landPulse * 0.08;
      }
    }
    if (u.head) {
      u.head.rotation.x = airborne ? 0.12 : Math.sin(this.t * 1.8) * 0.025;
      u.head.rotation.z = hit * 0.16;
    }
    // The prefab rigs are authored in a T-pose: their arm joints are horizontal at zero
    // rotation, and every pose branch above writes absolute offsets from that bind pose.
    // Anyone not covered by a per-identity idle branch (Hulk, Thor, most of the DLC
    // roster) therefore stood with both arms straight out during a fight. Dropping the
    // shoulders here, additively and after the combat pose is written, gives every
    // fighter a resting silhouette while leaving punches, guards and weapon arcs intact.
    if (u.leftArm && u.rightArm) {
      const resting = this.attackQueue.length === 0 && !guard && !this.webSwinging && this.attackPose <= 0;
      // 1.16 rad unbends the procedural body's horizontal T-pose arms. The prefab's arms
      // are authored hanging down already, so it only gets a small settle.
      const drop = proceduralRig ? (resting ? 1.16 : .34) : (resting ? .12 : .04);
      u.leftArm.rotation.z += drop;
      u.rightArm.rotation.z -= drop;
      if (resting) {
        // Relaxed elbows and a slow weight shift so an idle fighter is never a mannequin.
        const sway = Math.sin(this.t * 1.35) * .04;
        u.leftFore.rotation.x -= .3 - sway;
        u.rightFore.rotation.x -= .3 + sway;
        if (u.pelvis) u.pelvis.rotation.z = sway * .5;
      }
    }
    // Both rigs are authored facing +Z (cape behind at -Z), so the yaw that turns +Z onto the
    // facing vector is atan2(facing.x, facing.z). The swapped form pointed every fighter 90
    // degrees away from where it was moving or aiming.
    this.model.rotation.y = Math.atan2(this.facing, this.facingZ);
    this.model.position.y += 0; // root stays grounded; vertical motion remains in the physics body
    this.model.rotation.z = THREE.MathUtils.damp(this.model.rotation.z, dodge * -0.2 + hit * 0.12, 12, dt);
    const visualScale=this.model.userData.visualScale||this.model.userData.characterScale||1;
    if (proceduralRig) {
      this.model.scale.y = THREE.MathUtils.damp(this.model.scale.y, visualScale * (1 - this.landPulse * 0.08), 14, dt);
    } else {
      // A prefab is scaled uniformly: a per-axis Y squash would bake a non-uniform scale onto
      // the rig, which rig_validation.js rejects and which the landing pulse does not need.
      const nextScale = THREE.MathUtils.damp(this.model.scale.x, visualScale * (1 - this.landPulse * 0.04), 14, dt);
      this.model.scale.setScalar(nextScale);
    }
  }

  /**
   * Spend the defender's shield for a blocked hit. An empty shield breaks the guard for
   * SHIELD.breakSeconds, which is what makes pressure and guard-breaks real options.
   *
   * The cost is the defender's own: a shield in the offhand absorbs more of the hit but spends
   * more of the meter doing it (OFFHAND_DEFENSE in combat_rules.js).
   */
  spendGuard(defender, hit) {
    if (!defender || defender.guardBreak > 0) return;
    const result = shieldAfterHit(defender.shield, {
      damage: hit.damage, kbs: hit.kbs, offhand: offhandOf(defender)
    });
    defender.shield = result.shield;
    defender.guardRegenDelay = SHIELD.regenDelay;
    if (result.broke) defender.breakGuard();
  }

  breakGuard() {
    this.guardBreak = Math.max(this.guardBreak, SHIELD.breakSeconds);
    this.guardHeld = false;
    this.shield = 0;
    this.guardBreakFlash = 1;
    window.showCombatCallout?.('GUARD BREAK', '#ffd166');
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
    const current = this.attackQueue[this.attackQueue.length - 1];
    this.activeMoveId = current ? (current.id || current.kind) : null;
    this.state = stateOf(this);
  }

  /**
   * Start a grab hold. The damage and the throw happen when the hold ends, unless the victim
   * struggles out first, so a grab is a real interaction rather than an instant teleport.
   */
  beginThrow(victim, hit) {
    if (!victim || victim.grabbedBy || victim.invulnerable > 0) return false;
    this.grabTarget = victim;
    this.heldThrow = hit;
    this.grabAim = hit.aim || this.grabAim || 'forward';
    this.grabHold = GRAB.hold;
    victim.grabbedBy = this;
    victim.grabEscapeTimer = GRAB.escapeWindow;
    victim.hitstun = Math.max(victim.hitstun, GRAB.hold);
    victim.velocity.set(0, 0, 0);
    victim.isGrounded = true;
    window.combatAudio?.play?.('grab', { position: victim.position });
    window.showCombatCallout?.('GRABBED · STRUGGLE!', '#ffd166');
    return true;
  }

  /** Resolve the held grab into the aimed throw, releasing both fighters. */
  releaseThrow() {
    const victim = this.grabTarget;
    const hit = this.heldThrow || { damage: 16 };
    this.grabTarget = null;
    this.grabHold = 0;
    this.heldThrow = null;
    if (!victim) return;
    victim.grabbedBy = null;
    victim.grabEscapeTimer = 0;
    const thrown = damageFor(hit.damage || 16, {}) * (victim.incomingDamage ?? 1);
    victim.percent += thrown;
    awardCombatMeter(this, victim, thrown, {});
    victim.hitstun = .92;
    victim.position.x = this.position.x + this.facing * 1.25;
    victim.position.z = this.position.z + this.facingZ * 1.25;
    const aim = this.grabAim || 'forward';
    const arc = aim === 'up' ? { x: this.facing * 1.1, y: 12.6, z: this.facingZ * 1.1 }
      : aim === 'down' ? { x: this.facing * 2.4, y: -9.4, z: this.facingZ * 2.4 }
        : { x: this.facing * 6.4, y: 9.4, z: this.facingZ * 6.4 };
    victim.velocity.set(arc.x, arc.y, arc.z);
    // Recorded so tests and the HUD can read the throw that actually happened, not a velocity
    // that gravity has already changed by the time anyone looks.
    victim.lastThrow = { aim, ...arc, damage: hit.damage || 16, at: this.t };
    victim.lastHitBy = this;
    victim.isGrounded = false;
    window.combatAudio?.play?.('throw', { position: victim.position });
    this.throwChain++;
    this.comboStep = 0;
    this.comboWindow = 0;
    this.airHits = 0;
    window.spawnImpact?.(victim.position.clone().add(new THREE.Vector3(0, 1, 0)), 12, 0xffc476, 'grab');
    window.showCombatCallout?.(aim === 'up' ? 'UP THROW!' : aim === 'down' ? 'SPIKE THROW!' : 'THROW!', aim === 'down' ? '#ffc38a' : '#ffe0a6');
  }

  /** Struggle out of a held grab: both fighters released, grabber put on a short cooldown. */
  escapeGrab() {
    const attacker = this.grabbedBy;
    if (!attacker) return false;
    attacker.grabTarget = null;
    attacker.grabHold = 0;
    attacker.heldThrow = null;
    attacker.grabCooldown = Math.max(attacker.grabCooldown, GRAB.escapeCooldown);
    this.grabbedBy = null;
    this.grabEscapeTimer = 0;
    this.hitstun = Math.min(this.hitstun, .08);
    this.invulnerable = Math.max(this.invulnerable, .18);
    this.velocity.x = -attacker.facing * 3.6;
    this.velocity.y = 2.4;
    this.lastThrow = null;
    window.combatAudio?.play?.('dodge', { position: this.position });
    window.showCombatCallout?.('GRAB ESCAPE', '#9df1ff');
    return true;
  }

  /** Release a held grab without a throw: the grabber was hit, the round ended, etc. */
  dropGrab() {
    const victim = this.grabTarget;
    this.grabTarget = null;
    this.grabHold = 0;
    this.heldThrow = null;
    if (!victim) return false;
    victim.grabbedBy = null;
    victim.grabEscapeTimer = 0;
    victim.hitstun = Math.min(victim.hitstun, .12);
    return true;
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
      radius: a.aerial ? (a.comboStep>=5 ? 2.45 : a.dive ? 1.5 : 2.05) : a.launcher ? 1.48 : a.kind === 'heavy' ? 1.35 : a.kind === 'slash' ? 1.3 : a.kind === 'grab' ? 1.05 : 1.2,
      damage: a.damage, kbs: a.kbs, launchY: a.launchY || 3.4, aerial: !!a.aerial,
      kind:a.kind||'melee',weaponKind:a.weaponKind||this.model?.userData?.weaponKind||'unarmed',identityKey:this.identityKey||'',
      launcher: !!a.launcher, antiAir: !!a.antiAir, dive: !!a.dive, countering: !!a.countering, comboStep: a.comboStep || this.comboStep, lifetime: a.aerial ? .26 : .15, hit: false
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
        // Aerial moves carry a long lunge reach (`reachAbsolute` 4.6 for the air strike, 6.24 for
        // the finisher). Spawning the box at that fixed offset put a close midair punch 3.7 m past
        // an opponent standing 0.84 m away, so every close aerial strike whiffed while a distant
        // one connected - the exact opposite of what a fighting game wants. The strike is clamped
        // to a target that is actually in front, which keeps the long reach for pursuit and makes
        // point-blank air hits land.
        let strikeReach = h.reach;
        if (target) {
          const dx = target.position.x - owner.position.x;
          const dz = target.position.z - owner.position.z;
          const horizontal = Math.hypot(dx, dz);
          const inFront = dx * direction.x + dz * direction.z > 0;
          if (inFront && horizontal < strikeReach) strikeReach = Math.max(.8, horizontal);
        }
        h.pos.copy(owner.position).add(direction.multiplyScalar(strikeReach))
          .add(new THREE.Vector3(0, 1.32 + verticalTrack, 0));
      }
      let remove = h.lifetime <= 0;
      for (const other of (window.fighters || [])) {
        if (other === this || h.hit) continue;
        const targetPoint = other.position.clone().add(new THREE.Vector3(0, 1, 0));
        const d = h.pos.distanceTo(targetPoint);
        if (d < h.radius + other.hurtboxRadius) {
          // An invulnerable target (knocked down, mid-getup) must not spend the hitbox: the
          // swing passed through them, but the active frame still has life left for a target
          // that becomes hittable. Marking `hit` first silently ate every heavy and launcher
          // that spawned while the opponent was still recovering from the previous string.
          if (other.invulnerable > 0) continue;
          h.hit = true;
          // Cover: a swing does not reach through a wall. The line between the two chests is
          // sampled against the stage's solid volumes, so fighting either side of a wall in
          // the Death Star or a castle corridor cannot land free hits.
          const coveringLayout = other.layout || this.layout;
          if (coveringLayout) {
            const reachLineEnd = other.position.clone().add(new THREE.Vector3(0, 1, 0));
            if (solidBetween(this.position.clone().add(new THREE.Vector3(0, 1, 0)), reachLineEnd, coveringLayout)) {
              window.showCombatCallout?.('BLOCKED BY COVER', '#a9b7c9');
              continue;
            }
          }
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
          if (h.kind === 'grab') {
            // A real throw: the victim is held for a moment (and can struggle out), then
            // launched in the aimed direction instead of taking a generic punch.
            if (guarding) {
              const blocked = damageFor(h.damage, {
                guarding: true, offhand: offhandOf(other)
              }) * (other.incomingDamage ?? 1);
              other.percent += blocked;
              other.hitstun = 0.16;
              this.spendGuard(other, h);
              awardCombatMeter(this, other, blocked, { guarded: true });
            } else if (other.guardBreak > 0 || other.hitstun > 0) {
              // A guard-broken or already-stunned target cannot be held, but still takes the
              // grab's damage; this prevents a grabbed target from being grabbed again.
              const chipped = damageFor(h.damage, {}) * (other.incomingDamage ?? 1);
              other.percent += chipped;
              awardCombatMeter(this, other, chipped, {});
              other.hitstun = Math.max(other.hitstun, .35);
            } else {
              this.beginThrow(other, h);
            }
            other.lastHitBy = this;
            window.spawnImpact?.(h.pos, 12, 0xffc476, 'grab');
            remove = true;
            break;
          }
          const targetAirborne = !other.isGrounded || other.position.y > (other.groundLevel || 0) + .35;
          const combo = afterHit({
            attackerHits: this.comboHitCount,
            windowOpen: this.comboWindow > 0,
            targetAirborne,
            attackerAirHits: this.airHits
          });
          // A shielded block is resolved by the same rule as a bare one, with the defender's
          // offhand supplied: only a shield changes the multiplier, and only while guarding.
          const dealt = damageFor(h.damage, {
            guarding, comboStep: combo.hitCount, offhand: offhandOf(other)
          }) * (other.incomingDamage ?? 1);
          other.percent += dealt;
          if (guarding) this.spendGuard(other, h);
          // Meter and form power come from confirmed damage events only, so whiffing fills
          // nothing and a blocked hit is worth much less than a clean one.
          awardCombatMeter(this, other, dealt, { guarded: guarding });
          other.lastHitBy = this;
          this.comboHitCount = combo.hitCount;
          this.airHits = combo.airHits;
          this.comboHitFlash = .7;
          this.comboWindow = Math.max(this.comboWindow, COMBO.window);
          if (h.countering) window.showCombatCallout?.('COUNTER HIT!', '#ffe18a');
          else if (combo.limitReached && !guarding) window.showCombatCallout?.('JUGGLE LIMIT', '#ffb3a7');
          else if (h.comboStep >= 3 && !guarding) window.showCombatCallout?.('COMBO FINISHER!', '#ffbd72');
          else if (this.comboHitCount >= 2 && !guarding) window.showCombatCallout?.(`${this.comboHitCount} HIT COMBO`, '#b9f7ff');
          const baseStun = hitstunFor({ percent: other.percent, guarding, aerial: h.aerial, launcher: h.launcher });
          const reaction = reactionFor(other, {
            damage: h.damage,
            hitstun: targetAirborne ? airHitstun(baseStun, combo.airHits) : baseStun,
            knockback: knockbackFor({ kbs: h.kbs, percent: other.percent, guarding, weight: other.weight }),
            launch: launchFor({ launchY: h.launchY, guarding, weight: other.weight, aerial: h.aerial, launcher: h.launcher }),
            limitReached: combo.limitReached && !guarding
          });
          other.hitstun = reaction.hitstun;
          // Ledger of resolved melee hits, written by the resolver itself. Combat verification reads
          // this instead of assuming a hit happened or forcing percent between frames.
          try {
            const ledger = window.__browserSmashCombatEvents = window.__browserSmashCombatEvents || [];
            ledger.push({
              source: 'melee', move: h.moveId || h.id || h.kind || null, kind: h.kind || null,
              attacker: this.identity || null, target: other.identity || null,
              dealt: +dealt.toFixed(2), percentAfter: +other.percent.toFixed(2),
              hitstun: +other.hitstun.toFixed(3), guarded: Boolean(guarding),
              knockback: +Number(reaction.knockback || 0).toFixed(2),
              velocity: { x: +other.velocity.x.toFixed(2), y: +other.velocity.y.toFixed(2), z: +other.velocity.z.toFixed(2) },
              at: Math.round(performance.now())
            });
            if (ledger.length > 200) ledger.shift();
          } catch (_ledgerError) { /* diagnostics must never break a hit */ }
          // A blocked hit flinches but does not break the guard. This used to raise
          // `guardBreak` for 0.08 s, which disabled guarding and made every blocked hit after
          // the first free; guard break now means one thing only — the shield is empty.
          other.guardStun = guarding ? 0.14 : 0;
          other.velocity.x = this.facing * reaction.knockback;
          other.velocity.z = this.facingZ * reaction.knockback;
          if (reaction.spike) other.velocity.y = reaction.launch;
          else if (!reaction.armored) other.velocity.y = Math.max(other.velocity.y, reaction.launch);
          if (reaction.armored) window.showCombatCallout?.('ARMOR', '#c9d6ff');
          if (reaction.spike) window.showCombatCallout?.('SPIKED', '#ffb3a7');
          if (h.aerial && !guarding && !reaction.spike) { other.velocity.x += this.facing * 1.1; other.velocity.y += .85; }
          other.isGrounded = false;
          const impactColors={
            stormbreaker:0x91eaff,hammer:0xffd18a,axe:0xffc46f,sword:0xffe1a1,katana:0xffe1a1,cyber_blade:0x87d8ff,
            war_fan:0xf4d4a0,whip:0xffd36a,trident:0x70e8ff,webshooters:0xf7fbff,energy_gauntlet:0x7ce6ff,
            lightning:0xffec9d,repulsor:0x59eaff,staff:0x9df1ff
          };
          // Unarmed and ki fighters spark in their own signature colour instead of one shared blue.
          const sparkColor=impactColors[h.weaponKind]||signatureFor(this).color;
          window.spawnImpact?.(h.pos, guarding ? 3 : h.damage, sparkColor, h.weaponKind);
          // Hit-stop: strong clean hits momentarily freeze the simulation, which is what
          // makes a finisher feel heavier than a jab. Guarded hits never freeze.
          if (!guarding && h.damage >= 13) window.requestHitStop?.(h.damage >= 19 ? 0.085 : 0.05);
          remove = true;
          break;
        }
      }
      if (remove) this.hitboxes.splice(n, 1);
    }
  }
}
