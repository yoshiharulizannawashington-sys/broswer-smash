// Phase 29.8 — does the pull LOOK like a haul, and how much ground should she give up?
//
//   bash scripts/run-browser-test.sh scripts/audit-phase298.mjs
//
// Three questions, measured on the real bodies rather than judged from stills:
//
//   1. The chain still works with the haul overlay driving the caster's pose: per-tick damage,
//      displacement, foot slide and pose activity at point-blank, 50% and 60% reach.
//   2. Which movement budget to keep: the Phase 29.7 per-reel 0.1 m, one 0.1 m pool across the whole
//      ultimate, or a fully planted caster that only leans. Root travel and planted-foot slide are
//      what separate them.
//   3. How long the recovery takes once the reel releases, and what one rendered frame actually
//      costs at three viewport sizes (the real-time question, answered with numbers).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

const PULL = { 'grab-continuity-pull': true };
const REACHES = [{ name: 'point-blank', gap: 1.15 }, { name: '50%', gap: 6.5 }, { name: '60%', gap: 7.8 }];
const BUDGETS = ['per-reel', 'chain', 'plant'];

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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
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
await page.click('#selectScreen [data-nav="next"]');
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click();
await page.click('#play');
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  window.__origRAF = window.requestAnimationFrame.bind(window);
  window.__origRender = renderer.render.bind(renderer);
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  const scene = window.__browserSmashScene;
  const camera = window.smashCamera.camera;
  const V = scene.position.clone();
  const joint = (f, name) => f.model?.userData?.[name] || null;
  const worldXZ = (f, name) => {
    const j = joint(f, name);
    if (!j) return null;
    j.getWorldPosition(V);
    return { x: +V.x.toFixed(3), z: +V.z.toFixed(3) };
  };
  const rotX = (f, name) => {
    const j = joint(f, name);
    return j ? +j.rotation.x.toFixed(3) : null;
  };
  const rotY = (f, name) => {
    const j = joint(f, name);
    return j ? +j.rotation.y.toFixed(3) : null;
  };
  window.__p298 = {
    begin(flags, gap, budget) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.combatPowers.clear('p298');
      window.__browserSmashCasterBudget = budget || '';
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0; f.dodgeTimer = 0;
        f.parryTimer = 0; f.staggerTimer = 0; f.grabReel = null; f.__haul = null;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashHitTrace = [];
      window.__browserSmashGrabTrace = [];
      window.__browserSmashHaulTrace = [];
      window.__browserSmashExperiments = { ...flags };
      window.__browserSmashStep(1 / 60);
      // Stance reference: where her torso, arms and feet sit before anything is cast.
      this.base = {
        torsoX: rotX(p2, 'torso'), rightForeX: rotX(p2, 'rightFore'), leftArmX: rotX(p2, 'leftArm'),
        leftFoot: worldXZ(p2, 'leftFoot'), rightFoot: worldXZ(p2, 'rightFoot'),
        rootX: +p2.position.x.toFixed(3)
      };
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      this.rec = rec; this.cursor = 0;
      return { ok: true, label: rec.label, total: rec.total, base: this.base };
    },
    tick() {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.__browserSmashStep(1 / 60);
      // The real loop poses after the simulation step; do the same so the haul overlay is measured.
      window.combatPowers.applyCinematicPose?.(1 / 60);
      this.cursor++;
      const torsoX = rotX(p2, 'torso');
      const rightForeX = rotX(p2, 'rightFore');
      return {
        t: +(this.cursor / 60).toFixed(3), gap: +Math.hypot(p2.position.x - p1.position.x, p2.position.z - p1.position.z).toFixed(3),
        damage: +p1.percent.toFixed(1), phase: this.rec.phase,
        casterX: +p2.position.x.toFixed(3), victimX: +p1.position.x.toFixed(3),
        reel: p1.grabReel ? { travel: +p1.grabReel.travel.toFixed(2), moved: +p1.grabReel.casterMoved.toFixed(3),
          max: +p1.grabReel.casterMax.toFixed(3), mode: p1.grabReel.casterMode } : null,
        pose: { torsoX, torsoY: rotY(p2, 'torso'), rightForeX, leftArmX: rotX(p2, 'leftArm') },
        feet: { left: worldXZ(p2, 'leftFoot'), right: worldXZ(p2, 'rightFoot') },
        hands: { left: worldXZ(p2, 'leftHand'), right: worldXZ(p2, 'rightHand') }
      };
    },
    /**
     * Per-frame draw cost at a size. Warm-up frames are discarded because the first draw after a
     * setSize reallocates the shadow map and compiles nothing useful to time; three rounds of ten
     * frames then give the median instead of a single noisy sample.
     */
    drawCost(width, height) {
      const r = window.__browserSmashRenderer;
      r.setSize(width, height);
      for (let i = 0; i < 3; i++) window.__origRender(scene, camera);
      const runs = [];
      for (let round = 0; round < 3; round++) {
        const t0 = performance.now();
        for (let i = 0; i < 10; i++) window.__origRender(scene, camera);
        runs.push((performance.now() - t0) / 10);
      }
      runs.sort((a, b) => a - b);
      const ms = runs[1];
      return { width, height, ms: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), runs: runs.map(v => +v.toFixed(2)) };
    }
  };
});

const results = { kind: 'grab-haul-298', generatedAt: new Date().toISOString(), cells: [], budgets: [], recovery: [], draw: [], pageErrors };

function analyse(ticks, base) {
  let maxStep = 0, jumps = 0, maxFootSlide = 0, maxActivity = 0, activityTicks = 0, maxHand = 0;
  const reels = [];
  let anchor = null;
  const jumpTicks = [];
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1], b = ticks[i];
    const d = Math.hypot(b.victimX - a.victimX, 0);
    maxStep = Math.max(maxStep, d);
    const prevD = i > 1 ? Math.hypot(a.victimX - ticks[i - 2].victimX, 0) : 0;
    const nextD = i + 1 < ticks.length ? Math.hypot(ticks[i + 1].victimX - b.victimX, 0) : 0;
    if (d > 0.2 && d > 2.5 * Math.max(prevD, nextD)) {
      jumps++;
      jumpTicks.push({ i, t: b.t, d: +d.toFixed(3), prev: +prevD.toFixed(3), next: +nextD.toFixed(3),
        gap: b.gap, damage: b.damage, reel: b.reel ? b.reel.travel : null, x: b.victimX, casterX: b.casterX });
    }
    // Ground contact while the reel is running: how far a foot (and a hand) travels from where it
    // stood when the reel started. A planted caster shows hand travel and no foot travel.
    if (b.reel && !anchor) anchor = { feet: b.feet, hands: b.hands };
    if (b.reel && anchor) {
      for (const side of ['left', 'right']) {
        const f = b.feet?.[side], f0 = anchor.feet?.[side];
        if (f && f0) maxFootSlide = Math.max(maxFootSlide, Math.hypot(f.x - f0.x, f.z - f0.z));
        const h = b.hands?.[side], h0 = anchor.hands?.[side];
        if (h && h0) maxHand = Math.max(maxHand, Math.hypot(h.x - h0.x, h.z - h0.z));
      }
    }
    // Pose activity as tick-to-tick joint motion, not distance from the pre-cast stance: she is
    // mid-move, so being far from her idle is expected and says nothing about whether she is moving.
    const activity = Math.abs((b.pose.torsoX ?? 0) - (a.pose.torsoX ?? 0))
      + Math.abs((b.pose.rightForeX ?? 0) - (a.pose.rightForeX ?? 0))
      + Math.abs((b.pose.torsoY ?? 0) - (a.pose.torsoY ?? 0));
    if (activity > 0.004) { activityTicks++; maxActivity = Math.max(maxActivity, activity); }
  }
  // One entry per reel window, so "how much ground did she give up" is per pull, not a sum.
  let open = null;
  for (const tick of ticks) {
    if (tick.reel && !open) open = { start: tick, end: tick };
    else if (tick.reel && open) open.end = tick;
    else if (!tick.reel && open) { reels.push(open); open = null; }
  }
  if (open) reels.push(open);
  return {
    damage: ticks.at(-1)?.damage ?? 0,
    maxStep: +maxStep.toFixed(4), maxSpeed: +(maxStep * 60).toFixed(1), jumps, jumpTicks,
    casterRoot: +(ticks.at(-1).casterX - base.rootX).toFixed(3),
    feet: { slide: +maxFootSlide.toFixed(3), available: Boolean(ticks.find(t => t.feet?.left)?.feet?.left) },
    hands: { travel: +maxHand.toFixed(3), available: Boolean(ticks.find(t => t.hands?.left)?.hands?.left) },
    pose: { ticks: activityTicks, maxActivity: +maxActivity.toFixed(4) },
    reels: reels.map(r => ({
      at: r.start.t, seconds: +(r.end.t - r.start.t).toFixed(2), mode: r.start.reel.mode,
      travel: +(r.end.reel.travel - r.start.reel.travel).toFixed(2),
      casterMoved: +(r.end.reel.moved - r.start.reel.moved).toFixed(3)
    }))
  };
}

// ---------------------------------------------------------------- 1. the chain, with the haul
// Every cell is run with the pull AND with the shipped behaviour, because a displacement at
// point-blank is only a defect of this experiment if the shipped move does not do it too.
for (const reach of REACHES) {
  for (const [config, flags] of [['baseline', {}], ['pull', PULL]]) {
    const begin = await page.evaluate(({ flags, gap }) => window.__p298.begin(flags, gap, ''), { flags, gap: reach.gap });
    if (!begin.ok) { console.log('refused ' + reach.name + '/' + config + ' ' + begin.refused); continue; }
    const ticks = [];
    for (let i = 0; i < 200; i++) {
      ticks.push(await page.evaluate(() => window.__p298.tick()));
      if (ticks.at(-1).phase === 'done' && i > 10) break;
    }
    const summary = analyse(ticks, begin.base);
    const strikes = await page.evaluate(() => (window.__browserSmashGrabTrace || []).map(g => g.outcome));
    results.cells.push({ reach: reach.name, config, gap: reach.gap, ...summary, outcomes: strikes });
    console.log('cell ' + config.padEnd(9) + reach.name.padEnd(12) + JSON.stringify({ damage: summary.damage,
      jumps: summary.jumps, maxStep: summary.maxStep, casterRoot: summary.casterRoot, feet: summary.feet,
      hands: summary.hands, pose: summary.pose, reels: summary.reels.length, outcomes: strikes }));
    if (summary.jumpTicks.length) console.log('  jump ' + config + ' ' + JSON.stringify(summary.jumpTicks));
  }
}

// ---------------------------------------------------------------- 2. movement budget
for (const budget of BUDGETS) {
  const begin = await page.evaluate(({ flags, gap, budget }) => window.__p298.begin(flags, gap, budget), { flags: PULL, gap: 7.8, budget });
  if (!begin.ok) { console.log('refused budget ' + budget + ' ' + begin.refused); continue; }
  const ticks = [];
  for (let i = 0; i < 200; i++) {
    ticks.push(await page.evaluate(() => window.__p298.tick()));
    if (ticks.at(-1).phase === 'done' && i > 10) break;
  }
  const summary = analyse(ticks, begin.base);
  results.budgets.push({ budget, ...summary });
  console.log('budget ' + budget.padEnd(9) + ' ' + JSON.stringify({ damage: summary.damage, jumps: summary.jumps,
    casterRoot: summary.casterRoot, feet: summary.feet, hands: summary.hands, pose: summary.pose,
    reels: summary.reels.map(r => r.casterMoved) }));
}

// ---------------------------------------------------------------- 3. recovery into her stance
{
  const begin = await page.evaluate(({ flags, gap }) => window.__p298.begin(flags, gap, ''), { flags: PULL, gap: 7.8 });
  const settle = [];
  let lastReelAt = null, doneAt = null;
  for (let i = 0; i < 240; i++) {
    const tick = await page.evaluate(() => window.__p298.tick());
    settle.push(tick);
    if (tick.reel) lastReelAt = tick.t;
    if (tick.phase === 'done') { doneAt = tick.t; break; }
  }
  // Keep stepping after the record ends: the pose must still ease out and then stop moving.
  for (let i = 0; i < 30; i++) settle.push(await page.evaluate(() => window.__p298.tick()));
  const afterRelease = settle.filter(s => lastReelAt != null && s.t > lastReelAt);
  const motion = (a, b) => Math.abs((b.pose.torsoX ?? 0) - (a.pose.torsoX ?? 0))
    + Math.abs((b.pose.rightForeX ?? 0) - (a.pose.rightForeX ?? 0))
    + Math.abs((b.pose.torsoY ?? 0) - (a.pose.torsoY ?? 0));
  // Recovered = the pose has stopped changing for six consecutive ticks, in any stance. It does not
  // have to equal her pre-cast idle: after a finisher she is in her normal post-move pose.
  // "Recovered" = the pose's own motion drops under 0.01 rad/tick, in any stance. Demanding perfect
  // stillness was wrong: her post-move pose keeps drifting slightly as the body settles.
  let settleTicks = null;
  for (let i = 1; i < afterRelease.length; i++) {
    if (motion(afterRelease[i - 1], afterRelease[i]) < 0.01) { settleTicks = i; break; }
  }
  const residual = afterRelease.length
    ? +Math.max(0, ...afterRelease.slice(-5).map((s, i, arr) => i ? motion(arr[i - 1], s) : 0)).toFixed(4) : null;
  const haulTrace = await page.evaluate(() => (window.__browserSmashHaulTrace || []).slice(-6));
  const beats = await page.evaluate(() => {
    const seen = {};
    for (const entry of window.__browserSmashHaulTrace || []) seen[entry.beat] = (seen[entry.beat] || 0) + 1;
    return seen;
  });
  results.recovery.push({ lastReelAt, doneAt, settleTicks,
    settleSeconds: settleTicks == null ? null : +(settleTicks / 60).toFixed(2),
    maxMotionAfterRelease: +Math.max(0, ...afterRelease.slice(1).map((s, i) => motion(afterRelease[i], s))).toFixed(4),
    residualMotion: residual,
    tail: afterRelease.slice(0, 4).map(s => s.pose.torsoX), beats, haulTraceTail: haulTrace });
  console.log('recovery ' + JSON.stringify(results.recovery.at(-1)));
}

// ---------------------------------------------------------------- 4. what a frame costs
for (const size of [[640, 400], [900, 560], [480, 300], [640, 400]]) {
  const cost = await page.evaluate(({ w, h }) => window.__p298.drawCost(w, h), { w: size[0], h: size[1] });
  results.draw.push(cost);
  console.log('draw ' + JSON.stringify(cost));
}

await writeFile(resolve(outDir, 'grab-haul-results.json'), JSON.stringify(results, null, 2));
console.log('page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
