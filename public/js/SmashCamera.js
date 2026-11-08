// Elevated isometric-style camera with distance-aware framing and impact shake.
import * as THREE from 'three';

// Inspection framings, in metres. `distance` is how far the camera sits from the fighter and
// `lookY` is the height on the body it aims at, so "head" frames the face and "feet" frames the
// floor contact instead of always aiming at the chest.
const SPECTATE_FRAMINGS = Object.freeze({
  full: Object.freeze({ distance: 3.4, lookY: 1.02 }),
  torso: Object.freeze({ distance: 2.2, lookY: 1.28 }),
  head: Object.freeze({ distance: 1.15, lookY: 1.66 }),
  // A hand framing at 1.05 m sat inside the torso: for a 2 m fighter the palms hang near 0.95 m
  // and the camera has to stand clear of the chest to see them.
  hands: Object.freeze({ distance: 1.75, lookY: 0.98 }),
  feet: Object.freeze({ distance: 2.0, lookY: 0.20 })
});

/** Hide the duel HUD while inspecting: evidence should be the character, not overlays. */
function ensureSpectateStyle() {
  if (typeof document === 'undefined' || document.getElementById('spectateStyle')) return;
  const style = document.createElement('style');
  style.id = 'spectateStyle';
  // Captures kept showing a round banner, the control legend, the status line and the character
  // browser: the first selector list only covered the fight HUD. These are the overlays a
  // scripted probe found still painting over the canvas with body.spectating set.
  style.textContent = 'body.spectating #hud,body.spectating #roundScore,body.spectating .fighter,body.spectating #cameraSettings,body.spectating #energyHUD,'
    + 'body.spectating #trainingPanel,body.spectating #exploreHint,body.spectating #comboNotice,'
    + 'body.spectating #timer,body.spectating .bottom,body.spectating #status,body.spectating #loading,'
    + 'body.spectating #ocButton,body.spectating #roundBanner,body.spectating #round,'
    + 'body.spectating #announce,body.spectating #announcer{display:none!important}';
  document.head.appendChild(style);
}

export default class SmashCamera {
  constructor(camera, { height = 15, trailing = 23, minHeight = 12, maxHeight = 48 } = {}) {
    this.camera = camera;
    this.baseHeight = height;
    this.baseTrailing = trailing;
    this.minHeight = minHeight;
    this.maxHeight = maxHeight;
    // Elevated player-anchored default; mouse wheel and right-drag remain available.
    // 1.2 frames a ~2m fighter at roughly a sixth of the screen height. The previous 1.8
    // put the camera ~26 units back, which read as a distant top-down and made the
    // fighters too small to follow their limbs and hit reactions.
    this.zoom = 1.2;
    this.minZoom = 0.75;
    this.maxZoom = 3.2;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.shake = 0;
    this.shakeVector = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.positionTarget = new THREE.Vector3();
    this.framing = { distance: 0, angle: 0 };
    // Large world stages read as places, not floors, when the camera sits lower and pulls
    // back further. Small arenas keep the original close overhead framing.
    this.stageTilt = 0;
    this.stageScale = 1;
    // Some rooms are wider than they are deep, so the default camera side (+Z) leaves no
    // room to pull back. A stage can turn the shot along its own long axis instead.
    this.stageYaw = 0;
    // Reused by the composition solver to project candidate framing into screen space.
    this._probeCamera = new THREE.PerspectiveCamera(46, 1.6, 0.1, 600);
    // Solid volumes the camera must stay out of on large world stages (see setStageBounds).
    this.collisionBlocks = null;
    // Hulk's authored victory clip moves the rendered body away from the gameplay root, and Final
    // Valley's curved cliff meshes produce arena-wide AABBs. The victory shot therefore uses real
    // mesh raycasts instead of those conservative boxes.
    this._victoryRay = new THREE.Raycaster();
    this._victoryRay.near = .02;
    // The playable footprint. A victory camera may need to move around a body that has travelled
    // toward the arena edge; keeping this lets it reject a bearing that would leave the arena.
    this.stageBounds = null;
    this.collisionReach = Infinity;
    // A brief cinematic push toward a fighter who just started a signature move. Bounded on
    // purpose: this is emphasis, not a cutscene, and it must never take control away.
    this.focusState = null;
    // An authored ultimate shot. Unlike `focus` this replaces the duel framing for the duration of
    // one beat and restores every value it touched when the sequence ends.
    this.cineState = null;
    // Round start / map change: the lens should already be on its framing, not easing toward it
    // from wherever the menu left it (that ease was the 24 m opening shot).
    this.pendingSnap = false;
    // Third-person follow yaw: eased toward the fighter's facing rather than snapped, so a turn does
    // not whip the whole camera (and therefore the movement basis) around on one frame.
    this.followYaw = null;
  }

  /**
   * Give the camera the stage's solid geometry so it cannot end up inside a wall, under a
   * floor slab or above an interior ceiling. Only blocks near the battle area are kept, and
   * only blocks tall enough to be in the camera's line are kept at all.
   */
  setStageBounds(bounds, blocks) {
    this.collisionReach = Infinity;
    this.stageBounds = bounds && Number.isFinite(bounds.x0) && Number.isFinite(bounds.x1)
      && Number.isFinite(bounds.z0) && Number.isFinite(bounds.z1) ? bounds : null;
    if (!bounds || !Array.isArray(blocks) || !blocks.length) { this.collisionBlocks = null; return; }
    const pad = 55;
    // A box that contains the playable centre is not a wall between the fighters and the lens: it
    // is the ground/backdrop AABB the whole arena sits inside (Asgard's authored terrain produced
    // two of them, x -40..40, z -39..46, top ~12). Keeping them made every shot below 12 m read as
    // "camera inside solid", so the solver collapsed to collisionReach 0.6 at y 1.46.
    const cx = (bounds.x0 + bounds.x1) / 2;
    const cz = (bounds.z0 + bounds.z1) / 2;
    // A box whose FOOTPRINT covers the playable centre is a backdrop/roof AABB, not a wall
    // between the fighters and the lens. The old test also required the box's vertical range to
    // include the fighters' chests; that let the Hogwarts hall-wide roof box (x -23..23,
    // z -77..14, bottom 3.48, top 17.15) survive because its underside sat above them. The
    // camera then treated the entire upper hall as solid and the lift rescue parked it inside
    // the box. The footprint is what makes the volume a backdrop; the lens has to be able to
    // use the airspace over the arena.
    const containsPlayCentre = block => block.r != null
      ? (cx - block.x) * (cx - block.x) + (cz - block.z) * (cz - block.z) <= block.r * block.r
      : cx >= block.x0 && cx <= block.x1 && cz >= block.z0 && cz <= block.z1;
    this.collisionBlocks = blocks.filter(block => {
      if (containsPlayCentre(block)) return false;
      if (!(block.top > 1.6)) return false;
      if (block.r != null) {
        return block.x > bounds.x0 - pad && block.x < bounds.x1 + pad
          && block.z > bounds.z0 - pad && block.z < bounds.z1 + pad;
      }
      return block.x1 > bounds.x0 - pad && block.x0 < bounds.x1 + pad
        && block.z1 > bounds.z0 - pad && block.z0 < bounds.z1 + pad;
    });
  }

  /**
   * Distance along a ray to the nearest solid volume, or null when the line is clear.
   * `ignoreBelow` is the fighters' standing height: the slab they are fighting on is not an
   * obstruction, even though the shot's look point sits slightly under their feet.
   */
  obstruction(ox, oy, oz, dx, dy, dz, maxT, ignoreBelow = -Infinity) {
    if (!this.collisionBlocks) return null;
    let best = null;
    for (const block of this.collisionBlocks) {
      if (block.top <= ignoreBelow + .15) continue;
      let enter, exit;
      if (block.r != null) {
        // Vertical cylinder: solve the xz quadratic, then reject outside its height range.
        const ex = ox - block.x, ez = oz - block.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-6) continue;
        const b = 2 * (ex * dx + ez * dz);
        const c = ex * ex + ez * ez - block.r * block.r;
        const disc = b * b - 4 * a * c;
        if (disc <= 0) continue;
        const root = Math.sqrt(disc);
        enter = (-b - root) / (2 * a);
        exit = (-b + root) / (2 * a);
      } else {
        enter = 0; exit = maxT;
        for (const [min, max, o, d] of [[block.x0, block.x1, ox, dx], [block.bottom, block.top, oy, dy], [block.z0, block.z1, oz, dz]]) {
          if (Math.abs(d) < 1e-6) { if (o < min || o > max) { enter = Infinity; break; } continue; }
          let t0 = (min - o) / d, t1 = (max - o) / d;
          if (t0 > t1) { const swap = t0; t0 = t1; t1 = swap; }
          if (t0 > enter) enter = t0;
          if (t1 < exit) exit = t1;
          if (enter > exit) { enter = Infinity; break; }
        }
      }
      if (!Number.isFinite(enter) || enter > maxT) continue;
      // A ray that STARTS inside a volume is standing in the fighter's own terrain: Asgard's
      // authored mesh volumes contain the arena floor, so the fighter's chest is inside a broad
      // AABB. Treating that as a 0.5 m obstruction collapsed every duel shot onto the body
      // (collisionReach 0.6, y 1.46, fov 65). The volume can only block the shot when the
      // candidate camera endpoint is itself inside it; otherwise the ray exits behind the origin.
      // The same check still rejects a lens embedded in a wall, which is the case this guard
      // existed for.
      if (enter <= 0) {
        const tx = ox + dx * maxT, ty = oy + dy * maxT, tz = oz + dz * maxT;
        const endpointInside = block.r != null
          ? (tx - block.x) * (tx - block.x) + (tz - block.z) * (tz - block.z) <= block.r * block.r
            && ty >= (block.bottom ?? -Infinity) && ty <= block.top
          : tx >= block.x0 && tx <= block.x1 && tz >= block.z0 && tz <= block.z1
            && ty >= (block.bottom ?? -Infinity) && ty <= block.top;
        if (endpointInside) return .5;
        continue;
      }
      if (block.r != null) {
        const hitY = oy + dy * enter;
        if (hitY < block.bottom || hitY > block.top) continue;
      }
      if (best == null || enter < best) best = enter;
    }
    return best;
  }

  /** 0 = close overhead duel framing; ~.18 = pulled-back view for a large arena. */
  setStageTilt(value, scale = 1) {
    this.stageTilt = THREE.MathUtils.clamp(value || 0, 0, .26);
    this.stageScale = THREE.MathUtils.clamp(scale || 1, 1, 1.8);
  }

  /** Rotate the pulled-back shot around the fighters, for rooms that are wider than deep. */
  setStageYaw(value) { this.stageYaw = Number.isFinite(value) ? value : 0; }

  /**
   * Clear line from a candidate camera position to a fighter's chest.
   *
   * A clear camera-to-midpoint ray proves nothing: a column between the two fighters leaves both
   * midpoint sightlines open while hiding one of them completely. Every candidate is therefore
   * scored by a separate ray to each fighter.
   */
  _sightClear(shot, fighter, feet) {
    const dx = fighter.position.x - shot.x;
    const dy = (fighter.position.y || 0) + 1.05 - shot.y;
    const dz = fighter.position.z - shot.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < .2) return { clear: true, gap: len };
    const hit = this.obstruction(shot.x, shot.y, shot.z, dx / len, dy / len, dz / len, len - .35, feet);
    return { clear: hit == null, gap: hit == null ? len : hit };
  }

  /**
   * Would both fighters sit fully inside the frame from this candidate position?
   *
   * Sightlines alone are not a composition: a shot can have both rays clear and still push one
   * fighter past the frame edge, which is exactly how Thor was being clipped in two scenarios.
   */
  _framesBoth(shot, a, b, boxes = null, margin = 0.92) {
    const cam = this._probeCamera;
    cam.fov = this.camera.fov || 46;
    cam.aspect = this.camera.aspect || 1.6;
    cam.position.set(shot.x, shot.y, shot.z);
    cam.lookAt(shot.lookX, shot.lookY, shot.lookZ);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const point = new THREE.Vector3();
    // Probe the fighter's REAL bounds. A synthetic 0.64 x 0.44 box around the hips scored a smaller
    // fighter than the one on screen, so Thor's hammer hung below the frame while the solver called
    // the shot well framed.
    const probesOf = (fighter, box) => {
      if (box) {
        const out = [];
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) out.push([x, y, z]);
          }
        }
        return out;
      }
      const out = [];
      for (const height of [0.1, 1.0, 1.6]) {
        for (const dx of [-0.32, 0.32]) {
          for (const dz of [-0.22, 0.22]) {
            out.push([fighter.position.x + dx, (fighter.position.y || 0) + height, fighter.position.z + dz]);
          }
        }
      }
      return out;
    };
    let heightOf = 0;
    const fits = probes => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y, z] of probes) {
        point.set(x, y, z).project(cam);
        if (point.z >= 1) return false;
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      heightOf = Math.min(1, (maxY - minY) / 2);
      return minX >= -margin && maxX <= margin && minY >= -margin && maxY <= margin;
    };
    const fitA = fits(probesOf(a, boxes?.[0] || null));
    const heightA = heightOf;
    const fitB = fits(probesOf(b, boxes?.[1] || null));
    return { both: fitA && fitB, a: fitA, b: fitB, minHeight: Math.min(heightA, heightOf) };
  }

  /**
   * Composition solver for the duel camera.
   *
   * Candidates are small orbits, modest elevations and a slight move in, evaluated on whether BOTH
   * fighters are visible - never on whether one of them is. The cheapest adjustment wins, and the
   * chosen adjustment is damped rather than snapped, with the search re-running on a timer while
   * the pair is visible (long) and sooner when it is not (short). That timer is the hysteresis that
   * stops the lens hunting back and forth around a column every frame.
   */
  _composedShot(a, b, dt) {
    const feet = Math.min(a.position.y || 0, b.position.y || 0);
    const baseYaw = this.stageYaw || 0;
    const c = this.composition || (this.composition = { yaw: 0, lift: 0, scale: 1, timer: 0, choice: null, switches: 0 });
    c.timer -= dt;
    const boxes = [a, b].map(f => (f.model ? new THREE.Box3().setFromObject(f.model) : null));
    const baseShot = this.overheadFraming(a, b);
    const baseVisible = this._sightClear(baseShot, a, feet).clear && this._sightClear(baseShot, b, feet).clear;
    // The adjustment is scored against the fighters where they stood when the timer last expired.
    // A clamp, respawn or knockback can move them into a line with the lens while most of the timer
    // remains, and the stale shot then loses the near fighter below the frame (the narrow-street
    // acceptance did exactly this: both were clamped to x 53.3, 8 m apart in depth). A shot that no
    // longer frames both has to be re-scored now, not on the next timer tick.
    let currentFit = true;
    let currentCramped = false;
    if (c.choice) {
      this.stageYaw = baseYaw + c.yaw;
      const now = this.overheadFraming(a, b);
      this.stageYaw = baseYaw;
      const nowShot = {
        x: now.lookX + (now.x - now.lookX) * c.scale,
        y: now.lookY + (now.y - now.lookY) * c.scale + c.lift,
        z: now.lookZ + (now.z - now.lookZ) * c.scale,
        lookX: now.lookX, lookY: now.lookY, lookZ: now.lookZ
      };
      currentFit = this._framesBoth(nowShot, a, b, boxes).both;
      // A shot can frame both fighters and still be pressed against a wall only three metres
      // away; the rendered lens then sits in their faces even though neither is clipped. The
      // solver already prices a shot shorter than 5 m as cramped, but only when its timer runs,
      // and a respawn or training-to-match transition does not wait for that timer. Detect the
      // cramped shot that is about to be rendered and force the search now.
      const nowLength = Math.hypot(nowShot.x - nowShot.lookX, nowShot.y - nowShot.lookY, nowShot.z - nowShot.lookZ);
      if (nowLength > .01) {
        const nx = (nowShot.x - nowShot.lookX) / nowLength;
        const ny = (nowShot.y - nowShot.lookY) / nowLength;
        const nz = (nowShot.z - nowShot.lookZ) / nowLength;
        const hitNow = this.obstruction(nowShot.lookX, nowShot.lookY, nowShot.lookZ, nx, ny, nz, nowLength, feet);
        if (hitNow != null) {
          const allowedNow = Math.min(Math.max(hitNow - .9, 2.2), Math.max(.6, hitNow - .35));
          currentCramped = allowedNow < 5;
        }
      }
    }
    if (c.timer <= 0 || !currentFit || currentCramped || (!baseVisible && c.choice && c.choice.blocked > 0)) {
      c.timer = baseVisible ? .9 : .3;
      let best = null;
      for (const yawOffset of [0, .12, -.12, .26, -.26, .44, -.44, .70, -.70]) {
        // Tall architecture (the palace alley) defeats a 2.8 m lift: the only clear sightline is
        // over the roofline, so the search must be allowed to climb far enough to find it.
        for (const lift of [0, 1.4, 2.8, 5.2, 8, 11, 14]) {
          for (const scale of [1, .9, 1.15, 1.3, 1.45, 1.7, 2, 2.35]) {
            this.stageYaw = baseYaw + yawOffset;
            const raw = this.overheadFraming(a, b);
            const shot = {
              x: raw.lookX + (raw.x - raw.lookX) * scale,
              y: raw.lookY + (raw.y - raw.lookY) * scale + lift,
              z: raw.lookZ + (raw.z - raw.lookZ) * scale,
              lookX: raw.lookX, lookY: raw.lookY, lookZ: raw.lookZ
            };
            // Judge the candidate where the lens would ACTUALLY end up. The main path shortens the
            // shot against the same volumes, so a candidate that is clear only from a position inside
            // a wall used to win and then collapse to the 0.6 m clamp - which is how a fighter ended
            // up 0.53 m from the lens with two blocked sightlines.
            const len = Math.hypot(shot.x - shot.lookX, shot.y - shot.lookY, shot.z - shot.lookZ);
            let placed = shot, allowed = len;
            if (len > .01) {
              const hx = (shot.x - shot.lookX) / len, hy = (shot.y - shot.lookY) / len, hz = (shot.z - shot.lookZ) / len;
              const hit = this.obstruction(shot.lookX, shot.lookY, shot.lookZ, hx, hy, hz, len, feet);
              allowed = hit == null ? len : Math.min(Math.max(hit - .9, 2.2), Math.max(.6, hit - .35));
              if (allowed < len) {
                placed = { ...shot, x: shot.lookX + hx * allowed, y: shot.lookY + hy * allowed, z: shot.lookZ + hz * allowed };
              }
            }
            const seenA = this._sightClear(placed, a, feet), seenB = this._sightClear(placed, b, feet);
            const blocked = (seenA.clear ? 0 : 1) + (seenB.clear ? 0 : 1);
            const framing = this._framesBoth(placed, a, b, boxes);
            const clipped = (framing.a ? 0 : 1) + (framing.b ? 0 : 1);
            // Smallest change wins: orbit costs most, elevation less, moving in or out least. A shot
            // the scenery crushes to a few centimetres is unusable however clear it scores.
            const deviation = Math.abs(yawOffset) + lift * .10 + Math.abs(1 - scale) * .6 - framing.minHeight * .5;
            const cramped = allowed < 5;
            const score = (blocked + clipped) * 1000 + (cramped ? 60 : 0) + deviation;
            if (!best || score < best.score) best = { score, yaw: yawOffset, lift, scale, blocked, clipped, cramped, explored: true };
          }
        }
      }
      this.stageYaw = baseYaw;
      // Minimum improvement threshold: keep the current bearing unless the alternative is clearly
      // better, or the current one has actually lost a fighter. Without it the lens swapped between
      // two near-equal bearings and shimmered around a column.
      const current = c.choice;
      const lost = current && current.blocked > 0;
      if (!current || !currentFit || currentCramped || lost || best.score + .15 < current.score) {
        if (current && (Math.abs(best.yaw - current.yaw) > 1e-6 || Math.abs(best.lift - current.lift) > 1e-6 || Math.abs(best.scale - current.scale) > 1e-6)) c.switches++;
        c.choice = best;
      }
    }
    if (c.choice) {
      // Land the adjustment with the solve that chose it: easing away from the stale shot would
      // leave the target unframed for the remaining timer frames.
      if (!currentFit || currentCramped) { c.yaw = c.choice.yaw; c.lift = c.choice.lift; c.scale = c.choice.scale; }
      c.yaw = THREE.MathUtils.damp(c.yaw, c.choice.yaw, 3.2, dt);
      c.lift = THREE.MathUtils.damp(c.lift, c.choice.lift, 2.4, dt);
      c.scale = THREE.MathUtils.damp(c.scale, c.choice.scale, 2.4, dt);
    }
    this.stageYaw = baseYaw + c.yaw;
    const raw = this.overheadFraming(a, b);
    this.stageYaw = baseYaw;
    const shot = {
      x: raw.lookX + (raw.x - raw.lookX) * c.scale,
      y: raw.lookY + (raw.y - raw.lookY) * c.scale + c.lift,
      z: raw.lookZ + (raw.z - raw.lookZ) * c.scale,
      lookX: raw.lookX, lookY: raw.lookY, lookZ: raw.lookZ
    };
    this.compositionAdjust = { yaw: Number(c.yaw.toFixed(3)), lift: Number(c.lift.toFixed(2)),
      scale: Number(c.scale.toFixed(3)), blocked: c.choice ? c.choice.blocked : null,
      clipped: c.choice ? c.choice.clipped : null, explored: c.choice ? c.choice.explored : null };
    return shot;
  }

  /**
   * Acceptance report for one frame: where the lens is, both fighters' screen-space bounds, whether
   * head and torso sightlines are clear, and which adjustment the solver chose. Used by
   * scripts/accept-camera-composition.mjs so a scenario is graded on measurements, not on a glance.
   */
  /** Is this point inside a collision volume? Used to prove the lens never sits in stage geometry. */
  _insideBlock(x, y, z) {
    if (!this.collisionBlocks) return false;
    for (const block of this.collisionBlocks) {
      if (y > block.top || y < block.bottom) continue;
      if (block.r != null) {
        if (Math.hypot(x - block.x, z - block.z) <= block.r) return true;
      } else if (x >= block.x0 && x <= block.x1 && z >= block.z0 && z <= block.z1) return true;
    }
    return false;
  }

  report(a, b) {
    const feet = Math.min(a.position.y || 0, b.position.y || 0);
    const cam = this.camera;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    const boundsOf = fighter => {
      if (!fighter.model) {
        return { minX: null, maxX: null, minY: null, maxY: null, onScreen: null, heightFraction: null };
      }
      box.setFromObject(fighter.model);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let behind = false;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            point.set(x, y, z).project(cam);
            if (point.z >= 1) behind = true;
            minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
          }
        }
      }
      return {
        minX: +minX.toFixed(2), maxX: +maxX.toFixed(2), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2),
        onScreen: !behind && minX >= -1.02 && maxX <= 1.02 && minY >= -1.02 && maxY <= 1.02,
        heightFraction: +Math.min(1, (maxY - minY) / 2).toFixed(2)
      };
    };
    const sight = (fighter, height) => {
      const shot = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      const target = new THREE.Vector3(fighter.position.x, (fighter.position.y || 0) + height, fighter.position.z);
      if (this.spectateState?.victoryOccluders) {
        const clear = this._victoryLineClear(cam.position, target, this.spectateState.victoryOccluders) === true;
        return { clear, obstruction: clear ? null : .5 };
      }
      const dx = target.x - shot.x;
      const dy = target.y - shot.y;
      const dz = target.z - shot.z;
      const len = Math.hypot(dx, dy, dz);
      const hit = this.obstruction(shot.x, shot.y, shot.z, dx / len, dy / len, dz / len, len - .35, feet);
      return { clear: hit == null, obstruction: hit == null ? null : +hit.toFixed(2) };
    };
    const mid = { x: (a.position.x + b.position.x) / 2, z: (a.position.z + b.position.z) / 2 };
    return {
      camera: {
        x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2),
        fov: +cam.fov.toFixed(1),
        distanceToMid: +Math.hypot(cam.position.x - mid.x, cam.position.y - (feet + 1.1), cam.position.z - mid.z).toFixed(2),
        stageYaw: +((this.stageYaw || 0)).toFixed(3), collisionReach: Number.isFinite(this.collisionReach) ? +this.collisionReach.toFixed(2) : null
      },
      fighters: [a, b].map(f => ({
        name: f.name,
        bounds: boundsOf(f),
        head: sight(f, 1.55),
        torso: sight(f, 1.05)
      })),
      adjustment: this.compositionAdjust || null,
      bearings: { switches: this.composition?.switches ?? 0 },
      insideGeometry: this.spectateState?.victoryOccluders
        ? this._victoryLineClear(cam.position, this.lookTarget, this.spectateState.victoryOccluders) !== true
        : this._insideBlock(cam.position.x, cam.position.y, cam.position.z),
      enforced: this.framing.enforced ?? null,
      // Audit trail: does the solver's own framing test agree with the measured bounds?
      probeFits: this._framesBoth({ x: cam.position.x, y: cam.position.y, z: cam.position.z,
        lookX: this.lookTarget.x, lookY: this.lookTarget.y, lookZ: this.lookTarget.z }, a, b,
        [a.model ? new THREE.Box3().setFromObject(a.model) : null, b.model ? new THREE.Box3().setFromObject(b.model) : null]),
      mode: this.framing?.mode || null
    };
  }

  /** Put the lens on the next computed framing immediately (round start, map change, respawn). */
  snap() {
    this.pendingSnap = true;
    // A snap also lands the composition solver's chosen adjustment, so the lens the player sees is
    // the shot the solver scored. Without this the scored shot and the rendered one differed while
    // the damped values caught up, which made an accepted candidate look obstructed.
    const c = this.composition;
    if (c?.choice) { c.yaw = c.choice.yaw; c.lift = c.choice.lift; c.scale = c.choice.scale; }
  }

  impact(amount = 0.35) { this.shake = Math.min(1.5, this.shake + amount); }

  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, this.minZoom, this.maxZoom); }

  orbit(dx, dy) {
    this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw + dx, -Math.PI * .82, Math.PI * .82);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy, -.26, .34);
  }

  resetOrbit() { this.orbitYaw = 0; this.orbitPitch = 0; }

  /**
   * Spectator inspection mode.
   *
   * The duel camera exists to keep two fighters framed, which is exactly what makes it useless for
   * judging a hand, a grip or a face. This mode takes over the single write point (update) with a
   * fixed shot around ONE fighter, at a chosen framing and angle, and remembers everything the duel
   * camera owned so endSpectate() restores it exactly - including FOV, zoom, orbit and stage yaw.
   *
   * yaw is measured in degrees around the fighter, from his own facing: 0 = front, 90 = his left
   * side, 180 = rear, -90 = his right side. pitch tilts the shot up (positive) or down.
   */
  spectate({ fighter = null, framing = 'full', yaw = 0, pitch = 0, distance = null, fitBody = false,
    followBody = false, floorY = null, transition = 0.65, facingCorrection = false } = {}) {
    ensureSpectateStyle();
    if (!this.spectateState) {
      this.spectateState = {
        fov: this.camera.fov,
        zoom: this.zoom,
        orbitYaw: this.orbitYaw,
        orbitPitch: this.orbitPitch,
        stageYaw: this.stageYaw
      };
      if (typeof document !== 'undefined') document.body.classList.add('spectating');
    }
    Object.assign(this.spectateState, {
      fighter: fighter || this.spectateState.fighter,
      framing: SPECTATE_FRAMINGS[framing] ? framing : 'full',
      yaw,
      pitch,
      distance: distance ?? null,
      fitBody: Boolean(fitBody),
      followBody: Boolean(followBody),
      floorY: Number.isFinite(floorY) ? floorY : null,
      transition: Math.max(0, Number(transition) || 0),
      blend: 0,
      initializing: Boolean(followBody),
      fromPosition: this.camera.position.clone(),
      fromLook: this.lookTarget.clone(),
      // The shot is solved during this call, so the facing convention has to be part of the same
      // state update; setting it after spectate() cached a back-of-head solution for every body.
      victoryFacing: Boolean(facingCorrection),
      victoryTarget: null,
      victoryLook: null
    });
    this._updateSpectate(0);
    return this.describeSpectate();
  }

  /**
   * End-of-match presentation shot, used by every fighter.
   *
   * An authored celebration or defeat clip can carry root displacement: at 6 m from the gameplay
   * root the animated body can cross that point and the lens ends up inside an arm or leg. This
   * camera follows the rendered body box on every axis instead of the root, searches bearings until
   * the whole box projects inside the frame, and stays above the stage floor and outside collision
   * volumes. The first 0.65 s is blended from the live duel camera rather than cut.
   *
   * `facingCorrection` selects the body's own facing convention. The imported Hulk body faces +Z at
   * atan2(facing, facingZ); every other fighter uses the general spectator convention, so the
   * correction stays opt-in instead of silently changing their camera.
   */
  victoryShot(fighter, { opponent = null, floorY = null, distance = 6.4, yaw = 28, pitch = 5, fov = 52, bounds = null, blocks = null, occluders = null, facingCorrection = false } = {}) {
    // Final Valley is procedurally built and its layout carries no blocks. Its cliffs and rocks
    // are meshes, so the caller supplies mesh-derived volumes for the presentation. Restore the
    // previous collision set when the inspection camera ends, leaving the next match unchanged.
    const previous = { ...(this.spectateState?.stageGeometry || {}),
      victoryOccluders: this.spectateState?.victoryOccluders ?? null };
    if (bounds && Array.isArray(blocks)) {
      const priorBounds = this.stageBounds;
      const priorBlocks = this.collisionBlocks;
      this.setStageBounds(bounds, blocks);
      previous.stageBounds = priorBounds;
      previous.collisionBlocks = priorBlocks;
    }
    const result = this.spectate({
      fighter,
      framing: 'full',
      distance,
      yaw,
      pitch,
      fitBody: true,
      followBody: true,
      floorY,
      facingCorrection,
      transition: .7
    });
    if (this.spectateState) {
      // The mesh group is used only while this presentation camera owns the lens. The report and
      // candidate search can then distinguish a true cliff from an arena-wide bounding box.
      this.spectateState.victoryOccluders = occluders;
      this.spectateState.victoryOpponent = opponent;
      // Opt-in per body: Hulk's imported heading convention is the exception, not the rule.
      this.spectateState.victoryFacing = Boolean(facingCorrection);
      this.spectateState.victoryFov = THREE.MathUtils.clamp(Number(fov) || 52, 42, 62);
      this.spectateState.stageGeometry = previous;
    }
    return result;
  }

  /** Hulk's celebration keeps its own facing convention; every other body uses the general one. */
  hulkVictory(fighter, options = {}) {
    return this.victoryShot(fighter, { ...options, facingCorrection: true });
  }

  /** Leave inspection mode and hand the duel camera back with its saved state. */
  endSpectate() {
    if (!this.spectateState) return false;
    this.camera.fov = this.spectateState.fov;
    this.camera.updateProjectionMatrix();
    this.zoom = this.spectateState.zoom;
    this.orbitYaw = this.spectateState.orbitYaw;
    this.orbitPitch = this.spectateState.orbitPitch;
    this.stageYaw = this.spectateState.stageYaw;
    if (this.spectateState.stageGeometry) {
      this.stageBounds = this.spectateState.stageGeometry.stageBounds ?? this.stageBounds;
      this.collisionBlocks = this.spectateState.stageGeometry.collisionBlocks ?? this.collisionBlocks;
    }
    this._victoryOccluders = this.spectateState.stageGeometry?.victoryOccluders ?? null;
    this.spectateState = null;
    if (typeof document !== 'undefined') document.body.classList.remove('spectating');
    return true;
  }

  describeSpectate() {
    const state = this.spectateState;
    if (!state) return { active: false };
    return {
      active: true,
      fighter: state.fighter?.identity || null,
      framing: state.framing,
      yaw: state.yaw,
      pitch: state.pitch,
      distance: state.distance ?? SPECTATE_FRAMINGS[state.framing].distance,
      camera: { x: +this.camera.position.x.toFixed(2), y: +this.camera.position.y.toFixed(2), z: +this.camera.position.z.toFixed(2) }
    };
  }

  /** A real mesh raycast for the victory shot, ignoring transparent scenery and mist cards. */
  _victoryLineClear(position, target, occluders) {
    if (!occluders) return null;
    // The arena meshes are one root and the destructible props are another; a bearing is only clear
    // when every supplied root is clear, so a rock sitting in front of a downed body is still seen.
    if (Array.isArray(occluders)) {
      let sawClear = false;
      for (const entry of occluders) {
        if (!entry) continue;
        const clear = this._victoryLineClear(position, target, entry);
        if (clear === false) return false;
        if (clear === true) sawClear = true;
      }
      return sawClear ? true : null;
    }
    const length = position.distanceTo(target);
    if (length < .2) return false;
    const ray = this._victoryRay || (this._victoryRay = new THREE.Raycaster());
    const direction = new THREE.Vector3();
    const opaqueHit = (origin, point) => {
      direction.subVectors(point, origin);
      const rayLength = direction.length();
      if (rayLength < .2) return false;
      direction.multiplyScalar(1 / rayLength);
      ray.set(origin, direction);
      ray.near = .02;
      ray.far = Math.max(.05, rayLength - .32);
      for (const hit of ray.intersectObject(occluders, true)) {
        const object = hit.object;
        if (!object?.visible) continue;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const opaque = materials.some(material => material && !(material.transparent && (material.opacity ?? 1) < .65)
          && material.depthWrite !== false && material.visible !== false);
        if (opaque) return true;
      }
      return false;
    };
    // Check both directions. The camera-to-body ray alone starts inside a cliff and exits through
    // its backface without registering a hit; the body-to-camera direction catches that and the
    // wall a camera would otherwise sit behind.
    return !opaqueHit(position, target) && !opaqueHit(target, position);
  }

  _updateSpectate(dt = 0) {
    const state = this.spectateState;
    const fighter = state?.fighter;
    if (!fighter?.position) return;
    const preset = SPECTATE_FRAMINGS[state.framing] || SPECTATE_FRAMINGS.full;
    let box = null;
    let bodyCenter = null;
    let bodySize = null;
    if ((state.fitBody || state.followBody) && fighter.model) {
      box = new THREE.Box3().setFromObject(fighter.model);
      if (box.isEmpty()) {
        box = null;
      } else {
        bodyCenter = box.getCenter(new THREE.Vector3());
        bodySize = box.getSize(new THREE.Vector3());
      }
    }

    // A match ends with the movement facing zeroed, so the logical heading collapsed to world +Z and
    // the shot landed behind bodies that happened to be facing -Z. The rendered body already carries
    // its authored orientation, so take the bearing from its own +Z axis instead.
    const modelYaw = fighter.model?.matrixWorld
      ? Math.atan2(fighter.model.matrixWorld.elements[8], fighter.model.matrixWorld.elements[10])
      : null;
    const heading = state.victoryFacing
      ? Math.atan2(fighter.facing || 0, fighter.facingZ || 1)
      : (Number.isFinite(modelYaw) ? modelYaw : Math.atan2(fighter.facingZ || 0, fighter.facing || 1));
    const pitch = THREE.MathUtils.degToRad(state.pitch || 0);
    const occluders = state.victoryOccluders || null;
    const opponent = state.victoryOpponent || null;

    // Body-following victory camera. The anchor is the rendered body centre, not fighter.position:
    // Hulk's victory clip displaces the armature through the world, and a camera tied to the
    // gameplay root watches the celebration walk straight through its own lens.
    if (state.followBody && box && bodyCenter && bodySize) {
      const height = Math.max(.6, bodySize.y);
      const radius = Math.max(.35, bodySize.length() * .5);
      const requested = state.distance ?? preset.distance;
      const baseDistance = Math.max(requested, height * 1.7 + 1.6, radius * 2.05 + 1.2);
      const floorY = Number.isFinite(state.floorY) ? state.floorY : Math.min(fighter.position.y || 0, box.min.y);
      const aspect = this.camera.aspect || 1.6;
      // A fighter backed against a cliff has no room for a 6.4 m front shot. A closer, wider lens
      // keeps the same full-body composition without putting the camera outside the arena or in the
      // wall; the fit test still measures all eight body corners.
      const fov = state.victoryFov || 46;
      // Project all eight corners, not just the body centre. A shot can put the centre on screen
      // while the head or feet are clipped by the frame; that is exactly the failure mode here.
      const fits = (position, look) => {
        const probe = this._probeCamera;
        probe.fov = fov;
        probe.aspect = aspect;
        probe.near = .1;
        probe.far = 600;
        probe.position.copy(position);
        probe.lookAt(look);
        probe.updateProjectionMatrix();
        probe.updateMatrixWorld(true);
        const point = new THREE.Vector3();
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              point.set(x, y, z).project(probe);
              if (point.z >= 1 || Math.abs(point.x) > .9 || Math.abs(point.y) > .9) return false;
            }
          }
        }
        return true;
      };
      const inArena = position => {
        const b = this.stageBounds;
        if (!b) return true;
        return position.x > b.x0 - .35 && position.x < b.x1 + .35
          && position.z > b.z0 - .35 && position.z < b.z1 + .35;
      };
      const opponentBox = opponent?.model ? new THREE.Box3().setFromObject(opponent.model) : null;
      const opponentCenter = opponentBox && !opponentBox.isEmpty() ? opponentBox.getCenter(new THREE.Vector3()) : null;
      const projectRect = (probe, box) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const point = new THREE.Vector3();
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          point.set(x, y, z).project(probe);
          if (point.z >= 1) return null;
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
        return { minX, maxX, minY, maxY };
      };
      const opponentInFront = (position) => {
        if (!opponentBox || opponentBox.isEmpty() || !opponentCenter) return false;
        const probe = this._probeCamera;
        probe.fov = fov;
        probe.aspect = aspect;
        probe.near = .1;
        probe.far = 600;
        probe.position.copy(position);
        probe.lookAt(bodyCenter);
        probe.updateProjectionMatrix();
        probe.updateMatrixWorld(true);
        const hulk = projectRect(probe, box), other = projectRect(probe, opponentBox);
        if (!hulk || !other) return false;
        const overlapX = Math.max(0, Math.min(hulk.maxX, other.maxX) - Math.max(hulk.minX, other.minX));
        const overlapY = Math.max(0, Math.min(hulk.maxY, other.maxY) - Math.max(hulk.minY, other.minY));
        // A defeated opponent lying behind Hulk may overlap in projection and is harmless. Only
        // reject when the opponent is closer to the lens than Hulk and covers part of him.
        const cameraToHulk = position.distanceTo(bodyCenter);
        const cameraToOther = position.distanceTo(opponentCenter);
        return cameraToOther + .15 < cameraToHulk && overlapX * overlapY > .005;
      };
      // A center-only ray is not a visibility test for a character. The first accepted Hulk shot
      // had a clear line to his navel while a cliff cut away his right arm and half his head; the
      // camera scored it as unobstructed. Sample the whole rendered box (corners, face and limb
      // midpoints) so a candidate is only eligible when the mesh actually exposes the fighter.
      const bodySamples = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) bodySamples.push(new THREE.Vector3(x, y, z));
        }
      }
      for (const y of [box.min.y, bodyCenter.y, box.max.y - .12]) {
        bodySamples.push(new THREE.Vector3(bodyCenter.x, y, bodyCenter.z));
        bodySamples.push(new THREE.Vector3(box.min.x, y, bodyCenter.z));
        bodySamples.push(new THREE.Vector3(box.max.x, y, bodyCenter.z));
        bodySamples.push(new THREE.Vector3(bodyCenter.x, y, box.min.z));
        bodySamples.push(new THREE.Vector3(bodyCenter.x, y, box.max.z));
      }
      // A grounded/defeated body has corners at or under the floor. Those are not occlusions:
      // a ray to a foot sample hits the ground plane itself, which rejected every close defeat
      // bearing and forced the 12.8 m fallback. Keep the silhouette samples above the floor.
      for (let i = bodySamples.length - 1; i >= 0; i -= 1) {
        if (bodySamples[i].y <= floorY + .2) bodySamples.splice(i, 1);
      }
      const clearLine = position => {
        if (opponentInFront(position)) return false;
        // Real meshes beat conservative bounding boxes here: a curved cliff can share one huge
        // AABB with the whole arena, which made every candidate look blocked and sent the fallback
        // camera straight into the cliff. Transparent mist/water cards are ignored by the raycast.
        if (occluders) {
          for (const sample of bodySamples) {
            if (this._victoryLineClear(position, sample, occluders) !== true) return false;
          }
        } else if (this._insideBlock(position.x, position.y, position.z)) return false;
        if (!occluders && this.collisionBlocks?.length) {
          const dx = bodyCenter.x - position.x, dy = bodyCenter.y - position.y, dz = bodyCenter.z - position.z;
          const length = Math.hypot(dx, dy, dz);
          if (length < .2) return false;
          if (this.obstruction(position.x, position.y, position.z, dx / length, dy / length, dz / length,
            length - .35, floorY + .2) != null) return false;
        }
        // A center-only sightline cleared the downed opponent's head while Goku still covered
        // Hulk's torso and legs. Sample the full body column and reject a bearing where any part
        // of Hulk is behind the opponent.
        if (opponent?.model && opponentBox && !opponentBox.isEmpty()) {
          const levels = [bodyCenter.y, bodyCenter.y - bodySize.y * .28, bodyCenter.y + bodySize.y * .28];
          for (const y of levels) {
            if (this._victoryLineClear(position, { x: bodyCenter.x, y, z: bodyCenter.z }, opponent.model) !== true) return false;
          }
        }
        return true;
      };
      // The opening preference is a front three-quarter shot, so Hulk's face and completed pose
      // read. The opponent-aware sightline test below rejects a front angle that Goku covers, and
      // the side bearings are next; the rear is only a last resort, never the default.
      const preferred = [];
      // Start with a frontal and two close three-quarter bearings before fanning around. The
      // previous list jumped from +28 to +55 and never tried the direct front, which is exactly the
      // gap that made a front-facing Hulk read as a back view.
      const offsets = [...new Set([...preferred, 0, 12, -12, 24, -24, 38, -38, 55, -55,
        80, -80, 105, -105, 135, -135, 160, -160, 180])];
      let chosen = null;
      const scales = [.52, .64, .78, .92, 1, 1.18, 1.4, 1.7, 2.05];
      const pitchCandidates = [5, 15, 25, 34].map(deg => THREE.MathUtils.degToRad(Math.max(deg, THREE.MathUtils.radToDeg(pitch))));
      for (const offset of offsets) {
        const candidateYaw = heading + THREE.MathUtils.degToRad(offset);
        for (const scale of scales) {
          const distance = baseDistance * scale;
          if (distance < 2.8) continue;
          for (const pitchHere of [...new Set(pitchCandidates)]) {
            const horizontal = Math.cos(pitchHere) * distance;
            const position = new THREE.Vector3(
              bodyCenter.x + Math.sin(candidateYaw) * horizontal,
              Math.max(floorY + 1.05, bodyCenter.y + Math.sin(pitchHere) * distance),
              bodyCenter.z + Math.cos(candidateYaw) * horizontal
            );
            if (!inArena(position) || !clearLine(position) || !fits(position, bodyCenter)) continue;
            chosen = { position, yaw: candidateYaw, distance, offset, fov, pitch: pitchHere };
            break;
          }
          if (chosen) break;
        }
        if (chosen) break;
      }
      if (!chosen) {
        // Last-resort framing: keep the body centre and choose a safe distance above the floor.
        // It is still better than freezing the camera inside the model. Try the preferred front
        // bearing first, then broaden the search; only use the body centre as a last resort.
        for (const offset of offsets) {
          const candidateYaw = heading + THREE.MathUtils.degToRad(offset);
          for (const scale of [1.4, 1.7, 2.05, 2.5]) {
            const distance = baseDistance * scale;
            const horizontal = Math.cos(pitch) * distance;
            const position = new THREE.Vector3(
              bodyCenter.x + Math.sin(candidateYaw) * horizontal,
              Math.max(floorY + 1.05, bodyCenter.y + Math.sin(pitch) * distance),
              bodyCenter.z + Math.cos(candidateYaw) * horizontal
            );
            if (!inArena(position) || !clearLine(position) || !fits(position, bodyCenter)) continue;
            chosen = { position, yaw: candidateYaw, distance, offset, fov, pitch };
            break;
          }
          if (chosen) break;
        }
      }
      if (!chosen) {
        // Last-resort but still safe: a high overhead camera has a clear line above an arena corner
        // and cannot sit inside a wall. The body remains the subject and the full silhouette fits.
        for (const heightScale of [2.6, 3.4, 4.2]) {
          const distance = Math.max(8, bodySize.y * heightScale);
          const position = new THREE.Vector3(bodyCenter.x, floorY + distance, bodyCenter.z + .01);
          if (!clearLine(position) || !fits(position, bodyCenter)) continue;
          chosen = { position, yaw: heading, distance, offset: 0, fov, pitch: Math.PI / 2, fallback: 'overhead' };
          break;
        }
      }
      if (!chosen) {
        const distance = baseDistance * 2.2;
        const candidateYaw = heading + THREE.MathUtils.degToRad(state.yaw);
        const horizontal = Math.cos(pitch) * distance;
        chosen = {
          position: new THREE.Vector3(
            bodyCenter.x + Math.sin(candidateYaw) * horizontal,
            Math.max(floorY + 1.05, bodyCenter.y + Math.sin(pitch) * distance),
            bodyCenter.z + Math.cos(candidateYaw) * horizontal
          ),
          yaw: candidateYaw,
          distance,
          offset: state.yaw,
          fov,
          pitch,
          fallback: true
        };
      }
      state.victoryChoice = { offset: +Number(chosen.offset).toFixed(1), pitch: +THREE.MathUtils.radToDeg(chosen.pitch ?? pitch).toFixed(1),
        distance: +chosen.distance.toFixed(2), fov: +chosen.fov.toFixed(1), fallback: Boolean(chosen.fallback) };
      state.victoryHeading = +THREE.MathUtils.radToDeg(heading).toFixed(1);

      if (state.initializing) {
        // Keep the current lens for this call; the next simulation/render tick begins the blend.
        state.victoryTarget = chosen.position;
        state.victoryLook = bodyCenter.clone();
        state.cameraPosition = state.fromPosition.clone();
        state.initializing = false;
        return;
      }
      // Keep the current measured target available to the verification harness; the earlier value
      // was frozen at initialization even when the body moved the shot to a new bearing.
      state.victoryTarget = chosen.position;
      const blend = Math.min(1, (state.blend || 0) + (state.transition > 0
        ? Math.max(0, dt) / state.transition
        : 1));
      state.blend = blend;
      const ease = blend * blend * (3 - 2 * blend);
      if (!state.cameraPosition) state.cameraPosition = state.fromPosition.clone();
      if (blend < 1) {
        state.cameraPosition.lerpVectors(state.fromPosition, chosen.position, ease);
      } else {
        // Once the blend completes, damp toward the moving body instead of assigning the newly
        // chosen candidate directly. The authored clip shifts the body every frame; assigning the
        // candidate made a new bearing or distance read as a camera snap.
        const follow = 1 - Math.exp(-7 * Math.max(0, dt));
        state.cameraPosition.lerp(chosen.position, follow);
      }
      this.camera.position.copy(state.cameraPosition);
      if (!state.victoryLook) state.victoryLook = bodyCenter.clone();
      state.victoryLook.lerp(bodyCenter, Math.min(1, Math.max(.12, dt * 8)));
      this.lookTarget.lerpVectors(state.fromLook, state.victoryLook, ease);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, fov, 8, Math.min(.2, Math.max(0, dt)));
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.lookTarget);
      return;
    }

    // Legacy inspection framing (hands, head, feet): fixed distance from the gameplay root.
    // A clip can move the body away from that root, so fit the body's height when requested.
    let distance = state.distance ?? preset.distance;
    let lookY = preset.lookY;
    if (state.fitBody && box && bodyCenter) {
      const height = Math.max(.6, box.max.y - box.min.y);
      lookY = bodyCenter.y - fighter.position.y;
      distance = Math.max(distance, height * 2.2 + 2);
    }
    // The fighter's own facing defines "front", so a front view is his front even after he turns.
    let yaw = heading + THREE.MathUtils.degToRad(state.yaw);
    const horizontal = Math.cos(pitch) * distance;
    const position = fighter.position;
    this.camera.position.set(
      position.x + Math.sin(yaw) * horizontal,
      position.y + lookY + Math.sin(pitch) * distance,
      position.z + Math.cos(yaw) * horizontal
    );
    this.camera.lookAt(position.x, position.y + lookY, position.z);
  }

  /**
   * Briefly emphasise a fighter (a signature move or ultimate starting). `seconds` and `zoom` are
   * clamped: the push is capped at 0.6 s and 16% of the shot, so a special adds weight without
   * turning the fight into a cutscene or pushing the opponent out of frame.
   */
  focus(fighter, { seconds = 0.45, zoom = 0.12, bias = 0.22 } = {}) {
    if (!fighter?.position) return null;
    this.focusState = {
      fighter,
      t: 0,
      seconds: THREE.MathUtils.clamp(Number(seconds) || 0.45, 0.2, 0.6),
      zoom: THREE.MathUtils.clamp(Number(zoom) || 0.12, 0, 0.16),
      bias: THREE.MathUtils.clamp(Number(bias) || 0.22, 0, 0.24)
    };
    return this.focusState;
  }

  /**
   * Take an authored cinematic shot for one beat.
   *
   * The camera already owned every value needed to restore itself (spectate does the same), so a
   * shot only has to record them once. `shot` is the director's own data: distance in metres, height
   * above the look point, yaw around the duel axis, downward pitch, the look target and the FOV the
   * beat was authored with. Returns the shot that was accepted, or null if it is unusable.
   */
  cineShot(shot, { owner = null, target = null } = {}) {
    if (!shot) return null;
    const numbers = ['distance', 'height', 'yaw', 'pitch', 'fov'].every(k => Number.isFinite(Number(shot[k])));
    if (!numbers || Number(shot.distance) <= 0.5) return null;
    if (!this.cineState) {
      this.cineState = {
        fov: this.camera.fov,
        zoom: this.zoom,
        orbitYaw: this.orbitYaw,
        orbitPitch: this.orbitPitch,
        stageYaw: this.stageYaw,
        blend: 0
      };
    }
    this.cineState.shot = shot;
    this.cineState.owner = owner || this.cineState.owner || null;
    this.cineState.target = target || this.cineState.target || null;
    this.cineState.blend = 0;
    if (typeof document !== 'undefined') document.body.classList.add('cinematic');
    return shot;
  }

  /** Leave the cinematic shot and hand the duel camera back exactly as it was. */
  endCineShot() {
    if (!this.cineState) return false;
    this.camera.fov = this.cineState.fov;
    this.camera.updateProjectionMatrix();
    this.zoom = this.cineState.zoom;
    this.orbitYaw = this.cineState.orbitYaw;
    this.orbitPitch = this.cineState.orbitPitch;
    this.stageYaw = this.cineState.stageYaw;
    this.cineState = null;
    if (typeof document !== 'undefined') document.body.classList.remove('cinematic');
    return true;
  }

  /**
   * Apply the current shot. The authored FOV is honoured, but the shot is widened only as far as the
   * pair actually requires, so a close-up can never cut the opponent (or the caster's own hands) out
   * of frame. Every applied value is recorded for the cinematic telemetry.
   */
  _updateCine(dt) {
    const state = this.cineState;
    const shot = state.shot;
    if (!shot) return;
    const owner = state.owner?.position || null;
    const target = state.target?.position || null;
    // Framing always keeps the pair: an authored 'target' close-up is biased 25% back toward the
    // caster, because aiming straight at the victim pushed the attack's own emitter out of frame.
    const look = new THREE.Vector3();
    if (shot.look === 'owner' && owner) look.copy(owner).lerp(target || owner, .25);
    else if (shot.look === 'target' && target) look.copy(target).lerp(owner || target, .25);
    else if (owner && target) look.copy(owner).add(target).multiplyScalar(.5);
    else if (owner) look.copy(owner);
    else if (target) look.copy(target);
    else look.set(0, 1.1, 0);
    look.y += 1.15;

    const separation = owner && target
      ? Math.hypot(owner.x - target.x, owner.z - target.z)
      : 0;
    const aspect = this.camera.aspect || 1.6;
    // Enough distance for the pair plus their attacks, never less than the authored close-up.
    let distance = THREE.MathUtils.clamp(Math.max(shot.distance, separation * 1.45 + 2.6), 3.2, 26);
    const heightFor = d => THREE.MathUtils.clamp(shot.height, 0, d * .8);
    const horizontalFor = d => Math.sqrt(Math.max(.5, d * d - heightFor(d) * heightFor(d)));
    // The duel axis is the direction from the target to the caster, so yaw 0 looks over the
    // caster's shoulder at the opponent and positive yaw orbits to the caster's left.
    const baseYaw = owner && target ? Math.atan2(owner.x - target.x, owner.z - target.z) : 0;
    // Iron Man fires along the duel axis, so a beam shot taken from that same axis sees the beam
    // end-on: it projects onto his own torso and reads as a chest glow instead of a blast. On a
    // beam ultimate with no authored side angle, orbit far enough off the axis for the beam to
    // cross the frame beside the body. Authored side shots are left exactly as they were.
    const casting = state.owner?.casting || state.target?.casting || null;
    const beamUltimate = !!(casting && /beam/i.test(String(casting.def?.behaviour || casting.def?.kind || casting.label || '')));
    // Top the authored angle up to at least half a radian off the firing axis rather than replacing it:
    // a shot already composed well to the side is left alone, and a straight-behind-the-caster shot
    // is pulled round far enough that the beam no longer projects onto the torso.
    const yawBias = beamUltimate ? Math.max(0, .5 - Math.abs(Number(shot.yaw) || 0)) : 0;
    const yaw = baseYaw + (Number(shot.yaw) || 0) + yawBias;
    // An authored 32-34 degree close-up is honoured when the pair is tight; a wide separation
    // widens the lens instead of pushing the opponent off screen.
    const neededFor = d => THREE.MathUtils.radToDeg(2 * Math.atan((separation * .5 + 2.1) / Math.max(.5, d * aspect)));
    let fov = THREE.MathUtils.clamp(Math.max(shot.fov, neededFor(distance)), 26, 62);

    // Fit BOTH bodies, not just the look point. Guaranteeing only the look target is what let the
    // caster slide off the bottom of the frame (NDC y -1.45 on Goku's finisher, -0.89 on Iron Man's)
    // while the shot itself looked "correct". Feet, chest and head of both fighters now have to land
    // inside the margin, and the fit is measured against the same lens the frame is drawn with.
    const FIT_LIMIT = .85;
    const bodies = [];
    // Fixed offsets assume every body is 1.78 m tall and stands on its own origin. Iron Man hovers,
    // so his real feet sit well below the sampled point and his legs kept reaching the bottom edge
    // even while the measured points reported a pass. Measure each model's actual bounds once per
    // cast and fit the eight corners of that box instead of three guessed heights.
    const boundsFor = (fighter, key) => {
      const cached = state.bounds?.[key];
      if (cached && cached.at === fighter?.model) return cached.box;
      if (!fighter?.model) return null;
      this._cineBox ||= new THREE.Box3();
      this._cineBox.setFromObject(fighter.model);
      if (!Number.isFinite(this._cineBox.min.y) || this._cineBox.max.y - this._cineBox.min.y < .2) return null;
      state.bounds ||= {};
      state.bounds[key] = { at: fighter.model, box: this._cineBox.clone() };
      return state.bounds[key].box;
    };
    for (const [key, body] of [['owner', owner], ['target', target]]) {
      if (!body) continue;
      const box = boundsFor(state[key], key);
      if (box) {
        const midZ = (box.min.z + box.max.z) * .5;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) bodies.push(new THREE.Vector3(x, y, midZ));
        }
        continue;
      }
      bodies.push(new THREE.Vector3(body.x, body.y + .12, body.z));
      bodies.push(new THREE.Vector3(body.x, body.y + .95, body.z));
      bodies.push(new THREE.Vector3(body.x, body.y + 1.78, body.z));
    }
    const probe = this._cineProbe || (this._cineProbe = new THREE.PerspectiveCamera(50, aspect, .1, 500));
    let worstNdc = 0;
    let ndc = { x: 0, minY: 0, maxY: 0 };
    for (let pass = 0; pass < 3 && bodies.length; pass += 1) {
      const probeHeight = heightFor(distance);
      const probeHorizontal = horizontalFor(distance);
      probe.fov = fov;
      probe.aspect = aspect;
      probe.near = .1;
      probe.far = 500;
      probe.position.set(
        look.x + Math.sin(yaw) * probeHorizontal,
        look.y + probeHeight,
        look.z + Math.cos(yaw) * probeHorizontal
      );
      probe.lookAt(look);
      probe.updateProjectionMatrix();
      probe.updateMatrixWorld(true);
      worstNdc = 0;
      ndc = { x: 0, minY: 0, maxY: 0 };
      for (const point of bodies) {
        const projected = point.clone().project(probe);
        worstNdc = Math.max(worstNdc, Math.abs(projected.x), Math.abs(projected.y));
        ndc.x = Math.max(ndc.x, Math.abs(projected.x));
        ndc.minY = Math.min(ndc.minY, projected.y);
        ndc.maxY = Math.max(ndc.maxY, projected.y);
      }
      if (worstNdc <= FIT_LIMIT) break;
      // Back off by how far outside the margin the worst body point actually is, then re-derive the
      // lens so a tighter fit relaxes the FOV instead of only pushing the camera away.
      distance = Math.min(26, distance * (worstNdc / FIT_LIMIT) * 1.06);
      fov = THREE.MathUtils.clamp(Math.max(shot.fov, neededFor(distance)), 26, 62);
    }
    const height = heightFor(distance);
    const horizontal = horizontalFor(distance);
    this.positionTarget.set(look.x + Math.sin(yaw) * horizontal, look.y + height, look.z + Math.cos(yaw) * horizontal);
    this.lookTarget.copy(look);
    state.blend = Math.min(1, (state.blend || 0) + dt * 6);
    const nextFov = THREE.MathUtils.damp(this.camera.fov, fov, 8, Math.min(.2, dt || .016));
    if (Math.abs(nextFov - this.camera.fov) > .01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    state.applied = {
      distance: +distance.toFixed(2), height: +height.toFixed(2), fov: +fov.toFixed(2),
      authored: { distance: +shot.distance.toFixed(2), fov: +shot.fov.toFixed(2) },
      separation: +separation.toFixed(2), look: shot.look, yaw: +yaw.toFixed(3),
      beamYaw: +yawBias.toFixed(2),
      ndc: { x: +ndc.x.toFixed(2), minY: +ndc.minY.toFixed(2), maxY: +ndc.maxY.toFixed(2) },
      fittedNdc: +worstNdc.toFixed(2)
    };
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.positionTarget.x, 9, Math.min(.2, dt || .016));
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.positionTarget.y, 9, Math.min(.2, dt || .016));
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.positionTarget.z, 9, Math.min(.2, dt || .016));
    this.shake = Math.max(0, this.shake - dt * 2.8);
    if (this.shake > 0) {
      const magnitude = this.shake * this.shake;
      this.camera.position.x += (Math.random() - .5) * magnitude;
      this.camera.position.y += (Math.random() - .5) * magnitude * .7;
    }
    this.camera.lookAt(this.lookTarget);
  }

  /**
   * Final framing guarantee. The composed shot is chosen before the wall clamp and before the
   * easing settles, so on a tight street the lens can still settle aimed above a pair standing
   * below the frame. Verify at the *actual* lens and, if a fighter is out of frame, take the
   * smallest correction that brings both back: first lower the aim toward the duel mid, then
   * pull back a little. A step is only accepted when BOTH fit, so one is never traded for the
   * other, and the bounded search restores the composed shot untouched if nothing works.
   */
  _enforceFraming(a, b) {
    if (!a?.model || !b?.model) return;
    const boxes = [new THREE.Box3().setFromObject(a.model), new THREE.Box3().setFromObject(b.model)];
    // Judge the shot this frame INTENDS to take, not the smoothed lens still easing toward last
    // frame's target. Reading the live camera made this check one frame stale: a perfectly good
    // shot was rejected mid-transition, the palace fallback then fired in the open street, and the
    // correction could never land because smoothing overwrote it anyway.
    const shot = () => ({
      x: this.positionTarget.x, y: this.positionTarget.y, z: this.positionTarget.z,
      lookX: this.lookTarget.x, lookY: this.lookTarget.y, lookZ: this.lookTarget.z
    });
    const fits = () => this._framesBoth(shot(), a, b, boxes);
    const targetFits = fits().both;
    // The target can be right while the damped lens is still travelling toward it. The shot that
    // renders is the camera position, not positionTarget, so a lagging move must not be reported as
    // framed: land the lens on the verified target instead of letting a fighter leave the frame for
    // the frames the easing needs. At 60 fps this is a few centimetres.
    const cameraFits = this._framesBoth({
      x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z,
      lookX: this.lookTarget.x, lookY: this.lookTarget.y, lookZ: this.lookTarget.z
    }, a, b, boxes, .98).both;
    if (targetFits) {
      this.framing.enforced = 0;
      if (!cameraFits) {
        this.camera.position.copy(this.positionTarget);
        this.camera.lookAt(this.lookTarget);
        this.framing.enforced = 'settled';
      }
      return;
    }
    const midY = Math.max(0.9, (a.position.y + b.position.y) * 0.5 + 1.1);
    const startLook = this.lookTarget.clone();
    const startPos = this.positionTarget.clone();
    for (let step = 1; step <= 6; step++) {
      const t = step / 6;
      this.lookTarget.copy(startLook);
      if (midY < startLook.y) this.lookTarget.y = THREE.MathUtils.lerp(startLook.y, midY, t);
      const back = 1 + t * 0.18;
      this.positionTarget.copy(startPos).sub(this.lookTarget).multiplyScalar(back).add(this.lookTarget);
      if (fits().both) {
        this.framing.enforced = step;
        this.camera.position.copy(this.positionTarget);
        this.camera.lookAt(this.lookTarget);
        return;
      }
    }
    this.lookTarget.copy(startLook);
    this.positionTarget.copy(startPos);
    this.framing.enforced = null;
  }

  /** Telemetry for the cinematic camera: what was authored, and what was actually applied. */
  describeCineShot() {
    if (!this.cineState) return { active: false };
    return { active: true, beat: this.cineState.shot?.beat ?? null, ...(this.cineState.applied || {}) };
  }

  /** Smooth 0 -> 1 -> 0 envelope, so the focus never snaps in or out. */
  _focusProgress() {
    if (!this.focusState) return 0;
    const p = this.focusState.t / this.focusState.seconds;
    if (p >= 1) return 0;
    return Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  }

  _focusZoom() {
    if (!this.focusState) return 0;
    return this.focusState.zoom * this._focusProgress();
  }

  _focusBias() {
    if (!this.focusState) return 0;
    return this.focusState.bias * this._focusProgress();
  }

  /**
   * Overhead mode: a high, steep, pulled-back view that keeps both fighters inside the
   * frame. The old elevated modes anchored on the player and always sat on +Z, so the
   * opponent could drift to the edge or behind the camera. This one anchors on the
   * midpoint of the duel and derives its distance from how far apart the fighters are
   * - including a launched fighter's height - so jumps and flight pull the camera out
   * instead of losing the target.
   */
  overheadFraming(a, b) {
    let midX = (a.position.x + b.position.x) * .5;
    let midZ = (a.position.z + b.position.z) * .5;
    const midY = Math.max(0, a.position.y + b.position.y) * .5;
    // A special attack leans the shot toward its caster, but only by a fifth of the gap, so the
    // opponent remains the co-subject of the frame.
    const focusBias = this._focusBias();
    const focused = this.focusState?.fighter;
    if (focusBias > 0 && focused?.position) {
      midX = THREE.MathUtils.lerp(midX, focused.position.x, focusBias);
      midZ = THREE.MathUtils.lerp(midZ, focused.position.z, focusBias);
    }
    const separation = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const heightGap = Math.abs((a.position.y || 0) - (b.position.y || 0));
    // Keep the whole pair plus their shadow inside the frustum: the tighter the duel,
    // the closer and steeper the shot; a wide or airborne duel pulls back and flattens.
    // The multiplier is deliberately below 1: a 16:9 frame at this FOV already covers ~1.7x
    // the camera distance from side to side, so matching the separation 1:1 pushed the
    // fighters down to a couple of dozen pixels tall.
    const spread = THREE.MathUtils.clamp(separation / 11, 0, 1);
    // A close duel now sits about 9 units out instead of 13, which takes a ~2m fighter
    // from roughly an eighth of the frame to a quarter - the size a fighting game needs
    // for limbs, weapon arcs and hit reactions to read at a glance.
    const baseReach = 4.8 + separation * .3 + heightGap * .4 + midY * .22;
    // Guarantee both fighters stay in frame: derive the minimum distance the horizontal
    // field of view needs for this separation. Without it a widely-spaced spawn on a large
    // stage pushed one fighter off-screen while the camera filled the frame with floor.
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov || 46);
    const halfHorizontal = Math.tan(fovRad / 2) * (this.camera.aspect || 1.6);
    const requiredReach = (separation * .5 + 1.8) / Math.max(.3, halfHorizontal * .92);
    // The same solve on the vertical axis. `baseReach` only *nudged* the distance for height
    // (`heightGap * .4`), which framed a level duel correctly but lost an aerial one: with 11 m
    // between the two fighters the upper one sat at NDC y 1.29, above the top of the screen.
    // Half the height difference has to fit inside the vertical half-angle, so the shot pulls
    // back for an aerial duel exactly the way it already did for a wide one.
    const halfVertical = Math.tan(fovRad / 2);
    const requiredVerticalReach = (heightGap * .5 + 1.6) / Math.max(.2, halfVertical * .86);
    // On a large world stage a close duel still has to show the place it is happening in, so
    // the minimum distance grows with the stage instead of collapsing onto the pair.
    const stageFloor = 6.2 + (this.stageScale - 1) * 12;
    const reach = THREE.MathUtils.clamp(
      Math.max(baseReach, requiredReach * this.stageScale, requiredVerticalReach, stageFloor),
      stageFloor, 42) * this.zoom * (1 - this._focusZoom());
    // Look down steeply enough to read as an overhead fighting camera, but not so steeply
    // that a standing fighter is foreshortened into a stub - and lower still on world stages.
    const elevation = THREE.MathUtils.clamp(.8 - spread * .1 - this.stageTilt, .5, .8);
    const horizontal = reach * Math.sqrt(Math.max(0, 1 - elevation * elevation));
    this.framing.distance = reach;
    this.framing.angle = elevation;
    // The pulled-back offset normally sits on +Z. A yawed stage rotates that offset around
    // the fighters so a wide room is framed along its length instead of into the near wall.
    const yaw = this.stageYaw || 0;
    // `midY * .55` was tuned on stages whose floor is y = 0. On a raised terrace (Konoha's
    // Hokage Rock sits 24 m up, King Kai's planet 62 m) it put the camera *below* the floor it
    // was filming, so the shot opened inside the rock. The camera is never placed under the
    // fighters' feet, and it aims at their chest rather than at a fraction of their height.
    const liftY = Math.max(2.4, midY * .55);
    return {
      x: midX + horizontal * Math.sin(yaw),
      y: Math.max(liftY, midY) + reach * elevation,
      z: midZ + horizontal * Math.cos(yaw),
      lookX: midX,
      lookY: Math.max(1.1, midY + .5),
      lookZ: midZ
    };
  }

  update(a, b, dt, mode = 'classic') {
    // Inspection mode owns the camera outright while it is active; the duel camera is untouched
    // and resumes from its saved state the moment the mode ends. Pass the frame delta through:
    // without it the victory blend stayed at zero and the dedicated shot never moved off the
    // live duel camera.
    if (this.spectateState) { this._updateSpectate(dt); return; }
    // An authored ultimate shot also owns the camera, for one beat at a time.
    if (this.cineState) { this._updateCine(dt); return; }
    this.framing.mode = mode;
    if (this.focusState) {
      this.focusState.t += dt;
      if (this.focusState.t >= this.focusState.seconds) this.focusState = null;
    }
    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const spread = THREE.MathUtils.clamp(distance / 9, 0, 1);
    const altitude = Math.max(a.position.y || 0, b.position.y || 0);
    const altitudeLift = THREE.MathUtils.clamp(altitude * .72, 0, 34);

    if (mode === 'overhead') {
      const shot = this._composedShot(a, b, dt);
      this.positionTarget.set(shot.x, shot.y, shot.z);
      this.lookTarget.set(shot.lookX, shot.lookY, shot.lookZ);
    } else if (mode === 'explore') {
      // Free roam is not a duel: sit behind the fighter's shoulders, low enough to read the
      // street and see a skyline, and let the orbit offset turn it into a mouse look.
      const zoom = Math.min(this.zoom, 1.8);
      const trailing = 4.4 * zoom + 1.4;
      const height = 2.0 * zoom + 1.1;
      this.positionTarget.set(a.position.x, a.position.y + height, a.position.z + trailing);
      this.lookTarget.set(a.position.x, a.position.y + 1.45, a.position.z);
    } else if (mode === 'third-person') {
      // Third-person follow: the lens sits behind the character's back and above their head, with
      // the look point ahead of them. On a fresh shot (round start, map change) it snaps to the
      // facing; afterwards it only eases toward facing while the character is actually running
      // forward. Strafing and backpedalling leave it alone, so A/D stay lateral on screen and S keeps
      // the camera in front of the movement instead of spinning 180 degrees.
      const facingYaw = Math.atan2(a.facing || 1, a.facingZ || 0);
      if (this.followYaw == null || this.pendingSnap) this.followYaw = facingYaw;
      let delta = facingYaw - this.followYaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      const speed = Math.hypot(a.velocity?.x || 0, a.velocity?.z || 0);
      const forwardSpeed = (a.velocity?.x || 0) * (a.facing || 0) + (a.velocity?.z || 0) * (a.facingZ || 0);
      // Recenter only on a pure forward run (see the input adapter): diagonal and strafe input keep
      // the basis fixed so the travel direction cannot chase a camera that is chasing it.
      const chase = a.cameraRecenter && speed > .6 && forwardSpeed > .4 ? 2.4 : 0;
      this.followYaw += THREE.MathUtils.clamp(delta, -chase * dt, chase * dt);
      const yaw = this.followYaw + (this.orbitYaw || 0);
      const distance = 5.4 * Math.min(this.zoom, 1.7);
      const height = 2.35 * Math.min(this.zoom, 1.35);
      this.positionTarget.set(
        a.position.x - Math.sin(yaw) * distance,
        (a.position.y || 0) + height,
        a.position.z - Math.cos(yaw) * distance
      );
      this.lookTarget.set(
        a.position.x + Math.sin(yaw) * 2.2,
        (a.position.y || 0) + 1.35,
        a.position.z + Math.cos(yaw) * 2.2
      );
    } else if (mode === 'over-p1') {
      // Duel third-person shot: behind P1's shoulders ON THE P1 -> CPU AXIS, above head height,
      // looking past P1 at the opponent. The old branch sat on a fixed +Z offset and aimed at the
      // floor, so it read as a high isometric that happened to start near P1, and turning the duel
      // could put the camera in front of the player. Anchoring the offset to the duel axis keeps the
      // shot behind P1 however the pair turn, while P1 stays in the foreground.
      const focusZoom = 1 - this._focusZoom();
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const separation = Math.hypot(dx, dz) || 1;
      const ux = dx / separation;
      const uz = dz / separation;
      const heightGap = Math.max(0, (b.position.y || 0) - (a.position.y || 0));
      // Distance is solved from the pair's separation so a wide or aerial duel cannot push the CPU
      // out of frame; the floor keeps P1 large enough to read his limbs and hit reactions.
      const fovRad = THREE.MathUtils.degToRad(this.camera.fov || 46);
      const halfWidth = Math.tan(fovRad / 2) * (this.camera.aspect || 1.6);
      const requiredReach = (separation * .5 + 2.3) / Math.max(.3, halfWidth * .9);
      // The same solve on the vertical axis: a level duel frames fine, but an airborne opponent used
      // to sit above the top edge of the shot because only the horizontal spread was solved for.
      const halfVertical = Math.tan(fovRad / 2);
      const requiredVerticalReach = (heightGap * .5 + 2.0) / Math.max(.2, halfVertical * .86);
      const back = THREE.MathUtils.clamp(
        Math.max(4.3 + separation * .12, requiredReach, requiredVerticalReach) * this.zoom * focusZoom, 4.3, 26);
      const lift = THREE.MathUtils.clamp(3.0 + separation * .05 + heightGap * .35, 3.0, 7.0) * this.zoom;
      // Over-the-shoulder, not dead-centre behind: on the exact duel axis P1's own body sat in front
      // of the CPU, which left the opponent visible only as a sliver beside his head. A lateral
      // offset along the duel's right vector opens that line while keeping the shot behind P1.
      const shoulder = 1.15 * this.zoom * focusZoom;
      const rx = -uz;
      const rz = ux;
      const anchorY = Math.max(0, a.position.y || 0);
      this.positionTarget.set(
        a.position.x - ux * back + rx * shoulder,
        anchorY + lift,
        a.position.z - uz * back + rz * shoulder
      );
      // Aim slightly to the same side, so P1 settles into the lower-left third of the frame and the
      // opponent reads clearly ahead instead of behind him.
      const side = shoulder * .45;
      const lookY = THREE.MathUtils.lerp(anchorY + 1.3, (b.position.y || 0) + 1.3, .6);
      this.lookTarget.set(
        a.position.x + dx * .62 + rx * side,
        Math.max(1.2, lookY),
        a.position.z + dz * .62 + rz * side
      );
    } else {
      const focusZoom = 1 - this._focusZoom();
      const height = THREE.MathUtils.clamp(this.baseHeight + spread * 7 + altitudeLift, this.minHeight, this.maxHeight) * this.zoom * focusZoom;
      const trailing = (this.baseTrailing + spread * 9) * this.zoom * focusZoom;
      this.positionTarget.set(midX, height, midZ + trailing);
      this.lookTarget.set(midX, Math.max(1.2, altitude * .78), midZ - 2.4);
    }

    // Keep the shot out of the scenery: shorten it to the first solid volume between the
    // fighters and the camera. Shortening is immediate so a wall never fills the frame;
    // lengthening eases back so the camera does not pump when passing a pillar.
    if (this.collisionBlocks && this.collisionBlocks.length) {
      const ox = this.lookTarget.x, oy = this.lookTarget.y, oz = this.lookTarget.z;
      const vx = this.positionTarget.x - ox, vy = this.positionTarget.y - oy, vz = this.positionTarget.z - oz;
      const length = Math.hypot(vx, vy, vz);
      if (length > .01) {
        const feet = Math.min(a.position.y || 0, b.position.y || 0);
        const hit = this.obstruction(ox, oy, oz, vx / length, vy / length, vz / length, length, feet);
        // A flat minimum reach used to win over a closer wall, which parked the camera
        // inside pillars and walls whenever a fighter was pressed into a corner. Keep the
        // shot's comfort floor, but never place it past the surface that blocked it.
        const allowed = hit == null ? length
          : Math.min(Math.max(hit - .9, 2.2), Math.max(.6, hit - .35));
        // Shorten instantly, and also snap when the shot has clearly opened up again (a
        // teleport, a spawn onto a raised deck); only gentle changes ease out.
        this.collisionReach = allowed < this.collisionReach || allowed > this.collisionReach * 1.8
          ? allowed
          : THREE.MathUtils.damp(this.collisionReach, allowed, 4, dt);
        const use = Math.min(length, this.collisionReach);
        // Free roam walks into 7 m stair wells, hut interiors and passages where a wall sits
        // right behind the fighter. Shortening the shot alone parked the lens inside the
        // fighter's head, so in explore mode the shot also lifts: the closer the wall, the
        // higher the camera, until it is looking down over the shoulder instead of into it.
        // The lift is probed upward so it never pushes the lens into a ceiling, and it is
        // eased, so entering and leaving a tight space does not snap. Combat modes keep the
        // old behaviour exactly.
        let liftTarget = 0;
        if (mode === 'explore' && hit != null) {
          liftTarget = THREE.MathUtils.clamp((4.2 - hit) * .95, 0, 3.4);
          if (liftTarget > .05) {
            const ceiling = this.obstruction(ox, oy, oz, 0, 1, 0, liftTarget + .6, feet);
            if (ceiling != null) liftTarget = Math.max(0, Math.min(liftTarget, ceiling - .4));
          }
        } else if (mode === 'over-p1' && hit != null) {
          // A wall directly behind P1 crushed the third-person shot to a few metres, which put the
          // opponent outside the frame. Rise over the obstruction instead of pushing through it,
          // and never lift into a ceiling.
          liftTarget = THREE.MathUtils.clamp((5.4 - hit) * .72, 0, 2.4);
          if (liftTarget > .05) {
            const ceiling = this.obstruction(ox, oy, oz, 0, 1, 0, liftTarget + .6, feet);
            if (ceiling != null) liftTarget = Math.max(0, Math.min(liftTarget, ceiling - .4));
          }
        }
        else if (mode === 'overhead' && hit != null && use < 5) {
          // A wall behind the fighters can crush the overhead shot to three metres even when the
          // pair is sixteen metres apart. Never render that close-up: rise over the obstruction
          // until the lens is at least 6.5 m from the duel centre, then stop at the ceiling. This
          // is the same geometry rescue explore and over-p1 use, with a minimum reach so a capped
          // shot cannot settle into the fighters' faces.
          const minReach = 6.5;
          const needed = Math.sqrt(Math.max(0, minReach * minReach - use * use));
          liftTarget = Math.min(needed + .2, 9.5);
          if (liftTarget > .05) {
            const ceiling = this.obstruction(ox, oy, oz, 0, 1, 0, liftTarget + .6, feet);
            if (ceiling != null) liftTarget = Math.max(0, Math.min(liftTarget, ceiling - .4));
          }
        }
        this.collisionLift = THREE.MathUtils.damp(this.collisionLift || 0, liftTarget, 3.4, dt);
        // A capped duel shot is a failure state, not a value to ease into: land the rescue lift
        // on this frame instead of letting the lens spend the next half-second in the wall.
        if (mode === 'overhead' && hit != null) this.collisionLift = liftTarget;
        if (use < length) {
          const lift = (mode === 'explore' || mode === 'over-p1' || mode === 'overhead') ? this.collisionLift : 0;
          this.positionTarget.set(ox + vx / length * use, oy + vy / length * use + lift, oz + vz / length * use);
          if (lift > .05) this.lookTarget.y = Math.max(1.1, this.lookTarget.y - lift * .18);
        }
        // Record a capped shot: with a wall directly behind it the camera cannot pull back
        // any further, so the lens has to open up instead (see the FOV step below).
        this.framing.capped = hit != null;
      }
    }

    // The third-person branch already applied the orbit offset to its own shot; applying it again
    // here with a midpoint anchor would swing the lens twice as far as the mouse moved.
    if (mode !== 'third-person' && (Math.abs(this.orbitYaw) > .001 || Math.abs(this.orbitPitch) > .001)) {
      const anchored = mode === 'overhead' || mode === 'over-p1' || mode === 'explore';
      const anchor = new THREE.Vector3(
        anchored ? (mode === 'overhead' ? midX : a.position.x) : midX,
        mode === 'overhead' ? Math.max(0, (a.position.y + b.position.y) * .5)
          : (mode === 'explore' ? a.position.y + 1.45 : (mode === 'over-p1' ? a.position.y : 0)),
        anchored ? (mode === 'overhead' ? midZ : a.position.z) : midZ
      );
      const offset = this.positionTarget.clone().sub(anchor);
      const length = Math.max(1, offset.length());
      const yaw = Math.atan2(offset.x, offset.z) + this.orbitYaw;
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(offset.y / length, -1, 1)) + this.orbitPitch, .12, .82);
      this.positionTarget.set(anchor.x + Math.sin(yaw) * length * Math.cos(pitch), anchor.y + length * Math.sin(pitch), anchor.z + Math.cos(yaw) * length * Math.cos(pitch));
    }

    if (this.pendingSnap) {
      this.pendingSnap = false;
      this.collisionReach = Infinity;
      this.camera.position.copy(this.positionTarget);
    } else {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.positionTarget.x, 3.8, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.positionTarget.y, 3.4, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.positionTarget.z, 3.4, dt);
    }
    // Both duel cameras verify the settled lens actually frames both fighters.
    if (mode === 'overhead' || mode === 'over-p1') this._enforceFraming(a, b);
    // A wall directly behind P1 can crush the third-person shot until neither correction fits, and
    // accepting that loses a fighter off screen. For those frames only, borrow the composed duel
    // shot (the same solver the overhead camera uses) so both fighters stay visible; the normal
    // behind-P1 framing resumes as soon as the shot is not capped.
    // `enforced == null` is the real signal: it means even the last-ditch pull-back could not fit
    // both fighters. The capped flag only says the collision reach was clipped, which a lifted
    // shot can survive - gating on it withheld the fallback in the palace alley, where the wall
    // clamps the lens but the shot still never fits.
    if (mode === 'over-p1' && this.framing.enforced == null) {
      const fallback = this._composedShot(a, b, dt);
      // Write the lens as well as the target: this frame's collision pass runs after the smoothing
      // step, so a target-only fallback was re-clamped straight back to the 4.88 m wall shot.
      this.positionTarget.set(fallback.x, fallback.y, fallback.z);
      this.lookTarget.set(fallback.lookX, fallback.lookY, fallback.lookZ);
      this.camera.position.set(fallback.x, fallback.y, fallback.z);
      this.camera.lookAt(this.lookTarget);
      this.framing.fallback = 'composed';
    } else {
      this.framing.fallback = null;
    }
    // A narrower lens keeps the duel large in frame; widening it past ~50 degrees was
    // the fastest way to shrink both fighters into specks while still "framing" them.
    // When scenery caps the shot, though, a wider lens is the only way to keep a fighter
    // that is already at the frame edge from falling out of it entirely.
    // Free roam is a walk-around lens: a narrower duel FOV turned a street into a close-up of
    // the fighter's back, so explore opens out to show the world they are walking through.
    let targetFov = mode === 'explore' ? 54 : mode === 'third-person' ? 48 + spread * 4 : 38 + spread * 12 + (this.zoom - 1) * 4;
    if (this.framing.capped) {
      const reach = Math.max(2, this.positionTarget.distanceTo(this.lookTarget));
      const halfSpan = distance * .5 + 1.8;
      const aspect = this.camera.aspect || 1.6;
      targetFov = Math.max(targetFov, THREE.MathUtils.radToDeg(2 * Math.atan(halfSpan / (reach * aspect))));
    }
    const nextFov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(targetFov, 40, 65), 2.5, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.015) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.shake = Math.max(0, this.shake - dt * 2.8);
    if (this.shake > 0) {
      const magnitude = this.shake * this.shake;
      this.camera.position.x += (Math.random() - .5) * magnitude;
      this.camera.position.y += (Math.random() - .5) * magnitude * .7;
    }
    this.camera.lookAt(this.lookTarget);
  }
}
