// Complete identity capture for the launch roster, through the real character-select preview.
//
//   bash scripts/run-browser-test.sh scripts/capture-roster-identity.mjs [--from=N] [--count=N]
//
// Five views per fighter - full-body front / three-quarter / side and head front / head
// three-quarter - from the shipped GLB, on one light rig, one canvas size and one camera setup, so
// two fighters can be compared. The head views move the preview's own camera, so they show the
// geometry the game loads rather than a re-render in a second viewer.
//
// Speed matters here: 34 fighters x 5 shots is 170 frames, and Playwright's element screenshot
// waits for fonts and layout stability on every call (~8 s each under SwiftShader, six fighters in
// four minutes). This uses raw CDP screenshots clipped to the canvas and runs three preview pages in
// parallel, one shard each, which brings the whole roster under a minute.
//
// Writes artifacts/roster-identity/<slug>/{front,quarter,side,head-front,head-quarter}.png plus
// rows.jsonl / measurements.json (triangles, materials, height, head bone), the evidence the identity
// audit and the final report read.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/roster-identity');
await mkdir(outDir, { recursive: true });

const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;   // strip '--' and '='
};
const FROM = Number(flag('from') ?? 0) || 0;
const COUNT = Number(flag('count') ?? 999) || 999;
const ONLY = flag('only')?.split(',').map(s => s.trim()).filter(Boolean) || null;
const SHARDS = Math.max(1, Math.min(4, Number(flag('shards') ?? 2) || 2));

const W = 420, H = 560;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    // The content type is not optional: a module script served as octet-stream is blocked, and the
    // page then boots without ever defining the preview handle this harness waits for.
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const VIEWS = [['front', 0], ['quarter', 0.72], ['side', 1.35]];

const errors = [];
const rows = [];
let browser;

/** One preview page, one shard of the roster, CDP screenshots clipped to the canvas. */
async function runShard(names, shard) {
  const page = await browser.newPage({ viewport: { width: 520, height: 640 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120_000 });

  // Strip to the preview surface at its final size before the first model loads: show() frames
  // against the canvas it can see, so the size cannot change afterwards. The sheet's own CSS rules
  // set the preview height, and an inline height alone loses to them - the first capture attempt
  // produced 174 px tall canvases with the body cropped, so every size here is important and then
  // asserted.
  await page.evaluate(({ w, h }) => {
    const panel = document.querySelector('#selectScreen [data-role="preview"]');
    const canvasEl = panel.querySelector('canvas');
    for (const el of document.querySelectorAll('#selectScreen *')) {
      if (el === canvasEl || el.contains(canvasEl)) continue;
      el.style.setProperty('display', 'none', 'important');
    }
    const screen = document.querySelector('#selectScreen');
    if (screen) screen.style.setProperty('background', 'transparent', 'important');
    const force = (el, property, value) => el.style.setProperty(property, value, 'important');
    force(panel, 'height', h + 'px'); force(panel, 'min-height', h + 'px');
    force(panel, 'width', w + 'px'); force(panel, 'max-width', 'none');
    force(panel, 'border', 'none'); force(panel, 'background', 'transparent'); force(panel, 'box-shadow', 'none');
    force(panel, 'position', 'static'); force(panel, 'padding', '0');
    force(canvasEl, 'width', w + 'px'); force(canvasEl, 'height', h + 'px');
    force(canvasEl, 'display', 'block'); force(canvasEl, 'background', 'transparent');
  }, { w: W, h: H });
  await page.waitForTimeout(350);

  const size = await page.evaluate(() => {
    const c = document.querySelector('#selectScreen [data-role="preview"] canvas');
    const r = c.getBoundingClientRect();
    return { cw: c.clientWidth, ch: c.clientHeight, rw: Math.round(r.width), rh: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
  });
  if (Math.abs(size.rw - W) > 3 || Math.abs(size.rh - H) > 3) {
    throw new Error('preview canvas is not the capture size: ' + JSON.stringify(size));
  }
  console.log(`[${shard}] canvas ${size.rw}x${size.rh} at ${size.x},${size.y}`);

  const box = await page.locator('#selectScreen [data-role="preview"] canvas').boundingBox();
  if (!box) throw new Error('preview canvas has no layout box');
  const cdp = await page.context().newCDPSession(page);
  const shoot = async path => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1.25 }
    });
    await writeFile(path, Buffer.from(data, 'base64'));
  };

  for (const name of names) {
    const slug = slugOf(name);
    const dir = resolve(outDir, slug);
    if (existsSync(resolve(dir, 'head-quarter.png'))) { rows.push({ slug, state: 'cached' }); continue; }
    await mkdir(dir, { recursive: true });

    await page.evaluate(async identity => {
      window.__browserSmashPreview.setYaw(0);
      await window.__browserSmashPreview.show(identity, identity);
    }, slug);
    await page.waitForTimeout(170);
    const state = await page.evaluate(() =>
      document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || 'missing');

    for (const [label, yaw] of VIEWS) {
      await page.evaluate(angle => window.__browserSmashPreview.setYaw(angle), yaw);
      await page.waitForTimeout(70);
      await shoot(resolve(dir, `${label}.png`));
    }

    // Head close-up: aim the preview's own camera at the head joint, then return it to the
    // full-body framing so the next fighter does not inherit a camera parked at head height.
    const facts = await page.evaluate(() => {
      const debug = window.__fighterPreviewDebug;
      if (!debug?.root || !debug?.camera) return { error: 'no preview debug handle' };
      const root = debug.root;
      root.updateMatrixWorld(true);
      const head = root.getObjectByName('head') || root.getObjectByName('Head') ||
        root.getObjectByName('mixamorigHead');
      const box = { min: debug.boxMin, max: debug.boxMax };
      const height = box.max[1] - box.min[1];
      let world = null;
      if (head) {
        const v = debug.camera.position.clone();
        head.getWorldPosition(v);
        world = v.toArray();
      }
      const target = world || [0, box.max[1] - Math.max(0.06, height * 0.09), 0];
      const span = Math.max(0.34, height * 0.30);
      const fov = debug.camera.fov * Math.PI / 180;
      const distance = (span * 0.5) / Math.tan(fov / 2);
      const camera = debug.camera;
      camera.position.set(target[0], target[1], target[2] + distance);
      camera.near = Math.max(0.01, distance * 0.05);
      camera.far = distance * 20;
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateProjectionMatrix();
      root.rotation.y = 0;
      const stats = { meshes: 0, triangles: 0, materials: [], headBone: head?.name || null, height: +height.toFixed(3) };
      const seen = new Set();
      root.traverse(node => {
        if (!node.isMesh) return;
        stats.meshes++;
        const geo = node.geometry;
        stats.triangles += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of list) {
          if (!material || seen.has(material.uuid)) continue;
          seen.add(material.uuid);
          stats.materials.push({ name: material.name || '', color: material.color ? '#' + material.color.getHexString() : null });
        }
      });
      stats.triangles = Math.round(stats.triangles);
      return stats;
    });
    await page.waitForTimeout(100);
    await shoot(resolve(dir, 'head-front.png'));
    await page.evaluate(() => { window.__fighterPreviewDebug.root.rotation.y = 0.72; });
    await page.waitForTimeout(90);
    await shoot(resolve(dir, 'head-quarter.png'));

    await page.evaluate(() => {
      const debug = window.__fighterPreviewDebug;
      const box = { min: debug.boxMin, max: debug.boxMax };
      const height = box.max[1] - box.min[1];
      const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
      const fov = debug.camera.fov * Math.PI / 180;
      const distance = ((height * 0.5) / Math.tan(fov / 2)) * 1.04;
      debug.camera.position.set(center[0], center[1] + height * 0.02, center[2] + distance);
      debug.camera.near = Math.max(0.02, distance * 0.04);
      debug.camera.far = distance * 8;
      debug.camera.lookAt(center[0], center[1], center[2]);
      debug.camera.updateProjectionMatrix();
    });

    const row = { name, slug, state, ...facts };
    rows.push(row);
    // Incremental so a batch that hits the command timeout still leaves measured rows behind.
    await appendFile(resolve(outDir, `rows-${shard}.jsonl`), JSON.stringify(row) + '\n');
    process.stdout.write(`\r[${shard}] ${slug} ${state}        `);
  }
  await page.close();
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page0 = await browser.newPage();
  await page0.goto(origin + '/index.html', { waitUntil: 'load' });
  await page0.waitForFunction(() => Boolean(window.characterRosters), null, { timeout: 120_000 });
  const allNames = await page0.evaluate(() => window.characterRosters.launch.map(([name]) => name));
  await page0.close();

  const selected = allNames.slice(FROM, FROM + COUNT).filter(name => !ONLY || ONLY.includes(slugOf(name)));
  const shards = Array.from({ length: SHARDS }, () => []);
  selected.forEach((name, index) => shards[index % SHARDS].push(name));
  await Promise.all(shards.map((names, index) => (names.length ? runShard(names, index) : null)));
  process.stdout.write('\n');

  const measured = rows.filter(row => row.triangles);
  await writeFile(resolve(outDir, 'measurements.json'), JSON.stringify({
    captured: rows.length, views: 5, perFighterViews: rows.length * 5,
    rows, pageErrors: [...new Set(errors)].slice(0, 10)
  }, null, 2));

  const missing = rows.filter(row => row.state !== 'ready' && row.state !== 'cached');
  console.log(JSON.stringify({
    captured: rows.length,
    images: rows.filter(row => row.state !== 'cached').length * 5,
    notReady: missing.map(row => `${row.slug}:${row.state}`).slice(0, 10),
    triangleRange: measured.length ? [Math.min(...measured.map(r => r.triangles)), Math.max(...measured.map(r => r.triangles))] : null,
    headBones: measured.filter(r => r.headBone).length,
    pageErrors: [...new Set(errors)].slice(0, 6)
  }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
