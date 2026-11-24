// Lasso acceptance — ONE command, run on a GPU machine. Never promotes the animation.
//
//   npm run accept:lasso                 headless (still uses the machine GPU where available)
//   LASSO_HEADED=1 npm run accept:lasso  headed, for watching the run
//
// It refuses to grade a software renderer: on SwiftShader/llvmpipe the frame rate is an artefact of
// the environment, not of the lasso, so the run exits 2 with `environment-rejected` instead of
// inventing a pass or blaming the animation.
//
// Scenarios: plant -> haul -> release (natural), and an interruption during the haul.
// Acceptance needs: >= 30 fps median, all four transitions observed, no per-frame joint snap, root
// motion inside the per-reel caster budget, the module byte-identical, and zero page errors.
//
// Exit codes: 0 accepted, 1 failed, 2 environment-rejected.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const REQUIRED_FPS = 30;
/** The defect this phase removed measured 30.9 deg of forearm in one frame; 25 is the ceiling. */
const MAX_FRAME_DEG = 25;
/** experiments.js `casterMax` for the per-reel budget. */
const CASTER_BUDGET_M = 0.1;
/** The reviewed implementation; a different hash means this is not the build that was reviewed. */
const EXPECTED_SHA = '7925375f';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifacts = resolve(root, 'artifacts', 'lasso', stamp);
await mkdir(artifacts, { recursive: true });

const modulePath = resolve(root, 'public/js/combat/lasso_haul.js');
const sha = createHash('sha256').update(await readFile(modulePath)).digest('hex').slice(0, 8);

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}');
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { stamp, sha, expectedSha: EXPECTED_SHA, requiredFps: REQUIRED_FPS, scenarios: [], errors: [], limitations: [] };
let browser;
try {
  browser = await chromium.launch({
    headless: process.env.LASSO_HEADED !== '1',
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  report.missing = [];
  page.on('response', response => { if (response.status() === 404) report.missing.push(new URL(response.url()).pathname); });
  page.on('pageerror', error => report.errors.push('pageerror: ' + error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // The static test server intentionally serves no favicon; that 404 is not a rendering error.
    if (/favicon/i.test(message.text())) return;
    report.errors.push('console: ' + message.text());
  });

  // The reel experiment is opt-in; the query is the documented channel for a measurement run.
  await page.goto(origin + '/public/index.html?exp=grab-continuity-pull', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2,
    null, { timeout: 180_000, polling: 250 });

  report.gpu = await page.evaluate(() => {
    const gl = window.__browserSmashRenderer?.getContext?.();
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    };
  });
  report.softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(String(report.gpu?.renderer || ''));

  // A passive opponent keeps every run comparable; it is the shipped training-dummy switch, not a
  // modification of the fight.
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.select('p1', 'Wonder Woman');
    window.__browserSmashSelect?.select('p2', 'Superman');
    document.querySelector('#play')?.click();
  });
  await page.waitForTimeout(2600);

  const runScenario = async (name, { interruptAfterMs = 0 } = {}) => {
    const start = await page.evaluate(async () => {
      const [p1, p2] = window.fighters || [];
      if (!p1 || !p2) return { ok: false, reason: 'no fighters' };
      p1.meter = 100;
      // Deterministic stage: the grab ultimate has a 12 m range, and the arena spawn distance varies by
      // layout. Placing the pair at 5.5 m removes a whiff from the measurement without touching the
      // simulation or the record.
      const facing = p1.facing || 1;
      p2.position.set(p1.position.x + facing * 5.5, p1.position.y, p1.position.z);
      p2.velocity?.set?.(0, 0, 0);
      p2.hitstun = 0; p2.invulnerable = 0; p1.hitstun = 0;
      window.__browserSmashHaulTrace = [];
      window.__lassoRun = { frames: [], stop: false, reelSeq: 0, lastReel: null };
      let last = performance.now();
      const tick = now => {
        const run = window.__lassoRun;
        if (!run || run.stop) return;
        const fighter = window.fighters?.[0];
        const state = fighter?.__haul;
        const other = window.fighters?.[1];
        // Each reel is its own object on the target, so identity changes mark a new reel, and its
        // `casterMoved` is the ground given up BY THAT REEL - the quantity the per-reel budget
        // governs. Aggregate root travel cannot reveal one reel overshooting while another gave
        // up nothing.
        const reel = other?.grabReel && other.grabReel.record ? other.grabReel : null;
        if (reel && reel !== run.lastReel) { run.reelSeq += 1; run.lastReel = reel; }
        run.frames.push({
          ms: +(now - last).toFixed(2),
          beat: state?.beat || 'idle',
          intensity: state ? +state.intensity.toFixed(3) : 0,
          tug: state ? +state.tug.toFixed(3) : 0,
          rootX: +(fighter?.position?.x || 0).toFixed(4),
          gap: other && fighter ? +fighter.position.distanceTo(other.position).toFixed(3) : null,
          reelSeq: reel ? run.reelSeq : 0,
          casterMoved: reel ? +Number(reel.casterMoved || 0).toFixed(4) : null,
          casterMax: reel ? Number(reel.casterMax ?? 0) : null
        });
        last = now;
        if (run.frames.length < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      let cast = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        p1.meter = 100;
        cast = window.__browserSmashTryUltimate?.('p1');
        if (!(cast && typeof cast === 'object' && cast.ok === false && cast.reason === 'active')) break;
        await new Promise(done => setTimeout(done, 150));
      }
      // The cast returns the live ultimate record, which is circular through the scene graph. Keep only
      // the fields this report needs.
      const info = cast && typeof cast === 'object'
        ? (cast.ok === false ? { ok: false, reason: cast.reason ?? null } : { ok: true, label: cast.label ?? cast.def?.label ?? null })
        : { ok: Boolean(cast) };
      return { ok: info.ok, cast: info, gap: +p1.position.distanceTo(p2.position).toFixed(2) };
    });
    if (interruptAfterMs) {
      // Wait for the haul beat itself, then interrupt. Fixed delays are meaningless at any frame rate.
      await page.waitForFunction(() => (window.__browserSmashHaulTrace || []).some(entry => entry.beat === 'haul'),
        null, { timeout: interruptAfterMs }).catch(() => {});
      // The same field the hit resolver writes when a fighter is struck; the ultimate's own disruption
      // check reads it. No record or pose state is touched directly.
      await page.evaluate(() => { const p1 = window.fighters?.[0]; if (p1) p1.hitstun = Math.max(p1.hitstun || 0, .65); });
    }
    await page.screenshot({ path: resolve(artifacts, `${name}-mid.png`) });
    // Wait for the module's own trace to stop growing (release included), bounded.
    let lastLength = -1, stable = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(200);
      const length = await page.evaluate(() => window.__browserSmashHaulTrace?.length || 0);
      stable = length === lastLength ? stable + 1 : 0;
      lastLength = length;
      if (stable >= 3) break;
    }
    const result = await page.evaluate(() => {
      if (window.__lassoRun) window.__lassoRun.stop = true;
      return { frames: window.__lassoRun?.frames || [], trace: window.__browserSmashHaulTrace || [] };
    });
    const frames = result.frames.filter(f => f.ms > 0 && f.ms < 2000);
    const sorted = [...frames].map(f => f.ms).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const fps = median ? +(1000 / median).toFixed(1) : 0;
    const beats = [...new Set([...frames.map(f => f.beat), ...result.trace.map(entry => entry.beat)])]
      .filter(beat => beat && beat !== 'idle');
    const roots = frames.map(f => f.rootX);
    const rootTravel = roots.length ? +(Math.max(...roots) - Math.min(...roots)).toFixed(3) : 0;
    // Per-frame joint change, from the module's own per-frame trace. Trace entries share a frame with
    // several call sites, so equal timestamps are collapsed first.
    const joint = result.trace.filter((entry, index, all) => index === 0 || entry.t !== all[index - 1].t);
    let maxDeg = 0;
    for (let i = 1; i < joint.length; i++) {
      for (const key of ['torsoX', 'rightForeX']) {
        const a = joint[i - 1][key], b = joint[i][key];
        if (typeof a !== 'number' || typeof b !== 'number') continue;
        maxDeg = Math.max(maxDeg, Math.abs(b - a) * 180 / Math.PI);
      }
    }
    const reelMap = new Map();
    for (const frame of frames) {
      if (!frame.reelSeq) continue;
      const entry = reelMap.get(frame.reelSeq) || { seq: frame.reelSeq, casterMoved: 0, casterMax: null };
      entry.casterMoved = Math.max(entry.casterMoved, Number(frame.casterMoved) || 0);
      if (frame.casterMax != null) entry.casterMax = frame.casterMax;
      reelMap.set(frame.reelSeq, entry);
    }
    const reelDisplacements = [...reelMap.values()].map(r => ({ ...r, casterMoved: +r.casterMoved.toFixed(3) }));
    const maxReelDisplacementM = reelDisplacements.length ? Math.max(...reelDisplacements.map(r => r.casterMoved)) : 0;
    const strikes = result.trace.length
      ? await page.evaluate(() => (window.__browserSmashGrabTrace || []).filter(entry => entry.outcome === 'strike').length)
      : 0;
    const scenario = {
      name, cast: start.cast, reels: strikes, startGap: start.gap ?? null,
      frames: frames.length, fps, beats, castLabel: start.cast?.label ?? null, castReason: start.cast?.reason ?? null,
      beatsObserved: ['plant', 'haul', 'settle'].filter(beat => beats.includes(beat)),
      rootTravelM: rootTravel, maxJointDegPerFrame: +maxDeg.toFixed(1),
      reelDisplacements, maxReelDisplacementM,
      interrupted: Boolean(interruptAfterMs),
      haulSamples: joint.length
    };
    report.scenarios.push(scenario);
    return scenario;
  };

  const natural = await runScenario('natural');
  const interrupted = await runScenario('interruption', { interruptAfterMs: 8000 });

  // Three outcomes, never blurred: PASS was measured and inside limits, UNMEASURED could not be
  // measured in this environment, FAIL was measured and outside limits.
  const results = { pass: [], fail: [], unmeasured: [] };
  const expect = (name, ok, detail, { frameDependent = false } = {}) => {
    const label = `${name}${detail ? ' — ' + detail : ''}`;
    if (frameDependent && report.softwareRenderer) results.unmeasured.push(label);
    else if (ok) results.pass.push(label);
    else results.fail.push(label);
  };

  expect('module hash is the reviewed build', sha === EXPECTED_SHA, `sha ${sha} vs ${EXPECTED_SHA}`);
  for (const scenario of report.scenarios) {
    const beatsNeeded = scenario.interrupted ? ['plant', 'haul'] : ['plant', 'haul', 'settle'];
    for (const beat of beatsNeeded) {
      expect(`${scenario.name}: beat "${beat}" observed`, scenario.beats.includes(beat), `saw ${scenario.beats.join('>') || 'none'}`);
    }
    // Frame-rate independent: casterMoved is simulation state, so a software renderer can still
    // grade the per-reel budget honestly.
    expect(`${scenario.name}: every reel within the ${CASTER_BUDGET_M} m budget`,
      scenario.reelDisplacements.length > 0
        && scenario.reelDisplacements.every(reel => reel.casterMoved <= CASTER_BUDGET_M + 1e-6),
      scenario.reelDisplacements.length
        ? `per reel ${scenario.reelDisplacements.map(reel => reel.casterMoved + 'm').join(', ')} (max ${scenario.maxReelDisplacementM}m)`
        : 'no reel observed');
    expect(`${scenario.name}: total root travel matches the reels`,
      scenario.rootTravelM <= scenario.reelDisplacements.length * CASTER_BUDGET_M + .05,
      `total ${scenario.rootTravelM}m over ${scenario.reelDisplacements.length} reel(s)`);
    expect(`${scenario.name}: joint change <= ${MAX_FRAME_DEG} deg/frame`, scenario.maxJointDegPerFrame <= MAX_FRAME_DEG,
      `${scenario.maxJointDegPerFrame} deg/frame`, { frameDependent: true });
    expect(`${scenario.name}: median frame rate >= ${REQUIRED_FPS} fps`, scenario.fps >= REQUIRED_FPS,
      `${scenario.fps} fps`, { frameDependent: true });
    if (scenario.interrupted && !scenario.beats.includes('settle')) report.limitations.push(`${scenario.name}: no settle beat recorded after the interruption`);
  }
  expect('no page or console errors', report.errors.length === 0, report.errors.slice(0, 3).join(' | '));

  report.results = results;
  report.verdict = results.fail.length ? 'fail' : results.unmeasured.length ? 'unmeasured' : 'pass';
  report.promoted = false;
  await writeFile(resolve(artifacts, 'lasso-acceptance.json'), JSON.stringify(report, null, 2));

  console.log(`lasso acceptance · ${stamp}`);
  console.log(`module sha ${sha} ${sha === EXPECTED_SHA ? '(matches reviewed build)' : `(EXPECTED ${EXPECTED_SHA})`}`);
  console.log(`renderer: ${report.gpu?.renderer || 'unknown'}${report.softwareRenderer ? '  [SOFTWARE]' : ''}`);
  for (const scenario of report.scenarios) {
    const reels = scenario.reelDisplacements.length
      ? scenario.reelDisplacements.map(reel => `${reel.casterMoved}m`).join('/')
      : 'none';
    console.log(`  ${scenario.name.padEnd(13)} fps=${String(scenario.fps).padStart(5)} cast=${scenario.cast?.ok ? (scenario.castLabel || 'ok') : 'FAILED:' + (scenario.castReason || '?')}`
      + ` gap=${scenario.startGap} beats=${scenario.beats.join('>') || 'none'} joint=${scenario.maxJointDegPerFrame}deg/frame`
      + ` reels=${reels} maxReel=${scenario.maxReelDisplacementM}m total=${scenario.rootTravelM}m`);
  }
  for (const [bucket, label] of [['pass', 'PASS'], ['unmeasured', 'UNMEASURED'], ['fail', 'FAIL']]) {
    console.log(`${label} (${results[bucket].length})`);
    for (const item of results[bucket]) console.log(`  ${label.padEnd(10)} ${item}`);
  }
  console.log('limitations:', report.limitations.length ? report.limitations.join('; ') : 'none');
  console.log(`evidence: ${artifacts}`);
  console.log('PROMOTION: not performed — this run records evidence only.');

  if (report.verdict === 'fail') {
    console.log('VERDICT FAIL: a measurement exceeded a limit. lasso_haul.js was not modified.');
    process.exitCode = 1;
  } else if (report.verdict === 'unmeasured') {
    console.log(`VERDICT UNMEASURED: this environment cannot demonstrate ${REQUIRED_FPS}+ fps.`);
    console.log('         The lasso is neither accepted nor rejected by this run; re-run on a GPU machine.');
    process.exitCode = 2;
  } else {
    console.log(`VERDICT PASS: >= ${REQUIRED_FPS} fps, all transitions, every reel inside budget, no snap.`);
    console.log('         Promotion is still a manual decision; enabling the experiment by default is separate.');
    process.exitCode = 0;
  }
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
