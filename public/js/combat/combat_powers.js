// Glue between the ultimate/transformation systems and the running game.
//
// main.js owns the scene, the camera and the layouts; this module owns the *rules* for landing
// an ultimate: invulnerability, cover, guarding and shield cost, damage scaling, knockback,
// meter/power gain, and the cleanup that must happen on a KO or a round reset. Keeping it here
// means the ultimate runner stays engine-agnostic and testable, while the game keeps one place
// where "a big hit landed" is resolved.

import * as THREE from 'three';
import { damageFor, knockbackFor, launchFor, hitstunFor, offhandOf } from './combat_rules.js';
import { awardCombatMeter, startUltimate, updateUltimates, clearUltimates, canUltimate, activeUltimate, beamOriginFor, ULTIMATE } from './ultimate.js';
import { beginFinisher, stepFinishers, clearFinishers, finisherCount, activeFinisherTimeScale } from './cinematic_finisher.js';
import { applyChoreography, releaseChoreography, beatForRecord, hasChoreography } from './ultimate_choreography.js';
import { applyHaulPose, releaseHaulPose } from './lasso_haul.js';
import { gainPower, powerFromDamage, endTransform, beginTransform, canTransform, transformState, disposeAura, REFUSAL } from './transformation.js';
import { movesetFor, ultimateFor } from './movesets.js';
import { abilitiesFor } from './ability_kit.js';
import { abilityCooldownRemaining } from './ability_runtime.js';
import { segmentSolid } from './projectile_hit.js';

export function createCombatPowers({
  scene,
  getLayout,
  solidAt,
  callout,
  impact,
  camera,
  fighters,
  showText
} = {}) {
  const layout = () => (typeof getLayout === 'function' ? getLayout() : null);
  const chest = (f, height = 1.15) => f.position.clone().add(new THREE.Vector3(0, height, 0));

  /** Is solid stage geometry between two points? */
  function coverBetween(a, b) {
    const stage = layout();
    if (!stage || !solidAt) return false;
    if (!a || !b) return false;
    return segmentSolid(a, b, (x, y, z) => solidAt(x, y, z, stage));
  }

  /** How far a lane can travel before it hits a wall, in metres. */
  function coverDistance(origin, dir, max) {
    const stage = layout();
    if (!stage || !solidAt) return max;
    const probe = new THREE.Vector3();
    const step = .5;
    for (let distance = 1.2; distance <= max; distance += step) {
      probe.copy(origin).addScaledVector(dir, distance);
      if (solidAt(probe.x, probe.y, probe.z, stage)) return Math.max(0, distance - step);
    }
    return max;
  }

  /**
   * Resolve one ultimate damage event. Returns true only when damage was actually applied, so
   * the runner can report honest misses.
   */
  function hit(owner, target, opts = {}) {
    if (!owner || !target || target === owner) return false;
    if (target.model?.visible === false || target.ko) return false;
    // A dodge or respawn window must read as a deliberate miss, not as a broken hit.
    if ((target.invulnerable || 0) > 0) {
      callout?.('EVADED · INVULNERABLE', '#a9e6ff');
      return false;
    }
    if (coverBetween(chest(owner, 1.1), chest(target, 1.1))) {
      callout?.('BLOCKED BY COVER', '#a9b7c9');
      return false;
    }
    const guarding = !!target.guardHeld && (target.guardBreak || 0) <= 0;
    const base = Math.max(0, Number(opts.damage) || 0);
    const scale = target.incomingDamage ?? 1;
    const dealt = damageFor(base, { guarding, itemMultiplier: 1, offhand: offhandOf(target) }) * scale;
    if (dealt <= 0) return false;
    target.percent += dealt;
    target.lastHitBy = owner;
    // The impact VFX below owns the single hit-stop for a confirmed hit. Requesting a second
    // freeze here stacked two stops on one ultimate and made the heavier hit feel muddy.
    if (guarding) owner.spendGuard?.(target, { damage: base, kbs: opts.kbs || 80 });
    // A held grab cannot survive being hit by an ultimate, in either direction.
    if (target.grabTarget) target.dropGrab?.();
    if (target.grabbedBy) target.escapeGrab?.();

    const away = target.position.clone().sub(owner.position);
    away.y = 0;
    if (away.lengthSq() < .001) away.set(owner.facing || 1, 0, owner.facingZ || 0);
    away.normalize();
    const knockback = knockbackFor({
      kbs: opts.kbs || 120, percent: target.percent, guarding, weight: target.weight
    });
    target.velocity.x = away.x * knockback;
    target.velocity.z = away.z * knockback;
    const launch = guarding ? 1.2 : launchFor({
      launchY: opts.launchY || 8, guarding, weight: target.weight, launcher: true
    });
    target.velocity.y = Math.max(target.velocity.y, launch);
    target.isGrounded = false;
    target.hitstun = Math.max(target.hitstun || 0,
      guarding ? .16 : Math.max(.3, hitstunFor({ percent: target.percent, launcher: true }) * .82));
    target.guardStun = guarding ? .18 : 0;

    // One line per applied damage event. This is what proves (or disproves) that a hit came from
    // the ultimate the player saw, rather than from a second, invisible damage source.
    if (typeof window !== 'undefined') {
      const hits = window.__browserSmashHitTrace || (window.__browserSmashHitTrace = []);
      hits.push({
        from: owner.identity || owner.name || '', to: target.identity || target.name || '',
        label: opts.label || '', kind: opts.kind || 'melee', ultimate: opts.ultimate?.label || null,
        damage: +dealt.toFixed(2), guarded: guarding
      });
      if (hits.length > 60) hits.splice(0, hits.length - 60);
    }

    const point = chest(target, 1.2);
    if (opts.kind === 'ultimate') {
      impact?.(point, guarding ? 4 : Math.min(26, 10 + dealt), opts.color, 'ultimate');
      if (!guarding) camera?.impact?.(Math.min(1, .12 + dealt * .035));
    }
    if (!guarding && dealt >= 8) showText?.(opts.label || 'ULTIMATE HIT', guarding ? '#a4bfff' : '#ffe6a8');

    // An ultimate never feeds its own meter back to the caster: without that rule a long
    // multi-hit ultimate would pay for the next one. The victim still earns comeback meter.
    if (opts.kind === 'ultimate') awardCombatMeter(null, target, dealt, { guarded: guarding });
    else awardCombatMeter(owner, target, dealt, { guarded: guarding });
    gainPower(owner, powerFromDamage(dealt, { guarded: guarding }));
    gainPower(target, powerFromDamage(dealt, { taken: true, guarded: guarding }));
    return true;
  }

  /**
   * Feed one non-ultimate damage event into both resources. Signature moves and projectiles call
   * this so a fighter builds toward a form and an ultimate by actually connecting.
   */
  function award(owner, target, damage, { guarded = false } = {}) {
    const dealt = Math.max(0, Number(damage) || 0);
    // One place for the feel of a landed shot: projectiles and signature moves both come
    // through here, so they get the same brief freeze a heavy melee hit already got.
    if (typeof window !== 'undefined') {
      window.requestHitStop?.(guarded ? .015 : Math.min(.1, .02 + dealt * .0038));
    }
    awardCombatMeter(owner, target, dealt, { guarded });
    gainPower(owner, powerFromDamage(dealt, { guarded }));
    gainPower(target, powerFromDamage(dealt, { taken: true, guarded }));
  }

  /** Context handed to the ultimate runner. */
  function context() {
    return {
      scene,
      fighters,
      hit,
      coverBetween,
      coverDistance,
      callout,
      onImpact: (point, color) => {
        impact?.(point, 12, color, 'ultimate');
        camera?.impact?.(.22);
      },
      onSlam: (point, radius, color) => {
        impact?.(point.clone().add(new THREE.Vector3(0, .2, 0)), 26, color, 'ultimate');
        camera?.impact?.(.7);
        callout?.('IMPACT', '#ffd9a1');
        void radius;
      },
      onStrike: (point, radius, color) => {
        impact?.(point, 16, color, 'ultimate');
        camera?.impact?.(.3);
        void radius;
      },
      onZoneTick: (point, radius, color, final) => {
        if (final) camera?.impact?.(.4);
        if (final) impact?.(point, 20, color, 'ultimate');
        void radius;
      },
      onBeam: () => camera?.impact?.(.34),
      onStart: record => {
        callout?.(`${record.label}`, css(record.colour));
        beginFinisher(record);
      },
      onEnd: record => {
        void record;
      }
    };
  }

  /** Advance every running ultimate and keep the caster's inputs locked correctly. */
  function update(dt) {
    updateUltimates(dt, context());
  }

  /**
   * Per-identity attack presentation. A camera move alone does not make two ultimates different:
   * Goku gathers ki and fires a two-handed beam, Iron Man lights the thrusters, climbs and fires
   * repulsors. Both are counted so a live match can prove which one actually ran.
   */
  function signatureFor(record) {
    const owner = record?.owner;
    if (!owner) return 'unknown';
    // Strip punctuation and spaces: identities arrive as both `iron_man` and `Iron Man (Tony Stark)`,
    // and the first version matched neither form of the display name.
    const id = String(owner.identityKey || owner.identity || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (id.includes('goku')) return 'goku';
    if (id.includes('ironman')) return 'iron_man';
    return 'generic';
  }

  function signaturePoint(owner, ahead = 0.9, height = 1.15) {
    const facing = Number(owner?.facing) || 1;
    return new THREE.Vector3(owner.position.x + facing * ahead, owner.position.y + height, owner.position.z);
  }

  function signatureBeat(record, beat) {
    const owner = record?.owner;
    if (!owner) return;
    const kind = signatureFor(record);
    window.__browserSmashFinisherSignature ||= {};
    const sig = window.__browserSmashFinisherSignature;
    const seen = (sig[kind] ||= { beats: [], events: {}, lift: 0 });
    // Identity evidence: which routing inputs produced which branch, recorded from the live cast.
    seen.identityKey = owner.identityKey || '';
    seen.identity = owner.identity || '';
    seen.ultimate = record?.def?.label || record?.label || '';
    seen.behaviour = record?.def?.behaviour || '';
    if (!seen.beats.includes(beat)) seen.beats.push(beat);
    const bump = name => { seen.events[name] = (seen.events[name] || 0) + 1; };
    seen.lift = Math.max(seen.lift, +(owner.position.y || 0).toFixed(2));
    if (kind === 'goku') {
      // Ki gathers at the cupped hands, then a sustained beam leaves them.
      if (beat === 'clash') { impact?.(signaturePoint(owner, 0.35), 10, 0x6fd2ff, 'ultimate'); bump('ki_gather'); }
      if (beat === 'finisher') { impact?.(signaturePoint(owner, 0.7), 22, 0xffffff, 'ultimate'); bump('beam_charge'); }
      if (beat === 'impact') { impact?.(signaturePoint(owner, 1.9), 30, 0x9be8ff, 'ultimate'); bump('beam_fire'); }
    } else if (kind === 'iron_man') {
      // Thrusters lift him clear of the floor once per cast; then the paired palm repulsors fire,
      // once on the charge and once on the burst. Firing a beat twice made the effect read as a
      // stutter and made "each effect fires once" unverifiable.
      if ((beat === 'intro' || beat === 'clash') && !record.__thrusterLift) {
        record.__thrusterLift = true;
        // A real hop, not a velocity nudge the ground contact immediately cancels.
        owner.isGrounded = false;
        owner.velocity.y = Math.max(owner.velocity.y || 0, 4.6);
        bump('thrusters');
      }
      if (beat === 'finisher' && !record.__repulsorCharge) {
        record.__repulsorCharge = true;
        // Both repulsors fire from the palms the pose is holding up, not from two fixed offsets
        // beside the hips. With the arms raised that difference is the whole read of the move.
        for (const point of palmPoints(owner)) impact?.(point, 14, 0xffd27a, 'ultimate');
        bump('repulsor_charge');
      }
      if (beat === 'impact' && !record.__repulsorBurst) {
        record.__repulsorBurst = true;
        for (const point of palmPoints(owner)) impact?.(point, 20, 0xffd27a, 'ultimate');
        bump('repulsor_burst');
      }
    } else {
      if (beat === 'finisher') { impact?.(signaturePoint(owner, 1.2), 18, 0xffffff, 'ultimate'); bump('generic_hit'); }
    }
  }

  /**
   * Step the cinematic timeline for one rendered frame.
   *
   * Deliberately NOT driven from the fixed simulation step. `simulationStep` returns early while a
   * hit-stop freeze is live, so a director stepped from there stops the instant impact requests the
   * freeze: the sequence never reaches its own conclusion, the caster stays locked and the camera
   * never comes back. Render frames keep arriving during a freeze, so the director advances, ends
   * and releases the cast.
   */
  function updateCinematic(dt, { frozen = false } = {}) {
    void frozen;
    // Present the finisher for any ultimate that is still running. Camera work only happens on a
    // beat change or the impact frame, so this cannot jitter the shot between frames.
    const finisherEvents = stepFinishers(dt, {
      camera,
      hitStop: seconds => window.requestHitStop?.(seconds),
      onImpact: ({ record }) => {
        const victim = record?.target;
        if (!victim || victim.ko) return;
        // Reaction only: no damage, no hitbox. One stagger, one launch, one shove.
        victim.hitstun = Math.max(victim.hitstun || 0, .6);
        victim.staggerTimer = Math.max(victim.staggerTimer || 0, .5);
        const dir = record.dir || { x: 0, z: 0 };
        victim.velocity.x += (dir.x || 0) * 6.5;
        victim.velocity.z += (dir.z || 0) * 6.5;
        victim.velocity.y = Math.max(victim.velocity.y || 0, 4.4);
        window.__browserSmashFinisherReaction = {
          identity: victim.identity || null, hitstun: victim.hitstun,
          velocity: { x: +victim.velocity.x.toFixed(2), y: +victim.velocity.y.toFixed(2), z: +victim.velocity.z.toFixed(2) },
          at: { x: +victim.position.x.toFixed(2), y: +victim.position.y.toFixed(2), z: +victim.position.z.toFixed(2) }
        };
      }
    });
    for (const event of finisherEvents) {
      if (event.beatChanged) signatureBeat(event.record, event.beat);
    }
    // Iron Man holds altitude for the whole attack, not for one frame. `finisherEvents` only fires
    // on a beat change, so applying the lift there let gravity win: he hopped 0.26 m, landed, and
    // fired the "flight" ultimate from the floor. This runs every rendered frame while his ultimate
    // is in startup/active and stops in recovery, so he rises, holds through the repulsor bursts and
    // then settles under normal gravity.
    for (const fighter of fighters?.() || []) {
      const record = activeUltimate(fighter);
      if (!record || signatureFor(record) !== 'iron_man' || record.phase === 'recovery') continue;
      const hold = 0.95;
      if ((fighter.position?.y || 0) < hold) {
        fighter.isGrounded = false;
        fighter.velocity.y = Math.max(fighter.velocity.y || 0, 2.8);
      }
    }
    if (finisherEvents.length && typeof window !== 'undefined') {
      window.__browserSmashFinisherLog = (window.__browserSmashFinisherLog || []).concat(
        finisherEvents.map(e => ({
          beat: e.beat, beatChanged: !!e.beatChanged, concluded: !!e.concluded, whiffed: !!e.whiffed,
          identity: e.record?.owner?.identity || null, hitConfirmed: !!e.hitConfirmed, flash: e.flash ?? null
        }))
      ).slice(-120);
    }
    window.__browserSmashFinisherCount = finisherCount();
    // Hide the gameplay chrome for the duration, keep the caption readable, and restore the HUD the
    // moment nothing is casting. Driven from what is running, so a whiff, an interruption, a KO or a
    // round transition all restore by the same path.
    updateCinematicHud();
    if (finisherCount() === 0) camera?.endCineShot?.();
    // Defensive: an owner that vanished (character swap) must not leave a record or a lock.
    for (const fighter of fighters?.() || []) {
      if (fighter.casting && !activeUltimate(fighter)) fighter.casting = null;
    }
  }

  /** Cancel everything: KO, round end, reset, character swap. */
  function clear(reason = 'cleared') {
    clearUltimates(context(), reason);
    clearFinishers();
    // Round end / KO / reset happens with `started` false, so updateCinematic stops running: without
    // this the cinematic class and a hidden HUD survived the round and the menu came back unstyled.
    camera?.endCineShot?.();
    updateCinematicHud();
    if (typeof window !== 'undefined') window.__browserSmashFinisherCount = 0;
    // Diagnostic traces are per-cast evidence; they must not leak into the next round.
    if (typeof window !== 'undefined') {
      window.__browserSmashUltimateTrace = [];
      window.__browserSmashHitTrace = [];
    }
    for (const fighter of fighters?.() || []) {
      if (fighter.casting) fighter.casting = null;
      if (fighter.transform) endTransform(fighter, reason === 'ko' ? 'ko' : 'round');
    }
  }

  /**
   * Reset a fighter for a new round or a character swap. `keepMeter` keeps the ultimate charge
   * across rounds (a series should not wipe earned meter), while a rematch clears it.
   */
  function resetFighter(fighter, { keepMeter = true } = {}) {
    if (!fighter) return;
    if (fighter.transform) endTransform(fighter, 'round');
    disposeAura(fighter);
    fighter.casting = null;
    fighter.transformCooldown = 0;
    fighter.formLock = 0;
    fighter.power = 0;
    if (!keepMeter) fighter.meter = 0;
  }

  /** Attach a moveset (and its ultimate) to a fighter, with the base signature move recorded. */
  function attachMoveset(fighter, specialProfile) {
    if (!fighter) return null;
    fighter.moveset = movesetFor(fighter);
    fighter.ultimateDef = ultimateFor(fighter);
    if (specialProfile !== undefined) fighter.baseSpecialProfile = specialProfile || null;
    if (!fighter.baseSpecialProfile) fighter.baseSpecialProfile = fighter.specialProfile || null;
    fighter.specialProfile = fighter.baseSpecialProfile;
    return fighter.moveset;
  }

  /** Try a form; returns the same result object the fighter uses so callers can report why. */
  function tryTransform(fighter) {
    const result = beginTransform(fighter);
    if (!result.ok) callout?.(REFUSAL[result.reason] || 'FORM NOT READY', '#a9b7c9');
    return result;
  }

  /** Try an ultimate. */
  function tryUltimate(fighter) {
    fighter.ultimateDef = ultimateFor(fighter);
    return startUltimate(fighter, context());
  }

  /** Read-only snapshot for the HUD and tests. */
  function snapshot(fighter) {
    const form = transformState(fighter);
    return {
      fighter: fighter?.name || '',
      meter: Math.round(fighter?.meter || 0),
      meterMax: ULTIMATE.max,
      ultimateLabel: fighter?.ultimateDef?.label || '',
      ultimateReady: !!fighter && canUltimate(fighter).ok,
      ultimateReason: canUltimate(fighter).reason,
      formLabel: form.label,
      formActive: form.active,
      formCharging: form.charging,
      formCharge: Number((form.charge || 0).toFixed(2)),
      formChargeMax: Number((form.chargeTotal || 0).toFixed(2)),
      formTier: form.stage + 1,
      formTiers: form.tiers,
      formRemaining: Number(form.remaining.toFixed(2)),
      formRatio: Number(form.ratio.toFixed(3)),
      formReady: form.ready,
      formReason: form.reason,
      power: form.power,
      powerCost: form.cost,
      mods: form.mods,
      casting: fighter?.casting || null
    };
  }

  /**
   * Draw the ultimate meter and form gauge into the existing fighter panels. Built once, then
   * only widths and two labels change, so this costs nothing per frame.
   */
  function drawHud(pairs = []) {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('powerHudStyles')) {
      const style = document.createElement('style');
      style.id = 'powerHudStyles';
      style.textContent = '.power-hud{margin-top:6px;display:flex;flex-direction:column;gap:4px;font:900 8px/1 system-ui,sans-serif;letter-spacing:.14em;color:#b9e8ff}'
        + '.power-hud .row{display:flex;align-items:center;gap:6px}'
        + '.power-hud .row .lab{flex:0 0 30px;opacity:.85}'
        + '.power-hud .row .track{flex:1;height:6px;background:#08131f;border:1px solid #8fdcff55;overflow:hidden}'
        + '.power-hud .row .track>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,#37b6ff,#8df6ff);transition:width .12s}'
        + '.power-hud .row .val{flex:0 0 34px;text-align:right;opacity:.92}'
        + '.power-hud .row.ult .track>i{background:linear-gradient(90deg,#c98a1f,#ffe9a0)}'
        + '.power-hud .row.ult.ready .track>i{background:linear-gradient(90deg,#ff9a3d,#fff2b0)}'
        + '.power-hud .row.ult.ready .val{color:#ffe9a0}'
        + '.power-hud .row.form .track>i{background:linear-gradient(90deg,#b8437f,#ffc4de)}'
        + '.power-hud .row.form.ready .track>i{background:linear-gradient(90deg,#ff5ca8,#ffd0e6)}'
        + '.power-hud .row.form.ready .val{color:#ffc4de}'
        + '.power-hud.form-on .row.form .track>i{background:linear-gradient(90deg,#ff5ca8,#fff0f7)}'
        + '.power-hud.form-on .row.form .lab{color:#ffd6ea}'
        + '.power-hud .row.form.charging .track>i{background:linear-gradient(90deg,#8a5cf0,#e4c6ff)}'
        + '.power-hud.form-on .row.form .val{color:#ffe8f2}'
        + '.power-hud.form-on .row.ult .track{border-color:#ff5ca888}'
        + '.power-hud .kitlist{display:flex;flex-wrap:wrap;gap:2px 6px;font-size:7px;letter-spacing:.08em}'
        + '.power-hud .kitlist .slot{opacity:.92;white-space:nowrap}'
        + '.power-hud .kitlist .slot.cooling{opacity:.38}'
        + '.power-hud .kitlist .slot b{color:#9deeff}'
        + '.right .power-hud .row{flex-direction:row-reverse}.right .power-hud .row .val{text-align:left}';
      document.head.appendChild(style);
      for (const [side, selector] of [['p1', '.bb-cluster.bb-p1, .fighter:not(.right)'], ['p2', '.bb-cluster.bb-cpu, .fighter.right']]) {
        const host = document.querySelector(selector);
        if (!host) continue;
        const wrap = document.createElement('div');
        wrap.className = 'power-hud';
        wrap.id = `${side}power`;
        wrap.innerHTML = '<div class="row ult" data-row="ult"><span class="lab">ULT</span><span class="track"><i></i></span><span class="val">0%</span></div>'
          + '<div class="row form" data-row="form"><span class="lab">FORM</span><span class="track"><i></i></span><span class="val">0%</span></div>'
          + '<div class="row kit" data-row="kit"><span class="kitlist"></span></div>';
        host.appendChild(wrap);
      }
    }
    for (const [side, selector] of [['p1', '.bb-cluster.bb-p1, .fighter:not(.right)'], ['p2', '.bb-cluster.bb-cpu, .fighter.right']]) {
      if (document.getElementById(`${side}power`)) continue;
      const host = document.querySelector(selector);
      if (!host) continue;
      const wrap = document.createElement('div');
      wrap.className = 'power-hud';
      wrap.id = `${side}power`;
      wrap.innerHTML = '<div class="row ult" data-row="ult"><span class="lab">ULT</span><span class="track"><i></i></span><span class="val">0%</span></div>'
        + '<div class="row form" data-row="form"><span class="lab">FORM</span><span class="track"><i></i></span><span class="val">0%</span></div>'
        + '<div class="row kit" data-row="kit"><span class="kitlist"></span></div>';
      host.appendChild(wrap);
    }
    for (const [side, fighter] of pairs) {
      const wrap = document.getElementById(`${side}power`);
      if (!wrap || !fighter) continue;
      const snap = snapshot(fighter);
      const ultRow = wrap.querySelector('[data-row="ult"]');
      if (ultRow) {
        ultRow.querySelector('i').style.width = Math.max(0, Math.min(100, snap.meter)) + '%';
        ultRow.querySelector('.val').textContent = snap.ultimateReady ? 'READY' : Math.floor(snap.meter) + '%';
        ultRow.classList.toggle('ready', snap.ultimateReady);
      }        const formRow = wrap.querySelector('[data-row="form"]');
        wrap.classList.toggle('form-on', snap.formActive);
        if (formRow) {
          formRow.querySelector('.lab').textContent = snap.formActive ? 'ON' : 'FORM';
          // Name the tier the next press buys. A ladder's second entry costs more than the first,
          // and pricing the bar at the base entry printed impossible values like "117%".
          formRow.title = snap.formLabel
            ? `${snap.formLabel}${snap.formTiers > 1 ? ` · tier ${snap.formTier}/${snap.formTiers}` : ''} · ${snap.powerCost} power`
            : '';
          const cost = Math.max(1, snap.powerCost || 100);
          if (snap.formCharging) {
            const progress = 1 - Math.min(1, (snap.formCharge || 0) / Math.max(.01, snap.formChargeMax || 1));
            formRow.querySelector('i').style.width = (progress * 100).toFixed(1) + '%';
            formRow.querySelector('.val').textContent = 'CHARGE';
          } else if (snap.formActive) {
            formRow.querySelector('i').style.width = (snap.formRatio * 100).toFixed(1) + '%';
            formRow.querySelector('.val').textContent = snap.formRemaining.toFixed(1) + 's';
          } else {
            formRow.querySelector('i').style.width = Math.min(100, (snap.power / cost) * 100).toFixed(1) + '%';
            formRow.querySelector('.val').textContent = snap.formReady ? 'READY' : Math.min(100, Math.floor((snap.power / cost) * 100)) + '%';
          }
          formRow.classList.toggle('ready', snap.formReady);
          formRow.classList.toggle('charging', !!snap.formCharging);
        }
      // Kit slots: one entry per castable ability this identity actually has, with the key that
      // casts it and its live cooldown. Rebuilt only when the identity changes, so the label text
      // never rewrites every frame.
      const kitRow = wrap.querySelector('[data-row="kit"]');
      if (kitRow) {
        const list = abilitiesFor(fighter);
        const host = kitRow.querySelector('.kitlist');
        const signature = list.map(ability => ability.label).join('|');
        if (host && host.dataset.labels !== signature) {
          host.dataset.labels = signature;
          host.innerHTML = list.map((ability, index) =>
            `<span class="slot" data-slot="${index + 1}"><b>${['L', 'H', 'T', 'Y'][index] || '?'}</b> ${ability.label}</span>`
          ).join('');
        }
        host?.querySelectorAll('.slot').forEach((node, index) => {
          const remaining = abilityCooldownRemaining(fighter, index + 1);
          node.classList.toggle('cooling', remaining > 0);
          node.title = remaining > 0 ? `${remaining.toFixed(1)}s` : 'ready';
        });
      }
    }
  }

  /**
   * Palm points for the twin repulsors: the actual hands, not two offsets beside the hips. A body
   * without hand joints keeps the documented body-relative fallback.
   */
  function palmPoints(owner) {
    const userData = owner?.model?.userData || {};
    const joints = [userData.leftHand || userData.leftFore || userData.leftArm,
      userData.rightHand || userData.rightFore || userData.rightArm];
    const points = [];
    for (const joint of joints) {
      if (!joint?.getWorldPosition) continue;
      const point = new THREE.Vector3();
      joint.getWorldPosition(point);
      if (Number.isFinite(point.x)) points.push(point);
    }
    if (points.length) return points;
    for (const side of [-1, 1]) {
      points.push(new THREE.Vector3(
        owner.position.x + side * 0.30,
        owner.position.y + 1.22,
        owner.position.z + (Number(owner.facing) || 1) * 0.55
      ));
    }
    return points;
  }

  /**
   * Drive the signature pose for every live ultimate. Called from the RENDER loop after the
   * animation controller and the procedural pose have written their own bones - running earlier
   * would let the clip overwrite the choreography in the same frame.
   */
  function poseActiveUltimates(dt = 1 / 60) {
    for (const fighter of fighters?.() || []) {
      const record = activeUltimate(fighter);
      if (!record) {
        if (fighter.__cinematicRecord) {
          releaseChoreography(fighter.__cinematicRecord);
          fighter.__cinematicRecord = null;
        }
        if (fighter.__haulRecord) {
          // The record has ended, but the pose still has an ease-out to play: the module decays its
          // own intensity, so keep writing until it reports nothing left. Without this the last tug
          // pops straight back to her idle on the frame the ultimate ends.
          if (applyHaulPose(fighter.__haulRecord, dt) <= 0) {
            releaseHaulPose(fighter.__haulRecord);
            fighter.__haulRecord = null;
          }
        }
        continue;
      }
      if (hasChoreography(fighter)) {
        // A soft entry into each beat so the pose changes read as a transition, not a snap.
        const beat = beatForRecord(record);
        const elapsedInBeat = beat === record.__cinematicPoseBeat ? (record.__cinematicPoseFill || 0) + .05 : 0;
        record.__cinematicPoseFill = elapsedInBeat;
        applyChoreography(record, beat, Math.min(1, .35 + elapsedInBeat * 8));
        fighter.__cinematicRecord = record;
      }
      // Phase 29.8: the lasso haul is its own overlay, so it runs whether or not this identity has
      // cinematic choreography. It writes nothing unless the pull experiment is enabled.
      if (applyHaulPose(record, dt) > 0) fighter.__haulRecord = record;
      else if (fighter.__haulRecord) {
        releaseHaulPose(fighter.__haulRecord);
        fighter.__haulRecord = null;
      }
    }
  }

  /** Hide the ordinary gameplay HUD while a cinematic owns the screen, and restore it afterwards. */
  function ensureCinematicStyle() {
    if (typeof document === 'undefined' || document.getElementById('cinematicStyle')) return;
    const style = document.createElement('style');
    style.id = 'cinematicStyle';
    // The duel panels, the camera debug panel and the control legend are all gameplay chrome; a
    // finisher keeps its own caption instead. The vignette and world stay visible.
    style.textContent = 'body.cinematic #bbMatchBar,body.cinematic #trainingPanel,'
      + 'body.cinematic #exploreHint,body.cinematic #combatCallout{display:none!important}'
      + '#cinematicCaption{position:fixed;left:50%;bottom:46px;transform:translateX(-50%);z-index:9;'
      + 'font:900 clamp(13px,1.7vw,20px)/1.3 system-ui,sans-serif;letter-spacing:.3em;color:#eaf9ff;'
      + 'text-shadow:0 2px 14px #001018,0 0 26px #0a3a52;opacity:0;transition:opacity .2s;'
      + 'pointer-events:none;white-space:nowrap;text-align:center}';
    document.head.appendChild(style);
    if (!document.getElementById('cinematicCaption')) {
      const caption = document.createElement('div');
      caption.id = 'cinematicCaption';
      document.body.appendChild(caption);
    }
  }

  /** The cinematic HUD state, derived from what is actually running this frame. */
  function updateCinematicHud() {
    if (typeof document === 'undefined') return;
    const live = (fighters?.() || []).map(f => activeUltimate(f)).filter(Boolean);
    ensureCinematicStyle();
    const caption = document.getElementById('cinematicCaption');
    if (!live.length) {
      document.body.classList.remove('cinematic');
      if (caption) caption.style.opacity = '0';
      return;
    }
    document.body.classList.add('cinematic');
    if (caption) {
      const record = live[0];
      const who = String(record.owner?.identity || record.owner?.name || '').toUpperCase();
      caption.textContent = record.label + (who ? ' · ' + who : '');
      caption.style.opacity = '1';
    }
  }

  return {
    context, hit, update, updateCinematic, cinematicTimeScale: activeFinisherTimeScale,
    clear, resetFighter, attachMoveset, award, drawHud,
    tryTransform, tryUltimate, snapshot, coverBetween, coverDistance,
    canTransform, canUltimate,
    // Phase 24.2.5: signature choreography and cinematic presentation.
    applyCinematicPose: poseActiveUltimates, updateCinematicHud, palmPoints, beamOriginFor
  };
}

function css(color) {
  return '#' + Number(color || 0xffffff).toString(16).padStart(6, '0');
}
