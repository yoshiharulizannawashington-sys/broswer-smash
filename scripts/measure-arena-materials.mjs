
// Inventory the arena that is actually mounted: its largest surfaces and every emissive material.
//
//   bash scripts/run-browser-test.sh scripts/measure-arena-materials.mjs --arena=asgard
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=').slice(1).join('=');
const arena = arg('arena', 'asgard');
await mkdir('artifacts/diagnostics', { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  await page.goto('http://127.0.0.1:' + server.address().port + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(a => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena(a);
    window.__browserSmashSelect?.select('p1', 'Captain Jack Sparrow');
    document.querySelector('#play').click();
  }, arena);
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    let scene = window.fighters[0].model;
    while (scene.parent) scene = scene.parent;
    const round = n => +Number(n).toFixed(2);
    const out = [];
    scene.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean);
      const m = mats[0];
      if (!m) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      o.updateWorldMatrix(true, false);
      const Vector3 = g.boundingBox.max.constructor;
      const worldScale = o.getWorldScale(new Vector3());
      const absScale = new Vector3(Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
      const size = g.boundingBox.getSize(new Vector3()).multiply(absScale);
      const volume = Math.abs(size.x * size.y * size.z);
      const emissiveIntensity = m.emissiveIntensity ?? 0;
      if (volume < 12 && emissiveIntensity < 0.25) return;
      out.push({
        mesh: o.name || o.parent?.name || '(unnamed)',
        material: m.name || '(unnamed material)',
        color: m.color ? '#' + m.color.getHexString() : null,
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
        emissiveIntensity: round(emissiveIntensity),
        roughness: m.roughness ?? null,
        metalness: m.metalness ?? null,
        size: [round(size.x), round(size.y), round(size.z)],
        volume: round(volume)
      });
    });
    out.sort((a, b) => b.volume - a.volume);
    return out;
  });

  console.log('ARENA', arena, 'dominant surfaces:', report.length);
  for (const entry of report.slice(0, 24)) console.log('  ' + JSON.stringify(entry));
  await writeFile(`artifacts/diagnostics/arena-${arena}-materials.json`, JSON.stringify(report, null, 2));
  console.log('wrote', `artifacts/diagnostics/arena-${arena}-materials.json`);
} finally { await browser.close(); server.close(); }
