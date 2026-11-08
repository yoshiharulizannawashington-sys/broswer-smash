// Phase 22.6B: which entry point actually reaches the live ultimate runner?
//
//   bash scripts/run-browser-test.sh scripts/probe-ultimate-entry.mjs
//
// The 22.6 probe cast through `import('/js/combat/ultimate.js')` and the record never advanced.
// That can only mean the record landed in a module instance the game does not update. This probe
// casts the same move three ways in one page and reports, for each, whether the record advanced
// and whether damage was applied:
//   A  a probe-side import of '/js/combat/ultimate.js'   (what 22.6 did)
//   B  window.combatPowers.tryUltimate()                 (the game's own powers instance)
//   C  P2's real ultimate key                            (the player's path)
// It also compares the identity of the two module URLs the source imports.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-6b');
await mkdir(outDir, { recursive: true });
const VERSION = 'v=browser-smash-phase3-v45-20261027';

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

const report = { phase: '22.6b', kind: 'ultimate-entry-points', status: 'running', pageErrors: [] };
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
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
    null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(card => card.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(card => card.dataset.fighter === 'Superman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.click('#play');
  await page.evaluate(() => window.__browserSmashStep(0.1));

  // Module identity: the two URLs the source actually imports.
  report.modules = await page.evaluate(async ({ VERSION }) => {
    const plain = await import('/js/combat/ultimate.js');
    const versioned = await import('/js/combat/ultimate.js?' + VERSION);
    return {
      sameStartUltimate: plain.startUltimate === versioned.startUltimate,
      plainActive: plain.activeUltimate(window.fighters[1])?.id || null,
      versionedActive: versioned.activeUltimate(window.fighters[1])?.id || null
    };
  }, { VERSION });
  console.log('module identity', JSON.stringify(report.modules));

  const reset = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    window.combatPowers.clear('audit');
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
    window.__browserSmashStep(1 / 60);
  });
  /** Step the fixed tick inside one evaluate and report the first tick damage appears. */
  const drive = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const plainCast = window.__entryRecord || null;
    const trace = [];
    let landedAt = null;
    for (let tick = 1; tick <= 200; tick++) {
      window.__browserSmashStep(1 / 60);
      if (landedAt === null && p1.percent > 0) landedAt = tick;
      if (tick % 20 === 0) {
        const record = plainCast?.activeUltimate ? plainCast.activeUltimate(p2) : null;
        trace.push({ tick, percent: +p1.percent.toFixed(3), shield: +p1.shield.toFixed(1),
          casting: p2.casting, recordT: record ? +record.t.toFixed(2) : null,
          phase: record ? record.phase : null, hitCount: record ? record.hitCount : null });
      }
    }
    return { landedAt, damage: +p1.percent.toFixed(3),
      shieldSpent: +(100 - p1.shield).toFixed(2), trace };
  });

  // A: probe-side import, exactly as 22.6 did.
  await reset();
  report.a = { entry: "import('/js/combat/ultimate.js')" };
  report.a.cast = await page.evaluate(async () => {
    const mod = await import('/js/combat/ultimate.js');
    window.__entryRecord = mod;
    const p2 = window.fighters[1];
    p2.meter = 100;
    const result = mod.startUltimate(p2, window.ultimateContext());
    return { ok: result?.ok !== false, reason: result?.reason || null };
  });
  Object.assign(report.a, await drive());
  console.log('A probe import   cast', JSON.stringify(report.a.cast), 'landed', report.a.landedAt,
    'damage', report.a.damage, 'shield', report.a.shieldSpent);
  console.log('  trace', JSON.stringify(report.a.trace));

  // B: the game's own powers instance.
  await reset();
  report.b = { entry: 'window.combatPowers.tryUltimate(p2)' };
  report.b.cast = await page.evaluate(() => {
    window.__entryRecord = null;
    const p2 = window.fighters[1];
    p2.meter = 100;
    const result = window.combatPowers.tryUltimate(p2);
    return { ok: result?.ok !== false, reason: result?.reason || null,
      label: result?.label || null, snapshotCasting: window.combatPowers.snapshot(p2).casting };
  });
  Object.assign(report.b, await drive());
  console.log('B powers instance cast', JSON.stringify(report.b.cast), 'landed', report.b.landedAt,
    'damage', report.b.damage, 'shield', report.b.shieldSpent);

  // C: P2's real ultimate key.
  await reset();
  report.c = { entry: "keyboard 'm' (P2 ultimate)" };
  await page.evaluate(() => {
    window.__entryRecord = null;
    window.fighters[1].meter = 100;
  });
  await page.keyboard.down('m');
  report.c.cast = await page.evaluate(() => ({
    casting: window.fighters[1].casting,
    meter: Math.round(window.fighters[1].meter || 0),
    ok: true
  }));
  await page.keyboard.up('m');
  Object.assign(report.c, await drive());
  console.log('C real key       cast', JSON.stringify(report.c.cast), 'landed', report.c.landedAt,
    'damage', report.c.damage, 'shield', report.c.shieldSpent);

  report.section = Object.fromEntries(['a', 'b', 'c'].map(key => [key, {
    entry: report[key].entry, castOk: report[key].cast?.ok, landedAt: report[key].landedAt,
    damage: report[key].damage, shieldSpent: report[key].shieldSpent
  }]));
  report.status = report.pageErrors.length ? 'page-errors' : 'complete';
} catch (error) {
  report.crash = String(error?.stack || error);
  report.status = 'crashed';
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'ultimate-entry.json'), JSON.stringify(report, null, 2));
process.exit(report.status === 'complete' ? 0 : 1);
