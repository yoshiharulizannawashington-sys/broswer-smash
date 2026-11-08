// Naruto attack proof: eight moves, one camera, one timing, measured on the rendered body.
//
// For each move the attack is held at the same fraction of its own duration, the authored layer is
// applied, and two things are recorded from the SAME frame:
//   1. world-space positions of the hands, feet and head read off the rendered SkinnedMesh skeleton
//      (camera-, HUD- and VFX-independent), and
//   2. a cropped frame of the fighter only.
// Every pair of moves must differ by more than MIN_POSE_DISTANCE metres at some tracked joint, so a
// renamed clip, a pixel shift or a projectile cannot pass. Rest (no attack) is included as a
// control: an attack that matches rest is not animating at all.
//
//   bash scripts/run-browser-test.sh scripts/capture-naruto-attacks.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/animation-phase1';
await mkdir(out, { recursive: true });
const MIN_POSE_DISTANCE = 0.12; // metres, at some tracked joint
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

// [move id the resolver actually produces, kind, motion slot it must resolve to, file label]
// The fifth light is `finisher` in move_data.js; `light5` is only the motion slot, so pushing
// `light5` as a move id was a harness error, not a missing animation.
const MOVES = [
  ['light1', 'melee', 'light1', 'light1'],
  ['light2', 'melee', 'light2', 'light2'],
  ['light3', 'melee', 'light3', 'light3'],
  ['light4', 'melee', 'light4', 'light4'],
  ['finisher', 'melee', 'light5', 'light5'],
  ['heavy', 'heavy', 'heavy', 'heavy'],
  ['heavyLauncher', 'heavy', 'heavyLauncher', 'heavyLauncher'],
  ['heavySlam', 'slam', 'heavySlam', 'heavySlam']
];
const mapMoveToCombo = id => (id === 'finisher' ? 5 : Number(String(id).replace('light', '')) || 1);

let browser;
let failures = 0;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(9, .6, 0);
    // A 3/4 front view: yaw 0 stands on the fighter's side, which hid the striking arm behind
    // his torso. 55 degrees front-right and a torso framing makes the authored pose readable.
    window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: 55, pitch: 8, distance: 3.4 });
  });
  // The imported body mounts asynchronously (GLB plus five embedded textures), so the skinned mesh
  // can be missing for the first frames of the match. Waiting for it is the difference between
  // measuring Naruto's real skeleton and throwing on a null.
  await page.waitForFunction(() => {
    const f = window.fighters?.[0];
    if (!f?.model) return false;
    let sm = null;
    f.model.traverse(n => { if (n.isSkinnedMesh && !sm) sm = n; });
    f.__sm = sm;
    return !!sm && (sm.skeleton?.bones?.length || 0) > 0;
  }, null, { timeout: 120000, polling: 200 });
  await new Promise(r => setTimeout(r, 400));

  const settle = async () => {
    // The strike is selected on the idle -> attack edge only. Pushing a new move while a previous
    // entry is still live leaves `wasAttacking` true and the state machine never commits it, which
    // reads as "the animation did not play".
    await page.evaluate(() => { window.fighters[0].attackQueue.length = 0; });
    await page.evaluate(() => window.__browserSmashStep(0.3));
  };
  const sample = async (id, kind) => {
    await settle();
    return page.evaluate(async ({ id, kind, combo }) => {
    const f = window.fighters[0];
    f.comboStep = combo;
    // Hold the pose. A 0.4 s move finishes while SwiftShader is still capturing, so the drawn
    // frame showed the rest pose and every capture looked alike. A long attack keeps the same
    // normalised progress (~50%) across the seconds a capture takes.
    const total = 8;
    if (id) f.attackQueue.push({ id, kind, t: total * 0.5, total, damage: 10, hit: false, active: 0 });
    window.__browserSmashAttackTick();
    // SwiftShader draws a frame every few hundred milliseconds: rAF waits are not a reliable way to
    // reach the middle of a strike. Step the simulation deterministically into the contact window,
    // then read the skeleton it produced.
    window.__browserSmashStep(0.18);
    f.model.updateMatrixWorld(true);
    // Measure the resolved rig joints (rig_map publishes them on userData), not generic bone
    // names: the imported skeleton does not call its hand "RightHand", and a name lookup that
    // misses returns null, which silently reads as "no movement".
    const world = name => {
      const bone = f.model.userData?.[name];
      if (!bone) return null;
      const v = bone.position.clone();
      bone.getWorldPosition(v);
      return [ +v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4) ];
    };
    return {
      id: id || 'rest',
      strike: f.model.userData?.lastAuthoredStrike || null,
      clip: f.model.userData?.currentClip || null,
      pose: window.__browserSmashAttackMotion().p1.pose,
      set: window.__browserSmashAttackMotion().p1.set,
      hips: world('pelvis'), head: world('head'),
      leftHand: world('leftHand') || world('leftFore'), rightHand: world('rightHand') || world('rightFore'),
      leftFoot: world('leftFoot'), rightFoot: world('rightFoot')
    };
  }, { id, kind, combo: id ? mapMoveToCombo(id) : 1 });
  };

  const shots = [];
  for (const [id, kind, slot, label] of MOVES) {
    const pose = await sample(id, kind);
    // Freeze the stepped pose for the shutter. The next real render frame advances the mixer by the
    // wall-clock delta, which under SwiftShader is seconds - long enough to finish the strike and
    // settle back to idle before the screenshot. Holding the strike timer and zeroing the mixer time
    // scale captures the pose the measurement was taken from.
    await page.evaluate(() => {
      const f = window.fighters[0];
      // Pin the action itself: pausing an AnimationAction freezes its time while it keeps writing
      // its pose at full weight. Stopping the mixer clock instead froze a fresh crossfade at weight
      // 0, which is why the shutter caught the bind pose.
      f.model.userData.authoredStrikeTime = 30;
      const action = f.model.userData.authoredStrikeAction;
      if (action) { action.stopFading(); action.setEffectiveWeight(1); action.paused = true; }
    });
    await page.evaluate(async () => { await new Promise(r => requestAnimationFrame(r)); });
    const file = `${out}/naruto-${label}-pose.png`;
    await page.screenshot({ path: file, clip: { x: 340, y: 40, width: 600, height: 720 } });
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.attackQueue.length = 0;
      const action = f.model.userData.authoredStrikeAction;
      if (action) action.paused = false;
    });
    shots.push({ ...pose, moveId: id, expectedSlot: slot, file });
    console.log('POSE', label, JSON.stringify({ moveId: id, pose: pose.pose, set: pose.set, rightHand: pose.rightHand, leftFoot: pose.leftFoot }));
  }
  const rest = await sample(null, null);
  console.log('REST', JSON.stringify({ rightHand: rest.rightHand, leftFoot: rest.leftFoot }));

  // ------------------------------------------------------------- pairwise joint distances
  const joints = ['head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'hips'];
  const distance = (a, b) => {
    let worst = 0, joint = null;
    for (const key of joints) {
      if (!a[key] || !b[key]) continue;
      const d = Math.hypot(a[key][0] - b[key][0], a[key][1] - b[key][1], a[key][2] - b[key][2]);
      if (d > worst) { worst = d; joint = key; }
    }
    return { joint, metres: +worst.toFixed(4) };
  };
  const pairs = [];
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) {
      pairs.push({ a: shots[i].expectedSlot, b: shots[j].expectedSlot, ...distance(shots[i], shots[j]) });
    }
  }
  const worst = pairs.reduce((min, pair) => (pair.metres < min.metres ? pair : min), pairs[0]);
  const vsRest = shots.map(shot => ({ move: shot.expectedSlot, ...distance(shot, rest) }))
    .reduce((min, row) => (row.metres < min.metres ? row : min), { move: null, metres: Infinity });

  for (const shot of shots) {
    const nearRest = distance(shot, rest);
    // The state machine records the slot it selected; the bone distance proves the selected clip
    // moved the mounted skeleton. Either alone is not enough: a slot can be logged and not drawn.
    const selected = shot.strike?.slot === shot.expectedSlot;
    // `metres` is numeric only when at least one joint was comparable; a name mismatch must fail.
    const ok = selected && nearRest.metres > 0.05;
    if (!ok) failures++;
    console.log(`${ok ? '  ok ' : ' FAIL'} ${shot.expectedSlot.padEnd(13)} move=${shot.moveId} selected=${shot.strike?.slot} clip=${shot.clip} vs rest ${nearRest.metres} m at ${nearRest.joint}`);
  }
  for (const pair of pairs.filter(p => p.metres < MIN_POSE_DISTANCE)) {
    failures++;
    console.log(` FAIL ${pair.a} vs ${pair.b} only ${pair.metres} m apart at ${pair.joint}`);
  }
  console.log(`\nclosest pair of moves: ${worst.a} / ${worst.b} — ${worst.metres} m at ${worst.joint} (min required ${MIN_POSE_DISTANCE})`);
  console.log(`smallest move-vs-rest distance: ${vsRest.move} — ${vsRest.metres} m`);

  await writeFile(`${out}/naruto-attack-poses.json`, JSON.stringify({ generatedAt: new Date().toISOString(), shots, rest, pairs, worst, vsRest, minPoseDistance: MIN_POSE_DISTANCE, errors }, null, 2));
  console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
  console.log(failures === 0 ? `Naruto attack poses passed (${shots.length} moves, ${pairs.length} pairs).` : `Naruto attack poses FAILED (${failures} problems).`);
} finally {
  await browser?.close();
  server.close();
}
process.exitCode = failures === 0 ? 0 : 1;
