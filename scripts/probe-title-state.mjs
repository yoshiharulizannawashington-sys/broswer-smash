// Why does the title screen read as a dark blur? Reports what the camera is actually looking at,
// what the canvas shows behind the overlay, and how opaque the overlay layers are.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/presentation';
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
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const T = window.__browserSmashThree;
  const camera = window.smashCamera?.camera;
  const scene = window.__browserSmashScene;
  const raycaster = new T.Raycaster();
  const visible = o => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  const cast = (x, y) => {
    raycaster.setFromCamera(new T.Vector2(x, y), camera);
    raycaster.far = 4000;
    const hit = raycaster.intersectObjects(scene.children, true)
      .filter(h => h.object.isMesh && visible(h.object))[0];
    if (!hit) return null;
    const m = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
    return { mesh: hit.object.name || '(unnamed)', material: m?.name || '(unnamed)', distance: +hit.distance.toFixed(1) };
  };
  const style = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const computed = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      background: computed.backgroundColor,
      backgroundImage: computed.backgroundImage.slice(0, 90),
      opacity: computed.opacity,
      backdropFilter: computed.backdropFilter,
      box: [Math.round(box.width), Math.round(box.height)]
    };
  };
  const fighters = (window.fighters || []).map(f => ({ name: f.name, position: f.position?.toArray?.().map(v => +v.toFixed(1)) }));
  return {
    camera: { position: camera.position.toArray().map(v => +v.toFixed(2)), fov: camera.fov, far: camera.far },
    background: scene.background?.isTexture ? 'texture' : (scene.background?.getHexString ? '#' + scene.background.getHexString() : String(scene.background)),
    environment: scene.environment?.uuid?.slice(0, 8) || null,
    centre: cast(0, 0), lower: cast(0, -0.6), upper: cast(0, 0.6), left: cast(-0.7, 0),
    fighters,
    menu: style('#menu'), panel: style('#menu .panel'), title: style('#bbTitle'),
    canvas: style('#gl'),
    topElementAtCentre: document.elementFromPoint(640, 360)?.className || document.elementFromPoint(640, 360)?.tagName,
    sky: window.__browserSmashSkyStatus || null
  };
});
await writeFile(`${out}/title-state.json`, JSON.stringify(report, null, 2));
console.log('TITLE ' + JSON.stringify(report));
await browser.close(); server.close();
