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
    this.zoom = 1.8;
    this.minZoom = 0.75;
    this.maxZoom = 3.2;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.shake = 0;
    this.shakeVector = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.positionTarget = new THREE.Vector3();
  }

  impact(amount = 0.35) { this.shake = Math.min(1.5, this.shake + amount); }

  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, this.minZoom, this.maxZoom); }

  orbit(dx, dy) {
    this.orbitYaw = THREE.MathUtils.clamp(this.orbitYaw + dx, -Math.PI * .82, Math.PI * .82);
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy, -.26, .34);
  }

  resetOrbit() { this.orbitYaw = 0; this.orbitPitch = 0; }

  update(a, b, dt, mode = 'classic') {
    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const spread = THREE.MathUtils.clamp(distance / 9, 0, 1);
    const altitude = Math.max(a.position.y || 0, b.position.y || 0);
    const altitudeLift = THREE.MathUtils.clamp(altitude * .72, 0, 34);
    const height = THREE.MathUtils.clamp(this.baseHeight + spread * 7 + altitudeLift, this.minHeight, this.maxHeight) * this.zoom;
    const trailing = (this.baseTrailing + spread * 9) * this.zoom;
    const forward = mode === 'over-p1';
    const targetX = forward ? a.position.x - a.facing * 5.0 : midX;
    const targetZ = forward ? a.position.z + 12.5 * this.zoom : midZ + trailing;
    const targetY = forward ? 7.5 + 4.2 * this.zoom + altitudeLift * .58 : height;
    this.positionTarget.set(targetX, targetY, targetZ);
    if (Math.abs(this.orbitYaw) > .001 || Math.abs(this.orbitPitch) > .001) {
      const anchor = new THREE.Vector3(forward ? a.position.x : midX, forward ? a.position.y : 0, forward ? a.position.z : midZ);
      const offset = this.positionTarget.clone().sub(anchor);
      const length = Math.max(1, offset.length());
      const yaw = Math.atan2(offset.x, offset.z) + this.orbitYaw;
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(offset.y / length, -1, 1)) + this.orbitPitch, .12, .82);
      this.positionTarget.set(anchor.x + Math.sin(yaw) * length * Math.cos(pitch), anchor.y + length * Math.sin(pitch), anchor.z + Math.cos(yaw) * length * Math.cos(pitch));
    }
    this.lookTarget.set(forward ? a.position.x * .42 + b.position.x * .58 : midX, forward ? Math.max(1.35,a.position.y*.35) : Math.max(1.2,altitude*.78), forward ? a.position.z * .72 + b.position.z * .28 - .5 : midZ - 2.4);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.positionTarget.x, 3.8, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.positionTarget.y, 3.4, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.positionTarget.z, 3.4, dt);
    const nextFov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(43 + spread * 15 + (this.zoom - 1) * 4, 42, 70), 2.5, dt);
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
