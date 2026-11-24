// Side-by-side body comparison: the same fighter rendered twice in one browser session — once
// with the character manifest stubbed empty (so the code-authored sculpted body is what the game
// shows) and once with the real manifest (the Blender GLB replaces it). Writes both close-ups so
// the two bodies can be judged from screenshots instead of argued about.
//
//   bash scripts/run-browser-test.sh scripts/_compare-bodies.mjs [outDir] [fighter...]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/body-compare');
await mkdir(outDir, { recursive: true });
const fighters = process.argv.slice(3).length ? process.argv.slice(3) : ['Goku', 'Iron Man (Tony Stark)', 'Iron Spider'];

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
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

async function shoot(bodyVariant) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => console.log('PAGEERROR', error.message));
  if (bodyVariant === 'sculpted') {
    // Empty manifest: no body entry resolves, so the procedural/sculpted body stays mounted.
    await page.route('**/models/characters/manifest.json', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, characters: {} }) }));
  }
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath)
      });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180_000, polling: 200 });

  for (const name of fighters) {
    await page.evaluate(fighterName => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
    }, name);
    await page.waitForTimeout(2200);
    await page.evaluate(() => {
      document.querySelector('#play').click();
      window.__browserSmashTrainingDummy = true;
      window.__browserSmashStep(0.5);
    });
    // Hide every panel and frame the body from the chest, from the model's own bounds.
    const info = await page.evaluate(() => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      f.position.set(0, f.groundLevel ?? 0, 0);
      for (const sel of ['#hud', '#cameraSettings', '#help', '#status', '#exploreHint', '.hud', '#energyHUD', '#powerHudStyles']) {
        document.querySelectorAll(sel).forEach(node => { node.style.display = 'none'; });
      }
      const camera = window.smashCamera.camera;
      window.smashCamera.update = () => {};
      f.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(f.model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      camera.near = 0.05;
      camera.fov = 32;
      camera.position.set(center.x + size.y * 0.10, center.y + size.y * 0.06, center.z + size.y * 1.35);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      let meshes = 0, tris = 0;
      const materials = new Set();
      f.model.traverse(node => {
        if (!node.isMesh) return;
        meshes++;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) materials.add(material?.name || '?');
        const geometry = node.geometry;
        if (geometry?.index) tris += geometry.index.count / 3;
        else if (geometry?.attributes?.position) tris += geometry.attributes.position.count / 3;
      });
      return {
        body: f.model.userData?.characterAssetUrl ? 'imported'
          : f.model.userData?.sculptedBody ? 'sculpted' : 'prefab',
        meshes, tris: Math.round(tris), materials: [...materials].length
      };
    });
    // One render frame so the camera change is on screen before the shot.
    await page.waitForTimeout(400);
    const tag = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/-+$/, '');
    await page.screenshot({ path: resolve(outDir, `${tag}--${bodyVariant}.png`) });
    // Second shot with self-shadow receiving off, to tell shadow acne apart from coincident
    // geometry (both show up as stipple on a curved surface).
    await page.evaluate(() => {
      window.fighters[0].model.traverse(node => { if (node.isMesh) node.receiveShadow = false; });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(outDir, `${tag}--${bodyVariant}--noshadow.png`) });
    console.log(bodyVariant, name, JSON.stringify(info));
  }
  await page.close();
}

try {
  await shoot('sculpted');
  await shoot('imported');
} finally {
  await browser.close();
  await server.close();
}
console.log('wrote comparison shots to', outDir);
