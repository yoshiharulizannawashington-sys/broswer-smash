// One-pass audit of every selectable fighter's character-select preview.
//
//   bash scripts/run-browser-test.sh scripts/audit-select-previews.mjs
//
// This drives the real select screen (`window.__browserSmashSelect`) rather than calling the
// preview loader directly, so a missing card mapping, disabled manifest entry, broken GLB or
// failed GLB request all show up as a failed row. It intentionally does not reuse screenshots or
// cached preview results: every launch fighter is selected and loaded exactly once.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/select-preview-audit');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sources: [], unsupported: {}, roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
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
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

// Keep this in lock-step with public/js/combat/movesets.js. It is used only to compare the
// manifest lookup with the card name; the preview itself uses the same slugId.
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const pageErrors = [];
const consoleErrors = [];
const requestFailures = [];
const httpErrors = [];
const rows = [];
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(35_000);
  page.on('pageerror', error => pageErrors.push(String(error?.message || error).split('\n')[0]));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(String(message.text()).slice(0, 500));
  });
  page.on('requestfailed', request => requestFailures.push({
    url: request.url(), error: request.failure()?.errorText || 'request failed'
  }));
  page.on('response', response => {
    if (response.status() >= 400) httpErrors.push({ url: response.url(), status: response.status() });
  });

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview && window.__browserSmashSelect
    && window.characterRosters?.launch?.length), null, { timeout: 120_000, polling: 100 });

  const rosterNames = await page.evaluate(() => window.characterRosters.launch.map(([name]) => name));
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/models/characters/manifest.json', { cache: 'no-cache' });
    return response.ok ? response.json() : null;
  });
  const manifestCharacters = manifest?.characters || {};

  // Open the actual setup screen once; each selection uses the same public select() path a click
  // uses, so the audit does not bypass the roster card or its preview wiring.
  await page.evaluate(() => window.__browserSmashSelect.show());

  for (const name of rosterNames) {
    const slug = slugOf(name);
    const entry = manifestCharacters[slug];
    const beforeHttp = httpErrors.length;
    const beforeFailed = requestFailures.length;
    const result = {
      name, slug,
      enabled: entry?.enabled === true,
      url: entry?.url || null,
      state: 'timeout',
      status: '',
      previewName: '',
      root: false,
      bones: 0,
      idle: null,
      clips: 0,
      dimensions: null,
      durationMs: null,
      failure: null,
      httpErrors: [],
      requestFailures: []
    };
    const started = Date.now();
    try {
      await page.evaluate(({ name }) => {
        window.__browserSmashSelect.show();
        window.__browserSmashSelect.select('p1', name);
      }, { name });
      await page.waitForFunction(({ name }) => {
        const status = document.querySelector('[data-role="previewstatus"]');
        const selected = window.__browserSmashSelect?.state?.p1;
        return selected === name && status?.dataset?.state
          && !['loading', 'missing'].includes(status.dataset.state);
      }, { name }, { timeout: 35_000, polling: 100 });
      await page.waitForTimeout(180);
      const info = await page.evaluate(() => {
        const status = document.querySelector('[data-role="previewstatus"]');
        const debug = window.__fighterPreviewDebug;
        return {
          state: status?.dataset?.state || 'missing',
          status: status?.textContent || '',
          previewName: document.querySelector('[data-role="previewname"]')?.textContent || '',
          root: Boolean(debug?.root),
          bones: Number(debug?.bones) || 0,
          idle: debug?.idle ? {
            name: debug.idle.name || null,
            duration: debug.idle.duration ?? null,
            tracks: debug.idle.tracks ?? 0
          } : null,
          clips: Number(status?.dataset?.clips) || 0,
          dimensions: debug?.size || null
        };
      });
      Object.assign(result, info);
      const ready = result.state === 'ready'
        && result.root
        && result.bones > 0
        && Boolean(result.idle?.name)
        && (result.idle.tracks > 0 || result.clips > 0);
      if (!ready) result.failure = result.state === 'ready'
        ? 'MODEL READY but the live preview has no rigged animated body'
        : result.status;
    } catch (error) {
      result.failure = String(error?.message || error).split('\n')[0];
      result.timedOut = true;
    }
    result.durationMs = Date.now() - started;
    // A click intentionally aborts the previous fighter's request. Only errors for this row's
    // model URL belong to this row; an ERR_ABORTED from a superseded preview is expected.
    const relevantFailure = entry => {
      try { return new URL(entry.url).pathname === result.url?.split('?')[0]; }
      catch { return false; }
    };
    const relevantHttp = httpErrors.slice(beforeHttp).filter(relevantFailure);
    const relevantFailed = requestFailures.slice(beforeFailed)
      .filter(entry => relevantFailure(entry) && !/ERR_ABORTED|cancelled/i.test(entry.error));
    result.httpErrors = relevantHttp;
    result.requestFailures = relevantFailed;
    if (relevantHttp.length || relevantFailed.length) {
      result.failure ||= 'preview asset request failed';
    }
    rows.push(result);
    console.log(`${result.failure ? 'FAIL' : 'PASS'} ${name} · ${result.state} · ${result.durationMs}ms`
      + (result.failure ? ` · ${result.failure}` : ''));
  }

  const failures = rows.filter(row => row.failure);
  const cancelledRequests = requestFailures.filter(entry => /ERR_ABORTED|cancelled/i.test(entry.error));
  const report = {
    generatedAt: new Date().toISOString(),
    origin,
    renderer: process.env.BROWSER_RENDERER || 'SwiftShader',
    rosterCount: rows.length,
    passed: rows.length - failures.length,
    failed: failures.length,
    rows,
    global: {
      pageErrors: [...new Set(pageErrors)],
      consoleErrors: [...new Set(consoleErrors)],
      requestFailures: requestFailures.filter(entry => !/favicon\.ico/.test(entry.url)
        && !/ERR_ABORTED|cancelled/i.test(entry.error)),
      cancelledRequests,
      httpErrors: httpErrors.filter(entry => !/favicon\.ico/.test(entry.url))
    }
  };
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\nAUDIT ${report.passed}/${report.rosterCount} previews ready`);
  if (failures.length) {
    console.log('FAILURES');
    for (const row of failures) {
      console.log(`- ${row.name} (${row.slug}): ${row.failure}`);
      if (row.url) console.log(`  asset: ${row.url}`);
      for (const error of row.httpErrors) console.log(`  HTTP ${error.status}: ${error.url}`);
      for (const error of row.requestFailures) console.log(`  request failed: ${error.error}: ${error.url}`);
    }
  }
  console.log(`report: ${resolve(outDir, 'report.json')}`);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await browser?.close();
  server.close();
}
