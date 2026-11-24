// Temporary full arena + roster regression.
//   bash scripts/run-browser-test.sh scripts/_full_arena_roster_regression.mjs maps
//   bash scripts/run-browser-test.sh scripts/_full_arena_roster_regression.mjs roster
// Optional REG_OFFSET/REG_LIMIT slice either list. Screenshots and JSON reports are written under
// artifacts/full-regression/.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mode = String(process.argv[2] || 'maps').toLowerCase();
if (!['maps', 'roster'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
const offset = Math.max(0, Number(process.env.REG_OFFSET) || 0);
const limit = Math.max(0, Number(process.env.REG_LIMIT) || 0);
const out = resolve(root, 'artifacts/full-regression');
await mkdir(out, { recursive: true });
const slugOf = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const mainSource = await readFile(resolve(root, 'public/js/main.js'), 'utf8');
const roster = JSON.parse(mainSource.match(/const roster=(\[\[[\s\S]*?\]\]);/)[1]).map(([name]) => name);
const allTargets = mode === 'roster'
  ? roster.map(name => ({ key: name, name, label: name, world: null }))
  : null;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const requests = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 400)));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) consoleErrors.push(message.text().slice(0, 400));
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon\.ico/i.test(response.url())) failedRequests.push(`${response.status()} ${response.url().slice(-140)}`);
  });
  page.on('request', request => { if (['document', 'script', 'xhr', 'fetch'].includes(request.resourceType())) requests.push(request.url().slice(-140)); });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => window.__browserSmashSelect && document.querySelector('#selectScreen'), null, { timeout: 30_000 });

  const catalog = await page.evaluate(() => {
    const seen = new Set();
    return [...document.querySelectorAll('#selectScreen .bs-arena')].map(card => ({
      key: card.dataset.arena,
      label: card.querySelector('.bs-aname')?.textContent?.trim() || card.dataset.arena,
      world: card.dataset.world || null
    })).filter(card => card.key && !seen.has(card.key) && seen.add(card.key));
  });
  if (!catalog.length) throw new Error('no selectable arenas found');

  const targets = (allTargets || catalog).slice(offset, limit ? offset + limit : undefined);
  const results = [];
  console.log(`MODE ${mode} targets=${targets.length}/${(allTargets || catalog).length} offset=${offset}`);

  const waitForMap = async key => {
    const card = catalog.find(card => card.key === key) || {};
    if (card.world) {
      await page.waitForFunction(k => window.__browserSmashWorld?.location === k, key, { timeout: 60_000, polling: 100 }).catch(() => {});
    }
    await page.waitForFunction(k => {
      const asset = window.__browserSmashAssets?.arenas?.[k];
      if (asset?.status === 'error') return true;
      if (asset?.status === 'loading') return false;
      if (k === 'finalvalley' && window.__browserSmashFinalValley?.status === 'loading') return false;
      return true;
    }, key, { timeout: 60_000, polling: 100 }).catch(() => {});
    await page.waitForTimeout(250);
  };

  const startFight = async ({ name, opponent, arena }) => {
    await page.evaluate(({ name, opponent, arena }) => {
      window.__browserSmashLastResult = null;
      const select = window.__browserSmashSelect;
      select.setMode('1p');
      select.setRules({ roundsToWin: 1, roundSeconds: 60 });
      window.__browserSmashSetRules?.({ roundsToWin: 1, roundSeconds: 60 });
      select.select('p1', name);
      select.select('p2', opponent);
      select.chooseArena(arena);
      window.__browserSmashFreezeAI = true;
      window.__browserSmashGame.startMatch();
      window.__browserSmashStep(0.2);
    }, { name, opponent, arena });
    await waitForMap(arena);
    await page.waitForFunction(({ name, opponent }) => {
      const [p1, p2] = window.fighters || [];
      return p1?.identity === name && p2?.identity === opponent
        && p1.characterModelLoaded === true && p2.characterModelLoaded === true;
    }, { name, opponent }, { timeout: 150_000, polling: 200 });
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      window.__browserSmashSkipCinematic?.();
      window.__browserSmashStep(0.55);
    });
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
      null, { timeout: 20_000, polling: 150 }).catch(() => {});
    await page.waitForTimeout(300);
  };

  // A map sweep only needs one live match: switch the stage in place so the two fighter bodies
  // (and their imported GLBs) are not destroyed and re-mounted 74 times. This is the same
  // applyArenaSelection / chooseArena path the setup screen and existing world suite use.
  if (mode === 'maps' && targets.length) {
    await startFight({ name: 'Goku', opponent: 'Naruto Uzumaki', arena: targets[0].key });
    if (process.env.REG_FRESH === '1') {
      await mkdir(resolve(out, 'fresh'), { recursive: true });
      await page.screenshot({ path: resolve(out, 'fresh', `${slugOf(targets[0].key)}.png`) });
      console.log(`FRESH ${targets[0].key}`);
    }
  }

  for (const target of targets) {
    const beforeErrors = pageErrors.length;
    const beforeConsole = consoleErrors.length;
    const beforeFailed = failedRequests.length;
    const beforeRequests = requests.length;
    const arena = mode === 'maps' ? target.key : 'tournament';
    const opponent = target.name === 'Goku' ? 'Vegeta' : 'Goku';
    const row = { mode, key: target.key, label: target.label, world: target.world, fighter: target.name, opponent, arena };
    try {
      if (mode === 'maps') {
        await page.evaluate(key => {
          window.__browserSmashSelect?.chooseArena?.(key);
          // This is the same pair travelToLocation uses when walking through a world exit: apply
          // the new layout and put both fighters on its real spawn points. Without it the next
          // screenshot inherits the previous stage's coordinates (and camera), not the new stage.
          window.__browserSmashSpawnFighters?.();
          // applyMap snaps to the camera target at the old coordinates. Reset() snaps again after
          // placeFightersAtSpawns; do the same here so the capture is framed on the new stage.
          window.smashCamera?.snap?.();
          window.__browserSmashFreezeAI = true;
        }, arena);
        await waitForMap(arena);
        await page.evaluate(() => window.__browserSmashStep?.(0.1));
      } else {
        await startFight({ name: target.name, opponent, arena });
      }
      const state = await page.evaluate(({ arena, name, opponent }) => {
        const [p1, p2] = window.fighters || [];
        const [u1, u2] = [p1?.model?.userData || {}, p2?.model?.userData || {}];
        const match = window.__browserSmashMatch?.() || {};
        return {
          matchArena: match.arena || null,
          matchStatus: match.status || null,
          worldLocation: window.__browserSmashWorld?.location || null,
          world: window.__browserSmashWorld?.world || null,
          arenaAsset: window.__browserSmashAssets?.arenas?.[arena]?.status || null,
          finalValley: arena === 'finalvalley' ? (window.__browserSmashFinalValley?.status || null) : null,
          applyMapState: window.__browserSmashApplyMapState ? {
            key: window.__browserSmashApplyMapState.key || null,
            ok: window.__browserSmashApplyMapState.ok,
            error: window.__browserSmashApplyMapState.error || null
          } : null,
          p1: { identity: p1?.identity || null, loaded: p1?.characterModelLoaded === true, asset: u1.characterAssetUrl || null, clip: u1.currentClip || p1?.animationController?._active || null },
          p2: { identity: p2?.identity || null, loaded: p2?.characterModelLoaded === true, asset: u2.characterAssetUrl || null },
          fighters: (window.fighters || []).map(f => ({ x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2), ground: +(f.groundLevel ?? 0).toFixed(2), grounded: Boolean(f.isGrounded), visible: f.model?.visible !== false })),
          renderer: { calls: window.__browserSmashRenderer?.info?.render?.calls ?? null, triangles: window.__browserSmashRenderer?.info?.render?.triangles ?? null }
        };
      }, { arena, name: target.name, opponent });
      const screenshot = resolve(out, mode, `${slugOf(target.key)}.png`);
      await mkdir(resolve(out, mode), { recursive: true });
      await page.screenshot({ path: screenshot });
      row.state = state;
      row.screenshot = `artifacts/full-regression/${mode}/${slugOf(target.key)}.png`;
      row.errors = pageErrors.slice(beforeErrors);
      row.consoleErrors = consoleErrors.slice(beforeConsole);
      row.failedRequests = failedRequests.slice(beforeFailed);
      row.requestCount = requests.length - beforeRequests;
      row.ok = Boolean(state.p1?.loaded && state.p2?.loaded)
        && state.matchArena === arena
        && (mode === 'roster' ? state.p1.identity === target.name : true)
        && row.errors.length === 0 && row.consoleErrors.length === 0;
      row.status = row.ok ? 'PASS' : 'FAIL';
      console.log(`${row.status} ${mode} ${target.key}${mode === 'roster' ? `/${target.name}` : ''} arena=${state.matchArena || '-'} clip=${state.p1?.clip || '-'} errors=${row.errors.length}/${row.consoleErrors.length}/${row.failedRequests.length}`);
    } catch (error) {
      row.error = String(error?.stack || error).slice(0, 1800);
      row.errors = pageErrors.slice(beforeErrors);
      row.consoleErrors = consoleErrors.slice(beforeConsole);
      row.failedRequests = failedRequests.slice(beforeFailed);
      row.status = 'ERROR';
      row.ok = false;
      console.log(`ERROR ${mode} ${target.key}${mode === 'roster' ? `/${target.name}` : ''} ${String(error?.message || error).slice(0, 240)}`);
    }
    results.push(row);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    gpu: await page.evaluate(() => {
      const gl = window.__browserSmashRenderer?.getContext?.();
      const debug = gl?.getExtension?.('WEBGL_debug_renderer_info');
      return gl ? { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), software: /swiftshader|llvmpipe|software/i.test(String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '')) } : null;
    }),
    catalog,
    roster,
    offset, limit,
    results,
    totals: { targets: results.length, pass: results.filter(row => row.status === 'PASS').length, fail: results.filter(row => row.status !== 'PASS').length, pageErrors: results.reduce((n, row) => n + (row.errors?.length || 0), 0), consoleErrors: results.reduce((n, row) => n + (row.consoleErrors?.length || 0), 0), failedRequests: results.reduce((n, row) => n + (row.failedRequests?.length || 0), 0) }
  };
  const reportPath = resolve(out, `${mode}${offset || limit ? `-${offset}-${limit || 'end'}` : ''}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`REPORT ${reportPath}`);
  console.log(`TOTAL ${JSON.stringify(report.totals)}`);
  process.exitCode = report.totals.fail ? 1 : 0;
} finally {
  await browser?.close();
  server.close();
}
