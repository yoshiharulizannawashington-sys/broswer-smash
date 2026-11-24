// Focused probe: reproduce the Iron Spider raised-platform rig check and dump what the model
// really is at that moment (bone names, asset url, model name).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 200 });

const dump = label => page.evaluate(tag => {
  const p = window.fighters[0];
  const bones = [];
  p.model.traverse(o => { if (o.isBone) bones.push(o.name); });
  const check = window.__browserSmashRigCheck(p);
  return { tag, model: p.model.name, asset: p.model.userData?.characterAssetUrl || null,
    hasJoints: { pelvis: !!p.model.userData?.pelvis, head: !!p.model.userData?.head },
    skinned: (() => { let n = 0; p.model.traverse(o => { if (o.isSkinnedMesh) n++; }); return n; })(),
    bones: bones.slice(0, 25), boneCount: bones.length,
    rig: check.rig, ok: check.ok, issues: check.issues };
}, label);

await page.click('#selectScreen .bs-card[data-fighter="Iron Spider"]');
await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
await page.click('#selectScreen [data-nav="next"]');
await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
await page.evaluate(() => document.querySelector('#play').click());
await page.evaluate(() => window.__browserSmashStep(1.2));
console.log(JSON.stringify(await dump('first-match'), null, 1));

await page.evaluate(() => {
  window.__browserSmashSelect.chooseArena('starktower');
  document.querySelector('#play').click();
  window.__browserSmashStep(0.3);
});
console.log(JSON.stringify(await dump('after-restart-immediate'), null, 1));
await page.evaluate(() => window.__browserSmashStep(1.5));
console.log(JSON.stringify(await dump('after-restart-settled'), null, 1));

await browser.close();
server.close();
