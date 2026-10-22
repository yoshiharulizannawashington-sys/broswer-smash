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

const _round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

// Gameplay attack kind -> library clip. The controller never invents damage; it only mirrors
// the move the gameplay code already committed to.
function attackClipId(attack, fighter) {
  const kind = String(attack?.kind || 'melee');
  const combo = fighter?.comboStep || 1;
  if (kind === 'grab') return 'grab';
  if (kind === 'throw') return 'throw';
  if (kind === 'counter-strike') return 'uppercut';
  if (kind === 'air-finisher') return 'spinning_kick';
  if (kind === 'air-strike') return 'front_kick';
  if (kind === 'heavy') return combo >= 3 ? 'spinning_kick' : 'heavy_punch';
  if (kind === 'slash' || kind === 'arcane') return combo >= 2 ? 'heavy_punch' : 'cross_punch';
  if (combo >= 3) return 'combo_2';
  if (combo === 2) return 'combo_1';
  return 'jab';
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
    this._getUpTimer = 0;
    this._downState = false;
    this._heading = 0;
    this._turnRate = 0;
    this._startedFlight = false;
    this.stats = { transitions: 0, retimes: 0, missing: [] };
    if (this.rig && this.rig.missing.length) this.stats.missing = this.rig.missing.slice();
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
      // Same clip continuing (e.g. a held loop) - do not restart or re-lock it.
      if (!clip.userData?.loop) action.paused = false;
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

    const attack = f.attackQueue?.[f.attackQueue.length - 1];
    if (attack) {
      const id = attackClipId(attack, f);
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
    this._airTime = 0;

    const combat = typeof this.options.isCombat === 'function' ? this.options.isCombat() : true;
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
    this._heading = heading;

    // A fresh signature move fires a one-shot regardless of the locomotion state.
    const cooldown = f.specialCooldown || 0;
    if (cooldown > this._lastSpecialCooldown + 0.15 && !this._lockedOut(14)) {
      this._play('special_attack', { fade: 0.1, once: true });
      this._hold(14, CLIP_SPECS.special_attack.duration);
      this._lastSpecialCooldown = cooldown;
    } else {
      this._lastSpecialCooldown = Math.max(this._lastSpecialCooldown, cooldown);
      if (cooldown <= 0) this._lastSpecialCooldown = 0;
    }

    if (this._flyStartTimer > 0) this._flyStartTimer = Math.max(0, this._flyStartTimer - dt);
    this._getUpTimer = Math.max(0, this._getUpTimer - dt);
    if (this._lock && this.time >= this._lock.until) this._lock = null;

    const state = this._select();
    if (state && !this._lockedOut(state.priority)) {
      const played = this._play(state.id, {
        fade: state.fade,
        duration: state.duration || null,
        peak: state.peak ?? null,
        key: state.key || null
      });
      // Attacks own their own lifetime through attackQueue, so only self-timed one-shots lock,
      // and only at the moment they actually start (never re-armed every frame).
      if (played === 'started' && state.once && !state.key) this._hold(state.priority, state.once);
    }

    this._wasMoving = Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0) > 1.2;
    this.mixer.update(dt);
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
