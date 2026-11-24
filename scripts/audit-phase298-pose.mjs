// Phase 29.8 — the pose's actual contribution, and a real-time recording attempt.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-pose.mjs
//
// Two passes in one session:
//
//   A. Attribution. The haul hook runs from two call sites per frame, so "the arms moved a lot" is
//      weak evidence — the cast animation moves them too. This steps the SAME simulation twice, with
//      the overlay suppressed (`window.__browserSmashNoHaul`) and enabled, and reports the joint
//      angle and hand-position difference at matched ticks. That difference is the haul, nothing else.
//      It also captures front, side and three-quarter stills of both states at the peak tug.
//
//   B. Real time. The 29.7 recording ran at 2.6-3.2 fps because only software WebGL was available.
//      A frame now costs ~20 ms to draw, so this reloads the page with a normal live loop, records
//      the actual game at 900x560, measures the achieved frame rate and reports it with the clip.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const shotDir = resolve(root, 'artifacts/dev/phase298/pose');
const videoDir = resolve(root, 'artifacts/dev/phase298/video');
for (const dir of [outDir, shotDir, videoDir]) await mkdir(dir, { recursive: true });

const PULL = { 'grab-continuity-pull': true };
const GAP = 7.8;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const context = await chromium.launchPersistentContext(videoDir, {
  headless: true,
  viewport: { width: 900, height: 560 },
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  recordVideo: { dir: videoDir, size: { width: 900, height: 560 } }
});
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

const boot = async () => {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashRenderer
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]', { force: true });
  const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
    || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
  await arenaCard.click({ force: true });
  await page.click('#play', { force: true });
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
};

await boot();

// ---------------------------------------------------------------- A. attribution, stepped twice
const install = async () => {
  await page.evaluate(() => {
    const renderer = window.__browserSmashRenderer;
    window.__origRAF = window.requestAnimationFrame.bind(window);
    window.__origRender = renderer.render.bind(renderer);
    renderer.render = () => {};
    window.requestAnimationFrame = () => 0;
    const scene = window.__browserSmashScene;
    const camera = window.smashCamera.camera;
    const V = scene.position.clone();
    const M = scene.position.clone();
    const joint = (f, name) => f.model?.userData?.[name] || null;
    const rot = (f, name, axis) => {
      const j = joint(f, name);
      return j ? +j.rotation[axis].toFixed(4) : null;
    };
    const world = (f, name) => {
      const j = joint(f, name);
      if (!j) return null;
      j.getWorldPosition(V);
      return { x: +V.x.toFixed(3), y: +V.y.toFixed(3), z: +V.z.toFixed(3) };
    };
    const quatOf = (f, name) => {
      const j = joint(f, name);
      return j ? [+j.quaternion.x.toFixed(5), +j.quaternion.y.toFixed(5),
        +j.quaternion.z.toFixed(5), +j.quaternion.w.toFixed(5)] : null;
    };
    window.__p298p = {
      begin(noHaul) {
        const p1 = window.fighters[0], p2 = window.fighters[1];
        window.combatPowers.clear('p298p');
        window.__browserSmashCasterBudget = '';
        window.__browserSmashNoHaul = Boolean(noHaul);
        for (const f of [p1, p2]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
          f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
          f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.__haul = null;
        }
        p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
        // Literals, not Node constants: code inside evaluate() cannot see this module's scope.
        p2.position.set(7.8, p2.groundLevel ?? 0, 0); p2.facing = -1;
        const keys = window.__browserSmashInput.keys;
        for (const code of Object.keys(keys)) keys[code] = false;
        window.__browserSmashHitTrace = [];
        window.__browserSmashGrabTrace = [];
        window.__browserSmashHaulTrace = [];
        window.__browserSmashExperiments = { 'grab-continuity-pull': true };
        window.__browserSmashStep(1 / 60);
        p2.meter = 100;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
        this.rec = rec; this.cursor = 0;
        return { ok: true };
      },
      tick() {
        const p1 = window.fighters[0], p2 = window.fighters[1];
        window.__browserSmashStep(1 / 60);
        window.combatPowers.applyCinematicPose?.(1 / 60);
        this.cursor++;
        return {
          t: +(this.cursor / 60).toFixed(3),
          gap: +Math.hypot(p2.position.x - p1.position.x, p2.position.z - p1.position.z).toFixed(3),
          damage: +p1.percent.toFixed(1), reel: Boolean(p1.grabReel),
          joints: {
            torsoX: rot(p2, 'torso', 'x'), torsoY: rot(p2, 'torso', 'y'), torsoZ: rot(p2, 'torso', 'z'),
            rightArmX: rot(p2, 'rightArm', 'x'), rightForeX: rot(p2, 'rightFore', 'x'),
            leftArmX: rot(p2, 'leftArm', 'x'), leftArmZ: rot(p2, 'leftArm', 'z'),
            pelvisX: rot(p2, 'pelvis', 'x'), pelvisY: rot(p2, 'pelvis', 'y'),
            rightLegX: rot(p2, 'rightLeg', 'x'), rightShinX: rot(p2, 'rightShin', 'x'),
            leftLegX: rot(p2, 'leftLeg', 'x'), leftShinX: rot(p2, 'leftShin', 'x')
          },
          hands: { left: world(p2, 'leftHand'), right: world(p2, 'rightHand') },
          quats: {
            torso: quatOf(p2, 'torso'), pelvis: quatOf(p2, 'pelvis'),
            rightArm: quatOf(p2, 'rightArm'), rightFore: quatOf(p2, 'rightFore'),
            leftArm: quatOf(p2, 'leftArm'), leftFore: quatOf(p2, 'leftFore'),
            rightLeg: quatOf(p2, 'rightLeg'), rightShin: quatOf(p2, 'rightShin')
          }
        };
      },
      /** Render at one of three framings and screenshot; the camera is ours, the scene is not. */
      async shot(angle, file) {
        const p1 = window.fighters[0], p2 = window.fighters[1];
        M.copy(p1.position).add(p2.position).multiplyScalar(.5);
        M.y = (p2.groundLevel ?? 0) + 1.1;
        const forward = p1.position.clone().sub(p2.position); forward.y = 0; forward.normalize();
        const side = forward.clone().cross(scene.up).normalize();
        const offset = new (forward.constructor)();
        if (angle === 'front') offset.copy(forward).multiplyScalar(4.2);
        else if (angle === 'side') offset.copy(side).multiplyScalar(4.2);
        else offset.copy(forward).add(side).normalize().multiplyScalar(4.4);
        camera.position.copy(M).add(offset);
        camera.position.y = M.y + 0.9;
        camera.lookAt(M);
        camera.updateMatrixWorld(true);
        window.__origRender(scene, camera);
        return file;
      }
    };
  });
};
await install();

const runStepped = async (noHaul) => {
  await page.evaluate(nh => window.__p298p.begin(nh), noHaul);
  const ticks = [];
  for (let i = 0; i < 190; i++) {
    const tick = await page.evaluate(() => window.__p298p.tick());
    ticks.push(tick);
    if (tick.phase === 'done') break;
  }
  return ticks;
};

const withHaul = await runStepped(false);
const without = await runStepped(true);
// Quaternion angular distance, not an Euler subtraction: the overlay rotates a quaternion, and the
// Euler decomposition of the result jumps around gimbal regions, which turned small poses into
// meaningless ~pi readings. The angle between the two orientations is exact and wrap-free.
const JOINT_KEYS = Object.keys(withHaul[0].quats || {});
const quatAngle = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot)).toFixed(4);
};
const diffs = {};
for (const name of JOINT_KEYS) diffs[name] = [];
const handDiff = [];
for (let i = 0; i < Math.min(withHaul.length, without.length); i++) {
  for (const name of JOINT_KEYS) {
    const angle = quatAngle(withHaul[i].quats[name], without[i].quats[name]);
    if (angle == null) continue;
    diffs[name].push({ t: withHaul[i].t, rad: angle, reel: withHaul[i].reel });
  }
  const hl = withHaul[i].hands.left, hr = withHaul[i].hands.right;
  const nl = without[i].hands.left, nr = without[i].hands.right;
  if (hl && nl && hr && nr) {
    const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    handDiff.push({ t: withHaul[i].t, left: +dist(hl, nl).toFixed(3), right: +dist(hr, nr).toFixed(3) });
  }
}
const summary = {};
for (const name of JOINT_KEYS) {
  const list = diffs[name];
  if (!list.length) { summary[name] = null; continue; }
  const peak = list.reduce((a, b) => (b.rad > a.rad ? b : a), { rad: 0, t: 0 });
  const during = list.filter(s => s.reel);
  summary[name] = {
    peakDeg: +(peak.rad * 180 / Math.PI).toFixed(1), at: peak.t,
    duringReelMeanDeg: during.length
      ? +(during.reduce((s, x) => s + x.rad, 0) / during.length * 180 / Math.PI).toFixed(1) : null
  };
}
const handPeak = handDiff.reduce((a, b) => (b.left + b.right) > (a.left + a.right) ? b : a, { left: 0, right: 0, t: 0 });
console.log('attribution ' + JSON.stringify({ joints: summary, handPeak }));

// Stills at the peak tug — the tick where the overlay displaced the hands furthest, which is the
// frame that actually shows the draw.
const peakT = handPeak.t;
const stills = [];
for (const angle of ['front', 'side', 'three-quarter']) {
  for (const [label, noHaul] of [['haul', false], ['none', true]]) {
    // Re-run to the same tick so the pair differs only by the overlay.
    await page.evaluate(nh => window.__p298p.begin(nh), noHaul);
    let state = null;
    for (let i = 0; i < Math.round(peakT * 60); i++) state = await page.evaluate(() => window.__p298p.tick());
    const file = resolve(shotDir, angle + '-' + label + '.png');
    await page.evaluate(a => window.__p298p.shot(a), angle);
    await page.screenshot({ path: file });
    stills.push({ angle, label, t: state?.t, gap: state?.gap, file: file.replace(root + '/', '') });
  }
}
console.log('stills ' + stills.length + ' peakT ' + peakT);

// ---------------------------------------------------------------- B. real time, live loop
await page.evaluate(() => {
  window.requestAnimationFrame = window.__origRAF;
  window.__browserSmashRenderer.render = window.__origRender;
  window.__browserSmashNoHaul = false;
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashMatch && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
});
await page.click('#selectScreen [data-nav="next"]', { force: true });
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-tournament="tournament"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click({ force: true });
await page.click('#play', { force: true });
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

const live = await page.evaluate(async () => {
  // Idle frame rate first, with nothing being cast: the honest ceiling for this machine.
  const measure = async (ms) => {
    const t0 = performance.now();
    let frames = 0;
    await new Promise(done => {
      const step = () => {
        frames++;
        if (performance.now() - t0 < ms) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return +(frames / ((performance.now() - t0) / 1000)).toFixed(1);
  };
  const idle = await measure(1500);
  const p1 = window.fighters[0], p2 = window.fighters[1];
  p1.position.set(p2.position.x - 7.8, p1.position.y, p2.position.z);
  p1.facing = 1; p2.facing = -1;
  window.__browserSmashExperiments = { 'grab-continuity-pull': true };
  p2.meter = 100;
  const rec = window.combatPowers.tryUltimate(p2);
  const castAt = performance.now();
  const during = await measure(2200);
  return { idle, during, cast: rec?.ok !== false, label: rec?.label,
    frames: performance.now() - castAt, damage: +p1.percent.toFixed(1) };
});
await page.waitForTimeout(1200);
await context.close();
await new Promise(done => server.close(done));

const videos = (await readdir(videoDir)).filter(f => f.endsWith('.webm'));
const clip = videos.sort().at(-1);
const result = {
  kind: 'grab-haul-pose', generatedAt: new Date().toISOString(),
  attribution: { joints: summary, handPeak, ticksCompared: Math.min(withHaul.length, without.length) },
  stills, live, clip: clip ? 'artifacts/dev/phase298/video/' + clip : null, pageErrors
};
await writeFile(resolve(outDir, 'grab-haul-pose.json'), JSON.stringify(result, null, 2));
console.log('live ' + JSON.stringify(live));
console.log('clip ' + result.clip + ' page errors ' + pageErrors.length);
