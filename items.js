import * as THREE from 'three';

export class ItemManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.items = [];
    this.gravity = options.gravity ?? 18; // world units / second squared
    this.pickupRadius = options.pickupRadius ?? 1.8;
    this.floorY = options.floorY ?? 0;
    this.nextSpawnId = 1;
  }

  spawnItem(type = 'capsule', position = null) {
    const group = new THREE.Group();
    let geometry;
    let material;
    switch (type) {
      case 'smash_ball':
        geometry = new THREE.SphereGeometry(0.6, 24, 16);
        material = new THREE.MeshStandardMaterial({
          color: 0xff42e8, emissive: 0xb000a6, emissiveIntensity: 1.6,
          roughness: 0.15, metalness: 0.2
        });
        break;
      case 'food':
        geometry = new THREE.SphereGeometry(0.35, 16, 12);
        material = new THREE.MeshStandardMaterial({ color: 0x51ed6b, roughness: 0.45 });
        break;
      default:
        geometry = new THREE.CapsuleGeometry(0.24, 0.48, 4, 12);
        material = new THREE.MeshStandardMaterial({
          color: 0xeaf4ff, metalness: 0.72, roughness: 0.22
        });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const spawnPos = position?.isVector3
      ? position.clone()
      : new THREE.Vector3(
          position?.x ?? (Math.random() - 0.5) * 20,
          position?.y ?? 12,
          position?.z ?? (Math.random() - 0.5) * 12
        );
    group.position.copy(spawnPos);

    const item = {
      id: `item_${this.nextSpawnId++}`,
      type,
      mesh: group,
      velocity: new THREE.Vector3(),
      isGrounded: false,
      isHeld: false,
      holder: null
    };
    this.scene.add(group);
    this.items.push(item);
    return item;
  }

  update(fighters, deltaSeconds = 1 / 60, stageRadius = 30) {
    const dt = Math.min(Math.max(deltaSeconds || 0, 0), 1 / 20);

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];

      if (item.isHeld && item.holder?.model) {
        const handOffset = new THREE.Vector3(0.65, 1.2, 0.35)
          .applyQuaternion(item.holder.model.quaternion);
        item.mesh.position.copy(item.holder.model.position).add(handOffset);
        continue;
      }

      if (!item.isGrounded) {
        item.velocity.y -= this.gravity * dt;
        item.mesh.position.addScaledVector(item.velocity, dt);
        if (item.mesh.position.y <= this.floorY + 0.4) {
          item.mesh.position.y = this.floorY + 0.4;
          item.velocity.set(0, 0, 0);
          item.isGrounded = true;
        }
      } else {
        item.mesh.rotation.y += dt * 0.8;
      }

      const maxRadius = Math.max(1, stageRadius - 1);
      const flatDistance = Math.hypot(item.mesh.position.x, item.mesh.position.z);
      if (flatDistance > maxRadius) {
        const s = maxRadius / flatDistance;
        item.mesh.position.x *= s;
        item.mesh.position.z *= s;
        item.velocity.x *= -0.35;
        item.velocity.z *= -0.35;
      }

      for (const fighter of fighters) {
        if (item.isHeld || !fighter?.model || fighter.isKO) continue;
        if (item.mesh.position.distanceTo(fighter.model.position) < this.pickupRadius) {
          this.onFighterInteract(fighter, item);
          break;
        }
      }
    }
  }

  onFighterInteract(fighter, item) {
    if (item.type === 'food') {
      fighter.percent = Math.max(0, (fighter.percent ?? 0) - 20);
      if (fighter.combatState?.health != null) {
        fighter.combatState.health = Math.min(
          fighter.combatState.maxHealth,
          fighter.combatState.health + 15
        );
      }
      this.removeItem(item);
      return;
    }

    if (item.type === 'smash_ball') {
      fighter.hasFinalSmash = true;
    }
    item.isHeld = true;
    item.holder = fighter;
    fighter.heldItem = item;
  }

  throwItem(item, direction, speed = 12) {
    if (!item) return;
    const dir = direction?.clone?.() ?? new THREE.Vector3(0, 0, 1);
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    dir.normalize();
    item.isHeld = false;
    item.holder = null;
    item.isGrounded = false;
    item.velocity.copy(dir).multiplyScalar(speed);
    item.velocity.y += 4;
  }

  removeItem(item) {
    this.scene.remove(item.mesh);
    item.mesh.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
    const index = this.items.indexOf(item);
    if (index !== -1) this.items.splice(index, 1);
  }

  dispose() {
    [...this.items].forEach((item) => this.removeItem(item));
  }
}
