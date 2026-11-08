// Animation state machine for a fighter model.
//
// One AnimationMixer per fighter drives the bound rig. States are derived from the fighter's
// gameplay state (never the reverse): attacks, hit windows, damage and knockback stay in
// fighter3D.js / main.js, and this controller reads them to pick, blend and time clips.
//
// One-shot attack clips are retimed so their strike peak lands exactly on the gameplay active
// window ((start + end) / 2), so impacts line up with the visible extension of the limb instead
// of drifting with a guessed playback speed.
import * as THREE from 'three';
import { resolveRig, resetRig } from './rig_map.js';
import { buildAllClips, buildClip, retimeClip, CLIP_SPECS } from './clip_library.js';
import { attackClipsFor, specialClipFor } from './animation_manifest.js';
import { registerAttackClips } from './attack_clips.js';
import { motionSetFor } from './attack_animator.js';
import { styleFor, gaitTimeScale, DEFAULT_MOTION_STYLE } from './motion_style.js';

const _round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

// Reused every frame by the personality overlay instead of allocating a Euler/Quaternion per bone.
const _nudgeEuler = new THREE.Euler();
const _nudgeQuat = new THREE.Quaternion();

// States whose body language belongs to the clip itself. The personality overlay must not soften
// a knockdown, a hit reaction or a round-end pose.
const DOWN_CLIPS = new Set(['hit_light', 'hit_heavy', 'launch', 'aerial_recovery', 'knockdown', 'get_up', 'knockout']);
// Authored sequences own every joint for their whole duration. Layering idle sway or arm swing on
// top of them would soften the very beats the move is built from.
const SEQUENCE_CLIPS = new Set(['spider_web_ultimate', 'spider_sense_overdrive']);
const LOCOMOTION_CLIPS = new Set(['idle', 'walk', 'run', 'sprint', 'stop', 'turn', 'strafe_left', 'strafe_right', 'fighting_idle']);
const ATTACK_CLIPS = new Set(['jab', 'cross_punch', 'heavy_punch', 'uppercut', 'front_kick', 'spinning_kick', 'combo_1', 'combo_2', 'special_attack', 'grab', 'throw',
  // Spider-Man's own strike clips are attacks too. Without them the personality overlay treated a
  // committed punch as idle body language and added the full idle sway and arm swing on top.
  'SpiderMan_Jab', 'SpiderMan_Cross', 'SpiderMan_Heavy', 'SpiderMan_Kick', 'SpiderMan_Air']);

// Gameplay attack kind -> library clip. The controller never invents damage; it only mirrors
// the move the gameplay code already committed to.
function attackClipId(attack, fighter, available = null) {
  const kind = String(attack?.kind || 'melee');
  const combo = fighter?.comboStep || 1;
  let id = null;
  if (kind === 'grab') id = 'grab';
  else if (kind === 'throw') id = 'throw';
  else {
    // Per-character attack animation (anim/animation_manifest.js). A brawler's heavy is a rising
    // uppercut, an agile fighter's second hit is a kick, a controlled fighter throws a straight
    // cross. The defaults are the exact mappings this function shipped with, so a fighter with no
    // style override animates exactly as before.
    const clips = attackClipsFor(fighter);
    // A resolved move id outranks the chain step: 'heavyLauncher' and 'heavySlam' both reach here as
    // coarse kinds, so a kind-only lookup silently played the same clip for both of them.
    if (attack?.id && clips[attack.id]) id = clips[attack.id];
    else if (kind === 'counter-strike') id = clips.counter;
    else if (kind === 'air-finisher') id = clips.airFinisher;
    else if (kind === 'air-strike') id = clips.air;
    else if (kind === 'heavy') id = combo >= 3 ? clips.heavyFinisher : clips.heavy;
    else if (kind === 'slash' || kind === 'arcane') id = combo >= 2 ? clips.heavy : 'cross_punch';
    else if (combo >= 3) id = clips.finisher;
    else if (combo === 2) id = clips.light2;
    else id = clips.light;
  }
  // Imported strike manifests name clips loaded onto the legacy Mixamo mixer, not the controller's
  // own clip map. A body with no compatible copy (the current Mixamo Spider-Man) would otherwise
  // request 'SpiderMan_Jab', fail the lookup, and silently hold the previous locomotion pose for the
  // whole attack. Fall back to the style's library clip; a rig that really owns the imported clip
  // keeps using it.
  if (available && id && !available.has(id)) {
    return attackClipId(attack, { archetype: fighter?.archetype }, null);
  }
  return id;
}

export class AnimationController {
  constructor(model, fighter, options = {}) {
    this.model = model;
    this.fighter = fighter;
    this.options = options;
    this.enabled = true;
    this.time = 0;
    this.rig = options.rig || resolveRig(model);
    this.mixer = this.rig ? new THREE.AnimationMixer(model) : null;
    this.clips = this.rig ? buildAllClips(this.rig) : new Map();
    this.external = new Set();
    this.retimed = new Map();
    this._active = null;
    this._activeKey = null;
    this._lock = null;
    this._airTime = 0;
    this._wasMoving = false;
    this._lastSpecialCooldown = 0;
    this._lastAbilityCast = 0;
    this._getUpTimer = 0;
    this._landTimer = 0;
    this._downState = false;
    this._heading = 0;
    this._turnRate = 0;
    this._turnDir = 0;
    this._startedFlight = false;
    // Personality: which stride/bounce/sway this identity carries, and the two phase clocks that
    // drive the step cycle and the slow idle motions (breathing, weight shift).
    this.style = styleFor(fighter);
    this._phase = 0;
    this._idleClock = 0;
    this.stats = { transitions: 0, retimes: 0, missing: [] };
    if (this.rig && this.rig.missing.length) this.stats.missing = this.rig.missing.slice();

    // Authored attack motion (anim/attack_motions_*.js) is compiled into clips for THIS rig, so a
    // body whose bones are owned by this controller plays the identity's real strike. Before this,
    // the controller asked the manifest for a library id, so an authored motion could resolve, report
    // a pose slot, and never reach a bone the controller draws.
    this.authoredAttackClips = [];
    this.attackClipReport = { asked: [], added: [], missing: [] };
    try {
      const slots = attackClipsFor(fighter) || {};
      const motions = motionSetFor(fighter)?.motions || null;
      if (motions) {
        const ids = {};
        for (const clipId of Object.values(slots)) {
          if (!String(clipId || '').startsWith('authored_')) continue;
          ids[clipId] = String(clipId).slice('authored_'.length);
        }
        const result = registerAttackClips(this, { ids, motions });
        this.authoredAttackClips = result.added;
        this.attackClipReport = { asked: Object.keys(ids), added: result.added, missing: result.skipped };
      }
    } catch (error) {
      console.warn('Authored attack clips could not compile: ' + (error?.message || error));
    }
    // A bound controller must already be playing a clip. Waiting for the first gameplay frame left
    // the model in its bind pose while any probe that measured the just-mounted body saw an
    // animation owner with `active:null`; starting the idle here makes the bind atomic.
    if (this.ready) this.update(0);
  }

  /** True when this model can be driven by clips at all. */
  get ready() {
    return Boolean(this.mixer && this.clips.size);
  }

  /** Replace library clips with real downloaded clips (Mixamo/Sketchfab), keyed by clip id. */
  setExternalClips(map, source = 'external') {
    if (!map) return;
    for (const [id, clip] of map) {
      if (!clip) continue;
      this.clips.set(id, clip);
      this.external.add(id);
      this.retimed.delete(id);
    }
    this.sourceLabel = source;
  }

  /** All clips currently usable, with provenance for the asset report. */
  describe() {
    const active = this._active;
    const clip = active ? this.clips.get(active) : null;
    return {
      rig: this.rig?.kind || 'none',
      boundBones: this.rig?.boundCount || 0,
      missingBones: this.rig?.missing || [],
      clips: this.clips.size,
      externalClips: [...this.external],
      active: active || null,
      activeProgress: clip ? _round(this.currentTime / Math.max(1e-4, clip.duration)) : 0,
      loop: clip ? Boolean(clip.userData?.loop) : false,
      origin: clip?.userData?.origin || (this.external.has(active) ? 'external' : 'unknown'),
      transitions: this.stats.transitions,
      retimes: this.stats.retimes,
      personality: this.style?.id || 'default',
      enabled: this.enabled
    };
  }

  get currentTime() {
    return this.mixer && this._action ? this._action.time : 0;
  }

  _retimedClip(id, duration, peak) {
    const key = `${id}|${_round(duration, 2)}|${_round(peak, 3)}`;
    if (this.retimed.has(key)) return this.retimed.get(key);
    const source = this.clips.get(id);
    if (!source) return null;
    const clip = retimeClip(source, duration, peak);
    if (this.retimed.size > 64) this.retimed.clear();
    this.retimed.set(key, clip);
    this.stats.retimes++;
    return clip;
  }

  _play(id, { fade = 0.12, duration = null, peak = null, timeScale = 1, key = null } = {}) {
    if (!this.mixer) return false;
    let clip = duration ? this._retimedClip(id, duration, peak) : this.clips.get(id);
    if (!clip) return false;
    const action = this.mixer.clipAction(clip);
    const previous = this._action;
    if (previous === action && this._activeKey === key) {
      // Same clip continuing (e.g. a held loop) - do not restart or re-lock it, but keep the
      // playback rate current so a fighter who speeds up also steps faster.
      if (!clip.userData?.loop) action.paused = false;
      action.setEffectiveTimeScale(timeScale);
      return 'active';
    }
    const loop = clip.userData?.loop !== false;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(timeScale);
    if (fade > 0) action.fadeIn(fade);
    action.play();
    if (previous && previous !== action) {
      if (fade > 0) previous.fadeOut(fade);
      else previous.stop();
    }
    this._action = action;
    this._active = id;
    this._activeKey = key;
    this.stats.transitions++;
    return 'started';
  }

  _hold(priority, seconds) {
    this._lock = { priority, until: this.time + Math.max(0.08, seconds * 0.92) };
  }

  _lockedOut(priority) {
    return Boolean(this._lock && this.time < this._lock.until && priority <= this._lock.priority);
  }

  /**
   * Play the round result pose. The match ends by calling this on both fighters, so the winner
   * celebrates and the loser slumps instead of both dropping straight back to idle under the menu.
   * The lock outranks every gameplay state, so a leftover hit reaction or attack cannot override it.
   */
  celebrate(kind = 'victory') {
    const id = kind === 'defeat' ? 'defeat' : 'victory';
    if (!this.clips.has(id)) return false;
    this._play(id, { fade: 0.18 });
    this._hold(20, CLIP_SPECS[id]?.duration || 1.5);
    return true;
  }

  /** Derive the clip the fighter should be showing right now. */
  _select() {
    const f = this.fighter;
    if (!f) return null;
    const speed = Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0);
    const vy = f.velocity?.y || 0;
    const grounded = f.isGrounded !== false;
    const airborne = !grounded;
    const hitstun = f.hitstun || 0;
    const guardBreak = f.guardBreak || 0;

    if (hitstun > 0) {
      if (hitstun > 0.95 && airborne) { this._downState = true; return { id: 'knockout', priority: 19, fade: 0.1, once: 1.3 }; }
      if (hitstun > 0.62) { this._downState = true; return { id: airborne ? 'launch' : 'knockdown', priority: 18, fade: 0.1, once: airborne ? 0.62 : 0.9 }; }
      if (hitstun > 0.3) return { id: 'hit_heavy', priority: 16, fade: 0.08, once: 0.52 };
      return { id: 'hit_light', priority: 15, fade: 0.06, once: 0.34 };
    }
    if (this._downState) {
      this._downState = false;
      this._getUpTimer = grounded ? 0.8 : 0;
      // The knockdown clip clamped on its last pose; release its hold so the recovery plays.
      this._lock = null;
    }
    if (this._getUpTimer > 0) return { id: 'get_up', priority: 18, fade: 0.14, once: 0.8 };

    // An imported body has no baked ultimate, and the legacy action binder cannot pose its Mixamo
    // bones. The authored sequence lives in this controller's own clip map, so casting has to be a
    // state here or the meter is spent while the body keeps standing in fighting_idle.
    if (f.casting === 'ultimate' && this.clips.has('spider_web_ultimate')) {
      const def = f.ultimateDef || {};
      const total = Math.max(0.8,
        (Number(def.startup) || 0.46) + (Number(def.active) || 1.1) + (Number(def.recovery) || 0.6));
      return { id: 'spider_web_ultimate', priority: 17, fade: 0.08, once: total + 0.08 };
    }
    // The form activation is a one-second read, not the whole buff. It is selected from the live
    // transform record, so a body that activates the form from a non-idle state still snaps into
    // the authored launch pose instead of borrowing whatever locomotion it was in.
    if ((f.formLock || 0) > 0.04 && f.transform?.form?.id === 'spider-sense-overdrive'
      && this.clips.has('spider_sense_overdrive')) {
      return { id: 'spider_sense_overdrive', priority: 13, fade: 0.08, once: Math.max(0.9, f.formLock) };
    }

    const attack = f.attackQueue?.[f.attackQueue.length - 1];
    if (attack) {
      const id = attackClipId(attack, f, this.clips);
      const total = Math.max(0.12, attack.total || 0.34);
      const center = ((attack.start || 0) + (attack.end ?? attack.total ?? 0.2)) / 2;
      const peak = THREE.MathUtils.clamp(center / total, 0.12, 0.85);
      return { id, priority: 12, fade: 0.06, once: total, duration: total, peak, key: attack };
    }
    if (f.dodgeTimer > 0) {
      const lateral = (f.velocity?.x || 0) * (f.facing || 1);
      const id = lateral < -0.4 ? 'dodge_left' : lateral > 0.4 ? 'dodge_right' : 'dodge_right';
      return { id, priority: 11, fade: 0.06, once: 0.4 };
    }
    if (f.guardHeld && guardBreak <= 0) return { id: 'block', priority: 9, fade: 0.12 };

    if (f.webSwinging) return { id: 'web_swing', priority: 8, fade: 0.12 };

    if (f.flightMode) {
      if (!this._startedFlight) this._flyStartTimer = 0.5;
      this._startedFlight = true;
      if (speed > 13 && vy > 1) return { id: 'fly_boost', priority: 7, fade: 0.16 };
      if (this._turnRate > 1.6 && speed > 1.5) return { id: 'fly_turn', priority: 7, fade: 0.14 };
      if (this._flyStartTimer > 0) return { id: 'fly_start', priority: 7, fade: 0.1, once: 0.5 };
      return { id: 'fly_loop', priority: 6, fade: 0.18 };
    }
    if (this._startedFlight) {
      this._startedFlight = false;
      this._flyStartTimer = 0;
      return { id: 'fly_land', priority: 9, fade: 0.1, once: 0.6 };
    }

    if (airborne) {
      this._airTime += this._dt;
      if (vy > 3.2 && this._airTime < 0.4) return { id: 'jump', priority: 6, fade: 0.08, once: 0.42 };
      if (vy > 0.5) {
        const jumps = f.jumpCount || f.jumpsUsed || 1;
        if (jumps > 1 && this._airTime < 0.6) return { id: 'double_jump', priority: 7, fade: 0.08, once: 0.54 };
        return { id: 'fall', priority: 5, fade: 0.14 };
      }
      return { id: 'fall', priority: 5, fade: 0.14 };
    }
    // Landing is a transition, not a vertical-speed test: the collision resolver has already
    // zeroed `velocity.y` by the time a grounded frame is sampled, so the old `vy < -3.2` branch
    // never fired and jump -> idle skipped the touchdown pose entirely. Remember that the body
    // was actually airborne (not just spawned) and hold the landing clip for its own duration.
    if (this._airTime > 0.12) this._landTimer = Math.max(this._landTimer || 0, 0.34);
    this._airTime = 0;

    const combat = typeof this.options.isCombat === 'function' ? this.options.isCombat() : true;
    if (this._landTimer > 0) return { id: 'land', priority: 8, fade: 0.06, once: 0.34 };
    if (vy < -3.2) return { id: 'land', priority: 8, fade: 0.06, once: 0.34 };
    if (speed > 11.5) return { id: 'sprint', priority: 4, fade: 0.12 };
    if (speed > 6.2) return { id: 'run', priority: 3, fade: 0.12 };
    if (speed > 0.75) return { id: 'walk', priority: 2, fade: 0.14 };
    if (this._wasMoving) return { id: 'stop', priority: 2, fade: 0.08, once: 0.34 };
    if (this._turnRate > 2.4) return { id: 'turn', priority: 3, fade: 0.08, once: 0.42 };
    return { id: combat ? 'fighting_idle' : 'idle', priority: 1, fade: 0.2 };
  }

  update(dt) {
    if (!this.enabled || !this.mixer) return;
    this._dt = dt;
    this.time += dt;
    const f = this.fighter;
    if (!f) return;

    // Track heading change for the turn/bank clips.
    const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
    let delta = heading - this._heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this._turnRate = dt > 0 ? Math.abs(delta) / dt : 0;
    this._turnDir = delta === 0 ? 0 : Math.sign(delta);
    this._heading = heading;

    // A fresh signature move fires a one-shot regardless of the locomotion state.
    const cooldown = f.specialCooldown || 0;
    if (cooldown > this._lastSpecialCooldown + 0.15 && !this._lockedOut(14)) {
      // A fighter with an authored signature clip plays its own move; everyone else keeps the
      // shared special_attack pose, so no identity can end up with no animation.
      const requested = specialClipFor(f);
      const specialId = this.clips.has(requested) ? requested : 'special_attack';
      this._play(specialId, { fade: 0.1, once: true });
      this._hold(14, (CLIP_SPECS[specialId] || CLIP_SPECS.special_attack).duration);
      this._lastSpecialCooldown = cooldown;
    } else {
      this._lastSpecialCooldown = Math.max(this._lastSpecialCooldown, cooldown);
      if (cooldown <= 0) this._lastSpecialCooldown = 0;
    }

    // A kit ability (Rasengan, Shadow Clone) plays the motion authored for it. Priority 13 sits
    // under the signature's 14, so the headline move still wins if both land on one frame, and a
    // fighter whose ability has no authored motion simply keeps its locomotion pose.
    const cast = f.abilityCast;
    if (cast && cast.at !== this._lastAbilityCast) {
      const requested = cast.motion
        ? (this.clips.has(cast.motion) ? cast.motion : `authored_${cast.motion}`)
        : null;
      if (requested && this.clips.has(requested) && !this._lockedOut(13)) {
        this._play(requested, { fade: 0.08, once: true });
        this._hold(13, (CLIP_SPECS[requested] || CLIP_SPECS.special_attack).duration);
      }
      this._lastAbilityCast = cast.at;
    }

    if (this._flyStartTimer > 0) this._flyStartTimer = Math.max(0, this._flyStartTimer - dt);
    this._getUpTimer = Math.max(0, this._getUpTimer - dt);
    this._landTimer = Math.max(0, (this._landTimer || 0) - dt);
    if (this._lock && this.time >= this._lock.until) this._lock = null;

    const state = this._select();
    if (state && !this._lockedOut(state.priority)) {
      const speed = Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0);
      const played = this._play(state.id, {
        // A heavy identity fades more slowly between poses than a speedster does.
        fade: (state.fade ?? 0.12) * (this.style?.fadeScale || 1),
        duration: state.duration || null,
        peak: state.peak ?? null,
        key: state.key || null,
        // Cadence is speed-matched per identity, never per gameplay rule: the clip's speed has no
        // influence on damage, reach or movement.
        timeScale: gaitTimeScale(this.style, state.id, speed)
      });
      // Attacks own their own lifetime through attackQueue, so only self-timed one-shots lock,
      // and only at the moment they actually start (never re-armed every frame).
      if (played === 'started' && state.once && !state.key) this._hold(state.priority, state.once);
    }

    this._wasMoving = Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0) > 1.2;
    this.mixer.update(dt);
    // The mixer has just written the clip's pose; the personality layer adds to it, never instead
    // of it. Anything this layer skips still plays exactly the clip it played before.
    this._applyPersonality(dt);
  }

  /**
   * Secondary motion layered on top of the clip the mixer just wrote.
   *
   * The clip library is humanoid-average: one cadence, one sway for every fighter. This adds the
   * differences that make a body read as a specific person - breathing, weight shift, hip sway,
   * arm opposition, the shinobi's arms-streamed run - as small local quaternion offsets applied
   * AFTER mixer.update, so the clip stays the base pose and gameplay timing is untouched.
   *
   * Only joints the active clip actually drives are touched (`clip.userData.bones`), and hit, down
   * and round-end states are skipped: that body language belongs to the clip.
   */
  _applyPersonality(dt) {
    if (!this._active || !this.rig) return;
    const id = this._active;
    if (DOWN_CLIPS.has(id) || SEQUENCE_CLIPS.has(id) || id === 'victory' || id === 'defeat') return;
    const style = this.style || DEFAULT_MOTION_STYLE;
    const clip = this.clips.get(id);
    const covered = clip?.userData?.bones ? new Set(clip.userData.bones) : null;

    const speed = Math.hypot(this.fighter?.velocity?.x || 0, this.fighter?.velocity?.z || 0);
    const locomotion = LOCOMOTION_CLIPS.has(id);
    const flight = id.startsWith('fly_');
    const attacking = ATTACK_CLIPS.has(id);
    const weight = attacking ? 0.25 : flight ? 0.5 : 1;

    // Step cadence follows ground speed, so an approach and a sprint read differently.
    const cadence = (locomotion && speed > 1.2 ? 1.35 + Math.min(speed, 14) * 0.085 : 0.85) * (style.tempo || 1);
    this._phase += dt * Math.PI * 2 * cadence;
    this._idleClock += dt;
    const step = Math.sin(this._phase);
    const doubleStep = Math.sin(this._phase * 2);
    const breath = Math.sin(this._idleClock * Math.PI * 2 * 0.23);
    const shift = Math.sin(this._idleClock * Math.PI * 2 * 0.12);

    const moving = locomotion && speed > 1.2;
    const runCycle = id === 'run' || id === 'sprint';
    const bob = doubleStep * style.bounce * (moving ? 1 : 0.45) * weight;
    const sway = (step * style.sway * (moving ? 1 : 0.55) + shift * style.idleSway * (moving ? 0 : 1)) * weight;
    const lean = (style.lean
      + (runCycle ? style.runLean : 0)
      + (flight ? style.flightLean : 0)
      + breath * style.breathing * (moving ? 0.3 : 1)) * weight;
    // The shinobi run: arms streamed behind instead of swinging, only while running.
    const armBack = runCycle ? (style.armBack || 0) : 0;
    const armed = runCycle && style.armBack > 0.4 ? 0.25 : 1;
    const guard = (id === 'fighting_idle' || id === 'block')
      ? Math.sin(this._idleClock * Math.PI * 2 * 1.1) * style.guardBounce
      : 0;
    const bank = Math.min(1, Math.max(0, (this._turnRate || 0) * 0.05)) * style.turnBank * (this._turnDir || 0);

    this._nudge(covered, 'pelvis', bob + guard, sway * 0.6, sway);
    this._nudge(covered, 'torso', lean + bob * 0.5, sway * 0.2, -sway * 0.8 - bank);
    this._nudge(covered, 'head', -lean * 0.55 + style.headPitch + breath * 0.02,
      Math.sin(this._idleClock * 0.7) * style.headTurn * (moving ? 0.3 : 1), -sway * 0.3 + bank * 0.3);

    const swing = step * style.armSwing * (moving ? 1 : 0.35) * weight * armed;
    this._nudge(covered, 'leftArm', swing + armBack, 0, sway * 0.2);
    this._nudge(covered, 'rightArm', -swing + armBack, 0, -sway * 0.2);
    this._nudge(covered, 'leftFore', -Math.abs(armBack) * 0.25 + swing * 0.3, 0, 0);
    this._nudge(covered, 'rightFore', -Math.abs(armBack) * 0.25 - swing * 0.3, 0, 0);

    if (moving) {
      const stride = step * style.stride * weight;
      this._nudge(covered, 'leftLeg', -stride, 0, 0);
      this._nudge(covered, 'rightLeg', stride, 0, 0);
      this._nudge(covered, 'leftShin', Math.max(0, stride) * 1.4, 0, 0);
      this._nudge(covered, 'rightShin', Math.max(0, -stride) * 1.4, 0, 0);
    }
  }

  /** Add a small local-space rotation to one canonical joint, if the active clip drives it. */
  _nudge(covered, bone, x = 0, y = 0, z = 0) {
    if (!x && !y && !z) return;
    if (covered && !covered.has(bone)) return;
    const node = this.rig?.joints?.[bone];
    if (!node) return;
    _nudgeEuler.set(x, y, z, 'XYZ');
    _nudgeQuat.setFromEuler(_nudgeEuler);
    node.quaternion.multiply(_nudgeQuat).normalize();
  }

  /** Stop driving the rig and restore the bind pose (used for modes with no clip coverage). */
  suspend() {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.mixer) this.mixer.stopAllAction();
    this._action = null;
    this._active = null;
    this._activeKey = null;
    this._lock = null;
    resetRig(this.rig);
  }

  resume() {
    if (this.enabled) return;
    this.enabled = true;
    this._play('fighting_idle', { fade: 0.2 });
  }

  dispose() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
    }
    this.retimed.clear();
    this.clips.clear();
    this.mixer = null;
    this.rig = null;
    this.enabled = false;
  }
}

/** Bind an animation controller to a fighter, or return null when the model cannot be driven. */
export function attachAnimation(model, fighter, options = {}) {
  if (!model?.isObject3D) return null;
  // An imported rig that ships baked clips is driven by the named-action mixer in
  // human_fighter.js. An imported rig with a skeleton but no clips has no such library, so the
  // authored clips bind to its bones here rather than leaving it with the 4-joint overlay.
  if (model.userData?.humanMixer && model.userData?.hasAnimationClips) return null;
  const controller = new AnimationController(model, fighter, options);
  if (!controller.ready) {
    controller.dispose();
    return null;
  }
  model.userData.animationController = controller;
  model.userData.animationRig = controller.rig;
  window.__browserSmashAssets = window.__browserSmashAssets || {};
  window.__browserSmashAssets.animations = window.__browserSmashAssets.animations || {};
  window.__browserSmashAssets.animations[fighter?.identityKey || fighter?.name || 'fighter'] =
    controller.describe();
  // Live registry for tooling: the fighter's controller is the source of truth, the snapshot
  // above is only the state at bind time.
  window.__browserSmashAnimControllers = window.__browserSmashAnimControllers || [];
  window.__browserSmashAnimControllers.push(controller);
  return controller;
}

export { attackClipId, buildClip };
