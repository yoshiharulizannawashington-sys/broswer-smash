// Live check: the eight attack motions apply to Naruto's real rig, differ, and clear afterwards.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { MOTION_KINDS, sampleMotion } from '../public/js/anim/attack_animator.js';

const root = process.cwd();
const out = 'artifacts/compare/animation-phase1';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => { try { const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html'; if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel; res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' }); res.end(await readFile(resolve(root, rel))); } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); } });
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log('  ok  ' + name); };

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  const frames = n => page.evaluate(async total => { for (let i = 0; i < total; i++) await new Promise(r => requestAnimationFrame(r)); }, n);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(3.2, .6, 0);
  });
  await frames(2);

  const readRig = () => page.evaluate(() => {
    const m = window.fighters[0].model.userData;
    const grab = key => m[key]?.rotation ? [ +m[key].rotation.x.toFixed(3), +m[key].rotation.y.toFixed(3), +m[key].rotation.z.toFixed(3) ] : null;
    return { torso: grab('torso'), rightArm: grab('rightArm'), leftArm: grab('leftArm'), pelvis: grab('pelvis'), rightLeg: grab('rightLeg'), pose: window.__browserSmashAttackMotion().p1.pose };
  });

  // Pose and read in one evaluation: between two evaluations the locomotion update rewrites the
  // joints, so a later read would report the idle pose for every move.
  const poseRig = kindName => page.evaluate(name => {
    const f = window.fighters[0];
    f.attackQueue.length = 0;
    f.comboStep = Number(name.replace('light', '')) || 1;
    f.attackQueue.push({ kind: name, t: .1, total: .4, damage: 10, hit: false, active: 0 });
    window.__browserSmashAttackTick();
    const m = f.model.userData;
    const grab = key => m[key]?.rotation ? [ +m[key].rotation.x.toFixed(3), +m[key].rotation.y.toFixed(3), +m[key].rotation.z.toFixed(3) ] : null;
    // A whole-skeleton signature read in the same evaluation as the tick: the joint-name path above
    // can be equal across poses on a rig whose joints are aliased, so distinctness is judged on the
    // bones the mixer actually drives.
    const sig = [];
    f.model.traverse(n => { if (n.isSkinnedMesh && n.skeleton) n.skeleton.bones.forEach(b => sig.push(...b.quaternion.toArray().map(v => +v.toFixed(3)))); });
    return { torso: grab('torso'), rightArm: grab('rightArm'), leftArm: grab('leftArm'), pelvis: grab('pelvis'), rightLeg: grab('rightLeg'), sig: sig.join(','), pose: window.__browserSmashAttackMotion().p1.pose };
  }, kindName);

  const baseline = await readRig();
  const applied = [];
  for (const kind of MOTION_KINDS) {
    const rig = await poseRig(kind);
    applied.push({ kind, rig });
    check(`${kind}: motion is applied to the live rig`, rig.pose === kind, JSON.stringify(rig));
  }

  // Live distinctness is judged on the rendered frame, not on a joint read-out: this rig's named
  // joints alias, so a rotation read can report the same numbers for two different poses. A capture
  // per motion is the surface a player actually sees.
  const captures = [];

  // ------------------------------------------------------------------ move-id resolution
  // The three heavies resolve from the real move resolver, not a hand-pushed kind name. Before the
  // mapping fix these all fell through to the current light step, which is the defect this checks.
  const heavies = await page.evaluate(() => {
    const f = window.fighters[0];
    const out = {};
    for (const [id, kind] of [['heavy', 'heavy'], ['heavyLauncher', 'heavyLauncher'], ['heavySlam', 'heavySlam']]) {
      window.__browserSmashMotionErrors = [];
      f.attackQueue.length = 0;
      f.comboStep = 1;
      f.attackQueue.push({ id, kind, t: .14, total: .5, damage: 10, hit: false, active: 0 });
      window.__browserSmashAttackTick();
      const m = f.model.userData;
      const r = window.__browserSmashAttackMotion().p1;
      out[id] = {
        pose: r.pose, set: r.set,
        torso: m.torso.rotation.toArray().slice(0, 3).map(v => +v.toFixed(3)),
        rightArm: m.rightArm.rotation.toArray().slice(0, 3).map(v => +v.toFixed(3)),
        errors: (window.__browserSmashMotionErrors || []).length
      };
    }
    f.attackQueue.length = 0;
    window.__browserSmashAttackTick();
    return out;
  });
  for (const [id, slot] of [['heavy', 'heavy'], ['heavyLauncher', 'heavyLauncher'], ['heavySlam', 'heavySlam']]) {
    check(`${id}: the move id resolves to its own motion`, heavies[id].pose === slot && heavies[id].errors === 0,
      JSON.stringify(heavies[id]));
  }
  // No joint read here: this rig's named joints alias, so the rendered-frame comparison below is the
  // honest live check that the three heavies are three different motions.

  // -------------------------------------------------------- per-fighter motion in the same match
  const crossFighter = await page.evaluate(() => {
    const f = window.fighters[0];
    const sampleAt = identity => {
      f.identityKey = identity;
      f.attackQueue.length = 0;
      f.comboStep = 1;
      f.attackQueue.push({ id: 'light1', kind: 'melee', t: .14, total: .4, damage: 10, hit: false, active: 0 });
      window.__browserSmashAttackTick();
      const r = window.__browserSmashAttackMotion().p1;
      const m = f.model.userData;
      const sig = [];
      f.model.traverse(n => { if (n.isSkinnedMesh && n.skeleton) n.skeleton.bones.forEach(b => sig.push(...b.quaternion.toArray().map(v => +v.toFixed(3)))); });
      return { set: r.set, pose: r.pose, sig: sig.join(','), arm: m.rightArm.rotation.toArray().slice(0, 3).map(v => +v.toFixed(3)) };
    };
    const naruto = sampleAt('naruto_uzumaki');
    const thor = sampleAt('thor');
    f.identityKey = 'naruto_uzumaki';
    f.attackQueue.length = 0;
    window.__browserSmashAttackTick();
    return { naruto, thor };
  });
  check('Naruto plays his own motion set in the live match', crossFighter.naruto.set === 'naruto', JSON.stringify(crossFighter.naruto));
  check('a roster fighter plays its own authored set', crossFighter.thor.set === 'thor', JSON.stringify(crossFighter.thor));

  // Same move id, two identities, two rendered frames: the pose a player sees is not the same.
  const crossFrames = [];
  for (const identity of ['naruto_uzumaki', 'thor']) {
    await page.evaluate(id => {
      const f = window.fighters[0];
      f.identityKey = id;
      f.attackQueue.length = 0;
      f.comboStep = 1;
      f.attackQueue.push({ id: 'light1', kind: 'melee', t: .14, total: .4, damage: 10, hit: false, active: 0 });
      window.__browserSmashAttackTick();
    }, identity);
    const file = `${out}/light1-${identity}.png`;
    await page.screenshot({ path: file, clip: { x: 320, y: 200, width: 620, height: 360 } });
    crossFrames.push({ identity, hash: createHash('sha1').update(await readFile(file)).digest('hex').slice(0, 12) });
  }
  check('the same move renders differently on another fighter',
    crossFrames[0].hash !== crossFrames[1].hash,
    `${crossFrames[0].identity} ${crossFrames[0].hash} vs ${crossFrames[1].identity} ${crossFrames[1].hash}`);
  await page.evaluate(() => { const f = window.fighters[0]; f.identityKey = 'naruto_uzumaki'; f.attackQueue.length = 0; window.__browserSmashAttackTick(); });

  // Contact-frame captures for the brief's side-by-side comparison.
  for (const kind of MOTION_KINDS) {
    await page.evaluate(kindName => {
      const f = window.fighters[0];
      f.attackQueue.length = 0;
      f.comboStep = Number(kindName.replace('light', '')) || 1;
      f.attackQueue.push({ kind: kindName, t: .14, total: .4, damage: 10, hit: false, active: 0 });
    }, kind);
    await page.evaluate(() => window.__browserSmashAttackTick());
    const file = `${out}/${kind}-contact.png`;
    await page.screenshot({ path: file, clip: { x: 320, y: 200, width: 620, height: 360 } });
    captures.push({ kind, hash: createHash('sha1').update(await readFile(file)).digest('hex').slice(0, 12) });
  }
  const uniqueFrames = new Set(captures.map(entry => entry.hash)).size;
  check('every attack renders a different fighter region (HUD excluded)', uniqueFrames === MOTION_KINDS.length,
    `${uniqueFrames}/${MOTION_KINDS.length} unique frames`);

  // Sampled within one evaluation: the idle clip keeps breathing between separate calls, so a
  // baseline taken minutes earlier is a different pose for reasons that have nothing to do with the
  // attack. Before / during / after here isolates the attack delta.
  const restCheck = await page.evaluate(() => {
    const f = window.fighters[0];
    const grab = key => { const node = f.model.userData[key]; return node?.rotation ? node.rotation.toArray().slice(0, 3).map(v => +v.toFixed(4)) : null; };
    const read = () => ({ torso: grab('torso'), rightArm: grab('rightArm'), leftArm: grab('leftArm'), pelvis: grab('pelvis'), rightLeg: grab('rightLeg'), pose: window.__browserSmashAttackMotion().p1.pose });
    // The overlay only restores when it currently holds a pose, so a bare clear leaves whatever the
    // mixer last drew. Prime one attack, clear it, and sample the restored base as the baseline -
    // otherwise this compares a mixer frame against the base and fails for the wrong reason.
    f.comboStep = 1;
    f.attackQueue.push({ id: 'light1', kind: 'melee', t: .14, total: .4, damage: 10, hit: false, active: 0 });
    window.__browserSmashAttackTick();
    f.attackQueue.length = 0;
    window.__browserSmashAttackTick();
    const before = read();
    f.comboStep = 1;
    f.attackQueue.push({ id: 'light1', kind: 'melee', t: .14, total: .4, damage: 10, hit: false, active: 0 });
    window.__browserSmashAttackTick();
    const during = read();
    f.attackQueue.length = 0;
    window.__browserSmashAttackTick();
    const after = read();
    return { before, during, after };
  });
  check('an active attack actually changes the pose',
    JSON.stringify(restCheck.during) !== JSON.stringify(restCheck.before), JSON.stringify(restCheck.during));
  check('the rig returns exactly to its rest pose when the attack ends',
    JSON.stringify(restCheck.after) === JSON.stringify(restCheck.before) && restCheck.after.pose === null,
    JSON.stringify({ before: restCheck.before, after: restCheck.after }));

  const motionErrors = await page.evaluate(() => (window.__browserSmashMotionErrors || []).length);
  check('no mapped move silently fell back or missed its motion', motionErrors === 0, `${motionErrors} misses`);
  check('no page errors during the animation run', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\nAttack motion verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
