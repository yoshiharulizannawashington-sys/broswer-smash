// Measure each large authored map's real geometry in the title state, so a beauty camera can be
// authored from the landmarks that actually mounted rather than from guessed coordinates.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/title-beauty';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
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

const MAPS = ['asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower'];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
  await page.waitForTimeout(600);
  console.log('MENU', JSON.stringify(await page.evaluate(() => ({
    bodyClass: document.body.className,
    menuHidden: document.querySelector('#menu')?.classList.contains('hidden'),
    titleVisible: Boolean(document.querySelector('#bbTitle')),
    started: window.__browserSmashMatch?.().arena ?? null
  }))));

  for (const key of MAPS) {
    await page.evaluate(k => {
      for (const sel of [document.querySelector('#mapSelect'), document.querySelector('#menuMapSelect')]) {
        if (sel) { sel.value = k; sel.dispatchEvent(new Event('change')); }
      }
      window.__browserSmashApplyMap(k);
    }, key);
    await page.waitForFunction(k => window.__browserSmashAssets?.authoredArena?.key === k
      && window.__browserSmashAssets.authoredArena.status === 'loaded', key, { timeout: 90000, polling: 300 });
    await page.waitForTimeout(1800);
    const data = await page.evaluate(k => {
      const THREE = window.__browserSmashThree;
      const group = window.__browserSmashAuthoredGroup;
      const camera = window.smashCamera?.camera;
      if (!THREE || !group) return { key: k, error: 'no group' };
      group.updateWorldMatrix(true, true);
      const whole = new THREE.Box3().setFromObject(group);
      const parts = [];
      const box = new THREE.Box3();
      group.traverse(node => {
        if (!node.isMesh || !node.geometry) return;
        if (node.name.startsWith('Asgard courtyard') || node.name.startsWith('Asgard marble architecture')) return;
        box.setFromObject(node);
        const size = new THREE.Vector3(); box.getSize(size);
        const centre = new THREE.Vector3(); box.getCenter(centre);
        parts.push({
          name: node.name,
          volume: Math.round(size.x * size.y * size.z),
          centre: [ +centre.x.toFixed(1), +centre.y.toFixed(1), +centre.z.toFixed(1) ],
          size: [ +size.x.toFixed(1), +size.y.toFixed(1), +size.z.toFixed(1) ]
        });
      });
      parts.sort((a, b) => b.volume - a.volume);
      const layout = window.__browserSmashLayout?.() || {};
      return {
        key: k,
        meshes: parts.length,
        bbox: { min: [+whole.min.x.toFixed(1), +whole.min.y.toFixed(1), +whole.min.z.toFixed(1)], max: [+whole.max.x.toFixed(1), +whole.max.y.toFixed(1), +whole.max.z.toFixed(1)] },
        layout: { bounds: layout.bounds || null, ground: layout.ground ?? null, spawns: layout.spawns || null },
        camera: camera ? { x: +camera.position.x.toFixed(1), y: +camera.position.y.toFixed(1), z: +camera.position.z.toFixed(1), fov: camera.fov } : null,
        landmarks: parts.slice(0, 12)
      };
    }, key);
    results[key] = data;
    await page.screenshot({ path: `${out}/before-${key}.png` });
    console.log('MAP', key, JSON.stringify({ bbox: data.bbox, layout: data.layout?.bounds, camera: data.camera, top: data.landmarks?.slice(0, 5).map(l => [l.name, l.centre, l.size]) }));
  }
  await writeFile(`${out}/landmarks.json`, JSON.stringify(results, null, 2));
  console.log('WROTE', `${out}/landmarks.json`);
} finally {
  await browser.close();
  server.close();
}
