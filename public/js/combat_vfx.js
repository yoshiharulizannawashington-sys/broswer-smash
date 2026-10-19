// Combat VFX for Browser Bros: additive hit flashes, directional sparks, dash streaks and landing rings.
export default function createCombatVFX(THREE, scene) {
  const active = [];
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, 1);
  const makeBasic = (color, opacity = 1) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false
  });
  const disposeEffect = effect => {
    scene.remove(effect.group);
    effect.group.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) material.dispose();
      }
    });
  };
  function addEffect(group, life, data = {}) {
    scene.add(group);
    const effect = { group, age: 0, life, ...data };
    active.push(effect);
    return effect;
  }
  function impact(position, options = {}) {
    const color = options.color ?? 0xffd18a;
    const intensity = Math.max(1, Number(options.intensity) || 8);
    const guarded = options.guarded || options.kind === 'guard';
    const heavy = intensity >= 15 || ['heavy', 'shockwave', 'beam', 'lightning', 'fireball', 'land'].includes(options.kind);
    const life = guarded ? .2 : heavy ? .46 : .32;
    const group = new THREE.Group();
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(.18 + Math.min(.3, intensity * .012), 8, 6),
      makeBasic(guarded ? 0xa8caff : 0xfff6d6, .98)
    );
    flash.position.copy(position);
    group.add(flash);
    const rings = [];
    for (let i = 0; i < (heavy ? 3 : 2); i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(.44 + i * .18, i === 0 ? .045 : .022, 6, 28),
        makeBasic(i === 1 ? color : (guarded ? 0x83bfff : color), .95 - i * .12)
      );
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = (Math.random() - .5) * .8;
      ring.scale.setScalar(.28 + i * .06);
      group.add(ring);
      rings.push({ mesh: ring, start: .28 + i * .06, end: (heavy ? 2.8 : 1.9) + i * .38 });
    }
    const sparks = [];
    const count = guarded ? 8 : Math.round(12 + Math.min(22, intensity * 1.05) + (heavy ? 8 : 0));
    for (let i = 0; i < count; i++) {
      const velocity = new THREE.Vector3(
        (Math.random() - .5) * (heavy ? 13 : 9),
        Math.random() * (heavy ? 11 : 7) + 1.2,
        (Math.random() - .5) * (heavy ? 13 : 9)
      );
      const length = .13 + Math.random() * (heavy ? .48 : .3);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(.018 + Math.random() * .018, .018, length),
        makeBasic(i % 4 === 0 ? 0xfff4c4 : (guarded ? 0x91caff : color), .98)
      );
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(forward, velocity.clone().normalize());
      group.add(mesh);
      sparks.push({ mesh, velocity, spin: (Math.random() - .5) * 8, length });
    }
    let groundRing = null;
    if (heavy) {
      groundRing = new THREE.Mesh(
        new THREE.TorusGeometry(.72, .065, 8, 48),
        makeBasic(color, .8)
      );
      groundRing.position.set(position.x, Math.max(.045, position.y - .82), position.z);
      groundRing.rotation.x = Math.PI / 2;
      group.add(groundRing);
    }
    return addEffect(group, life, { flash, rings, sparks, groundRing, heavy });
  }
  function dash(position, direction, color = 0x7deaff) {
    const dir = direction?.clone?.() || new THREE.Vector3(1, 0, 0);
    dir.y = 0;
    if (dir.lengthSq() < .001) dir.set(1, 0, 0);
    dir.normalize();
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((i - 1) * (.18 + Math.random() * .12));
      const start = position.clone().add(new THREE.Vector3(0, .48 + i * .36, 0)).add(side);
      const end = start.clone().addScaledVector(dir, -(.7 + Math.random() * 1.1));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        makeBasic(i === 1 ? 0xffffff : color, .8 - i * .12)
      );
      group.add(line);
    }
    return addEffect(group, .19, { dash: true, direction: dir });
  }
  function launch(position, color = 0x58dfff, kind = 'energy') {
    impact(position, { color, intensity: kind === 'beam' ? 15 : 8, kind });
    const group = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(.2 + i * .14, .025 + i * .008, 6, 24),
        makeBasic(i ? color : 0xffffff, .92)
      );
      mesh.position.copy(position);
      mesh.rotation.y = Math.PI / 2;
      mesh.scale.setScalar(.4);
      group.add(mesh);
    }
    return addEffect(group, .24, { launchRings: group.children });
  }
  function landing(position, color = 0xffc978) {
    const p = position.clone();
    p.y = Math.max(.06, p.y + .04);
    return impact(p, { color, intensity: 12, kind: 'land' });
  }
  function update(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const effect = active[i];
      effect.age += dt;
      const t = Math.min(1, effect.age / effect.life);
      for (const spark of effect.sparks || []) {
        spark.velocity.y -= (effect.heavy ? 12 : 8.5) * dt;
        spark.mesh.position.addScaledVector(spark.velocity, dt);
        spark.mesh.rotation.z += spark.spin * dt;
        spark.mesh.scale.z = Math.max(.02, spark.length * (1 - t));
        spark.mesh.material.opacity = Math.max(0, 1 - t);
      }
      for (const ring of effect.rings || []) {
        const k = t * t;
        ring.mesh.scale.setScalar(ring.start + (ring.end - ring.start) * k);
        ring.mesh.material.opacity = .92 * (1 - t);
      }
      if (effect.flash) {
        effect.flash.scale.setScalar(1 + t * (effect.heavy ? 3.2 : 1.8));
        effect.flash.material.opacity = Math.max(0, .95 * (1 - t * 1.7));
      }
      if (effect.groundRing) {
        effect.groundRing.scale.setScalar(.25 + t * 3.6);
        effect.groundRing.material.opacity = .8 * (1 - t);
      }
      if (effect.launchRings) {
        for (const ring of effect.launchRings) {
          ring.scale.setScalar(.4 + t * 1.8);
          ring.rotation.x += dt * 4;
          ring.rotation.z += dt * 3;
          ring.material.opacity = .9 * (1 - t);
        }
      }
      if (effect.dash) {
        for (const line of effect.group.children) {
          line.position.addScaledVector(effect.direction, dt * 3);
          line.material.opacity = .82 * (1 - t);
        }
      }
      if (t >= 1) {
        disposeEffect(effect);
        active.splice(i, 1);
      }
    }
  }
  function dispose() {
    for (const effect of active) disposeEffect(effect);
    active.length = 0;
  }
  return { impact, dash, launch, landing, update, dispose, get activeCount() { return active.length; } };
}
