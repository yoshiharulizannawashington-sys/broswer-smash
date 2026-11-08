// Close-up capture sheet for an imported fighter, taken through the real game renderer.
//
//   bash scripts/run-browser-test.sh scripts/_render-kaze.mjs artifacts/kaze/before
//
// Shoots four orthographic-ish views of the full body plus a face close-up, then a pose sheet
// that freezes each exported clip mid-move on the real skeleton. This is the only honest way to
// judge the model: it is the same loader, materials, lights and shadow setup the game uses.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/kaze/before');
const fighterName = process.argv[3] || 'Kaze';
await mkdir(outDir, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 640, height: 820 } });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => { errors.push(error.message); console.log('PAGEERROR', error.message); });
page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text()); });
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180_000, polling: 200 });

await page.evaluate(async name => {
  const select = document.querySelector('#p1Character');
  select.value = name;
  select.dispatchEvent(new Event('change'));
}, fighterName);
await page.waitForTimeout(2500);
await page.evaluate(() => {
  document.querySelector('#play').click();
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashStep(0.5);
});

// One-time scene preparation: park the fighter at the origin, strip the UI, and report what
// actually mounted so the shots can be trusted.
const info = await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const f = window.fighters[0];
  f.position.set(0, f.groundLevel ?? 0, 0);
  f.velocity?.set?.(0, 0, 0);
  window.fighters[1].position.set(6, f.groundLevel ?? 0, 6);
  for (const sel of ['#hud', '#cameraSettings', '#help', '#status', '#exploreHint', '.hud',
    '#energyHUD', '#powerHudStyles', '#topbar', '#menu', '#attract', '#combatDebug',
    '#roundScore', '#announce', '#banner', '#callout']) {
    document.querySelectorAll(sel).forEach(node => { node.style.display = 'none'; });
  }
  const camera = window.smashCamera.camera;
  window.smashCamera.update = () => {};
  camera.fov = 30;
  camera.updateProjectionMatrix();

  let mixer = null, actions = null, bodyRoot = null;
  f.model.traverse(node => {
    if (node.userData?.humanMixer) { mixer = node.userData.humanMixer; actions = node.userData.animationActions; bodyRoot = node; }
  });
  f.model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(f.model);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  let meshes = 0, tris = 0, unskinned = 0;
  const materials = new Set();
  f.model.traverse(node => {
    if (!node.isMesh) return;
    meshes++;
    if (!node.isSkinnedMesh) unskinned++;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of list) materials.add(m?.name || '?');
    const g = node.geometry;
    tris += g?.index ? g.index.count / 3 : (g?.attributes?.position?.count || 0) / 3;
  });
  // The fighter turns to face its opponent every frame, so every view has to be measured from
  // that facing. Filming a fixed world axis shot the pose sheet from behind once already.
  window.__kazeShot = { camera, box, size, center, mixer, actions, bodyRoot, THREE, fighter: f };
  return {
    body: f.model.userData?.characterAssetUrl ? 'imported' : 'procedural',
    bones: f.model.userData?.characterAssetUrl ? 'skinned' : 'overlay',
    meshes, unskinned, tris: Math.round(tris),
    materials: [...materials],
    size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
    feetY: +(box.min.y - (f.groundLevel ?? 0)).toFixed(3),
    clips: actions ? Object.keys(actions) : []
  };
});
console.log('MOUNTED', JSON.stringify(info));

async function shoot(tag, { view = 'front', zoom = 1, target = null } = {}) {
  await page.evaluate(({ view, zoom, target }) => {
    const { camera, size, center } = window.__kazeShot;
    const mid = target === 'face'
      ? { x: center.x, y: center.y + size.y * 0.42, z: center.z }
      : { x: center.x, y: size.y * 0.5, z: center.z };
    const distance = size.y * (target === 'face' ? 0.26 : 2.05) * zoom;
    const angles = { front: 0, threequarter: 0.62, side: Math.PI / 2, back: Math.PI };
    const a = angles[view] ?? 0;
    // Measure the model's own +Z axis instead of trusting the fighter's facing integers: the
    // holder is rotated by faceFighterModel every frame and that is the direction that matters.
    const forward = new window.__kazeShot.THREE.Vector3();
    window.__kazeShot.fighter.model.getWorldDirection(forward);
    const heading = Math.atan2(forward.x, forward.z);
    camera.position.set(
      mid.x + Math.sin(heading + a) * distance,
      mid.y + size.y * 0.04,
      mid.z + Math.cos(heading + a) * distance);
    camera.lookAt(mid.x, mid.y, mid.z);
    camera.near = 0.02;
    camera.updateProjectionMatrix();
  }, { view, zoom, target });
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(outDir, `${tag}.png`) });
}

// ---- silhouette views (KAZE_SHOTS=poses skips them for a fast pose-only pass)
if (process.env.KAZE_SHOTS !== 'poses') {
await shoot('01-front', { view: 'front' });
await shoot('02-threequarter', { view: 'threequarter' });
await shoot('03-side', { view: 'side' });
await shoot('04-back', { view: 'back' });
await shoot('05-face', { view: 'threequarter', target: 'face' });
await shoot('06-face-front', { view: 'front', target: 'face' });
await shoot('07-hands', { view: 'threequarter', target: 'face', zoom: 2.4 });
}

// KAZE_SHOTS=silhouette skips the pose sheet, which is what the fast iteration loop uses.
if (process.env.KAZE_SHOTS === 'silhouette') {
  console.log('ERRORS', JSON.stringify(errors));
  console.log('wrote', outDir);
  await browser.close();
  await server.close();
  process.exit(0);
}

// ---- pose sheet: freeze each clip on the real skeleton
const poses = [['idle', 0.5], ['walk', 0.26], ['run', 0.14], ['jump', 0.30],
  ['jab', 0.12], ['heavy_punch', 0.20], ['block', 0.15], ['hit_light', 0.06]];
const poseReport = await page.evaluate(poseList => {
  const { mixer, actions, camera, size, center, fighter } = window.__kazeShot;
  const out = [];
  for (const [name, time] of poseList) {
    const action = actions?.[name] || Object.entries(actions || {}).find(([k]) => k.includes(name))?.[1];
    if (!action) { out.push({ name, missing: true }); continue; }
    for (const other of Object.values(actions)) other.stop();
    action.reset();
    action.setLoop(2501 /* LoopOnce */, 1);
    action.clampWhenFinished = true;
    action.play();
    action.time = Math.min(time, action.getClip().duration);
    mixer.update(0.0001);
    out.push({ name, duration: +action.getClip().duration.toFixed(3), time: +action.time.toFixed(3) });
  }
  // Frame the whole body from the front-left for the sheet.
  const forward = new window.__kazeShot.THREE.Vector3();
  fighter.model.getWorldDirection(forward);
  const heading = Math.atan2(forward.x, forward.z);
  camera.position.set(
    center.x + Math.sin(heading + 0.16) * size.y * 2.00,
    size.y * 0.58,
    center.z + Math.cos(heading + 0.16) * size.y * 2.00);
  camera.lookAt(center.x, size.y * 0.50, center.z);
  camera.updateProjectionMatrix();
  return out;
}, poses);
console.log('POSES', JSON.stringify(poseReport));

for (let i = 0; i < poses.length; i++) {
  const [name] = poses[i];
  // Software WebGL renders this scene at a few frames a second, so a screenshot taken 300 ms after
  // posing still shows the frame before it. Freeze the mixer at the requested time, then give the
  // renderer a full second and a half to draw it.
  const captured = await page.evaluate(({ name, time }) => {
    const { mixer, actions } = window.__kazeShot;
    const action = actions?.[name] || Object.entries(actions || {}).find(([k]) => k.includes(name))?.[1];
    if (!action) return null;
    for (const other of Object.values(actions)) other.stop();
    mixer.timeScale = 1;
    action.reset();
    action.setLoop(2501 /* LoopOnce */, 1);
    action.clampWhenFinished = true;
    action.play();
    return { duration: +action.getClip().duration.toFixed(3) };
  }, { name, time: poses[i][1] });
  await page.waitForTimeout(1200);
  const at = await page.evaluate(({ name, time }) => {
    const { mixer, actions } = window.__kazeShot;
    const action = actions?.[name] || Object.entries(actions || {}).find(([k]) => k.includes(name))?.[1];
    if (!action) return null;
    mixer.timeScale = 0;
    action.time = Math.min(time, action.getClip().duration);
    mixer.update(0);
    return +action.time.toFixed(3);
  }, { name, time: poses[i][1] });
  await page.waitForTimeout(1600);
  console.log('pose', name, 'frozen at', at, 'of', captured?.duration);
  await page.screenshot({ path: resolve(outDir, `pose-${String(i + 1).padStart(2, '0')}-${name}.png`) });
}

console.log('ERRORS', JSON.stringify(errors));
console.log('wrote', outDir);
await browser.close();
await server.close();
