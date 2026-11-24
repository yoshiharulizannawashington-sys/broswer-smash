// Phase 22.1 evidence: front / quarter / side / REAR / head front / head quarter / equipment
// close-up, plus the actual character-select frame, from the shipped GLB in the real preview.
//   bash scripts/run-browser-test.sh scripts/capture-phase22-evidence.mjs --slugs=thor,goku,mario
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const outDir = resolve(root, 'artifacts/roster-phase22-1');
const argv = process.argv.slice(2);
const flag = n => {
  const hit = argv.find(a => a.startsWith('--' + n + '='));
  return hit ? hit.slice(n.length + 3) : null;
};
const slugs = (flag('slugs') || '').split(',').map(s => s.trim()).filter(Boolean);
const W = 420, H = 560;
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.glb':'model/gltf-binary','.png':'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel)] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 520, height: 640 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
await page.goto(origin + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120000 });
const cdp = await page.context().newCDPSession(page);
const shoot = async (path, clip) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { ...clip, scale: 1.25 } });
  await writeFile(path, Buffer.from(data, 'base64'));
};
const results = [];
for (const slug of slugs) {
  const dir = resolve(outDir, slug);
  await mkdir(dir, { recursive: true });
  // 1. the real character-select screen, before the harness strips it to a capture surface.
  await page.evaluate(async s => { window.__browserSmashPreview.setYaw(0); await window.__browserSmashPreview.show(s, s); }, slug);
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(dir, 'select-preview.png') });
  // 2. strip to the preview canvas at its final size (same contract as the identity harness).
  await page.evaluate(({ w, h }) => {
    const panel = document.querySelector('#selectScreen [data-role="preview"]');
    const canvasEl = panel.querySelector('canvas');
    for (const el of document.querySelectorAll('#selectScreen *')) {
      if (el === canvasEl || el.contains(canvasEl)) continue;
      el.style.setProperty('display', 'none', 'important');
    }
    const screen = document.querySelector('#selectScreen');
    if (screen) screen.style.setProperty('background', 'transparent', 'important');
    const force = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    for (const [prop, val] of [['height', h + 'px'], ['min-height', h + 'px'], ['width', w + 'px'], ['max-width', 'none'], ['border', 'none'], ['background', 'transparent'], ['box-shadow', 'none'], ['position', 'static'], ['padding', '0']]) force(panel, prop, val);
    for (const [prop, val] of [['width', w + 'px'], ['height', h + 'px'], ['display', 'block'], ['background', 'transparent']]) force(canvasEl, prop, val);
  }, { w: W, h: H });
  await page.waitForTimeout(300);
  const box = await page.locator('#selectScreen [data-role="preview"] canvas').boundingBox();
  const state = await page.evaluate(() => document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || 'missing');
  for (const [label, yaw] of [['front', 0], ['quarter', 0.72], ['side', 1.35], ['rear', Math.PI]]) {
    await page.evaluate(a => window.__browserSmashPreview.setYaw(a), yaw);
    await page.waitForTimeout(80);
    await shoot(resolve(dir, label + '.png'), box);
  }
  // 3. head close-ups from the preview's own camera.
  const facts = await page.evaluate(() => {
    const d = window.__fighterPreviewDebug;
    const rootEl = d.root; rootEl.updateMatrixWorld(true);
    const head = rootEl.getObjectByName('head') || rootEl.getObjectByName('Head');
    const height = d.boxMax[1] - d.boxMin[1];
    const v = d.camera.position.clone();
    if (head) head.getWorldPosition(v); else v.set(0, d.boxMax[1] - height * 0.09, 0);
    const target = v.toArray();
    const fov = d.camera.fov * Math.PI / 180;
    const span = Math.max(0.34, height * 0.30);
    const distance = (span * 0.5) / Math.tan(fov / 2);
    d.camera.position.set(target[0], target[1], target[2] + distance);
    d.camera.near = Math.max(0.01, distance * 0.05); d.camera.far = distance * 20;
    d.camera.lookAt(target[0], target[1], target[2]); d.camera.updateProjectionMatrix();
    rootEl.rotation.y = 0;
    return { headBone: head?.name || null, height: +height.toFixed(3) };
  });
  await page.waitForTimeout(90);
  await shoot(resolve(dir, 'head-front.png'), box);
  await page.evaluate(() => { window.__fighterPreviewDebug.root.rotation.y = 0.72; });
  await page.waitForTimeout(80);
  await shoot(resolve(dir, 'head-quarter.png'), box);
  // 4. equipment close-up: chest-to-hand band, where the props actually are.
  await page.evaluate(() => {
    const d = window.__fighterPreviewDebug;
    d.root.rotation.y = 0.5;
    const cx = (d.boxMin[0] + d.boxMax[0]) / 2;
    const height = d.boxMax[1] - d.boxMin[1];
    const target = [cx, d.boxMin[1] + height * 0.52, 0];
    const fov = d.camera.fov * Math.PI / 180;
    const distance = (Math.max(0.55, height * 0.42) * 0.5) / Math.tan(fov / 2);
    d.camera.position.set(target[0], target[1], target[2] + distance);
    d.camera.near = Math.max(0.01, distance * 0.05); d.camera.far = distance * 20;
    d.camera.lookAt(target[0], target[1], target[2]); d.camera.updateProjectionMatrix();
  });
  await page.waitForTimeout(80);
  await shoot(resolve(dir, 'equipment.png'), box);
  results.push({ slug, state, ...facts });
  console.log('captured', slug, state, facts.headBone);
  // restore the full-body framing for the next fighter.
  await page.evaluate(() => {
    const d = window.__fighterPreviewDebug;
    const height = d.boxMax[1] - d.boxMin[1];
    const c = [(d.boxMin[0] + d.boxMax[0]) / 2, (d.boxMin[1] + d.boxMax[1]) / 2, (d.boxMin[2] + d.boxMax[2]) / 2];
    const fov = d.camera.fov * Math.PI / 180;
    const distance = ((height * 0.5) / Math.tan(fov / 2)) * 1.04;
    d.camera.position.set(c[0], c[1] + height * 0.02, c[2] + distance);
    d.camera.lookAt(c[0], c[1], c[2]); d.camera.updateProjectionMatrix();
    d.root.rotation.y = 0;
  });
}
await writeFile(resolve(outDir, 'capture-report.json'), JSON.stringify({ captured: results.length, results, pageErrors: [...new Set(errors)] }, null, 2));
console.log(JSON.stringify({ captured: results.length, pageErrors: [...new Set(errors)].slice(0, 5) }));
await browser.close(); server.close();
