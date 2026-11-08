// Pose review for the imported Spider-Man rig.
// Uses the real character-select preview renderer and the same clip library the match uses, so a
// front and side view can be inspected without the follow camera hiding forward extension.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/spider-man-preview';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.waitForFunction(() => ['ready', 'loaded'].includes(document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state), null, { timeout: 90000, polling: 300 }).catch(() => {});
await page.waitForTimeout(900);
const canvas = page.locator('#selectScreen [data-role="previewcanvas"]');

const allPoses = [
  ['idle', 0.4], ['walk', 0.25], ['run', 0.2], ['jump', 0.3], ['fall', 0.4], ['land', 0.2],
  ['jab', 0.42], ['front_kick', 0.42], ['heavy_punch', 0.45], ['block', 0.3],
  ['SpiderMan_Jab', 0.38], ['SpiderMan_Cross', 0.40], ['SpiderMan_Heavy', 0.42],
  ['SpiderMan_Kick', 0.36], ['SpiderMan_Air', 0.36],
  ['dodge_right', 0.3], ['web_swing', 0.3], ['spider_man_web_zip', 0.42],
  ['spider_web_shot', 0.34], ['spider_web_pull', 0.4], ['spider_web_swing', 0.42],
  ['knockdown', 0.5], ['get_up', 0.4]
];
const wanted = new Set((process.env.SPIDER_POSES || '').split(',').filter(Boolean));
const poses = wanted.size ? allPoses.filter(([id]) => wanted.has(id)) : allPoses;

async function showClip(id, fraction, yaw) {
  return page.evaluate(async ({ id, fraction, yaw }) => {
    const d = window.__fighterPreviewDebug;
    if (!d?.root || !d?.mixer) return { error: 'preview debug unavailable' };
    const { buildClip } = await import('/js/anim/clip_library.js');
    const clip = buildClip(id, d.rig);
    if (!clip) return { error: `missing clip ${id}` };
    d.mixer.stopAllAction();
    const action = d.mixer.clipAction(clip);
    action.reset().setLoop(window.__browserSmashThree.LoopOnce ?? 2200, 1);
    action.clampWhenFinished = true;
    action.play();
    action.time = Math.max(0, Math.min(clip.duration, clip.duration * fraction));
    d.mixer.update(0.0001);
    action.paused = true;
    window.__browserSmashPreview?.setYaw?.(yaw);
    // The portrait camera fits a standing T-pose; a raised web arm and forward kick leave it.
    // Hold a wider copy of that same camera so the whole silhouette is inspectable.
    if (!window.__poseBaseCam) {
      const THREE = window.__browserSmashThree;
      const position = d.camera.position.clone();
      const direction = d.camera.getWorldDirection(new THREE.Vector3());
      const target = position.clone().addScaledVector(direction, d.distance);
      window.__poseBaseCam = { position: position.toArray(), target: target.toArray(), distance: d.distance };
    }
    const THREE = window.__browserSmashThree;
    const base = new THREE.Vector3().fromArray(window.__poseBaseCam.position);
    const target = new THREE.Vector3().fromArray(window.__poseBaseCam.target);
    const direction = target.clone().sub(base).normalize();
    d.camera.position.copy(target).addScaledVector(direction, -window.__poseBaseCam.distance * 1.62);
    d.camera.lookAt(target);
    d.root.updateMatrixWorld(true);
    const box = new window.__browserSmashThree.Box3().setFromObject(d.root);
    const hand = (side) => {
      const node = d.root.userData?.[side + 'Hand'] || d.root.userData?.[side + 'Fore'];
      return node ? node.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) : null;
    };
    const joint = (name) => {
      const node = d.root.userData?.[name];
      return node ? node.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) : null;
    };
    const head = d.root.userData?.head?.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) || null;
    const pelvis = d.root.userData?.pelvis?.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) || null;
    const leftFoot = d.root.userData?.leftFoot?.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) || null;
    const rightFoot = d.root.userData?.rightFoot?.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(3)) || null;
    return {
      id, duration: +clip.duration.toFixed(2), tracks: clip.tracks.length, bones: clip.userData?.bones?.length ?? null,
      box: [box.min.toArray().map(v => +v.toFixed(3)), box.max.toArray().map(v => +v.toFixed(3))],
      head, pelvis, leftHand: hand('left'), rightHand: hand('right'), leftFoot, rightFoot,
      leftArm: joint('leftArm'), leftFore: joint('leftFore'), rightArm: joint('rightArm'), rightFore: joint('rightFore')
    };
  }, { id, fraction, yaw });
}

// Optional phase review: clipId:fraction:label, e.g. SpiderMan_Jab:0.18:anticipation.
const phaseSpecs = (process.env.SPIDER_PHASES || '').split(',').filter(Boolean).map(spec => {
  const [clip, fraction, label] = spec.split(':');
  return { clip, fraction: Number(fraction), label };
});
const shots = phaseSpecs.length
  ? phaseSpecs
  : poses.map(([id, fraction]) => ({ clip: id, id, fraction, label: null }));

const report = [];
for (const shot of shots) {
  const id = shot.clip;
  const name = shot.label ? `${id}-${shot.label}` : id;
  const front = await showClip(id, shot.fraction, 0);
  await page.waitForTimeout(60);
  await canvas.screenshot({ path: `${out}/${name}-front.png` });
  const side = await showClip(id, shot.fraction, Math.PI / 2);
  await page.waitForTimeout(60);
  await canvas.screenshot({ path: `${out}/${name}-side.png` });
  report.push({ id: name, clip: id, fraction: shot.fraction, front, side });
  console.log(name, JSON.stringify({ duration: front.duration, box: front.box, hands: [front.leftHand, front.rightHand], feet: [front.leftFoot, front.rightFoot] }));
}
await page.evaluate(() => window.__browserSmashPreview?.setYaw?.(0));
console.log('ERRORS', JSON.stringify(errors));
console.log('REPORT', JSON.stringify(report));
await browser.close();
server.close();
