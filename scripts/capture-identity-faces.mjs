// Face captures for Jack and Voldemort: the accepted front preset (yaw 90 showed the face in the
// earlier refine9 pass), open floor, plus head rotation to show the hat and muzzle under a turn.
// SwiftShader composition evidence only.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/identity-faces';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = [];

for (const [label, slug] of [['Captain Jack Sparrow', 'jack'], ['Lord Voldemort', 'voldemort']]) {
  const page = await browser.newPage({ viewport: { width: 620, height: 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(name => {
    window.__browserSmashSelect?.select('p1', name);
    window.__browserSmashSelect?.select('p2', 'Superman');
    window.__browserSmashSelect?.chooseArena('asgard');
  }, label);
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, 0, 0); f.velocity?.set?.(0, 0, 0);
    window.fighters[1].position.set(3.2, 0, 0);
    window.__browserSmashFreezeAI = true;
    f.mixer?.stopAllAction?.();
    const THREE = window.__browserSmashThree;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion()));
    return { fighter: f.name, model: f.model.name, forward: [+forward.x.toFixed(3), +forward.z.toFixed(3)], pos: [+f.position.x, +f.position.z] };
  });
  const shots = [];
  // SmashCamera places the camera at (sin yaw, cos yaw) * distance around the fighter and adds the
  // fighter's heading, so the yaw that puts the camera on the model's own forward axis is
  // atan2(forward.x, forward.z) - heading. Deriving it removes the guesswork that produced back
  // views labelled "front".
  for (const [name, offset] of [['front', 0], ['left', 90], ['back', 180], ['right', -90]]) {
    const pose = await page.evaluate(({ offset, turn }) => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
      const modelYaw = Math.atan2(f.model.getWorldQuaternion(new THREE.Quaternion()).y, 1);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const frontYaw = Math.atan2(forward.x, forward.z) - heading;
      const yaw = (frontYaw * 180 / Math.PI) + offset;
      let head = null;
      f.model.traverse(n => { if (!head && n.isBone && /^head$/i.test(n.name || '')) head = n; });
      if (head) head.rotation.y = turn * Math.PI / 180;
      window.smashCamera.spectate({ fighter: f, framing: 'head', yaw, pitch: 2, distance: 1.7 });
      const camera = window.smashCamera.camera;
      const away = camera.position.clone().sub(f.position).setY(0).normalize();
      return {
        yaw: +yaw.toFixed(1),
        alignment: +away.dot(forward).toFixed(3),
        forward: [+forward.x.toFixed(2), +forward.z.toFixed(2)],
        modelYawDeg: +(modelYaw * 180 / Math.PI).toFixed(1)
      };
    }, { offset, turn: 0 });
    await page.waitForTimeout(1150);
    await page.screenshot({ path: `${out}/${slug}-${name}.png` });
    shots.push({ name, ...pose });
  }
  for (const turn of [45, 90, 135]) {
    const pose = await page.evaluate(({ turn }) => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      let head = null;
      f.model.traverse(n => { if (!head && n.isBone && /^head$/i.test(n.name || '')) head = n; });
      if (head) head.rotation.y = turn * Math.PI / 180;
      window.smashCamera.spectate({ fighter: f, framing: 'head', yaw: (Math.atan2(forward.x, forward.z) - heading) * 180 / Math.PI, pitch: 2, distance: 1.7 });
      return { turn, bone: head?.name ?? null };
    }, { turn });
    await page.waitForTimeout(1150);
    await page.screenshot({ path: `${out}/${slug}-headturn-${turn}.png` });
    shots.push({ name: `headturn-${turn}`, ...pose });
  }
  report.push({ label, ...info, shots, errors: errors.slice(0, 2) });
  await page.close();
}
console.log('CAPTURES ' + JSON.stringify(report));
await browser.close();
server.close();
