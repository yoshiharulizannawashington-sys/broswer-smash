import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const failedRequests = [];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const bytes = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(bytes);
  } catch (error) {
    const pathname = req.url || '/';
    if (!pathname.includes('favicon.ico')) failedRequests.push({ url: pathname, error: String(error?.message || error) });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
const origin = 'http://127.0.0.1:' + address.port;
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'
    ]
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  context.setDefaultTimeout(180_000);

  // Exercise both supported entrypoints: repository root and the public deployment page.
  for (const route of ['/index.html', '/public/index.html']) {
    const page = await context.newPage();
    const pageErrors = [];
    const glbResponses = [];
    page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
    page.on('response', response => {
      if (/\.glb(?:\?|$)/i.test(response.url())) {
        glbResponses.push({ url: response.url(), status: response.status() });
      }
    });

    try {
      const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      assert.ok(response && response.status() === 200, route + ' did not return HTTP 200');

      await page.waitForFunction(() => {
        const state = window.__browserSmashAssets || {};
        const fighters = window.fighters || [];
        return state.app?.status === 'running'
          && state.app.frames >= 5
          && state.characters?.status === 'loaded'
          && state.characters.count >= 57
          && state.weapons?.status === 'loaded'
          && state.weapons.count >= 68
          && state.finalValley?.status === 'loaded'
          && state.finalValley.meshCount > 0
          && fighters.length === 2
          && fighters.every(f => f.model?.name?.startsWith('Blender fighter '))
          && fighters.every(f => !!f.model?.userData?.equippedWeaponRight);
      }, null, { timeout: 180_000, polling: 250 });

      const result = await page.evaluate(() => ({
        route: location.pathname,
        title: document.title,
        assets: window.__browserSmashAssets,
        fighters: (window.fighters || []).map(f => ({
          identity: f.identity,
          model: f.model?.name,
          weapon: f.model?.userData?.weaponLabel,
          weaponKind: f.model?.userData?.weaponKind,
          rigVersion: f.model?.userData?.blenderRigVersion
        })),
        canvasSize: {
          width: document.querySelector('#gl')?.width,
          height: document.querySelector('#gl')?.height
        }
      }));

      assert.equal(result.fighters.length, 2, route + ': expected P1 and CPU fighter instances');
      assert.ok(result.canvasSize.width > 0 && result.canvasSize.height > 0, route + ': render canvas has no dimensions');
      assert.ok(glbResponses.some(item => item.url.includes('character_models.glb') && item.status === 200), route + ': character GLB was not requested successfully');
      assert.ok(glbResponses.some(item => item.url.includes('character_weapons.glb') && item.status === 200), route + ': weapon GLB was not requested successfully');
      assert.ok(glbResponses.some(item => item.url.includes('final_valley.glb') && item.status === 200), route + ': Final Valley GLB was not requested successfully');
      assert.deepEqual(pageErrors, [], route + ': browser runtime errors: ' + pageErrors.join('\n'));
      console.log(JSON.stringify({ smoke: 'pass', ...result }, null, 2));
    } catch (error) {
      try {
        console.error('Asset state at failure:', JSON.stringify(await page.evaluate(() => window.__browserSmashAssets || {}), null, 2));
        const screenshotName = '/tmp/browser-smash-failure-' + route.replace(/[^a-z0-9]+/gi, '-') + '.png';
        await page.screenshot({ path: screenshotName, fullPage: true });
      } catch {}
      console.error('GLB responses:', JSON.stringify(glbResponses, null, 2));
      console.error('Page errors:', JSON.stringify(pageErrors, null, 2));
      throw error;
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(failedRequests, [], 'Static asset requests failed: ' + JSON.stringify(failedRequests));
  await context.close();
  console.log('Browser Smash runtime smoke test passed for both root and public entrypoints.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
