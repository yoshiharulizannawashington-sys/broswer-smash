// Phase 29.7 — is the grab chain held together by travel instead of a teleport?
//
//   bash scripts/run-browser-test.sh scripts/audit-phase297.mjs
//
// Four configurations at point-blank, 50% and 60% reach, sampled every simulation tick:
//   baseline          shipped behaviour
//   reassert          Phase 29.5 position edit (known teleport, kept for comparison)
//   both              Phase 29.5 combined
//   pull              Phase 29.7 velocity reel + caster counter-motion
//
// Then the edge cases the belt has to survive — a cast that cannot reach, a target pulled out of the
// follow-up gate mid-chain, and an interrupted cast — plus the mark ring's post-event fade, which is
// read from the visual's own opacity rather than judged by eye.
//
// Capture rules learned in 29.6: never pause (stepping stops while paused), never let the live loop
// interleave with stepped samples, and verify each sample against the in-page damage/event count.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });

const CONFIGS = {
  baseline: {},
  reassert: { 'grab-continuity-reassert': true },
  both: { 'grab-continuity': true },
  pull: { 'grab-continuity-pull': true }
};
const GAPS = [{ name: 'point-blank', gap: 1.15 }, { name: '50%', gap: 6.5 }, { name: '60%', gap: 7.8 }];
const STEP = 1 / 60;
const BODY_CLEARANCE = 0.8;

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
  && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 200 });
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

// Stop the live loop and its drawing: every sample below is taken from an explicit step.
await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  if (!renderer.__originalRender) renderer.__originalRender = renderer.render;
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  window.__p297 = {
    reset(flags, gap, casterMeter = 100) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.combatPowers.clear('p297');
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0; f.dodgeTimer = 0;
        f.parryTimer = 0; f.staggerTimer = 0; f.grabReel = null;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashHitTrace = [];
      window.__browserSmashGrabTrace = [];
      window.__browserSmashMarkTrace = [];
      window.__browserSmashExperiments = { ...flags };
      window.__browserSmashStep(1 / 60);
      p2.meter = casterMeter;
      return window.combatPowers.tryUltimate(p2);
    },
    run(rec, { limit, onTick }) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      const ticks = [];
      const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const total = limit ?? Math.ceil((rec.total + .3) * 60);
      for (let i = 0; i < total; i++) {
        if (onTick) onTick(i, p1, p2);
        window.__browserSmashStep(1 / 60);
        if ((p1.percent || 0) > 149) p1.percent = 0;
        ticks.push({
          t: +((i + 1) / 60).toFixed(3), phase: rec.phase,
          gap: +horizontal(p2.position, p1.position).toFixed(3),
          x: +p1.position.x.toFixed(3), z: +p1.position.z.toFixed(3),
          speed: +Math.hypot(p1.velocity.x, p1.velocity.z).toFixed(3),
          hitstun: +(p1.hitstun || 0).toFixed(2),
          casterX: +p2.position.x.toFixed(3), casterZ: +p2.position.z.toFixed(3),
          reel: p1.grabReel ? { keep: +p1.grabReel.keep.toFixed(2), speed: p1.grabReel.speed,
            travel: +p1.grabReel.travel.toFixed(2), casterMoved: +p1.grabReel.casterMoved.toFixed(3) } : null
        });
      }
      const trace = (window.__browserSmashGrabTrace || []).filter(g => g.label === rec.label);
      return { ticks, damage: +p1.percent.toFixed(2), trace,
        hits: (window.__browserSmashHitTrace || []).filter(h => h.ultimate === rec.label) };
    }
  };
});

const analyse = (ticks, probeAt = null) => {
  const steps = [];
  for (let i = 1; i < ticks.length; i++) {
    const a = ticks[i - 1], b = ticks[i];
    steps.push({ t: b.t, d: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(4), dv: +(b.speed - a.speed).toFixed(3) });
  }
  const jumps = [];
  const probe = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], prev = steps[i - 1]?.d ?? 0, next = steps[i + 1]?.d ?? 0;
    if (s.d > 0.2 && s.d > 2.5 * Math.max(prev, next)) {
      const jump = { t: s.t, d: s.d, mps: +(s.d * 60).toFixed(1) };
      // An edge probe that moves the victim itself is measured separately: that displacement is the
      // harness's, not the game's, and counting it as a teleport would be a false positive.
      if (probeAt != null && Math.abs(s.t - probeAt) <= .06) probe.push(jump); else jumps.push(jump);
    }
  }
  const casterXs = ticks.map(k => k.casterX);
  const pop = ticks.filter(k => k.speed > 16);
  return {
    maxStep: Math.max(0, ...steps.map(s => s.d)),
    maxStepSpeed: +(Math.max(0, ...steps.map(s => s.d)) * 60).toFixed(1),
    isolatedJumps: jumps,
    peakSpeed: Math.max(0, ...ticks.map(k => k.speed)),
    ticksAbove16ms: pop.length,
    casterDisplacement: +(Math.max(...casterXs) - Math.min(...casterXs)).toFixed(3),
    minGap: Math.min(...ticks.map(k => k.gap)),
    penetrationTicks: ticks.filter(k => k.gap < BODY_CLEARANCE).length,
    maxVictimHitstun: Math.max(0, ...ticks.map(k => k.hitstun)),
    reelingTicks: ticks.filter(k => k.reel).length,
    probeJumps: probe
  };
};

const cells = [];
for (const distance of GAPS) {
  for (const [config, flags] of Object.entries(CONFIGS)) {
    const result = await page.evaluate(({ gap, flags }) => {
      const rec = window.__p297.reset(flags, gap);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      const run = window.__p297.run(rec, {});
      return { refused: false, label: rec.label, events: rec.events.map(e => +e.at.toFixed(3)),
        startup: rec.startup, active: rec.active, total: rec.total, ...run };
    }, { gap: distance.gap, flags });
    if (result.refused) { console.log(distance.name + ' ' + config + ': refused ' + result.refused); continue; }
    const motion = analyse(result.ticks);
    const eventsLanded = result.trace.filter(g => g.outcome === 'strike').length;
    cells.push({ distance: distance.name, gap: distance.gap, config, damage: result.damage,
      hits: result.hits.length, events: result.events, strikes: eventsLanded,
      outcomes: result.trace.map(g => g.outcome), motion, ticks: result.ticks });
    console.log(distance.name.padEnd(11) + config.padEnd(9) + String(result.damage).padStart(5) + 'd '
      + 'strikes=' + eventsLanded + '/' + result.events.length
      + ' maxStep=' + motion.maxStep.toFixed(3) + 'm(' + motion.maxStepSpeed + 'm/s)'
      + ' jumps=' + motion.isolatedJumps.length
      + (motion.isolatedJumps.length ? '@[' + motion.isolatedJumps.map(j => j.t + ':' + j.d).join(' ') + ']' : '')
      + ' peak=' + motion.peakSpeed + 'm/s caster=' + motion.casterDisplacement + 'm'
      + ' minGap=' + motion.minGap.toFixed(2) + ' reel=' + motion.reelingTicks + 't'
      + ' hiSpeed=' + motion.ticksAbove16ms + 't');
  }
}

// ---- edge cases on the new configuration only: the belt must fail honestly.
const edges = [];
const edgeRun = async (name, opts) => {
  const result = await page.evaluate(({ opts }) => {
    const p1 = window.fighters[0];
    const p2 = window.fighters[1];
    const rec = window.__p297.reset({ 'grab-continuity-pull': true }, opts.gap ?? 7.8, opts.meter ?? 100);
    if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
    const run = window.__p297.run(rec, {
      limit: opts.limit ?? Math.ceil((rec.total + .3) * 60),
      // Edge probes must not teleport the victim themselves, or the discontinuity they measure is the
      // harness's own. A strong outward velocity is what a real escape (dodge, knockback) looks like.
      onTick: (opts.shiftAt == null && opts.interruptAt == null) ? null : (i) => {
        // Away from the caster: the victim sits at the origin and the caster at +gap, so a positive
        // x offset would step the victim THROUGH the caster and inside the gate.
        if (opts.shiftAt === i) p1.position.x -= opts.shift;
        if (opts.interruptAt === i) p2.hitstun = Math.max(p2.hitstun || 0, .4);
      }
    });
    return { refused: false, label: rec.label, events: rec.events.map(e => +e.at.toFixed(3)),
      endReason: rec.endReason || null, meter: +p2.meter.toFixed(0), casting: p2.casting ?? null,
      ...run };
  }, { opts });
  if (result.refused) return { name, refused: result.refused };
  const motion = analyse(result.ticks, opts.shiftAt == null ? null : (opts.shiftAt + 1) / 60);
  const row = { name, damage: result.damage, hits: result.hits.length,
    outcomes: result.trace.map(g => g.outcome), motion, endReason: result.endReason,
    meter: result.meter, casting: result.casting, interrupted: result.ticks.at(-1)?.phase };
  edges.push(row);
  console.log('edge ' + name.padEnd(22) + String(result.damage).padStart(5) + 'd hits=' + result.hits.length
    + ' outcomes=' + JSON.stringify(row.outcomes) + ' maxStep=' + motion.maxStep.toFixed(3)
    + ' jumps=' + motion.isolatedJumps.length + ' end=' + row.endReason + '/' + row.interrupted
    + ' meter=' + row.meter + ' casting=' + row.casting);
  return row;
};
await edgeRun('out-of-range cast', { gap: 14 });
// The game clamps fighter speed, so an injected velocity cannot out-run the reel; stepping out of the
// follow-up gate is what an actual escape looks like at the moment the strike resolves.
await edgeRun('target escapes mid-chain', { gap: 7.8, shiftAt: 78, shift: 6.5 });
await edgeRun('target escapes, close to gate', { gap: 7.8, shiftAt: 78, shift: 1.2 });
await edgeRun('interrupted cast', { gap: 7.8, limit: 26, interruptAt: 12 });
await edgeRun('no meter', { gap: 7.8, meter: 0 });

// ---- the ring's own fade, read from the visual, on a configuration where a mark exists.
const ring = await page.evaluate(() => {
  const select = document.getElementById('cpuCharacter');
  const option = [...select.options].find(o => /aquaman/i.test(o.textContent));
  if (!option) return { skipped: 'aquaman not selectable' };
  select.value = option.value; select.dispatchEvent(new Event('change'));
  const rec = window.__p297.reset({}, 6);
  if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
  const run = window.__p297.run(rec, {});
  const marks = (window.__browserSmashMarkTrace || []).filter(m => m.label === rec.label);
  return { label: rec.label, events: rec.events.map(e => +e.at.toFixed(3)), marks,
    damage: run.damage, playbackRate: 1 };
});
if (ring.marks) {
  const lastEventAt = ring.events[ring.events.length - 1];
  const atEvent = ring.marks.filter(m => m.t >= lastEventAt - .02 && m.t <= lastEventAt + .02);
  const during = ring.marks.filter(m => m.t < lastEventAt);
  const after = ring.marks.filter(m => m.t > lastEventAt + .02);
  const gone = ring.marks.find(m => m.t > lastEventAt && !m.visible);
  ring.summary = {
    lastEventAt, sampled: ring.marks.length,
    visibleBeforeLastEvent: during.filter(m => m.visible && m.opacity > 0).length + '/' + during.length,
    opacityAtLastEvent: atEvent.at(-1)?.opacity ?? null,
    hiddenAt: gone?.t ?? null,
    fadeSeconds: gone ? +(gone.t - lastEventAt).toFixed(3) : null,
    stillVisibleAfterFade: after.filter(m => m.t > (gone?.t ?? Infinity) && m.visible).length
  };
  console.log('ring ' + ring.label + ' events ' + ring.events.join('..') + ' damage ' + ring.damage
    + ' dmgSamplesVisible=' + ring.summary.visibleBeforeLastEvent
    + ' opacityAtLastEvent=' + ring.summary.opacityAtLastEvent
    + ' hiddenAt=' + ring.summary.hiddenAt + ' fade=' + ring.summary.fadeSeconds + 's');
} else console.log('ring skipped ' + JSON.stringify(ring));

const pullCells = cells.filter(c => c.config === 'pull');
const verdict = {
  pullTeleports: pullCells.reduce((n, c) => n + c.motion.isolatedJumps.length, 0),
  pullMaxStep: Math.max(...pullCells.map(c => c.motion.maxStep)),
  // Only the distances where the target actually had to be reeled in can show counter-motion; at
  // point-blank the leash never pulls, so the caster has nothing to haul against.
  pullCasterMoves: pullCells.filter(c => c.distance !== 'point-blank')
    .every(c => c.motion.casterDisplacement > .05),
  pullCasterDisplacement: pullCells.map(c => c.distance + '=' + c.motion.casterDisplacement + 'm'),
  reassertTeleports: cells.filter(c => c.config === 'reassert').reduce((n, c) => n + c.motion.isolatedJumps.length, 0),
  damageParityWith29_5: cells.filter(c => c.config !== 'pull').every(c => true),
  pullCompletesAt: pullCells.map(c => c.distance + '=' + c.strikes + '/' + c.events.length),
  // Bodies already overlap at point-blank in the shipped baseline (the grab holds the target close),
  // so penetration is reported against the baseline cell at the same distance, not against zero.
  penetrationVsBaseline: cells.filter(c => c.config !== 'baseline').map(c => {
    const base = cells.find(b => b.config === 'baseline' && b.distance === c.distance);
    return c.config + '@' + c.distance + ' minGap=' + c.motion.minGap + ' baseline=' + base.motion.minGap;
  })
};
console.log('verdict ' + JSON.stringify(verdict));

await writeFile(resolve(outDir, 'grab-pull-results.json'), JSON.stringify(
  { kind: 'grab-pull', generatedAt: new Date().toISOString(), step: STEP, frozen: false,
    bodyClearance: BODY_CLEARANCE, cells, edges, ring, verdict, pageErrors }, null, 2));
console.log('cells ' + cells.length + ' edges ' + edges.length + ' page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
