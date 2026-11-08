// Phase 29.8.2 — a matched A/B that cannot lie about whether a reel happened.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298-2-ab.mjs
//
// The 29.8.1 control never entered a reel, so it could not attribute the entry spike. This audit:
//   1. runs the cast with the overlay ON and again with it OFF, same gap, same setup;
//   2. records the reel flag, the record's fired-event count and a reel id on EVERY sampled frame;
//   3. FAILS (non-zero exit) if either trace has no reel - no comparison result is produced;
//   4. aligns the two traces on the first frame of the reel, not on frame index;
//   5. reports per authored joint the angular change per tick plus the overlay differential
//      (on vs off at the same reel-relative tick), separating overlay motion from the move's own;
//   6. reports intensity and tug deltas at the worst frame, so a first-frame pose-strength jump is
//      distinguishable from a tug-value jump.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

// Every bone named by PLANT/HAUL in public/js/combat/lasso_haul.js.
const AUTHORED = ['pelvis', 'torso', 'head', 'leftClavicle', 'rightClavicle', 'leftArm', 'leftFore',
  'leftHand', 'rightArm', 'rightFore', 'rightHand', 'leftLeg', 'leftShin', 'leftFoot', 'rightLeg',
  'rightShin', 'rightFoot'];
const GAPS = [3.0, 2.2, 4.0];

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
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: await readFile(resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''))) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
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

await page.evaluate(names => {
  const renderer = window.__browserSmashRenderer;
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const CASTER = () => window.fighters[1];
  const VICTIM = () => window.fighters[0];
  let reelId = 0;
  let wasReel = false;
  const q = (f, name) => {
    const j = f.model?.userData?.[name];
    return j?.quaternion ? [+j.quaternion.x.toFixed(6), +j.quaternion.y.toFixed(6),
      +j.quaternion.z.toFixed(6), +j.quaternion.w.toFixed(6)] : null;
  };
  window.__ab = {
    begin({ noHaul = false, gap = 3.0, budget = 'plant' } = {}) {
      const caster = CASTER(), victim = VICTIM();
      window.combatPowers.clear('p298ab');
      window.__browserSmashNoHaul = noHaul;
      window.__browserSmashCasterBudget = budget;
      for (const f of [caster, victim]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.grabReel = null; f.model.visible = true;
      }
      caster.position.set(0, caster.groundLevel ?? 0, 0); caster.facing = 1;
      victim.position.set(gap, victim.groundLevel ?? 0, 0); victim.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashExperiments = { 'grab-continuity-pull': true };
      window.__browserSmashStep(1 / 60);
      caster.meter = 100;
      const rec = window.combatPowers.tryUltimate(caster);
      window.__abRecord = rec;
      reelId = 0; wasReel = false;
      return { ok: rec?.ok !== false, label: rec?.label ?? null, total: rec?.total ?? null };
    },
    step(tick) {
      const caster = CASTER(), victim = VICTIM();
      window.__browserSmashStep(1 / 60);
      window.combatPowers.applyCinematicPose?.(1 / 60);
      const rec = window.__abRecord;
      const reel = Boolean(victim.grabReel);
      if (reel && !wasReel) reelId++;
      wasReel = reel;
      const quats = {};
      for (const name of names) quats[name] = q(caster, name);
      return {
        tick, t: +(Number(rec?.t) || 0).toFixed(3),
        reel, reelId, fired: Number(rec?.fired) || 0,
        intensity: rec?.__haul ? +rec.__haul.intensity.toFixed(4) : null,
        tug: rec?.__haul ? +rec.__haul.tug.toFixed(4) : null,
        victimPercent: +(victim.percent || 0).toFixed(1), victimX: +victim.position.x.toFixed(3),
        quats
      };
    }
  };
}, AUTHORED);

const angleDeg = (a, b) => {
  if (!a || !b) return null;
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(3);
};

async function runTrace({ noHaul, gap, ticks = 150 }) {
  const begin = await page.evaluate(([nh, g]) => window.__ab.begin({ noHaul: nh, gap: g }), [noHaul, gap]);
  if (!begin.ok) return { begin, rows: [], reels: 0, error: 'cast refused' };
  const rows = [];
  for (let i = 0; i < ticks; i++) rows.push(await page.evaluate(t => window.__ab.step(t), i));
  return { begin, rows, reels: rows.filter(r => r.reel).length,
    firstReel: rows.find(r => r.reel)?.tick ?? null, events: rows.at(-1)?.fired ?? 0 };
}

function perTick(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const deltas = {};
    let worst = { joint: null, deg: 0 };
    for (const name of AUTHORED) {
      const deg = angleDeg(rows[i - 1].quats[name], rows[i].quats[name]);
      if (deg == null) continue;
      deltas[name] = deg;
      if (deg > worst.deg) worst = { joint: name, deg };
    }
    out.push({ tick: rows[i].tick, t: rows[i].t, worstJoint: worst.joint, worstDeg: worst.deg, deltas,
      intensity: rows[i].intensity, tug: rows[i].tug,
      intensityDelta: rows[i].intensity != null && rows[i - 1].intensity != null
        ? +(rows[i].intensity - rows[i - 1].intensity).toFixed(4) : null,
      tugDelta: rows[i].tug != null && rows[i - 1].tug != null
        ? +(rows[i].tug - rows[i - 1].tug).toFixed(4) : null });
  }
  return out;
}

function differential(a, b) {
  const baseA = a.rows.find(r => r.reel)?.tick;
  const baseB = b.rows.find(r => r.reel)?.tick;
  if (baseA == null || baseB == null) return null;
  const span = Math.min(a.rows.length - baseA, b.rows.length - baseB);
  const out = [];
  for (let k = 0; k < span; k++) {
    const ra = a.rows[baseA + k], rb = b.rows[baseB + k];
    const deltas = {};
    let worst = { joint: null, deg: 0 };
    for (const j of AUTHORED) {
      const deg = angleDeg(ra.quats[j], rb.quats[j]);
      if (deg == null) continue;
      deltas[j] = deg;
      if (deg > worst.deg) worst = { joint: j, deg };
    }
    out.push({ k, tickA: ra.tick, tickB: rb.tick, reelA: ra.reel, reelB: rb.reel,
      intensityA: ra.intensity, tugA: ra.tug, worstJoint: worst.joint, worstDiff: worst.deg, deltas });
  }
  return out;
}

const results = { gapUsed: null, traces: {}, verdicts: {} };
let A = null, B = null;
for (const gap of GAPS) {
  A = await runTrace({ noHaul: false, gap });
  B = await runTrace({ noHaul: true, gap });
  const okA = A.reels > 0, okB = B.reels > 0;
  console.log('gap ' + gap + ' on reels=' + A.reels + ' firstReelTick=' + A.firstReel + ' events=' + A.events
    + ' | off reels=' + B.reels + ' firstReelTick=' + B.firstReel + ' events=' + B.events);
  if (okA && okB) { results.gapUsed = gap; break; }
  console.log('gap ' + gap + ' REJECTED: '
    + (!okA ? 'overlay-on trace never entered a reel. ' : '')
    + (!okB ? 'overlay-off control never entered a reel, so no comparison is valid.' : ''));
}

results.traces.on = { reels: A.reels, firstReelTick: A.firstReel, events: A.events, frames: A.rows.length };
results.traces.off = { reels: B.reels, firstReelTick: B.firstReel, events: B.events, frames: B.rows.length };

if (results.gapUsed == null) {
  console.log('AUDIT FAILED: no gap produced a reel in both traces; no comparison produced.');
  await writeFile(resolve(outDir, 'grab-haul-ab.json'), JSON.stringify({
    kind: 'grab-haul-ab', generatedAt: new Date().toISOString(), failed: true,
    reason: 'at least one trace never entered a reel at any tested gap', gapsTried: GAPS,
    traces: results.traces, pageErrors }, null, 2));
  process.exitCode = 2;
} else {
  const onTicks = perTick(A.rows);
  const offTicks = perTick(B.rows);
  const diff = differential(A, B);
  const worstOn = onTicks.reduce((x, y) => (y.worstDeg > x.worstDeg ? y : x), { worstDeg: 0 });
  const worstOff = offTicks.reduce((x, y) => (y.worstDeg > x.worstDeg ? y : x), { worstDeg: 0 });
  const worstDiff = (diff || []).reduce((x, y) => (y.worstDiff > x.worstDiff ? y : x), { worstDiff: 0 });
  const atReel = onTicks.find(r => r.tick === A.firstReel) || null;
  results.verdicts = {
    overlayOnWorst: { tick: worstOn.tick, joint: worstOn.worstJoint, deg: worstOn.worstDeg,
      intensity: worstOn.intensity, tug: worstOn.tug, intensityDelta: worstOn.intensityDelta,
      tugDelta: worstOn.tugDelta },
    overlayOffWorst: { tick: worstOff.tick, joint: worstOff.worstJoint, deg: worstOff.worstDeg },
    firstReelFrame: atReel ? { tick: atReel.tick, joint: atReel.worstJoint, deg: atReel.worstDeg,
      intensityDelta: atReel.intensityDelta, tugDelta: atReel.tugDelta,
      perJoint: Object.entries(atReel.deltas).sort((a, b) => b[1] - a[1]).slice(0, 5) } : null,
    worstOverlayDifferential: { k: worstDiff.k, tickA: worstDiff.tickA, joint: worstDiff.worstJoint,
      deg: worstDiff.worstDiff, intensityA: worstDiff.intensityA, tugA: worstDiff.tugA },
    // Compare the differential's ANGLE (worstDiff.worstDiff) with the control's own worst tick. The
    // earlier version read `worstDiff.deg`, which does not exist, so every run printed the negative
    // verdict regardless of the numbers.
    attribution: worstDiff.worstDiff > 5 && worstDiff.worstDiff > worstOff.worstDeg * 1.5
      ? 'overlay-owned' : 'not distinguishable from the move'
  };
  console.log('on-worst ' + JSON.stringify(results.verdicts.overlayOnWorst));
  console.log('off-worst ' + JSON.stringify(results.verdicts.overlayOffWorst));
  console.log('first-reel-frame ' + JSON.stringify(results.verdicts.firstReelFrame));
  console.log('worst-differential ' + JSON.stringify(results.verdicts.worstOverlayDifferential)
    + ' -> ' + results.verdicts.attribution);

  // Entry progression across the first six frames of the reel.
  const entryFrames = onTicks.filter(r => r.tick >= A.firstReel - 1 && r.tick <= A.firstReel + 5)
    .map(r => ({ tick: r.tick, intensity: r.intensity, intensityDelta: r.intensityDelta,
      worstDeg: r.worstDeg, joint: r.worstJoint }));
  // The tug transition that used to snap: the largest single-frame tug change and its neighbourhood.
  const tugPeak = onTicks.reduce((x, y) => (Math.abs(y.tugDelta ?? 0) > Math.abs(x.tugDelta ?? 0) ? y : x), { tugDelta: 0 });
  const tugWindow = onTicks.filter(r => Math.abs(r.tick - (tugPeak.tick ?? 0)) <= 3)
    .map(r => ({ tick: r.tick, tug: r.tug, tugDelta: r.tugDelta, worstDeg: r.worstDeg, joint: r.worstJoint }));
  // Hand-back still releasing, on the same cast.
  const exits = {};
  for (const kind of ['interrupt', 'match-end']) {
    await page.evaluate(g => window.__ab.begin({ gap: g }), results.gapUsed);
    for (let i = 0; i < 54; i++) await page.evaluate(t => window.__ab.step(t), i);
    await page.evaluate(k => {
      const caster = window.fighters[1];
      if (k === 'interrupt') window.combatPowers.clear('test-interrupt');
      else { caster.ko = true; window.combatPowers.clear('match-end'); }
    }, kind);
    let clearedAt = null;
    for (let i = 0; i < 24; i++) {
      const row = await page.evaluate(async t => {
        const r = window.__ab.step(t);
        await new Promise(res => setTimeout(res, 16));
        return r;
      }, 0);
      if (row.intensity == null && clearedAt == null) clearedAt = i;
    }
    exits[kind] = { clearedAtTick: clearedAt };
  }
  results.verdicts.entryFrames = entryFrames;
  results.verdicts.tugWindow = tugWindow;
  results.verdicts.exits = exits;
  results.verdicts.combat = { maxVictimPercent: Math.max(0, ...A.rows.map(r => r.victimPercent ?? 0)),
    drawIn: +(A.rows[0].victimX - A.rows.at(-1).victimX).toFixed(3) };
  console.log('entry ' + JSON.stringify(entryFrames));
  console.log('tug-window ' + JSON.stringify(tugWindow));
  console.log('exits ' + JSON.stringify(exits) + ' combat ' + JSON.stringify(results.verdicts.combat));
  await writeFile(resolve(outDir, 'grab-haul-ab.json'), JSON.stringify({
    kind: 'grab-haul-ab', generatedAt: new Date().toISOString(), failed: false,
    gapUsed: results.gapUsed, traces: results.traces, verdicts: results.verdicts,
    note: 'aligned on the first reel frame; authored joints only; reel flag + fired count on every sample',
    onTicks, offTicks, diff, pageErrors }, null, 2));
  console.log('ab written, page errors ' + pageErrors.length);
}
await browser.close();
await new Promise(done => server.close(done));
