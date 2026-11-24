// Voldemort's fourth-pass views: three portraits, two gameplay distances, one live animation frame.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/voldemort-pass4';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
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
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('asgard');
  window.__browserSmashSelect?.select('p1', 'Lord Voldemort');
  window.__browserSmashSelect?.select('p2', 'Superman');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3500);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); a.velocity?.set?.(0, 0, 0);
  b.position.set(3.6, 0, 0); b.velocity?.set?.(0, 0, 0);
  const THREE = window.__browserSmashThree;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
});
await page.locator('canvas').first().click({ position: { x: 330, y: 240 }, force: true });
const shots = [];
for (const [name, offset, framing, distance, pitch] of [
  ['portrait-front', 0, 'head', 1.25, 2],
  ['portrait-three-quarter', 45, 'head', 1.25, 2],
  ['portrait-profile', 90, 'head', 1.25, 2],
  ['gameplay-front', 0, 'full', 12, 10],
  ['gameplay-three-quarter', 45, 'full', 12, 10]
]) {
  await page.evaluate(({ offset, framing, distance, pitch }) => {
    window.smashCamera.spectate({ fighter: window.fighters[0], framing, yaw: window.__frontYaw + offset, pitch, distance });
  }, { offset, framing, distance, pitch });
  await page.waitForTimeout(900);
  const file = `${out}/voldemort-${name}.png`;
  await page.screenshot({ path: file });
  shots.push(name);
}
// One live animation frame: a real attack, framed on the head so the muzzle is visible in motion.
await page.evaluate(() => window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'head', yaw: window.__frontYaw + 35, pitch: 3, distance: 2.0 }));
await page.keyboard.press('j');
for (let i = 0; i < 4; i++) await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
await page.screenshot({ path: `${out}/voldemort-animation.png` });
shots.push('animation');
await writeFile(`${out}/voldemort-pass4.json`, JSON.stringify({ generatedAt: new Date().toISOString(), shots, errors }, null, 2));
console.log('SHOTS', JSON.stringify(shots), 'ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
