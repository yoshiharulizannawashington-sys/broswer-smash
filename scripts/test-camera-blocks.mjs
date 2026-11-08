// Unit test for the mesh-derived camera collider (public/js/world/camera_blocks.js).
//   node scripts/test-camera-blocks.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blocksFromGroup } from '../public/js/world/camera_blocks.js';

let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log(`  ok  ${name}`); };

const bounds = { x0: -20, x1: 20, z0: -20, z1: 20 };
const group = new THREE.Group();
const add = (w, h, d, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
};
add(60, 0.2, 60, 0, -0.1, 0);        // floor slab: top 0 -> not an obstruction
add(4, 6, 2, 10, 3, 0);              // house wall: the obstruction that matters
add(12, 8, 9, -8, 4, -6);            // bigger building
add(0.2, 5, 0.2, 4, 2.5, 2);         // lamp post: too small a footprint
add(4, 30, 4, 400, 15, 0);           // skyline tower far outside the pad
group.updateMatrixWorld(true);

const blocks = blocksFromGroup(group, bounds);
check('returns blocks for a real arena group', blocks.length === 2, String(blocks.length));
check('drops the floor slab', blocks.every(b => b.top > 1.6));
check('drops the lamp post', blocks.every(b => (b.x1 - b.x0) * (b.z1 - b.z0) >= 6));
check('drops geometry far outside the bounds', blocks.every(b => b.x0 < 20 + 55));
check('keeps both buildings', blocks.some(b => b.top === 6) && blocks.some(b => b.top === 8));
// Ordering is deliberate and changed: the 48-volume cap must keep obstacles near the fight, so a
// small building beside the pair outranks a large one far away. This asserts the documented rule
// (distance from the fight per unit footprint) rather than the old largest-area-first order.
check('orders blocks by distance-to-fight per unit size', (() => {
  const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
  const score = b => Math.hypot((b.x0 + b.x1) / 2 - cx, (b.z0 + b.z1) / 2 - cz)
    / Math.sqrt(Math.max(1, (b.x1 - b.x0) * (b.z1 - b.z0)));
  return blocks.length < 2 || score(blocks[0]) <= score(blocks[1]) + 1e-9;
})(), 'relevance order');
check('every block carries a bottom for the camera box test', blocks.every(b => Number.isFinite(b.bottom)));
check('bottom is the mesh base, not the origin', blocks.every(b => b.bottom < b.top - 1));
check('caps the block count', blocksFromGroup(group, bounds, { limit: 1 }).length === 1);
check('never emits the internal sort key', blocks.every(b => !('area' in b)));
check('null group is safe', blocksFromGroup(null, bounds).length === 0);
check('null bounds is safe', blocksFromGroup(group, null).length === 0);
check('instanced scenery is skipped', (() => {
  const g = new THREE.Group();
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshBasicMaterial(), 4);
  inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 4, 0));
  g.add(inst);
  g.updateMatrixWorld(true);
  return blocksFromGroup(g, bounds).length === 0;
})());

console.log(`${checks} checks passed`);
