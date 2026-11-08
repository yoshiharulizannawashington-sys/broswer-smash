// Visual audit harness: renders the live game from a close camera so character quality can be
// judged from screenshots (and viewed with an image tool), not from code alone.
//
//   bash scripts/run-browser-test.sh scripts/_audit-visual.mjs [outDir]
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/audit');
await mkdir(outDir, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
const step = s => page.evaluate(v => window.__browserSmashStep(v), s);

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180000, polling: 200 });

const assetReport = await page.evaluate(() => {
  const a = window.__browserSmashAssets || {};
  return {
    characters: a.characters && { status: a.characters.status, count: a.characters.count, meshCount: a.characters.meshCount },
    weapons: a.weapons && { status: a.weapons.status, count: a.weapons.count },
    lastCharacter: a.lastCharacter,
    animations: a.animations
  };
});
console.log('ASSETS', JSON.stringify(assetReport, null, 1));

async function shoot(fighterName, tag) {
  await page.click(`#selectScreen .bs-card[data-fighter="${fighterName}"]`);
  await page.click('#selectScreen .bs-card[data-fighter="Hulk (Bruce Banner)"]');
  await page.click('#selectScreen [data-nav="next"]');
  await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
  await page.evaluate(() => document.querySelector('#play').click());
  await step(0.4);
  // Wait for the imported prefab (not the procedural body) so the shot shows what ships.
  await page.waitForFunction(() => { const m = window.fighters?.[0]?.model; return Boolean(m?.userData?.sculptedBody) || Boolean(m?.userData?.characterAssetUrl) || m?.userData?.rigKind === 'prefab'; }, null, { timeout: 60000, polling: 100 }).catch(() => console.log('no upgraded body for', fighterName));
  // Freeze the gameplay camera and frame the fighter from the front, slightly above chest height.
  const info = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0];
    f.position.set(0, f.groundLevel ?? 0, 0);
    const camera = window.smashCamera.camera;
    const model = f.model;
    // Frame from the model's real bounds instead of guessing a distance.
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const worldPos = model.getWorldPosition(new THREE.Vector3());
    // The pinned audit frame only works while the gameplay camera is stubbed. Keep the real
    // update so the frames that need the game's own cinematic camera can run it again.
    window.__auditRealUpdate = window.smashCamera.update;
    window.smashCamera.update = () => {};
    const distance = Math.max(1.2, size.y * 1.55);
    camera.near = 0.05;
    camera.position.set(center.x + distance * 0.32, center.y + size.y * 0.08, center.z + distance);
    camera.lookAt(center);
    camera.fov = 30;
    camera.updateProjectionMatrix();
    window.__auditFrame = { size: size.toArray().map(n => +n.toFixed(2)), center: center.toArray().map(n => +n.toFixed(2)), worldPos: worldPos.toArray().map(n => +n.toFixed(2)), camera: camera.position.toArray().map(n => +n.toFixed(2)) };
    // Hide the UI so the shot is only the character.
    for (const sel of ['#hud', '#cameraSettings', '#help', '#status', '#exploreHint', '.hud', '#energyHUD']) {
      document.querySelectorAll(sel).forEach(node => { node.style.display = 'none'; });
    }
    document.querySelectorAll('body > div').forEach(node => {
      if (node !== document.querySelector('#game') && !node.querySelector?.('canvas') && !node.id?.includes('app')) {
        if (node.style && !node.querySelector('canvas')) node.style.visibility = 'hidden';
      }
    });
    let meshes = 0, materials = new Set(), tris = 0;
    f.model.traverse(n => {
      if (!n.isMesh) return;
      meshes++;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) materials.add(m?.name || m?.uuid);
      const geo = n.geometry;
      if (geo?.index) tris += geo.index.count / 3;
      else if (geo?.attributes?.position) tris += geo.attributes.position.count / 3;
    });
    return { identity: f.identity, rigKind: f.model.userData.rigKind, sculpted: f.model.userData.sculptedBody || null, weapon: f.model.userData.weaponKind || null, meshes, materials: materials.size, tris: Math.round(tris), frame: window.__auditFrame };
  });
  console.log(tag, JSON.stringify(info));
  await step(0.05);
  await page.screenshot({ path: resolve(outDir, `${tag}-idle.png`) });
  await page.keyboard.press('j');
  await step(0.08);
  await page.screenshot({ path: resolve(outDir, `${tag}-attack.png`) });
  await step(0.6);
  // Transformation
  await page.evaluate(() => { const f = window.fighters[0]; f.power = 100; });
  await page.keyboard.press('i');
  await step(0.7);
  await page.screenshot({ path: resolve(outDir, `${tag}-form.png`) });
  // The same moment again through the game's own camera: the stubbed camera above proves the form
  // state changed, this one shows what a player actually sees while transformed.
  await page.evaluate(() => { if (window.__auditRealUpdate) window.smashCamera.update = window.__auditRealUpdate; });
  await step(0.45);
  await page.screenshot({ path: resolve(outDir, `${tag}-form-live.png`) });
  await page.evaluate(() => { const f = window.fighters[0]; f.transform = null; f.power = 0; window.combatPowers?.clear?.('audit'); window.smashCamera.update = () => {}; });
  await step(0.6);
  // Signature / ultimate
  await page.evaluate(() => { const f = window.fighters[0]; f.specialCooldown = 0; f.meter = 100; });
  await page.keyboard.press('k');
  await step(0.12);
  await page.screenshot({ path: resolve(outDir, `${tag}-special.png`) });
  await step(1.0);
  await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; });
  await page.keyboard.press('o');
  await step(0.22);
  await page.screenshot({ path: resolve(outDir, `${tag}-ultimate.png`) });
  // The ultimate's cinematic camera treatment through the real camera, at startup and mid-sequence.
  await page.evaluate(() => { if (window.__auditRealUpdate) window.smashCamera.update = window.__auditRealUpdate; });
  await step(0.25);
  await page.screenshot({ path: resolve(outDir, `${tag}-ultimate-start.png`) });
  await step(0.6);
  await page.screenshot({ path: resolve(outDir, `${tag}-ultimate-live.png`) });

}

const only = process.argv[3] || 'Goku';
await shoot(only, only.replace(/[^a-z0-9]+/gi, '-').toLowerCase());

await browser.close();
server.close();
console.log('wrote screenshots to', outDir);
