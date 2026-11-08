// Reusable environmental destruction.
//
// Destruction in this game is state, not decoration: every breakable owns a collider that lives in
// the same list the arena collision code reads. Breaking it splices that collider out, so a crate
// you smash really stops blocking movement, drops a pickup, and leaves debris and an impact mark
// behind. A prop that only puffed particles and kept blocking would be a lie this module exists to
// prevent.
//
// States: intact -> cracked (still solid, visibly damaged) -> broken (collider removed).
// Damage after broken is ignored, so a hit that lands twice cannot double-drop or double-spawn.

export function createDestruction(THREE, scene, options = {}) {
  const {
    colliders = [],
    onDrop = null,
    onBreak = null,
    maxMarks = 48,
    maxDebris = 60
  } = options;

  const props = [];
  const debris = [];
  const marks = [];
  /** Debris and mark meshes are reused from these free lists instead of allocated per hit. */
  const debrisPool = [];
  const markPool = [];

  const debrisGeometry = new THREE.BoxGeometry(0.16, 0.16, 0.16);
  const markGeometry = new THREE.PlaneGeometry(0.5, 0.5);

  function makeMaterial(color, opacity = 1) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.1,
      transparent: opacity < 1,
      opacity
    });
    return material;
  }

  function acquireDebrisMesh() {
    const mesh = debrisPool.pop() || new THREE.Mesh(debrisGeometry, makeMaterial(0xa08b6a));
    mesh.visible = true;
    return mesh;
  }

  function acquireMarkMesh() {
    const mesh = markPool.pop() || new THREE.Mesh(markGeometry, makeMaterial(0x1b1a18, 0.85));
    mesh.visible = true;
    return mesh;
  }

  /**
   * Add a breakable. The returned handle is what the game damages; the mesh is only its body.
   * `bounds` is a plain box so it can be read by collision code that knows nothing about Three.
   */
  function addProp({ x = 0, z = 0, y = 0, w = 1, h = 1, d = 1, hp = 40, kind = 'crate', color = 0x9c7a4e, drops = null } = {}) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMaterial(color));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    scene.add(group);

    // Same shape the arena layout uses ({x0,x1,z0,z1,top,bottom}), so these colliders can be
    // pushed into layout.blocks and are then honoured by solidAt/resolveCollision/solidBetween
    // with no changes to the collision code.
    const collider = {
      kind: 'breakable',
      x0: x - w / 2, x1: x + w / 2,
      z0: z - d / 2, z1: z + d / 2,
      bottom: y, top: y + h,
      owner: null
    };

    const prop = {
      id: `prop-${props.length + 1}`,
      kind,
      group,
      body,
      collider,
      state: 'intact',
      hp,
      maxHp: hp,
      drops,
      position: { x, y, z },
      size: { w, h, d }
    };
    collider.owner = prop;
    colliders.push(collider);
    props.push(prop);
    return prop;
  }

  function spawnDebris(prop, hitPoint) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      if (debris.length >= maxDebris) {
        const oldest = debris.shift();
        oldest.mesh.visible = false;
        debrisPool.push(oldest.mesh);
      }
      const mesh = acquireDebrisMesh();
      mesh.material.color?.setHex?.(0x6f5a3e);
      mesh.position.set(
        prop.position.x + (Math.random() - 0.5) * prop.size.w,
        prop.position.y + prop.size.h * (0.35 + Math.random() * 0.5),
        prop.position.z + (Math.random() - 0.5) * prop.size.d
      );
      mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      scene.add(mesh);
      debris.push({
        mesh,
        velocity: {
          x: (Math.random() - 0.5) * 5 + (hitPoint ? (prop.position.x - hitPoint.x) * 0.8 : 0),
          y: 2 + Math.random() * 4,
          z: (Math.random() - 0.5) * 5 + (hitPoint ? (prop.position.z - hitPoint.z) * 0.8 : 0)
        },
        spin: (Math.random() - 0.5) * 9,
        age: 0,
        life: 1.6 + Math.random() * 0.8
      });
    }
  }

  /** A scorch/crack mark on a surface, pooled: past the cap the oldest mark is reused. */
  function markImpact(position, normal = { x: 0, y: 0, z: 1 }, size = 1) {
    let entry;
    if (marks.length >= maxMarks) {
      // Reuse the oldest mark, and put it back in the live list: shifting without pushing made
      // the cap shrink by one on every reuse, so marks quietly disappeared.
      entry = marks.shift();
      marks.push(entry);
    } else {
      const mesh = acquireMarkMesh();
      scene.add(mesh);
      entry = { mesh, age: 0, life: 9 };
      marks.push(entry);
    }
    const { mesh } = entry;
    mesh.visible = true;
    mesh.position.set(position.x, position.y, position.z);
    mesh.lookAt(position.x + normal.x, position.y + normal.y, position.z + normal.z);
    mesh.scale.setScalar(Math.max(0.3, size));
    mesh.material.opacity = 0.85;
    entry.age = 0;
    return entry;
  }

  function crack(prop) {
    prop.state = 'cracked';
    // The visible change is a real material change, not a particle: the body darkens and
    // desaturates so "damaged" can be read without a HUD.
    prop.body.material.color?.setHex?.(0x6f5a3e);
    prop.body.material.roughness = 0.98;
    prop.body.scale.set(0.98, 0.94, 0.98);
  }

  function breakProp(prop, hitPoint) {
    if (prop.state === 'broken') return false;
    prop.state = 'broken';
    prop.group.visible = false;
    scene.remove(prop.group);
    // The collider leaves the shared list: collision actually changes from this instant.
    const index = colliders.indexOf(prop.collider);
    if (index >= 0) colliders.splice(index, 1);
    spawnDebris(prop, hitPoint);
    if (hitPoint) markImpact(hitPoint, { x: 0, y: 0, z: 1 }, 1.2);
    if (prop.drops && typeof onDrop === 'function') onDrop(prop.drops, prop);
    if (typeof onBreak === 'function') onBreak(prop);
    return true;
  }

  /**
   * Apply damage. Returns 'broken' | 'cracked' | 'intact' | 'ignored' so callers can react (sound,
   * camera, score) without duplicating the state machine.
   */
  function damage(prop, amount, hitPoint = null) {
    if (!prop || prop.state === 'broken') return 'ignored';
    const dealt = Math.max(0, Number(amount) || 0);
    if (dealt <= 0) return 'ignored';
    prop.hp -= dealt;
    if (prop.hp <= 0) {
      breakProp(prop, hitPoint);
      return 'broken';
    }
    if (prop.state === 'intact' && prop.hp <= prop.maxHp * 0.5) {
      crack(prop);
      return 'cracked';
    }
    return 'intact';
  }

  /** Does any intact or cracked prop occupy this point? Mirrors the arena collision contract. */
  function solidAt(x, y, z) {
    for (const prop of props) {
      if (prop.state === 'broken') continue;
      const c = prop.collider;
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && y >= c.bottom && y <= c.top) return prop;
    }
    return null;
  }

  /** Damage the first prop a moving projectile passes through. Used for shots, not melee. */
  function damageSegment(from, to, amount = 12, hitPoint = null, samples = 6) {
    if (!from || !to) return null;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const z = from.z + (to.z - from.z) * t;
      const prop = solidAt(x, y, z);
      if (!prop) continue;
      const result = damage(prop, amount, hitPoint || { x, y, z });
      return { prop, result };
    }
    return null;
  }

  function update(dt) {
    const step = Math.min(0.05, Math.max(0, dt));
    for (let i = debris.length - 1; i >= 0; i--) {
      const piece = debris[i];
      piece.age += step;
      piece.velocity.y -= 16 * step;
      piece.mesh.position.x += piece.velocity.x * step;
      piece.mesh.position.y += piece.velocity.y * step;
      piece.mesh.position.z += piece.velocity.z * step;
      piece.mesh.rotation.x += piece.spin * step;
      piece.mesh.rotation.z += piece.spin * 0.7 * step;
      if (piece.mesh.position.y < 0.05) {
        piece.mesh.position.y = 0.05;
        piece.velocity.y = Math.abs(piece.velocity.y) * 0.35;
        piece.velocity.x *= 0.7;
        piece.velocity.z *= 0.7;
      }
      if (piece.age >= piece.life) {
        piece.mesh.visible = false;
        debrisPool.push(piece.mesh);
        debris.splice(i, 1);
      }
    }
    for (const mark of marks) {
      mark.age += step;
      if (mark.age > mark.life - 2) mark.mesh.material.opacity = Math.max(0, (mark.life - mark.age) / 2 * 0.85);
    }
  }

  function clear() {
    for (const prop of props) {
      scene.remove(prop.group);
      const index = colliders.indexOf(prop.collider);
      if (index >= 0) colliders.splice(index, 1);
    }
    props.length = 0;
    for (const piece of debris) {
      piece.mesh.visible = false;
      debrisPool.push(piece.mesh);
    }
    debris.length = 0;
    for (const mark of marks) {
      mark.mesh.visible = false;
      markPool.push(mark.mesh);
    }
    marks.length = 0;
  }

  // Debris and marks must animate even though the game's render loop belongs to main.js. One
  // frame loop per manager, stopped by stop() when an arena is replaced.
  let frame = 0;
  let last = 0;
  function tick(now) {
    frame = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    update(dt);
  }
  if (typeof requestAnimationFrame === 'function' && options.autoUpdate !== false) {
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  return {
    addProp, damage, damageSegment, breakProp, markImpact, solidAt, update, clear, stop,
    props,
    get debrisCount() { return debris.length; },
    get markCount() { return marks.length; },
    get pooledDebris() { return debrisPool.length; },
    get activeColliders() { return colliders.filter(c => c.kind === 'breakable').length; }
  };
}
