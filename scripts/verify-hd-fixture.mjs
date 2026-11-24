// Proves the licensed fixture loads through the existing manifest loader and actually plays in a
// match: skeleton, clips the loader can map, height, ground contact, and that it takes an attack
// without errors. Screenshots an idle and an attack frame for visual review.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const KEY = process.env.FIXTURE || 'hd_soldier_cc0';
const root = process.cwd();
const out = 'artifacts/hd-fixture';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
const requests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (/\.glb$/i.test(r.url())) requests.push({ file: r.url().split('/').pop(), status: r.status() }); });

await page.goto(origin + `/?showcaseCharacter=${KEY}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(3000);

const report = await page.evaluate(() => {
  const fighter = window.fighters[0];
  const model = fighter?.model;
  const T = window.__browserSmashThree;
  let bones = 0, skinned = 0, materials = new Set();
  model?.traverse(node => {
    if (node.isBone) bones += 1;
    if (node.isSkinnedMesh) {
      skinned += 1;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      list.filter(Boolean).forEach(m => materials.add(m.name || '(unnamed)'));
    }
  });
  const box = model ? new T.Box3().setFromObject(model) : null;
  const size = box ? box.getSize(new T.Vector3()) : null;
  return {
    identity: fighter?.identity,
    assetUrl: model?.userData?.characterAssetUrl || null,
    bones, skinnedMeshes: skinned,
    materials: [...materials],
    height: size ? +size.y.toFixed(3) : null,
    feetY: box ? +box.min.y.toFixed(3) : null,
    fighterY: fighter ? +fighter.position.y.toFixed(3) : null,
    hasAnimations: Boolean(model?.userData?.animations || fighter?.animations),
    notes: model?.userData?.characterAssetNote || model?.userData?.characterLoadNote || null
  };
});

await page.screenshot({ path: `${out}/${KEY}-idle.png` });
await page.keyboard.press('j');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/${KEY}-attack.png` });
await page.keyboard.press('j');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/${KEY}-combat.png` });

await writeFile(`${out}/${KEY}-report.json`, JSON.stringify({ report, requests, errors }, null, 2));
console.log('FIXTURE ' + JSON.stringify({ report, requests, errors }));
await browser.close(); server.close();
