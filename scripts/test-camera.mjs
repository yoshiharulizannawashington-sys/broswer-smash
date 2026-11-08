// Camera behaviour test: framing, collision, focus and shake, measured in node.
//
// The camera is the one system where "looks fine" is not verifiable headlessly and where a
// regression reads as a bug for the player rather than a failed assertion. So this drives the
// real SmashCamera with a real PerspectiveCamera and fake fighters, and projects both fighters
// through the settled lens: if either leaves the frame, the test fails.
//
//   node scripts/test-camera.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import SmashCamera from '../public/js/SmashCamera.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const fighter = (x, y, z) => ({
  position: new THREE.Vector3(x, y, z),
  velocity: new THREE.Vector3(),
  facing: 1, facingZ: 0, isGrounded: y < 2
});

function rig() {
  const camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 600);
  const cam = new SmashCamera(camera);
  return { camera, cam };
}

/** Run the camera until it settles, then refresh the matrices for projection. */
function settle(context, a, b, { frames = 180, mode = 'overhead' } = {}) {
  for (let i = 0; i < frames; i++) context.cam.update(a, b, 1 / 60, mode);
  context.camera.updateMatrixWorld(true);
  context.camera.updateProjectionMatrix();
}

const project = (context, f) => {
  const v = f.position.clone();
  v.y += 1;
  v.project(context.camera);
  return v;
};
const inFrame = v => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;

// ---- Baseline framing ----------------------------------------------------
{
  const context = rig();
  const a = fighter(0, 1.8, 0), b = fighter(1.5, 1.8, 0);
  settle(context, a, b);
  const pa = project(context, a), pb = project(context, b);
  check('a close duel keeps both fighters in frame', inFrame(pa) && inFrame(pb),
    `A ${pa.x.toFixed(2)},${pa.y.toFixed(2)} · B ${pb.x.toFixed(2)},${pb.y.toFixed(2)}`);
  check('the duel shot is elevated and pulled back',
    context.camera.position.y > 2 && context.cam.framing.distance > 5,
    `y ${context.camera.position.y.toFixed(2)} · d ${context.cam.framing.distance.toFixed(2)}`);
  check('the field of view stays inside the tuned range',
    context.camera.fov >= 40 && context.camera.fov <= 65, `${context.camera.fov.toFixed(1)}°`);
  check('the camera looks down at the floor, not level',
    context.cam.framing.angle >= 0.5 && context.cam.framing.angle <= 0.8,
    `${context.cam.framing.angle.toFixed(2)}`);
}

// ---- Distance framing ----------------------------------------------------
{
  const close = rig(); settle(close, fighter(0, 1.8, 0), fighter(1.5, 1.8, 0));
  const wide = rig(); settle(wide, fighter(-8, 1.8, 0), fighter(8, 1.8, 0));
  check('a wider duel pulls the camera back', wide.cam.framing.distance > close.cam.framing.distance,
    `${close.cam.framing.distance.toFixed(2)} -> ${wide.cam.framing.distance.toFixed(2)}`);
  const pa = project(wide, fighter(-8, 1.8, 0)), pb = project(wide, fighter(8, 1.8, 0));
  check('a wide duel still keeps both fighters in frame', inFrame(pa) && inFrame(pb));
}

// ---- Vertical separation (flight) ---------------------------------------
{
  const context = rig();
  const high = fighter(0, 12, 0), low = fighter(2, 1.8, 0);
  settle(context, high, low);
  const pa = project(context, high), pb = project(context, low);
  check('an aerial duel keeps both fighters in frame', inFrame(pa) && inFrame(pb),
    `high ${pa.x.toFixed(2)},${pa.y.toFixed(2)} · low ${pb.x.toFixed(2)},${pb.y.toFixed(2)}`);
  const level = rig(); settle(level, fighter(0, 1.8, 0), fighter(2, 1.8, 0));
  check('vertical separation pulls the shot back further than a level duel',
    context.cam.framing.distance > level.cam.framing.distance,
    `${level.cam.framing.distance.toFixed(2)} -> ${context.cam.framing.distance.toFixed(2)}`);
}

// ---- Camera collision ----------------------------------------------------
{
  const context = rig();
  const a = fighter(0, 1.8, 0), b = fighter(2, 1.8, 0);
  const bounds = { x0: -30, x1: 30, z0: -30, z1: 30 };
  context.cam.setStageBounds(bounds, []);
  settle(context, a, b, { frames: 90 });
  const clear = context.camera.position.distanceTo(context.cam.lookTarget);
  // A wall behind the fighters, exactly where the shot wants to sit.
  context.cam.setStageBounds(bounds, [{ x0: -30, x1: 30, bottom: 0, top: 20, z0: 3, z1: 3.6 }]);
  settle(context, a, b, { frames: 90 });
  const capped = context.camera.position.distanceTo(context.cam.lookTarget);
  check('a wall behind the fight shortens the shot', capped < clear, `${clear.toFixed(2)} -> ${capped.toFixed(2)}`);
  check('the shortened shot is recorded as capped', context.cam.framing.capped === true);
  check('the shot never collapses onto the fighters', capped > 1.5, `${capped.toFixed(2)} m`);
}

// ---- Special-attack focus ------------------------------------------------
{
  const context = rig();
  const a = fighter(0, 1.8, 0), b = fighter(3, 1.8, 0);
  settle(context, a, b);
  const baseline = context.cam.framing.distance;
  context.cam.focus(a, { seconds: 0.5, zoom: 0.14, bias: 0.22 });
  for (let i = 0; i < 8; i++) context.cam.update(a, b, 1 / 60, 'overhead');
  const focused = context.cam.framing.distance;
  check('a special focus tightens the shot', focused < baseline, `${baseline.toFixed(2)} -> ${focused.toFixed(2)}`);
  check('the focus is a small move, not a cutscene',
    baseline - focused < baseline * 0.2, `${(baseline - focused).toFixed(2)} m`);
  context.camera.updateMatrixWorld(true);
  const pb = project(context, b);
  check('the opponent stays in frame during the focus', inFrame(pb),
    `${pb.x.toFixed(2)},${pb.y.toFixed(2)}`);
  for (let i = 0; i < 60; i++) context.cam.update(a, b, 1 / 60, 'overhead');
  check('the focus releases on its own', context.cam.focusState === null);
  check('the shot returns to its normal distance afterwards',
    Math.abs(context.cam.framing.distance - baseline) < baseline * 0.06,
    `${baseline.toFixed(2)} -> ${context.cam.framing.distance.toFixed(2)}`);
  check('focus duration is capped so control is never taken away for long',
    context.cam.focus(a, { seconds: 5 }).seconds <= 0.6);
}

// ---- Impact shake and smoothing -----------------------------------------
{
  const context = rig();
  const a = fighter(0, 1.8, 0), b = fighter(2, 1.8, 0);
  settle(context, a, b);
  const rest = context.camera.position.clone();
  context.cam.impact(0.8);
  context.cam.update(a, b, 1 / 60, 'overhead');
  const shaken = context.camera.position.distanceTo(rest);
  check('an impact shakes the camera', shaken > 0, `${shaken.toFixed(3)} units`);
  check('the shake stays small enough to keep combat readable', shaken < 1.2, `${shaken.toFixed(3)}`);
  for (let i = 0; i < 90; i++) context.cam.update(a, b, 1 / 60, 'overhead');
  check('the shake decays to nothing', context.cam.shake === 0);

  // A fighter that jumps across the arena must not teleport the lens with it.
  const before = context.camera.position.clone();
  a.position.set(6, 1.8, 0);
  context.cam.update(a, b, 1 / 60, 'overhead');
  const step = context.camera.position.distanceTo(before);
  check('a fast reposition does not snap the camera', step < 1.5, `${step.toFixed(2)} units in one frame`);
}

console.log(`\nCamera checks passed (${checks} checks).`);
