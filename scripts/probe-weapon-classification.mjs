// Phase 22.4 probe: does a fighter keep the weapon classification its prefab declares?
//
//   bash scripts/run-browser-test.sh scripts/probe-weapon-classification.mjs
//
// Reads `model.userData.weaponKind` on the fighter's own exported body the moment it is armed, then
// again after the match loop has been running for real frames, and reports the left-hand
// classification as well. A fighter that reports a kind and then loses it is losing it to something
// in the game loop, not to the equipment code.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-4');
await mkdir(outDir, { recursive: true });
const FOCUS = ['Wonder Woman', 'Link', 'Captain Jack Sparrow', 'Kaze', 'Thor', 'Aquaman'];

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
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

const report = { phase: '22.4', kind: 'weapon-classification', fighters: [], pagesErrors: [], unverified: [], status: 'complete' };
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => report.pagesErrors.push(String(error.message || error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.characters?.status === 'loaded'
    && window.browserSmashAssets !== null, null, { timeout: 120_000, polling: 250 }).catch(() => {});
  await page.waitForFunction(() => window.__browserSmashAssets?.weapons?.status === 'loaded'
    && window.fighters?.length === 2, null, { timeout: 120_000, polling: 250 });

  for (const name of FOCUS) {
    const captured = await page.evaluate(async fighterName => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
      const fighter = window.fighters[0];
      const slug = String(fighterName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const model = fighter.model;
        const asset = String(model?.userData?.characterAssetUrl || '');
        const bodyLanded = asset.includes('/roster/' + slug + '.glb') || asset.endsWith('/' + slug + '/' + slug + '.glb');
        if (fighter.identity === fighterName && bodyLanded
          && (model?.userData?.equippedWeaponRight || model?.userData?.weaponKind)) break;
        await new Promise(done => setTimeout(done, 40));
      }
      const read = () => {
        const model = fighter.model;
        return {
          weaponKind: model.userData.weaponKind ?? null,
          weaponLabel: model.userData.weaponLabel ?? null,
          offhandKind: model.userData.offhandKind ?? null,
          offhandLabel: model.userData.offhandLabel ?? null,
          right: model.userData.equippedWeaponRight?.name ?? null,
          left: model.userData.equippedWeaponLeft?.name ?? null,
          pickupTimer: +(fighter.itemWeaponTimer || 0).toFixed(3),
          previousKind: fighter.itemPreviousWeaponKind ?? null,
          frames: window.__browserSmashAssets?.app?.frames || 0
        };
      };
      const atArming = read();
      // Let the match loop run real frames: whatever deletes the classification does it in update.
      const startFrames = atArming.frames;
      const startTime = Date.now();
      while (Date.now() - startTime < 2500 && (window.__browserSmashAssets?.app?.frames || 0) - startFrames < 6) {
        await new Promise(done => setTimeout(done, 50));
      }
      const afterLoop = read();
      return { identity: fighter.identity, atArming, afterLoop,
        framesElapsed: afterLoop.frames - atArming.frames };
    }, name);
    report.fighters.push(captured);
    console.log(`${name.padEnd(24)} arming=${String(captured.atArming.weaponKind)} `
      + `+${captured.framesElapsed}f=${String(captured.afterLoop.weaponKind)} `
      + `offhand=${String(captured.afterLoop.offhandKind)} frames=${captured.framesElapsed}`);
  }
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message || error);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'classification-probe.json'), JSON.stringify(report, null, 2));
const lost = report.fighters.filter(f => f.atArming.weaponKind && !f.afterLoop.weaponKind);
console.log(JSON.stringify({ status: report.status, error: report.error || null,
  classifiedAtArming: report.fighters.filter(f => f.atArming.weaponKind).length,
  lostAfterLoop: lost.map(f => f.identity),
  pageErrors: report.pagesErrors.length }, null, 2));
if (report.status === 'failed') process.exitCode = 1;
