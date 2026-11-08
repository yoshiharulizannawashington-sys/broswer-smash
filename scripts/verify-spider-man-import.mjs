// Spider-Man imported-body acceptance test.
// Selects the real roster slot through the real UI, waits for the GLB to mount, checks the rig,
// textures and animation path, then drives movement and an attack in a live match.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/spider-man-import';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    // The online-character browser fetches this API in production; the static test server has
    // no backend, so answer with the empty shape instead of a 404 that pollutes the run.
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

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-90)}`); });
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160) + ' @ ' + (m.location()?.url || '?')); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
// Picking P1 advances the picker to the CPU side; select P1 again so the preview and the
// screenshot are the imported Spider-Man, not the opponent being chosen next.
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.waitForTimeout(800);
await page.waitForFunction(() => ['ready', 'loaded'].includes(document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state), null, { timeout: 90000, polling: 300 }).catch(() => {});
await page.waitForTimeout(1500);
const preview = await page.evaluate(() => {
  const canvas = document.querySelector('#selectScreen [data-role="previewcanvas"]');
  const d = window.__fighterPreviewDebug || null;
  return {
    state: document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || null,
    clips: Number(document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.clips || 0),
    selected: document.querySelector('#p1Character')?.value || null,
    box: d ? { min: d.boxMin, max: d.boxMax, size: d.size, camera: d.camera, distance: d.distance } : null,
    canvas: canvas ? { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight } : null,
    meshNames: (() => { const names = []; d?.root?.traverse(n => { if (n.isMesh && names.length < 8) names.push(n.name); }); return names; })(),
    side: document.querySelector('#selectScreen [data-role="previewside"]')?.textContent || null,
    idle: d?.idle || null, previewBones: d?.bones || 0,
  };
});
check('select preview loads Spider-Man for the P1 side', ['ready', 'loaded'].includes(preview.state) && preview.selected === 'Spider-Man' && preview.side === 'P1 · PLAYER' && preview.meshNames.includes('Object_7'), JSON.stringify({ state: preview.state, selected: preview.selected, side: preview.side, meshNames: preview.meshNames, idle: preview.idle, bones: preview.previewBones }));
check('select preview canvas is sized and the model is in frame', preview.box && preview.canvas?.cw > 100 && preview.canvas?.ch > 100 && preview.box.size?.[1] > 1.5 && Math.abs(preview.box.camera?.position?.y - (preview.box.min[1] + preview.box.max[1]) / 2) < 0.5, JSON.stringify({ box: preview.box, canvas: preview.canvas }));
await page.screenshot({ path: `${out}/1-select-spider-man.png` });
// Keep a second, chrome-free view of the actual preview renderer so the imported silhouette and
// its live idle can be inspected without the surrounding menu.
await page.locator('#selectScreen [data-role="preview"]').screenshot({ path: `${out}/1-select-spider-man-preview.png` });

await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.characterModels?.spider_man?.status, null, { timeout: 120000, polling: 300 }).catch(() => {});
await page.waitForTimeout(2500);

const mounted = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  let meshes = 0, tris = 0, skinned = 0, bones = 0, textured = 0;
  const textures = new Set();
  f.model.traverse(n => {
    if (n.isBone) bones += 1;
    if (n.isSkinnedMesh) skinned += 1;
    if (!n.isMesh) return;
    meshes += 1;
    tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
    for (const mat of (Array.isArray(n.material) ? n.material : [n.material])) {
      if (!mat) continue;
      const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].filter(k => mat[k]?.image);
      if (maps.length) { textured += 1; for (const k of maps) textures.add(mat[k].uuid); }
    }
  });
  const asset = window.__browserSmashAssets?.characterModels?.spider_man || null;
  return {
    identity: f.identity, assetUrl: u.characterAssetUrl || null,
    meshes, triangles: Math.round(tris), skinned, bones, textured, textures: textures.size,
    placement: u.placement || null, validation: asset?.validation || null, assetStatus: asset?.status || null,
    clips: Object.keys(u.animationActions || {}),
    hasController: !!u.animationController, actions: Object.keys(u.animationActions || {}).length,
    controller: f.animationController?.describe?.() || null,
    controllerModelMatches: f.animationController?.model === f.model,
    bindModelMatches: f.animationBindModel === f.model,
    controllerClipIds: f.animationController?.clips ? [...f.animationController.clips.keys()] : [],
    activeClip: f.animationController?._active || null,
    hudSpider: /SPIDER/i.test((document.querySelector('#hud')?.textContent || '').replace(/\s+/g, ' ')),
  };
});
check('the live match mounts the imported Spider-Man GLB', /spider_man\.glb/.test(mounted.assetUrl || '') && mounted.triangles >= 10000 && mounted.skinned >= 5,
  JSON.stringify({ asset: mounted.assetUrl, triangles: mounted.triangles, skinned: mounted.skinned, bones: mounted.bones, status: mounted.assetStatus }));
check('the model passes the live rig/ground validation', mounted.validation?.ok === true, JSON.stringify(mounted.validation));
check('embedded textures are connected to materials', mounted.textures >= 3 && mounted.textured >= 3, JSON.stringify({ textures: mounted.textures, textured: mounted.textured }));
check('HUD names Spider-Man', mounted.hudSpider && mounted.identity === 'Spider-Man', JSON.stringify({ identity: mounted.identity }));

// Freeze the CPU and place the pair so the light attack has a real target.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  if (!p2.__testSim) { p2.__testSim = p2.simulate.bind(p2); p2.simulate = dt => p2.__testSim(dt, { getInputs: () => ({ ...idle }) }); }
  p1.position.set(-1.0, 0, 2); p2.position.set(0.1, 0, 2);
  p1.velocity.set(0,0,0); p2.velocity.set(0,0,0); p1.isGrounded = true; p2.isGrounded = true;
  p1.hitstun = 0; p1.guardBreak = 0; p1.attackPose = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100; p2.ko = false; p2.attackQueue.length = 0; p2.hitboxes.length = 0;
  window.__spiderBefore = p2.percent;
  window.__spiderHand = (() => { let h = null; p1.model.traverse(n => { if (!h && n.isBone && /hand/i.test(n.name) && /right/i.test(n.name)) h = n; }); return h ? h.getWorldPosition(new p1.model.position.constructor()).toArray() : null; })();
});
await page.screenshot({ path: `${out}/2-match-spider-man.png` });
await page.keyboard.press('j');
const motion = await page.evaluate(() => {
  const p1 = window.fighters[0];
  let hand = null;
  p1.model.traverse(n => { if (!hand && n.isBone && /hand/i.test(n.name) && /right/i.test(n.name)) hand = n; });
  const start = hand ? hand.getWorldPosition(new p1.model.position.constructor()).toArray() : null;
  let peak = 0;
  for (let i = 0; i < 40; i += 1) {
    window.__browserSmashStep(1 / 60);
    if (!hand || !start) continue;
    const now = hand.getWorldPosition(new p1.model.position.constructor()).toArray();
    peak = Math.max(peak, Math.hypot(now[0]-start[0], now[1]-start[1], now[2]-start[2]));
  }
  const u = p1.model.userData || {};
  return {
    travel: +peak.toFixed(3), before: window.__spiderBefore, after: window.fighters[1].percent,
    controllerClips: Object.keys(u.animationActions || {}),
    controllerState: u.animationController?.current || null,
  };
});
check('the imported rig moves during an attack', motion.travel > 0.05, JSON.stringify(motion));
check('a light attack deals real damage', motion.after > motion.before, JSON.stringify(motion));
await page.screenshot({ path: `${out}/3-attack-spider-man.png` });

const moved = await page.evaluate(() => {
  const p1 = window.fighters[0];
  const before = p1.position.clone();
  for (let i = 0; i < 30; i += 1) window.__browserSmashStep(1 / 60);
  return { dx: +(p1.position.x - before.x).toFixed(2), dz: +(p1.position.z - before.z).toFixed(2) };
});
check('movement produces no NaN', Number.isFinite(moved.dx) && Number.isFinite(moved.dz), JSON.stringify(moved));
check('no page errors', errors.length === 0 && failedRequests.length === 0, [...errors.slice(0, 3), ...failedRequests.slice(0, 4)].join(' | '));

console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
await browser.close();
server.close();
process.exit(checks.every(c => c.ok) ? 0 : 1);
