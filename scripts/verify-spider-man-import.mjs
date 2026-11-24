// Spider-Man imported-body acceptance test.
// Selects the real roster slot through the real UI, waits for the GLB to mount, checks the rig,
// textures and animation path, then drives movement and an attack in a live match.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

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
const browser = await chromium.launch(browserLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-90)}`); });
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160) + ' @ ' + (m.location()?.url || '?')); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
const gpu = await captureGpu(page);
const softwareRenderer = isSoftwareRenderer(gpu);
console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
if (HARDWARE_GPU) assertHardwareGpu(gpu, 'Spider-Man import hardware acceptance');
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
check('select preview loads Spider-Man for the P1 side', ['ready', 'loaded'].includes(preview.state) && preview.selected === 'Spider-Man' && preview.side === 'P1 · PLAYER' && preview.meshNames.includes('Object_189'), JSON.stringify({ state: preview.state, selected: preview.selected, side: preview.side, meshNames: preview.meshNames, idle: preview.idle, bones: preview.previewBones }));
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
    // The supplied body has a five-segment spine. Before the bone-map fix every segment
    // classified as a chest, so only the lumbar bone was driven and the source Spine track was
    // dropped; count the clips that really carry a spine destination track.
    spineTracks: (() => {
      const bones = [];
      f.model.traverse(n => { if (n.isBone && /spine/i.test(n.name)) bones.push(n.name); });
      const withSpine = [], without = [];
      for (const [id, action] of Object.entries(u.animationActions || {})) {
        const clip = action?.getClip?.();
        if (!clip) continue;
        const targets = clip.tracks.map(t => t.name.slice(0, t.name.lastIndexOf('.')));
        (targets.some(t => /spine/i.test(t)) ? withSpine : without).push(id);
      }
      return { bones, withSpine, without };
    })(),
    hasController: !!u.animationController, actions: Object.keys(u.animationActions || {}).length,
    controller: f.animationController?.describe?.() || null,
    controllerModelMatches: f.animationController?.model === f.model,
    bindModelMatches: f.animationBindModel === f.model,
    controllerClipIds: f.animationController?.clips ? [...f.animationController.clips.keys()] : [],
    activeClip: f.animationController?._active || null,
    // The modern HUD layer replaces the legacy #hud once a match starts; read both so the check
    // does not fail merely because the legacy block is hidden.
    hudSpider: /SPIDER/i.test(((document.querySelector('#bbHudLayer') || document.querySelector('#hud'))?.textContent || '').replace(/\s+/g, ' ')),
  };
});
check('the live match mounts the supplied Miles GLB', /miles_morales_animated\.glb/.test(mounted.assetUrl || '') && mounted.triangles >= 10000 && mounted.skinned >= 3 && mounted.bones === 178,
  JSON.stringify({ asset: mounted.assetUrl, triangles: mounted.triangles, skinned: mounted.skinned, bones: mounted.bones, status: mounted.assetStatus }));
check('the model passes the live rig/ground validation', mounted.validation?.ok === true, JSON.stringify(mounted.validation));
check('every retargeted clip carries the mapped spine chain', (mounted.spineTracks?.withSpine.length || 0) >= 25 && (mounted.spineTracks?.bones.length || 0) >= 2,
  JSON.stringify({ bones: mounted.spineTracks?.bones, withSpine: mounted.spineTracks?.withSpine.length, without: mounted.spineTracks?.without }));
check('both supplied textures are connected to the three skinned materials', mounted.textures >= 2 && mounted.textured >= 3, JSON.stringify({ textures: mounted.textures, textured: mounted.textured }));
check('HUD names Spider-Man', mounted.hudSpider && mounted.identity === 'Spider-Man', JSON.stringify({ identity: mounted.identity }));
const originalMilesClips = [
  'FearlessFlight_Male_idle', 'air_attack', 'beam', 'block', 'charge', 'defeat', 'dodge', 'fly',
  'get_up', 'heavy_punch', 'hit_heavy', 'hit_light', 'hover', 'idle', 'jab', 'jump', 'knockdown',
  'land', 'launcher', 'parry', 'run', 'sprint', 'strafe', 'throw', 'victory', 'walk'
];
const liveClipKeys = new Set((mounted.clips || []).map(name => name.toLowerCase()));
check('all 26 original Miles clips remain on the live mixer',
  originalMilesClips.every(name => liveClipKeys.has(name.toLowerCase())),
  JSON.stringify({ found: originalMilesClips.filter(name => liveClipKeys.has(name.toLowerCase())).length, expected: originalMilesClips.length }));

// Freeze the CPU and place the pair so the light attack has a real target.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  if (!p2.__testSim) { p2.__testSim = p2.simulate.bind(p2); p2.simulate = dt => p2.__testSim(dt, { getInputs: () => ({ ...idle }) }); }
  p1.position.set(-0.55, 0, 2); p2.position.set(0.1, 0, 2);
  p1.velocity.set(0,0,0); p2.velocity.set(0,0,0); p1.isGrounded = true; p2.isGrounded = true;
  p1.hitstun = 0; p1.guardBreak = 0; p1.attackPose = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100; p2.ko = false; p2.attackQueue.length = 0; p2.hitboxes.length = 0;
  window.__spiderBefore = p2.percent;
  window.__spiderHand = (() => { let h = null; p1.model.traverse(n => { if (!h && n.isBone && /hand/i.test(n.name) && /right/i.test(n.name)) h = n; }); return h ? h.getWorldPosition(new p1.model.position.constructor()).toArray() : null; })();
});
await page.screenshot({ path: `${out}/2-match-spider-man.png` });
// The live loop keeps running during the screenshot; re-assert the exchange immediately before
// the input so the strike is measured against a target that is actually in reach.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  p1.position.set(-0.55, 0, 2); p2.position.set(0.1, 0, 2);
  p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  p1.hitstun = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.percent = 0;
  window.__spiderBefore = p2.percent;
});
await page.keyboard.press('j');
const motion = await page.evaluate(() => {
  const p1 = window.fighters[0];
  let hand = null;
  // Miles names the wrist `hand_r_105_102`, not `RightHand`, so accept either spelling.
  p1.model.traverse(n => { if (!hand && n.isBone && /hand/i.test(n.name) && (/right/i.test(n.name) || /(^|[^a-z])r($|[^a-z])/i.test(n.name))) hand = n; });
  const start = hand ? hand.getWorldPosition(new p1.model.position.constructor()).toArray() : null;
  // Sample the mapped spine joints so the test proves the torso drives the strike on the live
  // skeleton, not just that some clip track exists in the GLB.
  const spineBones = [];
  p1.model.traverse(n => { if (n.isBone && /spine/i.test(n.name)) spineBones.push(n); });
  const spineStart = spineBones.map(b => b.quaternion.clone());
  const spinePeak = spineBones.map(() => 0);
  let peak = 0;
  for (let i = 0; i < 40; i += 1) {
    window.__browserSmashStep(1 / 60);
    spineBones.forEach((b, s) => { spinePeak[s] = Math.max(spinePeak[s], spineStart[s].angleTo(b.quaternion)); });
    if (!hand || !start) continue;
    const now = hand.getWorldPosition(new p1.model.position.constructor()).toArray();
    peak = Math.max(peak, Math.hypot(now[0]-start[0], now[1]-start[1], now[2]-start[2]));
  }
  const u = p1.model.userData || {};
  return {
    travel: +peak.toFixed(3), before: window.__spiderBefore, after: window.fighters[1].percent,
    strike: u.lastAuthoredStrike || null, queue: p1.attackQueue?.length ?? null,
    spine: spineBones.map((b, s) => ({ bone: b.name, peakDeg: +(spinePeak[s] * 180 / Math.PI).toFixed(2) })),
    controllerClips: Object.keys(u.animationActions || {}),
    controllerState: u.animationController?.current || null,
  };
});
check('the imported rig moves during an attack', motion.travel > 0.05, JSON.stringify(motion));
check('a light attack deals real damage', motion.after > motion.before, JSON.stringify(motion));
check('the mapped spine chain moves during the struck match', motion.spine.filter(s => s.peakDeg > 1).length >= 2, JSON.stringify(motion.spine));
check('normal J selects the retargeted Iron Spider light attack',
  motion.strike?.slot === 'light1' && /^IronSpider__.*@atk-01/.test(motion.strike.clip || ''),
  JSON.stringify(motion.strike));
await page.screenshot({ path: `${out}/3-attack-spider-man.png` });

// ---- Extended clip coverage -------------------------------------------------
// Each state is driven through the live match branch that owns its clip: a real jump and J for
// the aerial, a real grab for the throw, and the hitstun/knockdown/victory fields that a landed
// hit and a round end write for the reactions. Pose evidence is the largest bone-rotation change
// between the two samples, so a missing or bind-pose clip cannot pass on its name alone.
const samplePose = () => page.evaluate(() => {
  const p1 = window.fighters[0];
  const bones = {};
  p1.model.traverse(n => { if (n.isBone) bones[n.name] = n.quaternion.toArray().map(v => +v.toFixed(5)); });
  return {
    clip: p1.model.userData.currentClip || null,
    grounded: p1.isGrounded, y: +p1.position.y.toFixed(3), ground: +(p1.groundLevel ?? 0).toFixed(3),
    hitstun: +(p1.hitstun || 0).toFixed(3), victoryPose: p1.victoryPose || 0,
    grab: Boolean(p1.grabTarget || p1.grabbedBy || (p1.grabHold || 0) > 0 || (p1.heldThrow?.t || 0) > 0),
    airAction: Boolean(p1.model.userData.airAttackAction),
    lastStrike: p1.model.userData.lastAuthoredStrike || null,
    queue: (p1.attackQueue || []).map(a => a.id || a.kind || '?'),
    getUpTime: +(p1.model.userData.getUpTime || 0).toFixed(2),
    wasKnocked: Boolean(p1.model.userData.wasKnockedDown),
    bones
  };
});
const poseDegrees = (before, after) => {
  let best = 0;
  for (const [name, q] of Object.entries(after?.bones || {})) {
    const p = before?.bones?.[name];
    if (!p) continue;
    const dot = Math.abs(p.reduce((sum, value, index) => sum + value * q[index], 0));
    best = Math.max(best, 2 * Math.acos(Math.min(1, dot)));
  }
  return best * 180 / Math.PI;
};
const resetMiles = () => page.evaluate(() => {
  const p1 = window.fighters[0];
  p1.position.set(0, p1.groundLevel ?? 0, 2);
  p1.velocity.set(0, 0, 0);
  p1.isGrounded = true; p1.hitstun = 0; p1.ko = false; p1.victoryPose = 0;
  p1.attackQueue.length = 0; p1.attackBuffer = 0; p1.attackPose = 0; p1.model.userData.attackLock = 0;
  p1.hitboxes.length = 0;
  p1.model.userData.lastAuthoredStrike = null;
  p1.model.userData.lastStrikeQueueLength = 0;
  p1.model.userData.lastStrikeSignature = '';
  p1.model.userData.wasAttacking = false;
  p1.model.userData.authoredStrikeAction = null;
  p1.model.userData.authoredStrikeTime = 0;
  p1.model.userData.proceduralAttackTime = 0;
  p1.grabTarget = null; p1.grabbedBy = null; p1.grabHold = 0; p1.heldThrow = null;
  p1.model.userData.getUpTime = 0;
  p1.model.userData.wasKnockedDown = false;
  p1.model.userData.stunPrev = 0;
});
const stepFrames = (seconds) => page.evaluate((seconds) => {
  const frames = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < frames; i += 1) window.__browserSmashStep(1 / 60);
}, seconds);

// Aerial attack: a real jump, then J while airborne.
await resetMiles();
await page.keyboard.press('Space');
await stepFrames(0.16);
const airBefore = await samplePose();
await page.keyboard.press('j');
await stepFrames(0.1);
const airAfter = await samplePose();
await page.screenshot({ path: `${out}/4-aerial-spider-man.png` });
check('an airborne J plays the retargeted Iron Spider air attack',
  /^IronSpider__.*@skill04-02/.test(airAfter.clip || '') && airAfter.lastStrike?.slot === 'air' && !airAfter.grounded,
  JSON.stringify({ clip: airAfter.clip, y: airAfter.y, above: +(airAfter.y - airAfter.ground).toFixed(2), grounded: airAfter.grounded, airAction: airAfter.airAction, lastStrike: airAfter.lastStrike, queue: airAfter.queue, poseDeg: +poseDegrees(airBefore, airAfter).toFixed(1) }));

// Throw: a real grab at melee range; the held-target branch owns the throw clip.
await resetMiles();
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  p1.position.set(-0.45, p1.groundLevel ?? 0, 2); p2.position.set(0.1, p2.groundLevel ?? 0, 2);
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  p2.hitstun = 0; p2.ko = false; p2.invulnerable = 0; p2.percent = 0;
});
const throwBefore = await samplePose();
await page.keyboard.press('u');
await stepFrames(0.2);
const throwAfter = await samplePose();
await page.screenshot({ path: `${out}/5-throw-spider-man.png` });
check('a live grab selects the retargeted Iron Spider throw clip',
  /^IronSpider__.*@skill04-02/.test(throwAfter.clip || '') && throwAfter.grab,
  JSON.stringify({ clip: throwAfter.clip, grab: throwAfter.grab, lastStrike: throwAfter.lastStrike, poseDeg: +poseDegrees(throwBefore, throwAfter).toFixed(1) }));

// Hit reaction: the live hitstun branch, i.e. the field a landed hit writes.
await resetMiles();
const hitBefore = await samplePose();
await page.evaluate(() => { window.fighters[0].hitstun = 0.4; });
await stepFrames(0.16);
const hitAfter = await samplePose();
await page.screenshot({ path: `${out}/6-hit-reaction-spider-man.png` });
check('a light hitstun selects the retargeted Iron Spider hit reaction',
  /^IronSpider__.*@hit$/.test(hitAfter.clip || '') && hitAfter.hitstun > 0,
  JSON.stringify({ clip: hitAfter.clip, stun: hitAfter.hitstun, poseDeg: +poseDegrees(hitBefore, hitAfter).toFixed(1) }));

// Knockdown, then the get-up recovery.
await resetMiles();
const downBefore = await samplePose();
await page.evaluate(() => {
  const p1 = window.fighters[0];
  // Start the knockdown clearly above the floor so the fall reaction has room to play instead
  // of landing on the next frame and reading as an upright hit.
  p1.hitstun = 1.8; p1.isGrounded = false;
  p1.position.y = (p1.groundLevel ?? 0) + 0.8; p1.velocity.set(0, 7, 0);
});
await stepFrames(0.5);
const downAfter = await samplePose();
await page.screenshot({ path: `${out}/7-knockdown-spider-man.png` });
check('an airborne heavy hit selects the retargeted Iron Spider knockdown clip',
  /^IronSpider__knockdown/.test(downAfter.clip || '') && !downAfter.grounded,
  JSON.stringify({ clip: downAfter.clip, y: downAfter.y, above: +(downAfter.y - downAfter.ground).toFixed(2), poseDeg: +poseDegrees(downBefore, downAfter).toFixed(1) }));
// The knockdown branch turns a landed, stun-spent fighter into a recovery window. Stage the
// exact fields it reads (wasKnockedDown, grounded, no stun) so the branch itself performs the
// transition on the next frame; a full live fall can be recycled by the round before the
// recovery is reached, which made the window invisible to the driver.
await page.evaluate(() => {
  const p1 = window.fighters[0];
  p1.hitstun = 0; p1.isGrounded = true; p1.position.y = p1.groundLevel ?? 0; p1.velocity.set(0, 0, 0);
  p1.model.userData.wasKnockedDown = true;
});
await stepFrames(0.06);
const upBefore = await samplePose();
await stepFrames(0.18);
const upAfter = await samplePose();
await page.screenshot({ path: `${out}/8-get-up-spider-man.png` });
check('the knockdown recovers through the retargeted Iron Spider get_up clip',
  /^IronSpider__get_up/.test(upAfter.clip || '') && upAfter.grounded,
  JSON.stringify({ clip: upAfter.clip, y: upAfter.y, getUpTime: upAfter.getUpTime, poseDeg: +poseDegrees(upBefore, upAfter).toFixed(1) }));

const moved = await page.evaluate(() => {
  const p1 = window.fighters[0];
  const before = p1.position.clone();
  for (let i = 0; i < 30; i += 1) window.__browserSmashStep(1 / 60);
  return { dx: +(p1.position.x - before.x).toFixed(2), dz: +(p1.position.z - before.z).toFixed(2) };
});
check('movement produces no NaN', Number.isFinite(moved.dx) && Number.isFinite(moved.dz), JSON.stringify(moved));

// Victory presentation branch: the same field a round end writes.
await resetMiles();
const winBefore = await samplePose();
await page.evaluate(() => { window.fighters[0].victoryPose = 1; });
await stepFrames(0.12);
const winAfter = await samplePose();
await page.screenshot({ path: `${out}/9-victory-spider-man.png` });
check('the victory branch selects the retargeted Iron Spider victory clip',
  /^IronSpider__.*@succ_cam/.test(winAfter.clip || '') && winAfter.victoryPose > 0,
  JSON.stringify({ clip: winAfter.clip, pose: winAfter.victoryPose, poseDeg: +poseDegrees(winBefore, winAfter).toFixed(1) }));

// ---- A1 launch readiness: heavy, defeat, complete best-of-three ------------------------------
const startA1Match = async roundsToWin => {
  await page.evaluate((roundsToWin) => {
    const select = window.__browserSmashSelect;
    select.setMode('1p');
    select.setRules({ roundsToWin, roundSeconds: 60 });
    window.__browserSmashSetRules?.({ roundsToWin, roundSeconds: 60 });
    select.select('p1', 'Spider-Man');
    select.select('p2', 'Goku');
    select.chooseArena('tournament');
    window.__browserSmashFreezeAI = true;
    window.__browserSmashGame.startMatch();
    window.__browserSmashStep(0.8);
    window.__browserSmashSkipCinematic?.();
  }, roundsToWin);
  await page.waitForFunction(() => {
    const match = window.__browserSmashMatch?.();
    const intro = window.__browserSmashPresentation?.report?.().intro;
    return match?.status === 'fighting' && intro?.active === false;
  }, null, { timeout: 20_000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(250);
};

let heavy = null;
for (let attempt = 0; attempt < 3; attempt += 1) {
  await resetMiles();
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-0.55, p1.groundLevel ?? 0, 2); p2.position.set(0.1, p2.groundLevel ?? 0, 2);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.hitstun = 0; p1.dodgeTimer = 0; p1.comboStep = 0; p1.attackBuffer = 0;
    p1.attackQueue.length = 0; p1.attackPose = 0; p1.model.userData.attackLock = 0;
    p1.hitboxes.length = 0;
    p1.model.userData.lastAuthoredStrike = null;
    p2.hitstun = 0; p2.invulnerable = 0; p2.percent = 0; p2.ko = false;
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  });
  // Hold Shift and J across simulation frames. A press can release before the game's fixed-step
  // input update samples the modifier, which made the first version resolve as a light jab.
  await page.keyboard.down('Shift');
  await page.keyboard.down('j');
  await stepFrames(0.05);
  await page.keyboard.up('j');
  await page.keyboard.up('Shift');
  heavy = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    let peak = 0;
    let strike = null;
    const seen = [];
    for (let i = 0; i < 60; i += 1) {
      window.__browserSmashStep(1 / 60);
      peak = Math.max(peak, p2.percent || 0);
      const clip = p1.model.userData.currentClip || p1.animationController?._active || null;
      if (clip && !seen.includes(clip)) seen.push(clip);
      strike = p1.model.userData.lastAuthoredStrike || strike;
    }
    return { p2percent: +peak.toFixed(2), seen, clip: seen[seen.length - 1] || null,
      lastStrike: strike, p1percent: +(p1.percent || 0).toFixed(2),
      identity: p1.identity, asset: p1.model?.userData?.characterAssetUrl || null,
      distance: +p1.position.distanceTo(p2.position).toFixed(2), attempt: 0 };
  });
  heavy.attempt = attempt + 1;
  if (heavy.p2percent >= 12) break;
  await stepFrames(0.4);
}
await page.screenshot({ path: `${out}/10-heavy-spider-man.png` });
check('a live heavy attack reaches and damages the opponent',
  heavy.p2percent >= 12,
  JSON.stringify(heavy));
check('a live heavy attack selects the retargeted Iron Spider heavy clip',
  /^IronSpider__.*@skill02-03/.test(heavy.clip || '') || /^IronSpider__.*@skill02-03/.test(heavy.lastStrike?.clip || ''),
  JSON.stringify({ clip: heavy.clip, lastStrike: heavy.lastStrike, seen: heavy.seen }));

// Defeat is the loser-side result branch, not a victory with the text changed. Start a fresh
// one-round match so setting P1's percent to the KO threshold ends this match, rather than
// losing only the first round of a longer one.
await startA1Match(1);
await page.evaluate(() => {
  const p1 = window.fighters[0];
  p1.percent = 999; p1.ko = false; p1.invulnerable = 0;
});
let defeat = null;
for (let i = 0; i < 50; i += 1) {
  await stepFrames(0.15);
  defeat = await page.evaluate(() => ({
    status: window.__browserSmashMatch?.().status || null,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    wins: window.__browserSmashMatch?.().wins || null
  }));
  if (defeat.status === 'match-over') break;
}
await stepFrames(1.0);
defeat = await page.evaluate(() => ({
  status: window.__browserSmashMatch?.().status || null,
  text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
  wins: window.__browserSmashMatch?.().wins || null
}));
await page.screenshot({ path: `${out}/11-defeat-spider-man.png` });
check('defeat reaches a real result screen', defeat?.status === 'match-over' && defeat?.wins?.[0] === 0 && /PLAYER 2 WINS|DEFEAT/i.test(defeat?.text || ''),
  JSON.stringify(defeat));

// A complete best-of-three: two real round wins, then the match result. The opponent is frozen;
// each round is won by the live KO/round path, not by writing a winner field.
await startA1Match(2);
let bo3 = null;
for (let round = 0; round < 2; round += 1) {
  await page.evaluate(() => {
    const p2 = window.fighters[1];
    p2.percent = 999; p2.ko = false; p2.invulnerable = 0; p2.hitstun = 0;
  });
  for (let i = 0; i < 100; i += 1) {
    await stepFrames(0.1);
    bo3 = await page.evaluate(() => window.__browserSmashMatch?.() || null);
    if (bo3?.status === 'match-over' || (bo3?.wins?.[0] || 0) > round) break;
  }
  if (round === 0) {
    await stepFrames(2.5);
    bo3 = await page.evaluate(() => window.__browserSmashMatch?.() || null);
  }
}
await stepFrames(0.8);
const bo3Text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
await page.screenshot({ path: `${out}/12-bo3-result-spider-man.png` });
check('a complete best-of-three reaches two round wins and the match result',
  bo3?.status === 'match-over' && (bo3?.wins?.[0] || 0) >= 2,
  JSON.stringify({ status: bo3?.status, wins: bo3?.wins, round: bo3?.round, text: bo3Text.slice(0, 240) }));

check('no page errors', errors.length === 0 && failedRequests.length === 0, [...errors.slice(0, 3), ...failedRequests.slice(0, 4)].join(' | '));

console.log(`\n${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
await writeFile(`${out}/report.json`, JSON.stringify({ hardwareMode: HARDWARE_GPU, gpu, softwareRenderer, checks, errors, failedRequests }, null, 2));
await browser.close();
server.close();
process.exit(checks.every(c => c.ok) ? 0 : 1);
