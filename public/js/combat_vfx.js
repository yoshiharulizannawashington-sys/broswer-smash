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
  /**
   * One impact, graded by what produced it. The table exists because a single shared formula gave
   * every hit the same treatment: a 23-intensity explosion and a jab both built their flash from
   * `intensity * .012` and then scaled it by up to 4.2x, which produced a ~2 m additive sphere at
   * .98 opacity sitting on the fighter - the white puff in gameplay captures. The numbers here are
   * deliberately small: the flash is now a spark of light at the point of contact, and the energy
   * of the hit is carried by the sparks, the rings and the camera instead.
   */
  const GRADES = {
    light: { flash: .10, flashMax: .20, opacity: .34, growth: 1.25, rings: 2, ringEnd: 1.5, tube: .022, sparks: 12, sparkSpark: 9, length: .2, life: .28, ground: false },
    heavy: { flash: .14, flashMax: .30, opacity: .42, growth: 1.55, rings: 3, ringEnd: 1.9, tube: .028, sparks: 18, sparkSpark: 12, length: .42, life: .4, ground: true },
    guard: { flash: .09, flashMax: .16, opacity: .3, growth: 1.1, rings: 2, ringEnd: 1.2, tube: .018, sparks: 8, sparkSpark: 6, length: .16, life: .2, ground: false },
    ultimate: { flash: .16, flashMax: .34, opacity: .44, growth: 1.7, rings: 3, ringEnd: 2.2, tube: .03, sparks: 22, sparkSpark: 13, length: .5, life: .46, ground: true }
  };
  function grade(options, intensity, guarded, heavy) {
    const kind = String(options.kind || '');
    if (guarded) return GRADES.guard;
    if (kind === 'ultimate' || kind === 'beam' || kind === 'shockwave' || kind === 'lightning' || kind === 'fireball' || intensity >= 23) return GRADES.ultimate;
    return heavy ? GRADES.heavy : GRADES.light;
  }
  function impact(position, options = {}) {
    const color = options.color ?? 0xffd18a;
    const intensity = Math.max(1, Number(options.intensity) || 8);
    const guarded = options.guarded || options.kind === 'guard';
    const heavy = intensity >= 15 || ['heavy', 'shockwave', 'beam', 'lightning', 'fireball', 'land'].includes(options.kind);
    const spec = grade(options, intensity, guarded, heavy);
    const life = spec.life;
    const group = new THREE.Group();
    // A capped spark rather than a growing ball: `flashMax` is the hard ceiling on its radius, so
    // no intensity can produce an effect bigger than a fighter's torso.
    const flashRadius = Math.min(spec.flashMax, spec.flash + intensity * .004);
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(flashRadius, 8, 6),
      makeBasic(guarded ? 0xa8caff : 0xfff6d6, spec.opacity)
    );
    flash.position.copy(position);
    group.add(flash);
    const rings = [];
    for (let i = 0; i < spec.rings; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(.44 + i * .18, i === 0 ? spec.tube : spec.tube * .6, 6, 28),
        makeBasic(i === 1 ? color : (guarded ? 0x83bfff : color), (guarded ? .5 : .62) - i * .1)
      );
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = (Math.random() - .5) * .8;
      ring.scale.setScalar(.28 + i * .06);
      group.add(ring);
      rings.push({ mesh: ring, start: .28 + i * .06, end: spec.ringEnd + i * .3 });
    }
    const sparks = [];
    for (let i = 0; i < spec.sparks; i++) {
      const velocity = new THREE.Vector3(
        (Math.random() - .5) * spec.sparkSpark,
        Math.random() * spec.sparkSpark * .9 + 1.2,
        (Math.random() - .5) * spec.sparkSpark
      );
      const length = .09 + Math.random() * spec.length;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(.012 + Math.random() * .012, .014, length),
        makeBasic(i % 4 === 0 ? 0xfff4c4 : (guarded ? 0x91caff : color), guarded ? .6 : .78)
      );
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(forward, velocity.clone().normalize());
      group.add(mesh);
      sparks.push({ mesh, velocity, spin: (Math.random() - .5) * 8, length });
    }
    let groundRing = null;
    if (spec.ground) {
      groundRing = new THREE.Mesh(
        new THREE.TorusGeometry(.72, .042, 8, 48),
        makeBasic(color, .5)
      );
      groundRing.position.set(position.x, Math.max(.045, position.y - .82), position.z);
      groundRing.rotation.x = Math.PI / 2;
      group.add(groundRing);
    }
    return addEffect(group, life, { flash, rings, sparks, groundRing, heavy, spec });
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
        // Growth is per grade and no longer multiplies a radius that already grew with intensity.
        const growth = effect.spec?.growth ?? 1.6;
        effect.flash.scale.setScalar(1 + t * growth);
        effect.flash.material.opacity = Math.max(0, (effect.spec?.opacity ?? .4) * 1.6 * (1 - t * 1.5));
      }
      if (effect.groundRing) {
        effect.groundRing.scale.setScalar(.25 + t * 2.6);
        effect.groundRing.material.opacity = .5 * (1 - t);
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
  return {
    impact, dash, launch, landing, update, dispose,
    get activeCount() { return active.length; },
    // Read-only view for the visual gallery, which measures how large a live effect is on screen
    // relative to the fighter it is covering. Nothing in the game reads this.
    get activeEffects() { return active; }
  };
}
