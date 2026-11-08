// Reads the live material state of Asgard's surfaces after a real match has mounted the stage.
// Verifies the Rock030 assignment actually reached the GPU-facing material: colour map in sRGB,
// normal/roughness/AO linear, AO on uv1, roughness driven by the map, metalness zero, repeat derived
// from the mesh's real footprint - and that marble, gold, bronze and crystal were left alone.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/asgard-stone';
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

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.evaluate(() => { const s = document.querySelector('#menuMapSelect'); s.value = 'asgard'; s.dispatchEvent(new Event('change', { bubbles: true })); });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2500);

const report = await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const describe = texture => texture ? {
    file: (texture.image?.src || texture.name || '').split('/').pop(),
    colorSpace: texture.colorSpace,
    repeat: [texture.repeat.x, texture.repeat.y],
    size: texture.image ? [texture.image.width, texture.image.height] : null
  } : null;
  const out = [];
  scene.traverse(node => {
    if (!node.isMesh || !node.material) return;
    const m = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!m?.name || !/^Asgard ·/.test(m.name)) return;
    if (out.some(o => o.material === m.name)) return;
    const geometry = node.geometry;
    geometry?.computeBoundingBox?.();
    const box = geometry?.boundingBox;
    out.push({
      material: m.name,
      mesh: node.name,
      dimensions: box ? [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map(v => +v.toFixed(1)) : null,
      metalness: m.metalness,
      roughness: m.roughness,
      hasUv: !!geometry?.getAttribute('uv'),
      hasUv1: !!geometry?.getAttribute('uv1'),
      map: describe(m.map),
      normalMap: describe(m.normalMap),
      roughnessMap: describe(m.roughnessMap),
      aoMap: describe(m.aoMap),
      emissiveIntensity: m.emissiveIntensity
    });
  });
  return out;
});

await writeFile(`${out}/material-wiring.json`, JSON.stringify(report, null, 2));
console.log('WIRING ' + JSON.stringify(report));
await browser.close(); server.close();
