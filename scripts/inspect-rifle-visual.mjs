// Where is Infantry's rifle, exactly? Hides the opponent, pulls the camera in and paints the
// equipped prop unlit red so its geometry, orientation and placement are unambiguous.
//   bash scripts/run-browser-test.sh scripts/inspect-rifle-visual.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-rifle-visual';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch (error) { console.log('SERVE_FAIL', req.url, error.message); if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
page.on('pageerror', e => console.log('PAGEERROR', String(e.message || e).slice(0, 200)));

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 90000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.equippedWeaponRight, null, { timeout: 90000, polling: 250 });
  await page.waitForTimeout(1200);

  const geometry = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0], u = f.model.userData, w = u.equippedWeaponRight;
    const hand = u.rightHand || u.rightFore || u.rightArm;
    const handPos = new THREE.Vector3(); hand.getWorldPosition(handPos);
    const q = new THREE.Quaternion(); w.getWorldQuaternion(q);
    const parts = [];
    w.traverse(n => {
      if (!n.isMesh) return;
      const box = new THREE.Box3().setFromObject(n);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      parts.push({
        name: n.name, material: n.material?.name || null, visible: n.visible,
        opacity: n.material?.opacity ?? null, transparent: n.material?.transparent ?? null,
        localPos: n.position.toArray().map(v => +v.toFixed(3)),
        worldCentre: centre.toArray().map(v => +v.toFixed(3)),
        size: size.toArray().map(v => +v.toFixed(3))
      });
    });
    // Project the prop's box corners to screen space so we know whether it is even on camera.
    const cam = window.smashCamera?.camera || window.__browserSmashScene?.userData?.camera || null;
    let screen = null;
    if (cam) {
      const box = new THREE.Box3().setFromObject(w);
      const pts = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new THREE.Vector3(x, y, z));
      const proj = pts.map(p => { const v = p.clone().project(cam); return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)]; });
      screen = { minX: Math.min(...proj.map(p => p[0])), maxX: Math.max(...proj.map(p => p[0])), minY: Math.min(...proj.map(p => p[1])), maxY: Math.max(...proj.map(p => p[1])) };
    }
    return {
      weaponScale: w.scale.toArray().map(v => +v.toFixed(3)),
      weaponRotXYZ: [w.rotation.x, w.rotation.y, w.rotation.z].map(v => +v.toFixed(3)),
      worldQuat: q.toArray().map(v => +v.toFixed(3)),
      handPos: handPos.toArray().map(v => +v.toFixed(3)),
      parts, screen, cameraFound: Boolean(cam)
    };
  });
  console.log('GEOMETRY ' + JSON.stringify(geometry));

  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.model.visible = false;
    window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', yaw: 90, pitch: 4 });
    window.__browserSmashSetPaused?.(false);
  });
  await page.waitForTimeout(1500);

  const shoot = async name => {
    const box = await page.evaluate(() => {
      const THREE = window.__browserSmashThree;
      const cam = window.smashCamera?.camera;
      const w = window.fighters[0].model.userData.equippedWeaponRight;
      if (!cam || !w) return null;
      const b = new THREE.Box3().setFromObject(w);
      const pts = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
      const proj = pts.map(p => { const v = p.clone().project(cam); return [Math.round((v.x * .5 + .5) * innerWidth), Math.round((-v.y * .5 + .5) * innerHeight)]; });
      return { minX: Math.min(...proj.map(p => p[0])), maxX: Math.max(...proj.map(p => p[0])), minY: Math.min(...proj.map(p => p[1])), maxY: Math.max(...proj.map(p => p[1])) };
    }).catch(() => null);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log('SHOT ' + name + ' screen=' + JSON.stringify(box));
  };
  await shoot('01-side');
  for (const yaw of [0, 45, 135, 180]) {
    await page.evaluate(yaw => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw, pitch: 6 }), yaw);
    await page.waitForTimeout(900);
    await shoot(`02-yaw-${yaw}`);
  }

  // Paint the prop unlit red and repeat, so a dark/transparent material cannot hide it.
  await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const w = window.fighters[0].model.userData.equippedWeaponRight;
    const red = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    w.traverse(n => { if (n.isMesh) { n.userData.__origMaterial = n.material; n.material = red; } });
    window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 90, pitch: 4 });
  });
  await page.waitForTimeout(900);
  await shoot('03-highlighted-side');
  await page.evaluate(() => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 0, pitch: 6 }));
  await page.waitForTimeout(900);
  await shoot('04-highlighted-front');

  // And at the Rifle Butt contact frame, from the side.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.model.visible = true;
    p1.position.set(0, 0, 0); p2.position.set(1.2, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0); p1.facing = 1; p2.facing = -1;
    p1.attackQueue.length = 0; p1.hitboxes.length = 0; p2.percent = 0;
    window.smashCamera?.spectate?.({ fighter: p1, framing: 'full', yaw: 90, pitch: 6 });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__browserSmashSetPaused?.(false));
  await page.keyboard.down('j');
  await page.evaluate(() => window.__browserSmashStep(0.09));
  await page.keyboard.up('j');
  await page.evaluate(() => window.__browserSmashSetPaused?.(true));
  await page.waitForTimeout(400);
  await shoot('05-rifle-butt-contact-side');
} catch (error) {
  console.log('FATAL', String(error?.message || error).slice(0, 400));
} finally {
  await browser.close().catch(() => {});
  server.close();
}
