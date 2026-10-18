// Camera-relative movement vector utility. Fighter simulation remains in fighter3D.js.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

export default class CharacterController {
  static movementVector(inputs, cameraYaw = 0) {
    const x = (inputs.right ? 1 : 0) - (inputs.left ? 1 : 0);
    const z = (inputs.down ? 1 : 0) - (inputs.up ? 1 : 0);
    const vector = new THREE.Vector3(x, 0, z);
    if (vector.lengthSq() > 1) vector.normalize();
    return vector.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
  }
}
