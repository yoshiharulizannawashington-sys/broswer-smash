// Gameplay-camera visual audit: shoots a live match from the camera the player actually sees,
// so character quality is judged at fighting distance rather than a close-up beauty render.
//
//   bash scripts/run-browser-test.sh scripts/_audit-camera.mjs [outDir] [fighter]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/audit-camera');
const fighter = process.argv[3] || 'Goku';
await mkdir(outDir, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
const step = s => page.evaluate(v => window.__browserSmashStep(v), s);

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180000, polling: 200 });

await page.click(`#selectScreen .bs-card[data-fighter="${fighter}"]`);
await page.click('#selectScreen .bs-card[data-fighter="Hulk (Bruce Banner)"]');
await page.click('#selectScreen [data-nav="next"]');
await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
await page.evaluate(() => document.querySelector('#play').click());
await step(1.6);
await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.sculptedBody, null, { timeout: 60000, polling: 100 }).catch(() => console.log('no sculpted body for', fighter));

const info = await page.evaluate(() => {
  const f = window.fighters[0];
  const camera = window.smashCamera.camera;
  return { identity: f.identity, sculpted: f.model.userData.sculptedBody || null,
    model: f.model.name, asset: f.model.userData.characterAssetUrl || null,
    bones: (() => { let n = 0; f.model.traverse(o => { if (o.isBone) n++; }); return n; })(),
    clips: f.animationController?.clips ? f.animationController.clips.size : 0,
    camera: camera.position.toArray().map(n => +n.toFixed(2)),
    distance: +camera.position.distanceTo(f.model.getWorldPosition(new window.__browserSmashThree.Vector3())).toFixed(2) };
});
console.log('play', JSON.stringify(info));
const animState = await page.evaluate(() => (window.__browserSmashAssets?.animations || null));
console.log('animations', JSON.stringify(animState));
await page.screenshot({ path: resolve(outDir, 'match.png') });
await page.keyboard.press('j');
await step(0.10);
await page.screenshot({ path: resolve(outDir, 'match-attack.png') });
await step(0.9);
await page.keyboard.down('d');
await step(0.7);
await page.keyboard.up('d');
await page.screenshot({ path: resolve(outDir, 'match-run.png') });
// Transformation and ultimate, from the same gameplay camera.
await page.evaluate(() => { const f = window.fighters[0]; f.power = 100; f.meter = 100; });
await page.keyboard.press('i');
await step(0.7);
await page.screenshot({ path: resolve(outDir, 'match-form.png') });
await page.evaluate(() => { window.fighters[0].meter = 100; });
await page.keyboard.press('o');
await step(0.35);
await page.screenshot({ path: resolve(outDir, 'match-ultimate.png') });
await browser.close();
server.close();
console.log('wrote screenshots to', outDir);
