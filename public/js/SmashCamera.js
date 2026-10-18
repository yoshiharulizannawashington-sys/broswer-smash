// Elevated isometric-style camera with distance-aware framing and impact shake.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

export default class SmashCamera {
  constructor(camera, { height = 12, trailing = 18, minHeight = 10, maxHeight = 22 } = {}) {
    this.camera = camera;
    this.baseHeight = height;
    this.baseTrailing = trailing;
    this.minHeight = minHeight;
    this.maxHeight = maxHeight;
    // Start wider than the old close-up framing; mouse wheel can zoom between 0.7x and 3.2x.
    this.zoom = 2.6;
    this.minZoom = 0.7;
    this.maxZoom = 5.0;
    this.shake = 0;
    this.shakeVector = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.positionTarget = new THREE.Vector3();
  }

  impact(amount = 0.35) { this.shake = Math.min(1.5, this.shake + amount); }

  setZoom(value) { this.zoom = THREE.MathUtils.clamp(value, this.minZoom, this.maxZoom); }

  update(a, b, dt, mode = 'classic') {
    const midX = (a.position.x + b.position.x) * 0.5;
    const midZ = (a.position.z + b.position.z) * 0.5;
    const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    const spread = THREE.MathUtils.clamp(distance / 9, 0, 1);
    const height = THREE.MathUtils.clamp(this.baseHeight + spread * 7, this.minHeight, this.maxHeight) * this.zoom;
    const trailing = (this.baseTrailing + spread * 9) * this.zoom;
    const forward = mode === 'over-p1';
    const targetX = forward ? a.position.x - a.facing * 3.6 : midX;
    const targetZ = forward ? a.position.z + 28 * this.zoom : midZ + trailing;
    const targetY = forward ? 9.2 * this.zoom : height;
    this.positionTarget.set(targetX, targetY, targetZ);
    this.lookTarget.set(forward ? a.position.x * .65 + b.position.x * .35 : midX, 1.2, midZ - 2.4);
    this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.positionTarget.x, 3.8, dt);
    this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.positionTarget.y, 3.4, dt);
    this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.positionTarget.z, 3.4, dt);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, THREE.MathUtils.clamp(42 + spread * 19 + (this.zoom - 1) * 7, 40, 78), 2.5, dt);
    this.camera.updateProjectionMatrix();
    this.shake = Math.max(0, this.shake - dt * 2.8);
    if (this.shake > 0) {
      const magnitude = this.shake * this.shake;
      this.camera.position.x += (Math.random() - .5) * magnitude;
      this.camera.position.y += (Math.random() - .5) * magnitude * .7;
    }
    this.camera.lookAt(this.lookTarget);
  }
}
