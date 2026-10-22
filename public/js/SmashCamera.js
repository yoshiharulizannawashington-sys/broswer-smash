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
  }

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
    const reach = THREE.MathUtils.clamp(4.8 + separation * .3 + heightGap * .4 + midY * .22, 6.2, 22) * this.zoom;
    // Look down steeply enough to read as an overhead fighting camera, but not so steeply
    // that a standing fighter is foreshortened into a stub.
    const elevation = THREE.MathUtils.clamp(.8 - spread * .1, .62, .8);
    const horizontal = reach * Math.sqrt(Math.max(0, 1 - elevation * elevation));
    this.framing.distance = reach;
    this.framing.angle = elevation;
    return {
      x: midX,
      y: Math.max(2.4, midY * .55) + reach * elevation,
      z: midZ + horizontal,
      lookX: midX,
      lookY: Math.max(1.1, midY * .72),
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
    const nextFov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(38 + spread * 12 + (this.zoom - 1) * 4, 37, 58), 2.5, dt);
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
