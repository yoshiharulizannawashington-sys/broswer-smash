// Phase 29.8.6 — normal-speed visual acceptance harness.
//
//   bash scripts/run-browser-test.sh scripts/capture-298-6-live.mjs
//
// This does NOT step the simulation. It lets the game run its own loop, so what is measured is the
// cadence a player would actually see on this machine. It reports that cadence honestly: if the loop
// cannot reach a normal frame rate here, the output says so rather than passing a slow capture off as
// normal-speed video. No animation code is touched.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const frameDir = resolve(root, 'docs/phase298/live');
await mkdir(outDir, { recursive: true });
await mkdir(frameDir, { recursive: true });

const NAME = ['pelvis', 'torso', 'head', 'leftClavicle', 'rightClavicle', 'leftArm', 'leftFore',
  'leftHand', 'rightArm', 'rightFore', 'rightHand', 'leftLeg', 'leftShin', 'leftFoot', 'rightLeg',
  'rightShin', 'rightFoot'];

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const body = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'] });

const angleDeg = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(2);
};

async function openGame(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashRenderer && window.fighters?.length === 2,
    null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]', { force: true });
  const arena = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
    || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
  await arena.click({ force: true });
  await page.click('#play', { force: true });
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting',
    null, { timeout: 30_000, polling: 100 });
  await page.evaluate(names => {
    const CASTER = () => window.fighters[1], VICTIM = () => window.fighters[0];
    const q = (f, n) => {
      const j = f.model?.userData?.[n];
      return j?.quaternion ? [j.quaternion.x, j.quaternion.y, j.quaternion.z, j.quaternion.w] : null;
    };
    const pose = f => { const o = {}; for (const n of names) o[n] = q(f, n); return o; };
    const world = (f, n) => {
      const j = f.model?.userData?.[n];
      if (!j?.matrixWorld) return null;
      j.updateWorldMatrix(true, false);
      const m = j.matrixWorld.elements;
      return [+m[12].toFixed(3), +m[13].toFixed(3), +m[14].toFixed(3)];
    };
    window.__live = {
      names,
      setup(gap) {
        const c = CASTER(), v = VICTIM();
        window.combatPowers.clear('live');
        for (const f of [c, v]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
          f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
          f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.model.visible = true;
        }
        c.position.set(0, c.groundLevel ?? 0, 0); c.facing = 1;
        v.position.set(gap, v.groundLevel ?? 0, 0); v.facing = -1;
        for (const code of Object.keys(window.__browserSmashInput.keys)) window.__browserSmashInput.keys[code] = false;
        window.__browserSmashExperiments = { 'grab-continuity-pull': true };
        // Deliberately leave the budget unset: acceptance must judge the shipped default (per-reel),
        // not the 'plant' policy that the measurement audits used to isolate the pose.
        window.__liveIdle = pose(c);
        window.__liveIdleFeet = { left: world(c, 'leftFoot'), right: world(c, 'rightFoot') };
      },
      cast() {
        const c = CASTER();
        c.meter = 100;
        const rec = window.combatPowers.tryUltimate(c);
        window.__liveRec = rec;
        return { ok: rec?.ok !== false, label: rec?.label ?? null };
      },
      sample() {
        const c = CASTER(), v = VICTIM();
        const rec = window.fighters[1].__haulRecord || window.__liveRec;
        let snapT = 0;
        try { snapT = Number(window.__browserSmashPowers?.('p2')?.t) || 0; } catch { /* no snapshot */ }
        return {
          at: +performance.now().toFixed(1), frame: window.__browserSmashRenderer.info.render.frame,
          t: +((Number(rec?.t) || snapT) || 0).toFixed(3), reel: Boolean(v.grabReel),
          intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(4) : null,
          tug: rec?.__haul ? +rec.__haul.tug.toFixed(4) : null,
          victimX: +v.position.x.toFixed(3), casterX: +c.position.x.toFixed(3),
          leftFoot: world(c, 'leftFoot'), rightFoot: world(c, 'rightFoot'), leftHand: world(c, 'leftHand'),
          quats: pose(c)
        };
      },
      idlePose() { return window.__liveIdle; },
      idleFeet() { return window.__liveIdleFeet; },
      interrupt(kind) {
        const c = CASTER();
        if (kind === 'interrupt') window.combatPowers.clear('test-interrupt');
        else { c.ko = true; window.combatPowers.clear('match-end'); }
      },
      fpsOver(ms) {
        return new Promise(done => {
          const r = window.__browserSmashRenderer;
          const f0 = r.info.render.frame, t0 = performance.now();
          setTimeout(() => {
            const f1 = r.info.render.frame, t1 = performance.now();
            done({ frames: f1 - f0, ms: +(t1 - t0).toFixed(1), fps: +(((f1 - f0) * 1000) / (t1 - t0)).toFixed(2) });
          }, ms);
        });
      }
    };
  }, NAME);
  return { page, errors };
}

const report = { kind: 'capture-live-298-6', generatedAt: new Date().toISOString(), runs: {} };

async function measure(width, height, { capture = false } = {}) {
  const { page, errors } = await openGame(width, height);
  const fps = await page.evaluate(() => window.__live.fpsOver(2500));
  const out = { viewport: [width, height], fps, errors: errors.slice(0, 5) };
  console.log('fps ' + width + 'x' + height + ' -> ' + JSON.stringify(fps));

  await page.evaluate(() => window.__live.setup(3.0));
  const idle = await page.evaluate(() => ({ pose: window.__live.idlePose(), feet: window.__live.idleFeet() }));
  // Trigger through the route a player uses: the ultimate is edge-triggered from the input buffer,
  // and fighters[1] reads the P2 map, whose ultimate key is M. The direct API call is only a fallback.
  const advanced = () => page.waitForFunction(() => {
    const f = window.fighters?.[1] || {};
    let t = Number(f.__haulRecord?.t) || Number(window.__liveRec?.t) || 0;
    try { t = t || Number(window.__browserSmashPowers?.('p2')?.t) || 0; } catch { /* no snapshot */ }
    return t > 0;
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  await page.evaluate(() => { const c = window.fighters[1]; c.meter = 100; c.casting = null; });
  await page.keyboard.down('m');
  await page.waitForTimeout(150);
  await page.keyboard.up('m');
  out.cast = { via: 'keydown KeyM' };
  out.castAdvanced = await advanced();
  if (!out.castAdvanced) {
    await page.evaluate(() => window.__live.setup(3.0));
    out.cast = await page.evaluate(() => window.__live.cast());
    out.castTrigger = 'api-fallback';
    out.castAdvanced = await advanced();
  }
  console.log('cast ' + JSON.stringify(out.cast) + ' advanced=' + out.castAdvanced);

  const samples = [], shots = [];
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => window.__live.sample());
    samples.push(s);
    if (capture && i % 3 === 0 && shots.length < 12) {
      const name = 'live-' + String(shots.length).padStart(2, '0') + '.jpg';
      await page.screenshot({ path: resolve(frameDir, name), type: 'jpeg', quality: 72 });
      shots.push({ file: 'docs/phase298/live/' + name, frame: s.frame, at: s.at, t: s.t,
        intensity: s.intensity, reel: s.reel });
    }
    await page.waitForTimeout(40);
  }
  out.shots = shots;
  out.frames = samples.length;
  out.gameTimeCovered = +(samples.at(-1).t - samples[0].t).toFixed(3);
  out.wallTimeCovered = +((samples.at(-1).at - samples[0].at) / 1000).toFixed(2);
  out.reelSamples = samples.filter(s => s.reel).length;

  const deltas = [];
  for (let i = 1; i < samples.length; i++) {
    let worst = { joint: null, deg: 0 };
    for (const n of NAME) {
      const d = angleDeg(samples[i - 1].quats[n], samples[i].quats[n]);
      if (d != null && d > worst.deg) worst = { joint: n, deg: d };
    }
    deltas.push({ frame: samples[i].frame, gapMs: +(samples[i].at - samples[i - 1].at).toFixed(1),
      worstJoint: worst.joint, worstDeg: worst.deg });
  }
  out.worstFrameDelta = deltas.reduce((a, b) => (b.worstDeg > a.worstDeg ? b : a), { worstDeg: 0 });
  const gaps = deltas.map(d => d.gapMs).sort((a, b) => a - b);
  out.medianFrameGapMs = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  const haul = samples.filter(s => s.reel || (s.intensity ?? 0) > 0.05);
  const footStats = side => {
    const key = side === 'left' ? 'leftFoot' : 'rightFoot';
    const ys = haul.map(s => s[key]?.[1]).filter(Number.isFinite);
    const xs = haul.map(s => s[key]?.[0]).filter(Number.isFinite);
    if (!ys.length) return null;
    const idleY = idle.feet?.[side]?.[1];
    return { samples: ys.length, driftY: +(Math.max(...ys) - Math.min(...ys)).toFixed(3),
      slideX: +(Math.max(...xs) - Math.min(...xs)).toFixed(3),
      idleY: Number.isFinite(idleY) ? +idleY.toFixed(3) : null,
      maxLiftFromIdle: Number.isFinite(idleY) ? +Math.max(...ys.map(y => Math.abs(y - idleY))).toFixed(3) : null };
  };
  out.feet = { left: footStats('left'), right: footStats('right') };

  const hand = samples.filter(s => s.leftHand).map(s => ({
    t: s.t, reel: s.reel, dist: +Math.hypot(s.leftHand[0] - s.victimX, s.leftHand[2]).toFixed(3) }));
  out.handToVictim = { first: hand[0] ?? null, last: hand.at(-1) ?? null,
    min: hand.length ? +Math.min(...hand.map(h => h.dist)).toFixed(3) : null };
  const moving = samples.filter(s => s.reel);
  out.victimTravel = moving.length > 1 ? +(moving[0].victimX - moving.at(-1).victimX).toFixed(3) : 0;
  console.log('feet ' + JSON.stringify(out.feet) + ' victimTravel ' + out.victimTravel
    + ' handDist ' + JSON.stringify(out.handToVictim));

  const rel = [];
  for (let i = 0; i < 40; i++) {
    rel.push(await page.evaluate(() => window.__live.sample()));
    await page.waitForTimeout(45);
    if (rel.at(-1).intensity == null && i > 4) break;
  }
  // Start measuring only once the ease has actually begun. Sampling a still-held overlay and calling
  // the result "release motion" is what produced the earlier 76 deg artefact.
  let releaseStart = 0;
  for (let i = 1; i < rel.length; i++) {
    const prev = rel[i - 1].intensity, cur = rel[i].intensity;
    if (prev != null && (cur == null || cur < prev)) { releaseStart = i - 1; break; }
  }
  out.releaseStartSample = releaseStart;
  out.releaseWindowValid = rel.some((r, i) => i >= releaseStart && r.intensity == null) || releaseStart > 0;
  const relDeltas = [];
  for (let i = Math.max(1, releaseStart + 1); i < rel.length; i++) {
    let worst = { joint: null, deg: 0 };
    for (const n of NAME) {
      const d = angleDeg(rel[i - 1].quats[n], rel[i].quats[n]);
      if (d != null && d > worst.deg) worst = { joint: n, deg: d };
    }
    relDeltas.push({ worstJoint: worst.joint, worstDeg: worst.deg, intensity: rel[i].intensity });
  }
  let settledVsIdle = { joint: null, deg: 0 };
  for (const n of NAME) {
    const d = angleDeg(idle.pose[n], rel.at(-1).quats[n]);
    if (d != null && d > settledVsIdle.deg) settledVsIdle = { joint: n, deg: d };
  }
  out.release = { clearedAtSample: rel.findIndex((r, i) => i >= releaseStart && r.intensity == null),
    worstFrameDelta: relDeltas.reduce((a, b) => (b.worstDeg > a.worstDeg ? b : a), { worstDeg: 0 }),
    settledVersusIdle: settledVsIdle };
  console.log('release ' + JSON.stringify({ clearedAtSample: out.release.clearedAtSample,
    worst: out.release.worstFrameDelta, settled: settledVsIdle }));

  out.cleanup = {};
  for (const kind of ['interrupt', 'match-end']) {
    await page.evaluate(k => window.__live.interrupt(k), kind);
    const after = [];
    for (let i = 0; i < 12; i++) {
      after.push(await page.evaluate(() => window.__live.sample()));
      await page.waitForTimeout(45);
    }
    const cd = [];
    for (let i = 1; i < after.length; i++) {
      let worst = { joint: null, deg: 0 };
      for (const n of NAME) {
        const d = angleDeg(after[i - 1].quats[n], after[i].quats[n]);
        if (d != null && d > worst.deg) worst = { joint: n, deg: d };
      }
      cd.push(worst);
    }
    let vsIdle = { joint: null, deg: 0 };
    for (const n of NAME) {
      const d = angleDeg(idle.pose[n], after.at(-1).quats[n]);
      if (d != null && d > vsIdle.deg) vsIdle = { joint: n, deg: d };
    }
    out.cleanup[kind] = { worstFrameDelta: cd.reduce((a, b) => (b.worstDeg > a.worstDeg ? b : a), { worstDeg: 0 }),
      intensityClearedAt: after.findIndex(r => r.intensity == null), settledVersusIdle: vsIdle };
    console.log('cleanup ' + kind + ' ' + JSON.stringify(out.cleanup[kind]));
  }

  await page.close();
  return out;
}

const envViewports = (process.env.CAPTURE_VIEWPORT || '').split(',').filter(Boolean)
  .map(s => s.split('x').map(Number)).filter(([w, h]) => w > 0 && h > 0);
const cfg = envViewports.length
  ? envViewports.map(([w, h]) => [w, h, { capture: true }])
  : [[640, 360, { capture: true }], [480, 270, {}], [900, 560, {}]];
for (const [w, h, opt] of cfg) {
  try { report.runs[w + 'x' + h] = await measure(w, h, opt); }
  catch (e) {
    report.runs[w + 'x' + h] = { error: String(e.message || e).slice(0, 400) };
    console.log('run ' + w + 'x' + h + ' ERROR ' + String(e.message || e).slice(0, 200));
  }
}

const r = report.runs['640x360'] || {};
report.summary = {
  fpsByViewport: Object.fromEntries(cfg.map(([w, h]) => [w + 'x' + h, report.runs[w + 'x' + h]?.fps?.fps ?? null])),
  medianFrameGapMsAt640: r.medianFrameGapMs ?? null,
  gameTimeCoveredAt640: r.gameTimeCovered ?? null,
  wallTimeCoveredAt640: r.wallTimeCovered ?? null,
  normalSpeedClaimed: (r.fps?.fps ?? 0) >= 30,
  feet: r.feet ?? null, victimTravel: r.victimTravel ?? null, handToVictim: r.handToVictim ?? null,
  worstFrameDelta: r.worstFrameDelta ?? null,
  release: r.release ?? null, cleanup: r.cleanup ?? null, framesCaptured: r.shots?.length ?? 0
};
console.log('summary ' + JSON.stringify(report.summary));
await writeFile(resolve(outDir, 'capture-live-298-6.json'), JSON.stringify(report, null, 2));
console.log('written');
await browser.close();
await new Promise(done => server.close(done));
