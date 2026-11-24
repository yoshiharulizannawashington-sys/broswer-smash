// Focused verification for the roster preview loader hardening.
//
//   bash scripts/run-browser-test.sh scripts/verify-preview-loader.mjs
//
// Checks two failure modes the roster previously could not survive:
// 1. A transient HTTP failure is retried and the selected body still reaches MODEL READY.
// 2. Selecting another fighter cancels the slow previous GLB request and publishes only the new
//    fighter, instead of leaving either preview stuck on LOADING MODEL.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/select-preview-audit');
await mkdir(outDir, { recursive: true });
const delay = ms => new Promise(done => setTimeout(done, ms));

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sources: [], unsupported: {}, roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    // Keep the actual source body slow so the test can select Goku while its request is still open.
    if (url.pathname.endsWith('/wonder_woman_rigged.glb')) await delay(3500);
    if (res.destroyed) return;
    let relative = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = { retry: null, cancellation: null, pageErrors: [], failedRequests: [] };
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'CHECK PASS' : 'CHECK FAIL'} ${name} · ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(45_000);
  page.on('pageerror', error => results.pageErrors.push(String(error?.message || error)));
  page.on('requestfailed', request => {
    results.failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' });
  });

  // Retry: fail Iron Man's first response once, then serve the real GLB.
  let ironAttempts = 0;
  await page.route('**/models/characters/roster/iron_man_tony_stark.glb', async route => {
    ironAttempts++;
    if (ironAttempts === 1) {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary' });
    } else {
      await route.continue();
    }
  });

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview && window.__browserSmashSelect
    && window.characterRosters?.launch?.length), null, { timeout: 120_000, polling: 100 });
  await page.evaluate(() => window.__browserSmashSelect.show());

  // Wait for the initial preview to settle, then switch to the fighter whose first request fails.
  await page.waitForFunction(() => {
    const state = document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state;
    return state && state !== 'loading';
  }, null, { timeout: 30_000, polling: 100 });
  const initial = await page.evaluate(() => ({
    name: document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '',
    state: document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || ''
  }));
  await page.evaluate(name => {
    window.__browserSmashSelect.show();
    window.__browserSmashSelect.select('p1', name);
  }, 'Iron Man (Tony Stark)');
  await page.waitForFunction(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    const name = document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '';
    return name === 'IRON MAN (TONY STARK)' && status?.dataset?.state === 'ready';
  }, null, { timeout: 30_000, polling: 100 });
  const retryInfo = await page.evaluate(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return {
      name: document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '',
      state: status?.dataset?.state || '',
      status: status?.textContent || '',
      bones: window.__fighterPreviewDebug?.bones ?? 0,
      idle: window.__fighterPreviewDebug?.idle?.name || null
    };
  });
  results.retry = { initial, attempts: ironAttempts, ...retryInfo };
  check('a transient 503 is retried rather than left as MODEL FAILED',
    retryInfo.state === 'ready' && ironAttempts >= 2 && retryInfo.bones > 0 && Boolean(retryInfo.idle),
    results.retry);

  // Cancellation: keep Wonder Woman's response slow, start it, then immediately choose Goku.
  await page.unroute('**/models/characters/roster/iron_man_tony_stark.glb');
  const modelRequests = [];
  page.on('request', request => {
    if (/\/models\/characters\//.test(request.url())) modelRequests.push(request.url());
  });
  const wonderRequest = page.waitForRequest(request => request.url().includes('wonder_woman'),
    { timeout: 15_000 });
  await page.evaluate(name => {
    window.__browserSmashSelect.show();
    window.__browserSmashSelect.select('p1', name);
  }, 'Wonder Woman');
  await wonderRequest.catch(async error => {
    const diagnostics = await page.evaluate(() => ({
      status: document.querySelector('#selectScreen [data-role="previewstatus"]')?.textContent || '',
      state: document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || '',
      name: document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '',
      selectState: window.__browserSmashSelect?.state || null,
      debugRoot: Boolean(window.__fighterPreviewDebug?.root)
    }));
    console.log('CANCEL DIAGNOSTICS', JSON.stringify({ error: String(error), diagnostics, modelRequests }, null, 2));
    throw error;
  });
  await page.evaluate(name => {
    window.__browserSmashSelect.select('p1', name);
  }, 'Goku');
  await page.waitForFunction(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    const name = document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '';
    return name === 'GOKU' && status?.dataset?.state === 'ready';
  }, null, { timeout: 30_000, polling: 100 });
  await page.waitForTimeout(700);
  const cancelInfo = await page.evaluate(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return {
      name: document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || '',
      state: status?.dataset?.state || '',
      status: status?.textContent || '',
      bones: window.__fighterPreviewDebug?.bones ?? 0,
      idle: window.__fighterPreviewDebug?.idle?.name || null
    };
  });
  const wonderAborts = results.failedRequests.filter(request =>
    /wonder_woman/.test(request.url) && /ERR_ABORTED|cancelled/i.test(request.error));
  results.cancellation = { ...cancelInfo, wonderAborts };
  check('a new selection cancels the previous slow GLB and publishes only the new fighter',
    cancelInfo.name === 'GOKU' && cancelInfo.state === 'ready' && cancelInfo.bones === 73
      && cancelInfo.idle === 'Goku_Idle' && wonderAborts.length > 0,
    results.cancellation);

  // Permanent failure: every attempt is a 404; the panel must settle on the explicit fallback
  // status instead of leaving the retry/loading state on screen forever.
  let kazeAttempts = 0;
  await page.route('**/models/characters/kaze/kaze.glb', async route => {
    kazeAttempts++;
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
  });
  await page.evaluate(name => {
    window.__browserSmashSelect.select('p1', name);
  }, 'Kaze');
  await page.waitForFunction(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return status?.dataset?.state === 'fallback';
  }, null, { timeout: 15_000, polling: 100 });
  const failedLoad = await page.evaluate(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return {
      state: status?.dataset?.state || '',
      status: status?.textContent || '',
      name: document.querySelector('#selectScreen [data-role="previewname"]')?.textContent || ''
    };
  });
  results.permanentFailure = { attempts: kazeAttempts, ...failedLoad };
  check('a permanently failing GLB settles on MODEL FAILED',
    kazeAttempts >= 3 && failedLoad.state === 'fallback' && /MODEL FAILED/i.test(failedLoad.status),
    results.permanentFailure);
  check('no page errors during retry, cancellation or permanent failure',
    results.pageErrors.length === 0, results.pageErrors);

  const report = {
    generatedAt: new Date().toISOString(),
    checks,
    passed: checks.filter(entry => entry.ok).length,
    total: checks.length,
    ...results
  };
  await writeFile(resolve(outDir, 'loader-hardening.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`SUMMARY ${report.passed}/${report.total} checks passed`);
  process.exitCode = report.passed === report.total ? 0 : 1;
} finally {
  await browser?.close();
  server.close();
}
