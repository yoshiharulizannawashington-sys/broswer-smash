// Phase 1 live-roster capture: one real character-select -> match -> mounted-body frame per
// launch fighter, from the game renderer with the gameplay camera pinned for inspection.
//
//   bash scripts/run-browser-test.sh scripts/capture-phase1-live-roster.mjs --shards=3
//   bash scripts/run-browser-test.sh scripts/capture-phase1-live-roster.mjs --only=aquaman
//
// A full match is started for every fighter; no fixture body or preview panel is used. The CPU is
// frozen only after the match is underway so the idle pose is the fighter's own, not a hit reaction.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase1-live');
await mkdir(outDir, { recursive: true });

const argv = process.argv.slice(2);
const flag = name => {
  const hit = argv.find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const ONLY = flag('only')?.split(',').map(s => s.trim()).filter(Boolean) || null;
const SHARDS = Math.max(1, Math.min(3, Number(flag('shards') ?? 2) || 2));

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) {
      rel = 'public' + sep + rel;
    }
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const rows = [];
const errors = [];
let browser;

async function waitForPage(page, fresh = false) {
  if (fresh || !page.__phase1Booted) {
    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashSelect && window.__browserSmashStep
      && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
    await page.addStyleTag({ content: '#bbHudLayer,#hud,.bb-hud{display:none!important}' });
    page.__phase1Booted = true;
    return;
  }
  // A new match reuses the booted page: the win/lose overlay is cleared and the select screen is
  // opened again. Reloading the 26 MB game for all 38 fighters was the slow part of this capture.
  await page.evaluate(() => {
    window.__browserSmashSetPaused?.(false);
    window.__browserSmashFreezeAI = false;
    window.__browserSmashTrainingDummy = false;
    if (window.__phase1RealUpdate) window.smashCamera.update = window.__phase1RealUpdate;
    const menu = document.querySelector('#menu');
    menu?.classList.remove('hidden', 'bb-title', 'bb-setup', 'bb-result', 'bb-defeat');
    window.__browserSmashSelect?.show?.();
    menu?.classList.add('bs-select-open');
  });
  await page.waitForTimeout(250);
}

async function captureOne(page, name) {
  const slug = slugOf(name);
  const file = resolve(outDir, slug + '.png');
  const existing = await readFile(file).catch(() => null);
  if (existing?.length > 1000) { rows.push({ name, slug, state: 'cached' }); return; }

  await page.evaluate(({ fighter }) => {
    const select = window.__browserSmashSelect;
    select.show();
    select.select('p1', fighter);
    select.select('p2', 'Vegeta');
    select.chooseArena('tournament');
    document.querySelector('#play')?.click();
  }, { fighter: name });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
    null, { timeout: 60_000, polling: 200 });
  await page.waitForFunction(fighterSlug => {
    const f = window.fighters?.[0];
    const slug = String(f?.identityKey || f?.identity || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    return slug === fighterSlug && Boolean(f?.model?.userData?.characterAssetUrl || f?.model?.userData?.sculptedBody);
  }, slug, { timeout: 120_000, polling: 200 });
  await page.waitForFunction(() => Boolean(window.fighters?.[0]?.model?.userData?.humanMixer),
    null, { timeout: 20_000, polling: 100 }).catch(() => {});
  // Freeze the opponent and advance past the intro/bind frame before pinning the camera.
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashStep?.(1.2);
  });
  // A late reaction/library bind can restart idle at t=0 after the first step. Wait for the
  // action clock to advance, then step again, so evidence is a settled loop frame instead of the
  // authored bind pose.
  await page.waitForFunction(() => {
    const action = window.fighters?.[0]?.model?.userData?.idleAction;
    return Boolean(action && action.isRunning() && action.time > 0.18);
  }, null, { timeout: 5_000, polling: 100 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashStep?.(0.3));
  await page.waitForTimeout(180);

  const report = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0];
    const model = f.model;
    const u = model.userData;
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const camera = window.smashCamera.camera;
    window.__phase1RealUpdate = window.smashCamera.update;
    window.smashCamera.update = () => {};
    // Full body with a little floor: the close 1.55x framing cropped heads and feet and made the
    // arena pickups read as part of the fighter.
    const distance = Math.max(3.0, size.y * 2.25);
    // Show the face the fighter actually presents to the opponent. A fixed +Z camera put every
    // fighter who happened to spawn facing -Z into a back view, which is evidence of camera
    // placement, not of a broken character.
    const bodyForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
      .setY(0);
    if (bodyForward.lengthSq() < 1e-6) bodyForward.set(0, 0, 1); else bodyForward.normalize();
    const desiredFacing = new THREE.Vector3(Number(f.facing) || 0, 0, Number(f.facingZ) || 1);
    if (desiredFacing.lengthSq() < 1e-6) desiredFacing.set(0, 0, 1); else desiredFacing.normalize();
    const facingDot = +bodyForward.dot(desiredFacing).toFixed(2);
    // Stand on the opponent side of the fighter, not on the body-axis side. That is the face the
    // fighter is presenting in the match; facingDot above records whether the body agrees.
    const facing = desiredFacing;
    const right = new THREE.Vector3(-facing.z, 0, facing.x);
    camera.position.set(
      center.x + facing.x * distance + right.x * distance * 0.18,
      center.y + size.y * 0.10,
      center.z + facing.z * distance + right.z * distance * 0.18
    );
    camera.near = 0.05;
    camera.far = 100;
    camera.fov = 32;
    camera.lookAt(center.x, center.y, center.z);
    camera.updateProjectionMatrix();
    for (const selector of ['#bbHudLayer', '#hud', '#energyHUD', '#cameraSettings', '#exploreHint', '#comboNotice', '#menu']) {
      document.querySelectorAll(selector).forEach(node => { node.style.setProperty('display', 'none', 'important'); });
    }
    const weapon = u.equippedWeaponRight || u.equippedWeaponLeft || null;
    const mount = weapon?.parent || null;
    const attach = mount?.userData?.attachBoneObject || null;
    const hand = u.rightHand || null;
    const wp = weapon?.getWorldPosition(new THREE.Vector3()) || null;
    const hp = hand?.getWorldPosition(new THREE.Vector3()) || null;
    return {
      identity: f.identity,
      facingDot,
      model: u.characterAssetUrl || u.sculptedBody || null,
      weapon: u.weaponKind || null,
      clips: (u.animationActions && Object.keys(u.animationActions).length) || 0,
      idle: u.idleAction?.getClip?.()?.name || null,
      idleTime: +(u.idleAction?.time || 0).toFixed(2),
      weaponMount: mount ? {
        parent: mount.name || null,
        attachBone: mount.userData.attachBone || null,
        attachIsHand: mount.userData.attachIsHand === true,
        hand: hand?.name || null,
        weaponToHand: wp && hp ? +wp.distanceTo(hp).toFixed(3) : null
      } : null,
      size: size.toArray().map(n => +n.toFixed(2)),
      box: { min: box.min.toArray().map(n => +n.toFixed(2)), max: box.max.toArray().map(n => +n.toFixed(2)) }
    };
  });
  await page.waitForTimeout(100);
  await page.screenshot({ path: file });
  rows.push({ name, slug, state: 'captured', ...report });
  console.log(`${slug} ${report.identity} ${report.model} clips=${report.clips} idle=${report.idle}`);
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const boot = await browser.newPage();
  await waitForPage(boot);
  const all = await boot.evaluate(() => window.characterRosters.launch.map(([name]) => name));
  await boot.close();
  const targets = all.filter(name => !ONLY || ONLY.includes(slugOf(name)));
  const shards = Array.from({ length: SHARDS }, () => []);
  targets.forEach((name, index) => shards[index % SHARDS].push(name));

  await Promise.all(shards.map(async (names, shard) => {
    if (!names.length) return;
    const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
    page.setDefaultTimeout(120_000);
    page.on('pageerror', error => { errors.push(String(error).split('\n')[0]); });
    for (const name of names) {
      try {
        await waitForPage(page);
        await captureOne(page, name);
      } catch (error) {
        rows.push({ name, slug: slugOf(name), state: 'failed', error: String(error).split('\n')[0] });
        console.error('FAILED', slugOf(name), String(error).split('\n')[0]);
      }
    }
    await page.close();
  }));

  await writeFile(resolve(outDir, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    requested: targets.length,
    captured: rows.filter(row => row.state === 'captured' || row.state === 'cached').length,
    rows,
    pageErrors: [...new Set(errors)].slice(0, 20)
  }, null, 2) + '\n');
  console.log(JSON.stringify({ captured: rows.filter(r => r.state !== 'failed').length, failed: rows.filter(r => r.state === 'failed').length, errors: [...new Set(errors)].slice(0, 5) }));
} finally {
  await browser?.close();
  server.close();
}
