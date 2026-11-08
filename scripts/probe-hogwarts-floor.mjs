// Identifies what the Great Hall floor actually is: raycasts under several screen points and lists
// the nearest floor/stone-named meshes with their real material state (map, tint, roughness, metal).
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
await page.evaluate(() => {
  const select = document.querySelector('#menuMapSelect');
  if (select) { select.value = 'hogwarts'; select.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); });
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2600);

const report = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const camera = window.smashCamera?.camera;
  const scene = window.__browserSmashScene;
  const ray = new T.Raycaster();
  const visible = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  const describe = object => {
    const m = Array.isArray(object.material) ? object.material[0] : object.material;
    return m ? {
      mesh: object.name || '(unnamed)',
      material: m.name || '(unnamed)',
      color: m.color?.getHexString?.() ?? null,
      map: m.map ? (m.map.name || 'map') : null,
      mapRepeat: m.map?.repeat ? [m.map.repeat.x, m.map.repeat.y] : null,
      roughness: m.roughness ?? null,
      metalness: m.metalness ?? null,
      emissive: m.emissive?.getHexString?.() ?? null,
      emissiveIntensity: m.emissiveIntensity ?? null,
      type: m.type,
      archStone: Boolean(m.userData?.archStone),
      vertexColors: Boolean(m.vertexColors)
    } : null;
  };
  const at = (x, y) => {
    ray.setFromCamera(new T.Vector2(x, y), camera);
    ray.far = 4000;
    const hits = ray.intersectObjects(scene.children, true).filter(h => h.object.isMesh && visible(h.object));
    const hit = hits.find(h => { const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material; return m && !m.transparent; });
    return hit ? { screen: [x, y], distance: +hit.distance.toFixed(2), point: hit.point.toArray().map(n => +n.toFixed(1)), ...describe(hit.object) } : null;
  };
  // Every big horizontal-ish stone candidate in the hall, so the floor can be identified by size.
  const floors = [];
  scene.traverse(node => {
    if (!node.isMesh || !visible(node)) return;
    const m = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!m) return;
    node.geometry?.computeBoundingBox?.();
    const box = node.geometry?.boundingBox;
    if (!box) return;
    const size = new T.Vector3(); box.getSize(size);
    const name = `${node.name} ${m.name}`;
    if (!/floor|stone|marble|tile|paving|plaza|wall|ground/i.test(name)) return;
    if (size.y > 3 && size.x < 8 && size.z < 8) return;
    floors.push({ ...describe(node), size: size.toArray().map(n => +n.toFixed(1)), width: +Math.max(size.x, size.z).toFixed(1) });
  });
  floors.sort((a, b) => b.width - a.width);
  return {
    exposure: window.__browserSmashRenderer?.toneMappingExposure ?? null,
    sun: window.__browserSmashSun ? { intensity: window.__browserSmashSun.intensity, color: window.__browserSmashSun.color.getHexString() } : null,
    hemisphere: window.__browserSmashHemisphere ? { intensity: window.__browserSmashHemisphere.intensity } : null,
    probes: [at(0, -0.72), at(0, -0.35), at(-0.45, -0.6), at(0.45, -0.55)],
    floors: floors.slice(0, 12),
    stoneTuning: window.__browserSmashStoneTuning || null,
    stoneError: window.__browserSmashStoneError || null
  };
});
console.log('HOGFLOOR ' + JSON.stringify(report, null, 1).slice(0, 6000));
await browser.close(); server.close();
