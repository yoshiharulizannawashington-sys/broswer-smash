// Elevated isometric-style camera with distance-aware framing and impact shake.
import * as THREE from 'three';

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
    // Solid volumes the camera must stay out of on large world stages (see setStageBounds).
    this.collisionBlocks = null;
    this.collisionReach = Infinity;
  }

  /**
   * Give the camera the stage's solid geometry so it cannot end up inside a wall, under a
   * floor slab or above an interior ceiling. Only blocks near the battle area are kept, and
   * only blocks tall enough to be in the camera's line are kept at all.
   */
  setStageBounds(bounds, blocks) {
    this.collisionReach = Infinity;
    if (!bounds || !Array.isArray(blocks) || !blocks.length) { this.collisionBlocks = null; return; }
    const pad = 55;
    this.collisionBlocks = blocks.filter(block => {
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
      if (!Number.isFinite(enter) || enter <= 0 || enter > maxT) continue;
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

  impact(amount = 0.35) { this.shake = Math.min(1.5, this.shake + amount); }

  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, this.minZoom, this.maxZoom); }

  orbit(dx, dy) {
    this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw + dx, -Math.PI * .82, Math.PI * .82);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy, -.26, .34);
  }

  resetOrbit() { this.orbitYaw = 0; this.orbitPitch = 0; }

  /**
   * Overhead mode: a high, steep, pulled-back view that keeps both fighters inside the
   * frame. The old elevated modes anchored on the player and always sat on +Z, so the
   * opponent could drift to the edge or behind the camera. This one anchors on the
   * midpoint of the duel and derives its distance from how far apart the fighters are
   * - including a launched fighter's height - so jumps and flight pull the camera out
   * instead of losing the target.
   */
  overheadFraming(a, b) {
    const midX = (a.position.x + b.position.x) * .5;
    const midZ = (a.position.z + b.position.z) * .5;
    const midY = Math.max(0, a.position.y + b.position.y) * .5;
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
    // On a large world stage a close duel still has to show the place it is happening in, so
    // the minimum distance grows with the stage instead of collapsing onto the pair.
    const stageFloor = 6.2 + (this.stageScale - 1) * 12;
    const reach = THREE.MathUtils.clamp(Math.max(baseReach, requiredReach * this.stageScale, stageFloor), stageFloor, 42) * this.zoom;
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
    this.framing.mode = mode;
    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const spread = THREE.MathUtils.clamp(distance / 9, 0, 1);
    const altitude = Math.max(a.position.y || 0, b.position.y || 0);
    const altitudeLift = THREE.MathUtils.clamp(altitude * .72, 0, 34);

    if (mode === 'overhead') {
      const shot = this.overheadFraming(a, b);
      this.positionTarget.set(shot.x, shot.y, shot.z);
      this.lookTarget.set(shot.lookX, shot.lookY, shot.lookZ);
    } else {
      const height = THREE.MathUtils.clamp(this.baseHeight + spread * 7 + altitudeLift, this.minHeight, this.maxHeight) * this.zoom;
      const trailing = (this.baseTrailing + spread * 9) * this.zoom;
      const forward = mode === 'over-p1';
      const targetX = forward ? a.position.x - a.facing * 5.0 : midX;
      const targetZ = forward ? a.position.z + 12.5 * this.zoom : midZ + trailing;
      const targetY = forward ? 7.5 + 4.2 * this.zoom + altitudeLift * .58 : height;
      this.positionTarget.set(targetX, targetY, targetZ);
      this.lookTarget.set(
        forward ? a.position.x * .42 + b.position.x * .58 : midX,
        forward ? Math.max(1.35, a.position.y * .35) : Math.max(1.2, altitude * .78),
        forward ? a.position.z * .72 + b.position.z * .28 - .5 : midZ - 2.4
      );
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
        if (use < length) {
          this.positionTarget.set(ox + vx / length * use, oy + vy / length * use, oz + vz / length * use);
        }
        // Record a capped shot: with a wall directly behind it the camera cannot pull back
        // any further, so the lens has to open up instead (see the FOV step below).
        this.framing.capped = hit != null;
      }
    }

    if (Math.abs(this.orbitYaw) > .001 || Math.abs(this.orbitPitch) > .001) {
      const anchor = new THREE.Vector3(
        mode === 'overhead' ? midX : (mode === 'over-p1' ? a.position.x : midX),
        mode === 'overhead' ? Math.max(0, (a.position.y + b.position.y) * .5) : (mode === 'over-p1' ? a.position.y : 0),
        mode === 'overhead' ? midZ : (mode === 'over-p1' ? a.position.z : midZ)
      );
      const offset = this.positionTarget.clone().sub(anchor);
      const length = Math.max(1, offset.length());
      const yaw = Math.atan2(offset.x, offset.z) + this.orbitYaw;
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(offset.y / length, -1, 1)) + this.orbitPitch, .12, .82);
      this.positionTarget.set(anchor.x + Math.sin(yaw) * length * Math.cos(pitch), anchor.y + length * Math.sin(pitch), anchor.z + Math.cos(yaw) * length * Math.cos(pitch));
    }

    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.positionTarget.x, 3.8, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.positionTarget.y, 3.4, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.positionTarget.z, 3.4, dt);
    // A narrower lens keeps the duel large in frame; widening it past ~50 degrees was
    // the fastest way to shrink both fighters into specks while still "framing" them.
    // When scenery caps the shot, though, a wider lens is the only way to keep a fighter
    // that is already at the frame edge from falling out of it entirely.
    let targetFov = 38 + spread * 12 + (this.zoom - 1) * 4;
    if (this.framing.capped) {
      const reach = Math.max(2, this.positionTarget.distanceTo(this.lookTarget));
      const halfSpan = distance * .5 + 1.8;
      const aspect = this.camera.aspect || 1.6;
      targetFov = Math.max(targetFov, THREE.MathUtils.radToDeg(2 * Math.atan(halfSpan / (reach * aspect))));
    }
    const nextFov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(targetFov, 37, 64), 2.5, dt);
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
