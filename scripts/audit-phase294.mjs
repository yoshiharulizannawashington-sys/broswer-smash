// Phase 29.4 — per-hit guard mitigation, mark readability captures, grab-continuity counterfactual.
// READ-ONLY: nothing in the game is changed, and every proposed change stays in a document.
//
//   PHASE294_MODE=guard bash scripts/run-browser-test.sh scripts/audit-phase294.mjs
//   PHASE294_MODE=shots bash scripts/run-browser-test.sh scripts/audit-phase294.mjs
//   node scripts/audit-phase294.mjs --model      # gate counterfactual from saved geometry
//
// Per-hit mitigation uses the game's own `__browserSmashHitTrace`, which the hit resolver writes once
// per applied damage event with the dealt damage and the guarded flag. Comparing the same event index
// guarded against unguarded is a like-for-like per-hit measurement, not an average over the ultimate.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const shotDir = resolve(root, 'artifacts/dev/phase294');
await mkdir(outDir, { recursive: true });
await mkdir(shotDir, { recursive: true });
const MODE = process.env.PHASE294_MODE || (process.argv.includes('--model') ? 'model' : 'guard');

const ultimateSource = readFileSync(resolve(root, 'public/js/combat/ultimate.js'), 'utf8');
const defaultsLiteral = ultimateSource.match(/const DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/)[1];
const DEFAULTS = new Function(`return ${defaultsLiteral};`)();
const fold = (id, moveset) => {
  const raw = moveset.ultimate || {};
  const d = { ...(DEFAULTS[raw.behaviour] || {}), ...raw };
  const events = d.hits ?? d.ticks ?? 1;
  return { id, label: d.label, behaviour: d.behaviour, damage: d.damage, events,
    damaging: d.behaviour === 'grab' ? events - 1 : events,
    startup: d.startup, active: d.active, recovery: d.recovery, range: d.range ?? null, radius: d.radius ?? null };
};
const all = Object.entries(MOVESETS).map(([id, v]) => fold(id, v));
const grabFighters = all.filter(f => f.behaviour === 'grab');

// ------------------------------------------------------------------ model: gate counterfactual
if (MODE === 'model') {
  const geometryPath = resolve(outDir, 'grab-geometry-results.json');
  if (!existsSync(geometryPath)) throw new Error('run PHASE294_MODE=guard geometry first (grab-geometry-results.json)');
  const geometry = JSON.parse(readFileSync(geometryPath, 'utf8'));
  const gates = [5.2, 6.0, 6.5, 7.0, 7.5];
  const rows = [];
  for (const fighter of geometry.static) {
    const trials = (geometry.trials[fighter.id]?.rows || []).filter(r => !r.refused && r.movement === 'still');
    for (const trial of trials) {
      const gaps = trial.followUpGaps || [];
      const entry = { fighter: fighter.id, startGap: trial.startGap, gaps, damage: trial.damage };
      for (const gate of gates) {
        entry['gate' + gate] = gaps.filter(g => g <= gate).length;
      }
      rows.push(entry);
    }
  }
  const summary = gates.map(gate => {
    const key = 'gate' + gate;
    const total = rows.reduce((s, r) => s + r[key], 0);
    const possible = rows.reduce((s, r) => s + r.gaps.length, 0);
    const full = rows.filter(r => r[key] === r.gaps.length).length;
    return { gate, followUps: total, possible, trialsFull: full, trials: rows.length };
  });
  const payload = { kind: 'grab-gate-counterfactual', generatedAt: new Date().toISOString(),
    method: 're-evaluates saved follow-up gaps from the geometry run against candidate gates; it is a '
      + 'counterfactual on measured geometry, not a re-simulation of knockback',
    gates: summary, trials: rows };
  await writeFile(resolve(outDir, 'grab-gate-counterfactual.json'), JSON.stringify(payload, null, 2));
  for (const s of summary) {
    console.log('gate ' + s.gate + ': ' + s.followUps + '/' + s.possible + ' follow-ups inside, '
      + s.trialsFull + '/' + s.trials + ' trials complete');
  }
  process.exit(0);
}

// ------------------------------------------------------------------ browser
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

const openMatch = async () => {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashInput
    && window.fighters?.length === 2,
    null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(c => c.dataset.fighter === 'Superman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]');
  const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
    || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
  await arenaCard.click();
  await page.click('#play');
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
  await page.evaluate(() => {
    const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_').replace(/^_|_$/g, '');
    window.__p294 = {
      select(id) {
        const select = document.getElementById('cpuCharacter');
        const option = [...select.options].find(o => slug(o.textContent) === id);
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('change'));
        window.__browserSmashStep(1 / 60);
        return true;
      },
      reset(gap) {
        const pair = window.fighters;
        const p1 = pair[0], p2 = pair[1];
        window.combatPowers.clear('p294');
        for (const f of [p1, p2]) {
          f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.invulnerable = 0;
          f.casting = null; f.grabbedBy = null; f.grabTarget = null; f.ko = false;
          f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
          f.shield = 100; f.guardHeld = false; f.guardBreak = 0; f.guardStun = 0;
          f.dodgeTimer = 0; f.parryTimer = 0; f.staggerTimer = 0;
        }
        p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1; p1.facingZ = 0;
        p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1; p2.facingZ = 0;
        const keys = window.__browserSmashInput.keys;
        for (const code of Object.keys(keys)) keys[code] = false;
        window.__browserSmashHitTrace = [];
        window.__browserSmashStep(1 / 60);
      }
    };
  });
};
await openMatch();

// ------------------------------------------------------------------ per-hit guard
if (MODE === 'guard') {
  const controls = all.filter(f => f.behaviour === 'zone').slice(0, 1);
  const targets = [...grabFighters, ...controls];
  const results = { kind: 'guard-per-hit', generatedAt: new Date().toISOString(),
    method: 'per-event damage from __browserSmashHitTrace, same event index guarded vs unguarded',
    fighters: {}, pageErrors };
  for (const fighter of targets) {
    if (!await page.evaluate(id => window.__p294.select(id), fighter.id)) continue;
    const cells = [];
    // Point blank completes a grab chain, so every damaging event exists to compare. Mid reach is
    // included to show that mitigation is measured per event even when fewer events land.
    for (const distance of [{ name: 'point-blank', gap: 1.15 },
      { name: 'mid', gap: +(fighter.range * .55).toFixed(2) }]) {
      for (const condition of ['none', 'held-before']) {
        const cell = await page.evaluate(input => {
          const pair = window.fighters;
          const p1 = pair[0], p2 = pair[1];
          window.__p294.reset(input.gap);
          const keys = window.__browserSmashInput.keys;
          if (input.condition === 'held-before') keys.KeyE = true;
          p2.meter = 100;
          const rec = window.combatPowers.tryUltimate(p2);
          if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
          const shieldStart = p1.shield;
          const shieldAtHit = [];
          let seen = 0;
          for (let tick = 1; tick <= 400 && rec.phase !== 'done'; tick++) {
            window.__browserSmashStep(1 / 60);
            const trace = (window.__browserSmashHitTrace || []).filter(h => h.ultimate === rec.label);
            while (seen < trace.length) { shieldAtHit.push(+p1.shield.toFixed(2)); seen++; }
            if ((p1.percent || 0) > 149) p1.percent = 0;
          }
          for (const code of Object.keys(keys)) keys[code] = false;
          const trace = (window.__browserSmashHitTrace || []).filter(h => h.ultimate === rec.label);
          return {
            startGap: +input.gap.toFixed(2), condition: input.condition,
            hits: trace.map((h, index) => ({ index, damage: h.damage, guarded: h.guarded,
              shieldAfter: shieldAtHit[index] ?? null })),
            total: +p1.percent.toFixed(2), shieldStart, shieldEnd: +p1.shield.toFixed(2),
            shieldSpent: +(shieldStart - p1.shield).toFixed(2), endReason: rec.endReason || null
          };
        }, { gap: distance.gap, condition });
        cells.push({ distance: distance.name, ...cell });
      }
    }
    results.fighters[fighter.id] = { ...fighter, cells };
    console.log(fighter.id + ' ' + cells.filter(c => !c.refused)
      .map(c => c.distance + '/' + c.condition + ':' + c.total + 'd').join(' '));
    if (await page.evaluate(() => window.__browserSmashMatch().status) !== 'fighting') await openMatch();
  }
  await writeFile(resolve(outDir, 'guard-per-hit-results.json'), JSON.stringify(results, null, 2));
  console.log('per-hit guard cells: ' + Object.keys(results.fighters).length + ' fighters');
}

// ------------------------------------------------------------------ mark readability captures
if (MODE === 'shots') {
  const picks = [
    { id: 'superman', behaviour: 'slam' },
    { id: 'aquaman', behaviour: 'storm' },
    { id: 'lord_voldemort', behaviour: 'zone' }
  ];
  const shots = [];
  for (const pick of picks) {
    if (!await page.evaluate(id => window.__p294.select(id), pick.id)) continue;
    const setup = await page.evaluate(() => {
      const pair = window.fighters;
      const p1 = pair[0], p2 = pair[1];
      window.__p294.reset(6);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      return { ok: true, startup: rec.startup, active: rec.active, label: rec.label,
        radius: rec.def.radius, anchor: { x: +rec.anchor.x.toFixed(2), z: +rec.anchor.z.toFixed(2) } };
    });
    if (!setup.ok) { console.log(pick.id + ' refused ' + setup.refused); continue; }
    const frames = [
      { name: 'cast', seconds: 0.1 },
      { name: 'mid-startup', seconds: +((setup.startup || .6) * .6).toFixed(2) },
      { name: 'active', seconds: +((setup.startup || .6) + (setup.active || 1) * .35).toFixed(2) }
    ];
    let elapsed = 0;
    for (const frame of frames) {
      const delta = Math.max(0, frame.seconds - elapsed);
      await page.evaluate(seconds => window.__browserSmashStep(seconds), delta);
      elapsed = frame.seconds;
      const file = pick.behaviour + '-' + frame.name + '.png';
      await page.screenshot({ path: resolve(shotDir, file) });
      shots.push({ fighter: pick.id, behaviour: pick.behaviour, frame: frame.name, at: frame.seconds,
        label: setup.label, radius: setup.radius, file: file });
      console.log('  shot ' + file);
    }
    await page.evaluate(() => { for (const f of window.fighters) f.percent = 0; window.combatPowers.clear('shots'); });
    if (await page.evaluate(() => window.__browserSmashMatch().status) !== 'fighting') await openMatch();
  }
  await writeFile(resolve(outDir, 'mark-readability-shots.json'), JSON.stringify(
    { kind: 'mark-readability', generatedAt: new Date().toISOString(),
      note: 'Software WebGL (SwiftShader) in a container: colours and lighting are representative, not final art.',
      shots, pageErrors }, null, 2));
  console.log('mark shots: ' + shots.length);
}

if (pageErrors.length) console.log('page errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
await browser.close();
await new Promise(done => server.close(done));
