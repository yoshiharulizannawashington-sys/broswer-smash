// Dumps Asgard's marble surfaces with world-space bounds so architectural detail can be built on the
// geometry that actually exists instead of guessed coordinates.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
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
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(() => { const s = document.querySelector('#menuMapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const scene = window.__browserSmashScene;
  const out = [];
  scene.traverse(node => {
    if (!node.isMesh) return;
    const material = Array.isArray(node.material) ? node.material[0] : node.material;
    const name = material?.name || '';
    if (!/marble/i.test(name)) return;
    const box = new T.Box3().setFromObject(node);
    const size = box.getSize(new T.Vector3());
    const centre = box.getCenter(new T.Vector3());
    out.push({
      mesh: node.name || '(unnamed)',
      material: name,
      centre: centre.toArray().map(v => +v.toFixed(2)),
      size: size.toArray().map(v => +v.toFixed(2)),
      visible: node.visible,
      castShadow: node.castShadow,
      vertexCount: node.geometry?.attributes?.position?.count || 0,
      hasUv: Boolean(node.geometry?.attributes?.uv)
    });
  });
  out.sort((a, b) => (b.size[0] * b.size[2]) - (a.size[0] * a.size[2]));
  const bounds = new T.Box3().setFromObject(scene).getSize(new T.Vector3());
  const colours = [...new Set(out.map(o => o.material))];
  return { count: out.length, materials: colours, sceneSize: bounds.toArray().map(v => +v.toFixed(1)), surfaces: out };
});
console.log('ASGARD_GEOMETRY ' + JSON.stringify(report, null, 1).slice(0, 12000));
await browser.close(); server.close();
