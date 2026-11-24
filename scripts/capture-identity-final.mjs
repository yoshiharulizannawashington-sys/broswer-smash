// Final identity captures: the views the acceptance criteria ask for, from a camera placed on the
// model's own forward axis, plus Jack's hat clearance sampled while a real attack animation runs.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/identity-final';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
  });
  await page.locator('canvas').first().click({ position: { x: 300, y: 200 }, force: true });

  const views = slug === 'jack'
    ? [['close-front', 0, 'head', 1.35], ['close-three-quarter', 45, 'head', 1.35], ['close-profile', 90, 'head', 1.35], ['rear-three-quarter', 135, 'head', 1.6], ['gameplay', 0, 'full', 11]]
    : [['close-front', 0, 'head', 1.3], ['close-three-quarter', 45, 'head', 1.3], ['close-profile', 90, 'head', 1.3], ['gameplay', 0, 'full', 11]];
  const shots = [];
  for (const [name, offset, framing, distance] of views) {
    const pose = await page.evaluate(({ offset, framing, distance }) => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      const heading = Math.atan2(f.facingZ || 0, f.facing || 1);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(f.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const yaw = (Math.atan2(forward.x, forward.z) - heading) * 180 / Math.PI + offset;
      window.smashCamera.spectate({ fighter: f, framing, yaw, pitch: framing === 'head' ? 2 : 10, distance });
      const camera = window.smashCamera.camera;
      const away = camera.position.clone().sub(f.position).setY(0).normalize();
      return { yaw: +yaw.toFixed(1), alignment: +away.dot(forward).toFixed(3), cameraY: +camera.position.y.toFixed(2) };
    }, { offset, framing, distance });
    await page.waitForTimeout(1200);
    const file = `${out}/${slug}-${name}.png`;
    await page.screenshot({ path: file });
    shots.push({ name, ...pose, file });
  }

  // Jack's hat against the shoulders while the game's own animation drives the head: the attack is
  // triggered by key and the pose is never touched by the probe, so the clearance measured is the
  // one the rig actually produces.
  let clearance = null;
  if (slug === 'jack') {
    clearance = await page.evaluate(async () => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      const skinned = [];
      f.model.traverse(n => { if (n.isSkinnedMesh) skinned.push(n); });
      const byMaterial = matcher => {
        const found = [];
        for (const mesh of skinned) {
          const geo = mesh.geometry, index = geo.index;
          const groups = geo.groups?.length ? geo.groups : [{ start: 0, count: index ? index.count : geo.attributes.position.count, materialIndex: 0 }];
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const g of groups) {
            if (!matcher.test(mats[g.materialIndex]?.name || '')) continue;
            if (index) for (let i = g.start; i < g.start + g.count; i += 1) found.push({ mesh, index: index.getX(i) });
            else for (let i = g.start; i < g.start + g.count; i += 1) found.push({ mesh, index: i });
          }
        }
        return found;
      };
      const hat = byMaterial(/hat/i).filter((_, k) => k % 7 === 0);
      const torso = byMaterial(/^fighter-skin(-shade)?$/i).filter(({ mesh, index }) => {
        const y = mesh.geometry.attributes.position.getY(index);
        return y > 1.15 && y < 1.5;
      }).filter((_, k) => k % 5 === 0);
      const world = ({ mesh, index }) => {
        const v = new THREE.Vector3();
        if (mesh.applyBoneTransform) mesh.applyBoneTransform(index, v);
        else v.fromBufferAttribute(mesh.geometry.attributes.position, index);
        return v.applyMatrix4(mesh.matrixWorld);
      };
      let head = null;
      f.model.traverse(n => { if (!head && n.isBone && /^head$/i.test(n.name || '')) head = n; });
      const restQuat = head.quaternion.clone();
      let worst = { clearance: Infinity, yawDeg: 0, frame: 0 };
      let maxYaw = 0;
      const samples = [];
      for (let frame = 0; frame < 90; frame++) {
        if (frame === 0) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
        if (frame === 20) document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', bubbles: true }));
        await new Promise(r => requestAnimationFrame(r));
        f.model.updateMatrixWorld(true);
        for (const mesh of skinned) mesh.skeleton.update();
        const delta = head.quaternion.clone().multiply(restQuat.clone().invert());
        const yawDeg = Math.abs(2 * Math.atan2(delta.y, delta.w) * 180 / Math.PI);
        maxYaw = Math.max(maxYaw, yawDeg);
        if (frame % 6 !== 0) continue;
        const torsoWorld = torso.map(world);
        let min = Infinity;
        for (const entry of hat) {
          const v = world(entry);
          for (const t of torsoWorld) { const d = v.distanceTo(t); if (d < min) min = d; }
        }
        samples.push({ frame, yawDeg: +yawDeg.toFixed(1), minDistance: +min.toFixed(4) });
        if (min < worst.clearance) worst = { clearance: +min.toFixed(4), yawDeg: +yawDeg.toFixed(1), frame };
      }
      return { maxHeadYawDeg: +maxYaw.toFixed(1), worst, samples: samples.length, sampleDetail: samples };
    });
  }
  report.push({ label, shots, clearance, errors });
  await page.close();
}
await writeFile(`${out}/identity-final.json`, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
for (const item of report) {
  console.log('IDENTITY', item.label, JSON.stringify({ shots: item.shots.map(s => ({ name: s.name, yaw: s.yaw, alignment: s.alignment })), errors: item.errors }));
  if (item.clearance) console.log('JACK_CLEARANCE', JSON.stringify({ maxHeadYawDeg: item.clearance.maxHeadYawDeg, worst: item.clearance.worst }));
}
await browser.close();
server.close();
