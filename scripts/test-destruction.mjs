// Destruction test: a broken prop must change the gameplay state it participates in, not just
// look different. This drives the real module against a minimal Three stub and asserts the
// collider list, the drop callback and the debris/mark pools.
//
//   node scripts/test-destruction.mjs
import assert from 'node:assert/strict';
import { createDestruction } from '../public/js/world/destruction.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- Minimal Three stub -------------------------------------------------
const vec = (x = 0, y = 0, z = 0) => ({
  x, y, z,
  set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
  setScalar(v) { this.x = this.y = this.z = v; return this; }
});
class StubMesh {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.position = vec();
    this.scale = vec(1, 1, 1);
    this.rotation = vec();
    this.visible = true;
    this.children = [];
    this.parent = null;
  }
  add(child) { child.parent = this; this.children.push(child); }
  remove(child) { this.children = this.children.filter(c => c !== child); }
  lookAt() {}
  traverse(fn) { fn(this); this.children.forEach(c => c.traverse?.(fn)); }
}
class StubGroup extends StubMesh {
  constructor() { super(null, null); }
}
const THREE = {
  Group: StubGroup,
  Mesh: StubMesh,
  BoxGeometry: class { constructor(w, h, d) { this.w = w; this.h = h; this.d = d; } },
  PlaneGeometry: class { constructor(w, h) { this.w = w; this.h = h; } },
  MeshStandardMaterial: class {
    constructor(opts = {}) {
      this.color = { hex: opts.color ?? 0xffffff, setHex(v) { this.hex = v; } };
      this.roughness = opts.roughness ?? 1;
      this.metalness = opts.metalness ?? 0;
      this.transparent = Boolean(opts.transparent);
      this.opacity = opts.opacity ?? 1;
    }
  }
};
const scene = {
  children: [],
  add(object) { if (!this.children.includes(object)) this.children.push(object); },
  remove(object) { this.children = this.children.filter(c => c !== object); }
};

// ---- The collider list the arena collision code would read ---------------
const colliders = [];
const drops = [];
const breaks = [];
const destruction = createDestruction(THREE, scene, {
  colliders,
  onDrop: (dropsFromProp, prop) => drops.push({ drops: dropsFromProp, prop: prop.id }),
  onBreak: prop => breaks.push(prop.id)
});

const crate = destruction.addProp({ x: 2, z: -1, w: 1, h: 1.2, d: 1, hp: 40, drops: 'health' });
check('a prop registers one collider', colliders.length === 1 && destruction.activeColliders === 1);
check('the prop is solid where it stands', destruction.solidAt(2, 0.4, -1) === crate);
check('the prop is not solid outside its box', destruction.solidAt(9, 0.4, 9) === null);
check('the prop starts intact', crate.state === 'intact' && crate.hp === 40);

// ---- Damage states ------------------------------------------------------
check('light damage leaves it intact', destruction.damage(crate, 10) === 'intact');
check('hp drops by the damage dealt', crate.hp === 30);
check('crossing half health cracks it', destruction.damage(crate, 10) === 'cracked' && crate.state === 'cracked');
check('a cracked prop still blocks', colliders.length === 1 && destruction.solidAt(2, 0.4, -1) === crate);
check('cracking changes the material, not just a particle', crate.body.material.color.hex === 0x6f5a3e);

// ---- Breaking changes the gameplay state --------------------------------
const state = destruction.damage(crate, 30, { x: 1.6, y: 0.9, z: -1 });
check('lethal damage breaks the prop', state === 'broken' && crate.state === 'broken');
check('the broken prop removes its collider', colliders.length === 0 && destruction.activeColliders === 0);
check('the broken prop is no longer solid', destruction.solidAt(2, 0.4, -1) === null);
check('the broken prop leaves the scene', scene.children.includes(crate.group) === false);
check('breaking spawns real debris', destruction.debrisCount === 8, `${destruction.debrisCount} pieces`);
check('breaking drops the configured item exactly once', drops.length === 1 && drops[0].drops === 'health');
check('breaking fires the break hook once', breaks.length === 1);
check('damage after breaking is ignored', destruction.damage(crate, 50) === 'ignored' && drops.length === 1);
check('an impact mark was left behind', destruction.markCount >= 1);

// ---- Impact marks are pooled and capped ---------------------------------
for (let i = 0; i < 60; i++) destruction.markImpact({ x: i * 0.1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
check('impact marks are capped', destruction.markCount === 48, `${destruction.markCount} marks`);
check('the scene is not flooded with mark meshes', scene.children.length < 70, `${scene.children.length} objects`);

// ---- Debris recycles instead of leaking ---------------------------------
for (let i = 0; i < 400; i++) destruction.update(1 / 30);
check('debris expires after its lifetime', destruction.debrisCount === 0);
check('expired debris returns to the pool', destruction.pooledDebris === 8);

// ---- Resetting an arena -------------------------------------------------
const barrel = destruction.addProp({ x: -3, z: 4, w: 0.9, h: 1, d: 0.9, hp: 20 });
check('a second prop can be added', colliders.length === 1 && barrel.state === 'intact');
destruction.clear();
check('clear removes props and colliders', colliders.length === 0 && destruction.props.length === 0);
check('clear removes marks', destruction.markCount === 0);

console.log(`\nDestruction checks passed (${checks} checks).`);
