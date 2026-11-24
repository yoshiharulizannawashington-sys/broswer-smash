// Phase 22.6B diagnostic: where does an ultimate actually stop, and when does a round reset?
//
//   mkdir -p artifacts/phase22-6b
//   bash scripts/run-browser-test.sh scripts/probe-ultimate-lifecycle.mjs
//
// This probe changes nothing and asserts nothing. It drives the real game one fixed 1/60 s tick
// at a time inside a single page.evaluate (so no render frame interleaves) and records every tick
// on which the ultimate record or the match state changed. The point is to separate:
//   - a harness problem (the record advances but the probe read at the wrong moment), from
//   - a real problem (the record never advances, or the hit resolves as a miss).
// Tick 0 is the cast itself. Only changed values are kept, so the trace stays readable.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-6b');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = { phase: '22.6b', kind: 'ultimate-lifecycle-trace', status: 'running', pageErrors: [] };
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  // Same 2P setup the verification probe uses: Wonder Woman for P1, Superman for P2.
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__auditCallouts = [];
    const original = window.showCombatCallout;
    window.showCombatCallout = (text, color) => {
      window.__auditCallouts.push(String(text));
      return original?.(text, color);
    };
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(card => card.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(card => card.dataset.fighter === 'Superman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await page.evaluate(() => window.__browserSmashStep(0.1));

  // ---- 1. the ultimate lifecycle, one tick at a time -------------------------
  report.ultimate = await page.evaluate(async () => {
    const mod = await import('/js/combat/ultimate.js');
    const [p1, p2] = window.fighters;
    const reset = () => {
      for (const fighter of [p1, p2]) {
        fighter.percent = 0; fighter.velocity.set(0, 0, 0);
        fighter.hitstun = 0; fighter.invulnerable = 0; fighter.guardBreak = 0; fighter.guardStun = 0;
        fighter.attackQueue.length = 0; fighter.comboWindow = 0; fighter.attackBuffer = 0;
        fighter.parryTimer = 0; fighter.parryCooldown = 9; fighter.guardHeld = false;
        fighter.meter = 0;
      }
      p1.shield = 100; p2.shield = 100;
      p1.position.set(0, p1.groundLevel, 0); p1.facing = 1; p1.facingZ = 0;
      p2.position.set(1.02, p2.groundLevel, 0); p2.facing = -1; p2.facingZ = 0;
    };
    // A clean slate first: drop anything the attract/AI may have left running.
    mod.clearUltimates(window.ultimateContext(), 'probe');
    p2.casting = null;
    reset();
    window.__browserSmashStep(1 / 60);

    const snapshot = () => {
      const record = mod.activeUltimate(p2);
      return {
        rec: record ? record.id : null,
        t: record ? +record.t.toFixed(3) : null,
        phase: record ? record.phase : null,
        fired: record ? record.fired : null,
        events: record ? record.events.map(event => +event.at.toFixed(2)).join(',') : null,
        hitCount: record ? record.hitCount : null,
        whiffs: record ? record.whiffs : null,
        casting: p2.casting,
        p1pct: +p1.percent.toFixed(3),
        p2pct: +p2.percent.toFixed(3),
        p1inv: +(p1.invulnerable || 0).toFixed(3),
        p1guard: !!p1.guardHeld,
        p2y: +p2.position.y.toFixed(2),
        gap: +p2.position.distanceTo(p1.position).toFixed(2),
        hitStop: window.__browserSmashMatch().hitStop,
        status: window.__browserSmashMatch().status,
        callouts: window.__auditCallouts.length
      };
    };

    p2.meter = 100;
    const cast = mod.startUltimate(p2, window.ultimateContext());
    const def = p2.ultimateDef ? {
      id: p2.ultimateDef.id, label: p2.ultimateDef.label, behaviour: p2.ultimateDef.behaviour,
      damage: p2.ultimateDef.damage, startup: p2.ultimateDef.startup, active: p2.ultimateDef.active,
      recovery: p2.ultimateDef.recovery, radius: p2.ultimateDef.radius, range: p2.ultimateDef.range,
      hits: p2.ultimateDef.hits
    } : null;
    const started = { ok: cast?.ok !== false && Boolean(cast), reason: cast?.reason || null,
      label: cast?.label || null, targetIsP1: cast?.target === p1 };
    const anchor = cast?.anchor ? { x: +cast.anchor.x.toFixed(2), y: +cast.anchor.y.toFixed(2), z: +cast.anchor.z.toFixed(2) } : null;

    const trace = [];
    let previous = snapshot();
    trace.push({ tick: 0, ...previous });
    for (let tick = 1; tick <= 240; tick++) {
      window.__browserSmashStep(1 / 60);
      const now = snapshot();
      const changed = Object.keys(now).some(key => now[key] !== previous[key]);
      if (changed) trace.push({ tick, ...now });
      previous = now;
      if (!mod.activeUltimate(p2) && now.casting === null && tick > 2) break;
    }
    return { def, started, anchor, trace, callouts: window.__auditCallouts.slice(-12),
      finalPercent: +p1.percent.toFixed(3), remaining: mod.activeUltimate(p2)?.id || null };
  });
  console.log('ultimate def     ', JSON.stringify(report.ultimate.def));
  console.log('cast accepted    ', JSON.stringify(report.ultimate.started), 'anchor', JSON.stringify(report.ultimate.anchor));
  for (const row of report.ultimate.trace) {
    console.log('tick', String(row.tick).padStart(3),
      'rec', row.rec, 'phase', String(row.phase).padEnd(8), 't', row.t,
      'fired', row.fired, 'hits', row.hitCount, 'whiff', row.whiffs,
      '| p1', row.p1pct, 'inv', row.p1inv, 'guard', row.p1guard,
      '| p2y', row.p2y, 'gap', row.gap, 'casting', row.casting,
      '| hitStop', row.hitStop, row.status, 'callouts', row.callouts);
  }
  console.log('callouts        ', JSON.stringify(report.ultimate.callouts));
  console.log('final p1 percent', report.ultimate.finalPercent);

  // ---- 2. round reset, one tick at a time ------------------------------------
  report.roundReset = await page.evaluate(async () => {
    const [p1, p2] = window.fighters;
    for (const fighter of [p1, p2]) {
      fighter.percent = 0; fighter.velocity.set(0, 0, 0); fighter.hitstun = 0;
      fighter.attackQueue.length = 0; fighter.parryCooldown = 9;
    }
    p1.position.set(0, p1.groundLevel, 0);
    p2.position.set(1.02, p2.groundLevel, 0);
    window.__browserSmashStep(1 / 60);
    const read = () => ({
      status: window.__browserSmashMatch().status,
      round: window.__browserSmashMatch().round,
      wins: (window.__browserSmashMatch().wins || []).join('-'),
      p1: +p1.percent.toFixed(2), p2: +p2.percent.toFixed(2),
      shield: +p1.shield.toFixed(1), inv: +(p1.invulnerable || 0).toFixed(2), ko: !!p1.ko
    });
    const trace = [{ tick: 0, ...read() }];
    let previous = trace[0];
    // The KO is the game's own rule: 150% ends the round.
    p1.percent = 200;
    trace.push({ tick: 'pre', ...read() });
    previous = trace[trace.length - 1];
    for (let tick = 1; tick <= 600; tick++) {
      window.__browserSmashStep(1 / 60);
      const now = read();
      if (Object.keys(now).some(key => now[key] !== previous[key])) trace.push({ tick, ...now });
      previous = now;
      // Stop once the next round is running again and the percentage has stayed put.
      if (now.status === 'fighting' && tick > 200) break;
    }
    return { trace, final: read() };
  });
  for (const row of report.roundReset.trace) {
    console.log('round tick', String(row.tick).padStart(4), row.status, 'round', row.round,
      'wins', row.wins, 'p1', row.p1, 'p2', row.p2, 'shield', row.shield, 'inv', row.inv, 'ko', row.ko);
  }
  report.status = report.pageErrors.length ? 'page-errors' : 'complete';
} catch (error) {
  report.crash = String(error?.stack || error);
  report.status = 'crashed';
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'ultimate-lifecycle.json'), JSON.stringify(report, null, 2));
process.exit(report.status === 'complete' ? 0 : 1);
