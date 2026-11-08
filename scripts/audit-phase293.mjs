// Phase 29.3 measurements — grab geometry, guard interaction, mark counterplay. READ-ONLY.
//
//   PHASE293_MODE=geometry bash scripts/run-browser-test.sh scripts/audit-phase293.mjs
//   PHASE293_MODE=guard    bash scripts/run-browser-test.sh scripts/audit-phase293.mjs
//   PHASE293_MODE=mark     bash scripts/run-browser-test.sh scripts/audit-phase293.mjs
//
// Writes grab-geometry-results.json, guard-interaction-results.json and mark-counterplay-results.json.
// Reports are built separately by scripts/report-phase293.mjs, so a reporting bug can never cost a
// browser run. Every trial resets percent, shield, guard, stun, meter, casting, grab, dodge and input
// state, and both positions, so no trial inherits state from the one before it.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
await mkdir(outDir, { recursive: true });
const MODE = process.env.PHASE293_MODE || 'geometry';

const ultimateSource = readFileSync(resolve(root, 'public/js/combat/ultimate.js'), 'utf8');
const defaultsLiteral = ultimateSource.match(/const DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/)[1];
const DEFAULTS = new Function(`return ${defaultsLiteral};`)();
// Read the follow-up gate and pull speed from the behaviour rather than restating copies.
const GATE = Number((ultimateSource.match(/const GRAB_GATE = ([0-9.]+)/) || ultimateSource.match(/gap > ([0-9.]+)/) || [])[1]) || 5.2;
const PULL_SPEED = Number((ultimateSource.match(/velocity\.x = toward\.x \/ length \* ([0-9.]+)/) || [])[1]) || 9.4;

function fold(id, moveset) {
  const raw = moveset.ultimate || {};
  const d = { ...(DEFAULTS[raw.behaviour] || {}), ...raw };
  const events = d.hits ?? d.ticks ?? 1;
  const damaging = d.behaviour === 'grab' ? events - 1 : events;
  return {
    id, label: d.label, behaviour: d.behaviour, damage: d.damage, events, damaging,
    potential: +(d.damage * damaging).toFixed(2),
    startup: d.startup, active: d.active, recovery: d.recovery,
    range: d.range ?? null, radius: d.radius ?? null
  };
}
const fighters = Object.entries(MOVESETS).map(([id, v]) => fold(id, v));
const grabFighters = fighters.filter(f => f.behaviour === 'grab');
const markFighters = fighters.filter(f => ['slam', 'storm', 'zone'].includes(f.behaviour));

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

const pageErrors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
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
    window.__p293 = {
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
        window.combatPowers.clear('p293');
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
        window.__browserSmashStep(1 / 60);
      }
    };
  });
};

const matchStatus = () => page.evaluate(() => window.__browserSmashMatch().status);
const clearDamage = () => page.evaluate(() => { for (const f of window.fighters) f.percent = 0; });
const ensureFighting = async () => { if (await matchStatus() !== 'fighting') await openMatch(); };

await openMatch();

if (MODE === 'geometry') {
  const results = { kind: 'grab-geometry', generatedAt: new Date().toISOString(),
    gate: GATE, pullSpeed: PULL_SPEED, static: grabFighters, trials: {}, pageErrors };
  for (const fighter of grabFighters) {
    if (!await page.evaluate(id => window.__p293.select(id), fighter.id)) continue;
    const rows = [];
    const distances = [
      { name: 'point-blank', gap: 1.15 },
      { name: '35%', gap: +(fighter.range * .35).toFixed(2) },
      { name: '55%', gap: +(fighter.range * .55).toFixed(2) },
      { name: '98%', gap: +(fighter.range * .98).toFixed(2) }
    ];
    for (const distance of distances) {
      for (const movement of ['still', 'moving']) {
        const trial = await page.evaluate(input => {
          const pair = window.fighters;
          const p1 = pair[0], p2 = pair[1];
          window.__p293.reset(input.gap);
          const start = { x: p1.position.x, z: p1.position.z };
          p2.meter = 100;
          const rec = window.combatPowers.tryUltimate(p2);
          if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
          const keys = window.__browserSmashInput.keys;
          const eventTimes = rec.events.map(e => e.at);
          const gapAtEvent = [];
          let eventIndex = 0, minGap = Infinity, maxDisplacement = 0, gapAtPull = null, guardTicks = 0;
          for (let tick = 1; tick <= 400 && rec.phase !== 'done'; tick++) {
            if (input.movement === 'moving') keys.KeyA = true;
            window.__browserSmashStep(1 / 60);
            const gapNow = p1.position.distanceTo(p2.position);
            minGap = Math.min(minGap, gapNow);
            maxDisplacement = Math.max(maxDisplacement,
              Math.hypot(p1.position.x - start.x, p1.position.z - start.z));
            if (rec.pulled && gapAtPull === null) gapAtPull = +gapNow.toFixed(2);
            while (eventIndex < eventTimes.length && rec.t >= eventTimes[eventIndex]) {
              gapAtEvent.push(+gapNow.toFixed(2)); eventIndex++;
            }
            if (p1.guardHeld) guardTicks++;
            if ((p1.percent || 0) > 149) p1.percent = 0;
          }
          for (let i = 0; i < 3; i++) window.__browserSmashStep(1 / 60);
          for (const code of Object.keys(keys)) keys[code] = false;
          const followUps = gapAtEvent.slice(1);
          return {
            startGap: +input.gap.toFixed(2), movement: input.movement,
            pullConnected: Boolean(rec.pulled), gapAtPull, gapAtEvent, followUpGaps: followUps,
            followUpsInsideGate: followUps.filter(g => g <= input.gate).length,
            followUpsOutsideGate: followUps.filter(g => g > input.gate).length,
            minGap: +minGap.toFixed(2), maxVictimDisplacement: +maxDisplacement.toFixed(2),
            finalGap: +p1.position.distanceTo(p2.position).toFixed(2),
            hits: rec.hitCount, whiffs: rec.whiffs, damage: +p1.percent.toFixed(2),
            endReason: rec.endReason || null, guardTicks
          };
        }, { gap: distance.gap, movement, gate: GATE });
        rows.push({ distance: distance.name, ...trial });
      }
    }
    results.trials[fighter.id] = { ...fighter, rows };
    console.log(fighter.id + ' ' + rows.filter(r => !r.refused)
      .map(r => r.distance + '/' + r.movement + ':g' + (r.gapAtPull ?? 'x') + '->' + r.hits + 'h').join(' '));
    await ensureFighting();
  }
  await writeFile(resolve(outDir, 'grab-geometry-results.json'), JSON.stringify(results, null, 2));
  console.log('geometry trials: ' + Object.keys(results.trials).length + ' fighters');
}

if (MODE === 'guard') {
  const conditions = ['none', 'held-before', 'during', 'released'];
  const results = { kind: 'guard-interaction', generatedAt: new Date().toISOString(),
    gate: GATE, conditions, static: grabFighters, trials: {}, pageErrors };
  for (const fighter of grabFighters) {
    if (!await page.evaluate(id => window.__p293.select(id), fighter.id)) continue;
    const rows = [];
    const distances = [
      { name: 'point-blank', gap: 1.15 },
      { name: '55%', gap: +(fighter.range * .55).toFixed(2) },
      { name: '98%', gap: +(fighter.range * .98).toFixed(2) }
    ];
    for (const distance of distances) {
      for (const condition of conditions) {
        const trial = await page.evaluate(input => {
          const pair = window.fighters;
          const p1 = pair[0], p2 = pair[1];
          window.__p293.reset(input.gap);
          const keys = window.__browserSmashInput.keys;
          const shieldBefore = p1.shield;
          let shieldAtPull = null, pullAt = null, guardTicks = 0, released = false;
          if (input.condition === 'held-before' || input.condition === 'released') keys.KeyE = true;
          p2.meter = 100;
          const rec = window.combatPowers.tryUltimate(p2);
          if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
          for (let tick = 1; tick <= 400 && rec.phase !== 'done'; tick++) {
            if (rec.pulled && pullAt === null) { pullAt = +rec.t.toFixed(2); shieldAtPull = p1.shield; }
            if (input.condition === 'during' && rec.pulled && !keys.KeyE) keys.KeyE = true;
            if (input.condition === 'released' && rec.pulled && !released && rec.t > pullAt + .2) {
              keys.KeyE = false; released = true;
            }
            window.__browserSmashStep(1 / 60);
            if (p1.guardHeld) guardTicks++;
            if ((p1.percent || 0) > 149) p1.percent = 0;
          }
          for (let i = 0; i < 3; i++) window.__browserSmashStep(1 / 60);
          for (const code of Object.keys(keys)) keys[code] = false;
          return {
            startGap: +input.gap.toFixed(2), condition: input.condition,
            pullConnected: Boolean(rec.pulled), pullAt, guardTicks,
            shieldBefore, shieldAtPull, shieldAfter: +p1.shield.toFixed(2),
            shieldSpent: +(shieldBefore - p1.shield).toFixed(2),
            hits: rec.hitCount, whiffs: rec.whiffs, damage: +p1.percent.toFixed(2),
            chainContinued: rec.hitCount >= 2, endReason: rec.endReason || null
          };
        }, { gap: distance.gap, condition });
        rows.push({ distance: distance.name, ...trial });
      }
    }
    results.trials[fighter.id] = { ...fighter, rows };
    console.log(fighter.id + ' ' + rows.filter(r => !r.refused)
      .map(r => r.distance + '/' + r.condition + ':' + r.damage + 'd/' + r.shieldSpent + 's').join(' '));
    await ensureFighting();
  }
  await writeFile(resolve(outDir, 'guard-interaction-results.json'), JSON.stringify(results, null, 2));
  console.log('guard trials: ' + Object.keys(results.trials).length + ' fighters');
}

if (MODE === 'mark') {
  const timings = ['stay', 'leave-cast', 'leave-mid-startup', 'leave-mid-active'];
  const results = { kind: 'mark-counterplay', generatedAt: new Date().toISOString(),
    timings, static: markFighters, trials: {}, pageErrors };
  for (const fighter of markFighters) {
    if (!await page.evaluate(id => window.__p293.select(id), fighter.id)) continue;
    const rows = [];
    for (const timing of timings) {
      const trial = await page.evaluate(input => {
        const pair = window.fighters;
        const p1 = pair[0], p2 = pair[1];
        const gap = Math.min((input.range || 16) * .8, 8);
        window.__p293.reset(gap);
        const start = { x: p1.position.x, z: p1.position.z };
        const escape = (input.radius || 6) + 3;
        const leaveTick = input.timing === 'leave-cast' ? 1
          : input.timing === 'leave-mid-startup' ? Math.max(1, Math.round(input.startup * 36))
            : input.timing === 'leave-mid-active' ? Math.max(2, Math.round((input.startup + input.active * .5) * 60)) : -1;
        p2.meter = 100;
        const rec = window.combatPowers.tryUltimate(p2);
        if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
        const anchor = { x: rec.anchor.x, z: rec.anchor.z };
        let leftAtTick = null;
        for (let tick = 1; tick <= 400 && rec.phase !== 'done'; tick++) {
          if (tick === leaveTick && input.timing !== 'stay') {
            p1.position.set(start.x + escape, p1.groundLevel ?? 0, start.z);
            p1.velocity.set(0, 0, 0); leftAtTick = tick;
          }
          window.__browserSmashStep(1 / 60);
          if ((p1.percent || 0) > 149) p1.percent = 0;
        }
        for (let i = 0; i < 3; i++) window.__browserSmashStep(1 / 60);
        return {
          timing: input.timing, gapAtCast: +gap.toFixed(2), escapeDistance: escape,
          leftAtSeconds: leftAtTick ? +(leftAtTick / 60).toFixed(2) : null,
          damage: +p1.percent.toFixed(2), hits: rec.hitCount, whiffs: rec.whiffs,
          anchorMoved: Math.hypot(rec.anchor.x - anchor.x, rec.anchor.z - anchor.z) > .01,
          markAtTargetStart: Math.hypot(anchor.x - start.x, anchor.z - start.z) <= .05,
          victimDistanceFromMark: +Math.hypot(p1.position.x - anchor.x, p1.position.z - anchor.z).toFixed(2),
          endReason: rec.endReason || null
        };
      }, { timing, startup: fighter.startup, active: fighter.active, radius: fighter.radius, range: fighter.range });
      rows.push({ ...trial });
      await clearDamage();
    }
    results.trials[fighter.id] = { ...fighter, rows };
    console.log(fighter.id + ' ' + fighter.behaviour + ' '
      + rows.map(r => r.timing + ':' + (r.damage ?? 'x')).join(' '));
    await ensureFighting();
  }
  await writeFile(resolve(outDir, 'mark-counterplay-results.json'), JSON.stringify(results, null, 2));
  console.log('mark trials: ' + Object.keys(results.trials).length + ' fighters');
}

if (pageErrors.length) console.log('page errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
await browser.close();
await new Promise(done => server.close(done));
