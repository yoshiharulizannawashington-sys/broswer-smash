// Phase 29.6 — motion-quality comparison for the grab-continuity pilot.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase296.mjs
//
// No gameplay change: the three configurations are the existing opt-in experiments plus the shipped
// baseline.
//
// Capture method matters, and two earlier attempts were invalid:
//   * `marks` (29.5) stepped 0.1 s per screenshot while the live loop kept simulating, so the match
//     clock drifted and the ultimate had already ended.
//   * `telegraph` (29.5) paused the match first, but pausing stops the simulation, so
//     `__browserSmashStep` became a no-op: every frame was the startup frame with only the camera
//     moving, and nothing ever fired.
// This script steps inside a single synchronous evaluate, so the animation loop cannot interleave,
// and reads the canvas from inside that same task. Both the per-tick numbers and the stills therefore
// come from one uninterrupted simulation run.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const shotDir = resolve(root, 'artifacts/dev/phase296');
await mkdir(outDir, { recursive: true });
await mkdir(shotDir, { recursive: true });

const CONFIGS = {
  baseline: {},
  reassert: { 'grab-continuity-reassert': true },
  both: { 'grab-continuity': true }
};
const GAPS = [{ name: 'point-blank', gap: 1.15 }, { name: '50%', gap: 6.5 }, { name: '60%', gap: 7.8 }];
const STEP = 1 / 60;

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

const saveFrames = async (frames, prefix) => {
  for (const frame of frames) {
    const base64 = String(frame.url || '').split(',')[1] || '';
    if (base64.length < 2000) continue;
    await writeFile(resolve(shotDir, prefix + '-' + frame.t.toFixed(2) + '.png'), Buffer.from(base64, 'base64'));
  }
  return frames.filter(f => String(f.url || '').length > 2000).length;
};

const cells = [];
for (const distance of GAPS) {
  for (const [config, flags] of Object.entries(CONFIGS)) {
    const wantFrames = distance.name === '60%' && config === 'both';
    const result = await page.evaluate(({ gap, flags, wantFrames }) => {
      const p1 = window.fighters[0];
      const p2 = window.fighters[1];
      window.combatPowers.clear('p296');
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
        f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
        f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
        f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0; f.dodgeTimer = 0;
        f.parryTimer = 0; f.staggerTimer = 0;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1; p1.facingZ = 0;
      p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1; p2.facingZ = 0;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashHitTrace = [];
      window.__browserSmashExperiments = { ...flags };
      window.__browserSmashStep(1 / 60);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      const ticks = [];
      const frames = [];
      const canvas = document.querySelector('canvas');
      const limit = Math.ceil((rec.total + .25) * 60);
      const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      for (let i = 0; i < limit; i++) {
        window.__browserSmashStep(1 / 60);
        if ((p1.percent || 0) > 149) p1.percent = 0;
        ticks.push({
          t: +((i + 1) / 60).toFixed(3), phase: rec.phase,
          gap: +horizontal(p2.position, p1.position).toFixed(3),
          x: +p1.position.x.toFixed(3), z: +p1.position.z.toFixed(3),
          vx: +p1.velocity.x.toFixed(3), vz: +p1.velocity.z.toFixed(3),
          speed: +Math.hypot(p1.velocity.x, p1.velocity.z).toFixed(3),
          hitstun: +(p1.hitstun || 0).toFixed(2),
          // The caster never fills in `attack` during an ultimate: its state lives on `casting`, so
          // that is what has to be sampled to judge the attack rhythm and whether it keeps its footing.
          casterX: +p2.position.x.toFixed(3), casterZ: +p2.position.z.toFixed(3),
          casterVX: +p2.velocity.x.toFixed(2), casterVZ: +p2.velocity.z.toFixed(2),
          hitting: +(p2.hitstun || 0).toFixed(2),
          castingId: p2.casting?.id || null, castingPhase: p2.casting?.phase || null,
          fired: !!p2.casting?.fired
        });
        if (wantFrames && i % 8 === 0) frames.push({ t: (i + 1) / 60, url: canvas.toDataURL('image/png') });
      }
      const hits = (window.__browserSmashHitTrace || []).filter(h => h.ultimate === rec.label);
      return {
        refused: false, label: rec.label, startup: rec.startup, active: rec.active,
        total: rec.total, events: rec.events.map(e => +e.at.toFixed(3)),
        damage: +p1.percent.toFixed(2), hits, ticks, frames,
        reasserts: (window.__browserSmashGrabTrace || []).filter(g => g.label === rec.label && g.reasserted).length
      };
    }, { gap: distance.gap, flags, wantFrames });

    if (result.refused) { console.log(distance.name + ' ' + config + ': refused ' + result.refused); continue; }

    const steps = [];
    for (let i = 1; i < result.ticks.length; i++) {
      const a = result.ticks[i - 1], b = result.ticks[i];
      steps.push({ t: b.t, d: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(4), dv: +(b.speed - a.speed).toFixed(3) });
    }
    const sorted = steps.map(s => s.d).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const maxStep = Math.max(...steps.map(s => s.d));
    const snaps = steps.filter(s => s.d > Math.max(.12, median * 6));
    const motion = {
      maxStep, maxStepSpeed: +(maxStep * 60).toFixed(2), medianStep: +median.toFixed(4),
      movingTicks: steps.filter(s => s.d > .01).length,
      snapTicks: snaps.length, snapTimes: snaps.map(s => s.t),
      snapDistance: +Math.max(0, ...snaps.map(s => s.d)).toFixed(3),
      snapImpulse: +Math.max(0, ...snaps.map(s => Math.abs(s.dv))).toFixed(2),
      peakSpeed: Math.max(...result.ticks.map(k => k.speed)),
      peakAccel: +Math.max(...steps.map(s => Math.abs(s.dv) * 60)).toFixed(1),
      gapAtEvents: result.events.map(at => {
        const tick = result.ticks.reduce((best, k) => Math.abs(k.t - at) < Math.abs(best.t - at) ? k : best, result.ticks[0]);
        return { at, gap: tick.gap, phase: tick.phase };
      })
    };
    const written = wantFrames ? await saveFrames(result.frames, config) : 0;
    cells.push({ distance: distance.name, gap: distance.gap, config, damage: result.damage,
      hits: result.hits.length, reasserts: result.reasserts, startup: result.startup,
      active: result.active, total: result.total, events: result.events, motion,
      stills: written, ticks: result.ticks });

    console.log(distance.name.padEnd(11) + config.padEnd(9) + result.damage + 'd ' + result.hits.length + 'h'
      + ' re=' + result.reasserts
      + ' maxStep=' + motion.maxStep.toFixed(3) + 'm/f(' + motion.maxStepSpeed + 'm/s)'
      + ' snaps=' + motion.snapTicks + (motion.snapTimes.length ? ' @[' + motion.snapTimes.join(',') + ']' : '')
      + ' peak=' + motion.peakSpeed + 'm/s accel=' + motion.peakAccel
      + (wantFrames ? ' stills=' + written : ''));
  }
}

// Telegraph, captured the same way: one synchronous run, canvas read inside it.
if (!await page.evaluate(() => {
  const select = document.getElementById('cpuCharacter');
  const option = [...select.options].find(o => /aquaman/i.test(o.textContent));
  if (!option) return false;
  select.value = option.value; select.dispatchEvent(new Event('change'));
  window.__browserSmashStep(1 / 60);
  return true;
})) console.log('telegraph skipped: aquaman not selectable');
else {
  const telegraph = await page.evaluate(() => {
    const p1 = window.fighters[0], p2 = window.fighters[1];
    window.combatPowers.clear('p296t');
    for (const f of [p1, p2]) {
      f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.casting = null; f.grabbedBy = null;
      f.grabTarget = null; f.ko = false; f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
      f.shield = 100; f.guardHeld = false; f.guardBreak = 0;
    }
    p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
    p2.position.set(6, p2.groundLevel ?? 0, 0); p2.facing = -1;
    const keys = window.__browserSmashInput.keys;
    for (const code of Object.keys(keys)) keys[code] = false;
    window.__browserSmashHitTrace = [];
    window.__browserSmashExperiments = {};
    window.__browserSmashStep(1 / 60);
    p2.meter = 100;
    const rec = window.combatPowers.tryUltimate(p2);
    if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
    const canvas = document.querySelector('canvas');
    const frames = [];
    const phases = [];
    const limit = Math.ceil((rec.total + .1) * 60);
    for (let i = 0; i < limit; i++) {
      window.__browserSmashStep(1 / 60);
      if ((p1.percent || 0) > 149) p1.percent = 0;
      if (i % 6 === 0) {
        frames.push({ t: (i + 1) / 60, url: canvas.toDataURL('image/png') });
        phases.push({ t: +((i + 1) / 60).toFixed(2), phase: rec.phase, fired: rec.fired ?? null,
          damage: +p1.percent.toFixed(1) });
      }
    }
    return { refused: false, label: rec.label, startup: rec.startup, active: rec.active,
      total: rec.total, events: rec.events.map(e => +e.at.toFixed(3)), frames, phases,
      damage: +p1.percent.toFixed(1) };
  });
  if (telegraph.refused) console.log('telegraph refused ' + telegraph.refused);
  else {
    const written = await saveFrames(telegraph.frames, 'storm');
    await writeFile(resolve(outDir, 'mark-telegraph-live.json'), JSON.stringify({
      kind: 'mark-telegraph-live', generatedAt: new Date().toISOString(), step: STEP,
      method: 'single synchronous evaluate; canvas read in the same task; simulation NOT paused',
      label: telegraph.label, startup: telegraph.startup, active: telegraph.active,
      total: telegraph.total, events: telegraph.events, damage: telegraph.damage,
      stills: written, phases: telegraph.phases
    }, null, 2));
    console.log('telegraph ' + telegraph.label + ' ' + written + ' stills, damage ' + telegraph.damage
      + ' events ' + telegraph.events.join('..') + ' phases ' + telegraph.phases.map(p => p.t + ':' + p.phase + '/' + p.damage).join(' '));
  }
}

await writeFile(resolve(outDir, 'grab-motion-results.json'), JSON.stringify(
  { kind: 'grab-motion-quality', generatedAt: new Date().toISOString(), step: STEP,
    frozen: false, method: 'single synchronous step loop; no pause', cells, pageErrors }, null, 2));
console.log('cells ' + cells.length + ', page errors ' + pageErrors.length + (pageErrors.length ? ' ' + pageErrors[0] : ''));
await browser.close();
await new Promise(done => server.close(done));
