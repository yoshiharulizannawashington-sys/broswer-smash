// Jack's tricorn during real animated head turns, plus Voldemort's face views.
//
// The head is never posed by the probe: keys are pressed and the game's own animation drives the
// neck. Each frame records the measured head yaw relative to rest, so the capture that shows the
// largest turn can be identified rather than assumed.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/identity-animated';
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
const report = [];

for (const [label, slug] of [['Captain Jack Sparrow', 'jack'], ['Lord Voldemort', 'voldemort']]) {
  const page = await browser.newPage({ viewport: { width: 640, height: 760 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(name => {
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', name);
    window.__browserSmashSelect?.select('p2', 'Superman');
    document.querySelector('#play').click();
  }, label);
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const a = window.fighters[0], b = window.fighters[1];
    a.position.set(0, 0, 0); a.velocity?.set?.(0, 0, 0);
    b.position.set(3.2, 0, 0);
    const THREE = window.__browserSmashThree;
    const heading = Math.atan2(a.facingZ || 0, a.facing || 1);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    window.__frontYaw = (Math.atan2(forward.x, forward.z) - heading) * 180 / Math.PI;
    window.smashCamera.spectate({ fighter: a, framing: 'head', yaw: window.__frontYaw + 35, pitch: 2, distance: 1.5 });
  });
  await page.locator('canvas').first().click({ position: { x: 300, y: 200 }, force: true });

  const measure = () => page.evaluate(() => {
    const f = window.fighters[0];
    let head = null;
    f.model.traverse(n => { if (!head && n.isBone && /^head$/i.test(n.name || '')) head = n; });
    const u = f.model.userData;
    const rest = u.headRestQuaternion || (u.headRestQuaternion = head ? head.quaternion.clone() : null);
    let yaw = 0;
    if (head && rest) {
      const d = head.quaternion.clone().multiply(rest.clone().invert());
      yaw = Math.abs(2 * Math.atan2(d.y, d.w) * 180 / Math.PI);
    }
    return { yaw: +yaw.toFixed(1), special: +(f.specialCooldown || 0).toFixed(2), queue: f.attackQueue.length };
  });

  const frames = [];
  // Real input: attack, then signature six frames later, sampled across the whole window.
  for (let i = 0; i < 9; i++) {
    if (i === 0) await page.keyboard.press('j');
    if (i === 3) await page.keyboard.press('k');
    for (let step = 0; step < 4; step++) await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    const state = await measure();
    const file = `${out}/${slug}-turn-${i}.png`;
    await page.screenshot({ path: file });
    frames.push({ i, file, ...state });
  }
  const worst = frames.reduce((a, b) => (b.yaw > a.yaw ? b : a), frames[0]);

  // Voldemort also gets the static face views the acceptance list asks for.
  const views = [];
  if (slug === 'voldemort') {
    for (const [name, offset, framing, distance] of [['close-front', 0, 'head', 1.3], ['close-three-quarter', 45, 'head', 1.3], ['close-profile', 90, 'head', 1.3], ['gameplay', 0, 'full', 11]]) {
      await page.evaluate(({ offset, framing, distance }) => {
        window.smashCamera.spectate({ fighter: window.fighters[0], framing, yaw: window.__frontYaw + offset, pitch: framing === 'head' ? 2 : 10, distance });
      }, { offset, framing, distance });
      await page.waitForTimeout(1100);
      const file = `${out}/voldemort-${name}.png`;
      await page.screenshot({ path: file });
      views.push({ name, file });
    }
  }
  report.push({ label, frames, maxTurn: worst, views, errors });
  await page.close();
}
await writeFile(`${out}/animated-headturn.json`, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
for (const item of report) {
  console.log('ANIMATED', item.label, JSON.stringify({ yaws: item.frames.map(f => f.yaw), max: item.maxTurn, views: item.views.map(v => v.name), errors: item.errors }));
}
await browser.close();
server.close();
