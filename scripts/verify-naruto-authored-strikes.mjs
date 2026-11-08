// Every authored strike Naruto can reach, driven by real keys on the shipped game.
//
// Records the resolved move id (what gameplay committed to), the authored clip the prefab mixer is
// actually running, and that move's own frames/damage so an integration that quietly changed combat
// data cannot pass. Poses are captured in-tick via canvas.toDataURL so a screenshot delay cannot
// land after the clip has returned to idle.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const out = 'artifacts/compare/naruto-strikes';
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
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); b.position.set(3.2, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  const THREE = window.__browserSmashThree;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
  // One in-page sampler: records the live pose state and grabs the frame in-tick.
  window.__probeStrike = async (frames, opts = {}) => {
    const f = window.fighters[0], u = f.model.userData;
    const canvas = document.querySelector('canvas');
    const rows = [];
    let shot = null, shotProg = null;
    for (let i = 0; i < frames; i++) {
      if (opts.airborne) { f.isGrounded = false; f.position.y = Math.max(f.position.y, 3); f.velocity.y = 0; }
      if (opts.camera) window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: window.__frontYaw + (opts.yaw || 0), pitch: 4, distance: opts.distance || 3.4 });
      await new Promise(r => requestAnimationFrame(r));
      const acts = u.authoredAbilityActions || {};
      const running = Object.entries(acts).filter(([, a]) => a.isRunning() && a.getEffectiveWeight() > 0.01)
        .map(([slot, a]) => ({ slot, w: +a.getEffectiveWeight().toFixed(2), p: +Math.min(1, a.time / Math.max(1e-4, a.getClip().duration)).toFixed(2) }));
      const strike = u.authoredStrikeAction;
      // Capture hold only: the game sets `authoredStrikeTime` from the move's own duration, which at
      // this frame delta can expire before a still can be taken. Extending that timer keeps the
      // game's own selection and target logic in charge - no bone is written here.
      if (opts.hold && strike && u.authoredStrikeTime > 0) u.authoredStrikeTime = 4;
      const row = {
        moveId: f.activeMoveId || null,
        clip: u.currentClip || null,
        strike: strike && strike.isRunning() ? strike.getClip().name : null,
        strikeW: strike ? +strike.getEffectiveWeight().toFixed(2) : 0,
        running, equip: u.equipmentState?.state || null, last: u.lastAuthoredStrike || null,
        queue: (f.attackQueue || []).map(a => ({ id: a.id, frames: a.frames, damage: a.damage }))
      };
      rows.push(row);
      // Captured at the move's drive, not at its first keyframe: a still taken while the clip is still
      // at t=0 reads as the rest pose and proves nothing about the strike.
      const prog = strike ? strike.time / Math.max(1e-4, strike.getClip().duration) : 0;
      if (!shot && strike && strike.isRunning() && strike.getEffectiveWeight() > 0.3 && prog > 0.25 && prog < 0.85) {
        shot = canvas.toDataURL('image/png');
        shotProg = +prog.toFixed(2);
      }
    }
    return { rows, shot, shotProg };
  };
});
await page.locator('canvas').first().click({ position: { x: 340, y: 230 }, force: true });

// Clearing the queue has to be observed by a frame before the next press: the prefab body only
// selects an authored strike on the attacking -> attacking edge, and a synchronous clear leaves
// `wasAttacking` true, so the next press would queue a real move and animate nothing.
const reset = async () => {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0; f.hitLag = 0; f.comboWindow = 0; f.comboStep = 0;
    f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0);
  });
  await page.evaluate(() => window.__probeStrike(1, {}));
};
const bind = await page.evaluate(() => {
  const u = window.fighters[0].model.userData;
  return { slots: Object.keys(u.authoredAbilityActions || {}), special: u.authoredSpecialClipId, diag: u.authoredBindDiag };
});
const save = async (name, url) => {
  if (!url || url.length < 5000) return null;
  const file = `${out}/${name}.png`;
  await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
  return file;
};
const results = [];
const record = (name, keys, res, yaw = 0) => {
  const ids = [...new Set(res.rows.map(r => r.moveId).filter(Boolean))];
  const clips = [...new Set(res.rows.flatMap(r => r.running.map(x => x.slot)))];
  const strike = [...new Set(res.rows.map(r => r.strike).filter(Boolean))];
  const queue = res.rows.flatMap(r => r.queue).find(Boolean) || null;
  const last = res.rows.map(r => r.last).filter(Boolean).pop() || null;
  results.push({ name, keys, ids, strike, clips, queue, last, equip: [...new Set(res.rows.map(r => r.equip).filter(Boolean))], yaw });
  return res;
};

// The ground chain: one tap per hit, sampled between presses so the combo advances.
await reset();
let chain = { rows: [], shot: null };
for (let tap = 1; tap <= 5; tap++) {
  await page.keyboard.press('j');
  const res = await page.evaluate(t => window.__probeStrike(5, { camera: true, distance: 3.4, yaw: 28 }), tap);
  chain.rows.push(...res.rows);
  if (!chain.shot && res.shot) { chain.shot = res.shot; chain.prog = res.shotProg; }
}
const chainFile = await save('chain-5-hit', chain.shot);
results.push({
  name: 'ground-chain', keys: 'j x5',
  ids: [...new Set(chain.rows.map(r => r.moveId).filter(Boolean))],
  strike: [...new Set(chain.rows.map(r => r.strike).filter(Boolean))],
  clips: [...new Set(chain.rows.flatMap(r => r.running.map(x => x.slot)))],
  queue: chain.rows.flatMap(r => r.queue).find(Boolean) || null,
  equip: [...new Set(chain.rows.map(r => r.equip).filter(Boolean))],
  file: chainFile
});

const singles = [
  { name: 'heavy-forward', keys: 'Shift+j', run: true, yaw: 20 },
  { name: 'heavy-launcher', keys: 'Shift+w+j', run: true, up: true, yaw: 20 },
  { name: 'heavy-slam', keys: 'Shift+s+j', run: true, down: true, yaw: 20 },
  { name: 'air-strike', keys: 'airborne+j', airborne: true, yaw: 25 },
  { name: 'air-finisher', keys: 'airborne+j x3', airborne: true, taps: 3, yaw: 25 }
];
for (const s of singles) {
  await reset();
  // Pose capture only: the authored clip is slowed so a still frame exists to capture at a frame
  // delta this renderer reaches. Selection, ids and move data are recorded on every frame as usual.
  await page.evaluate(() => { const u = window.fighters[0].model.userData;    if (u.humanMixer) u.humanMixer.timeScale = 0.08; });
  if (s.run) await page.keyboard.down('Shift');
  if (s.up) await page.keyboard.down('w');
  if (s.down) await page.keyboard.down('s');
  let res = { rows: [], shot: null };
  const taps = s.taps || 1;
  for (let tap = 0; tap < taps; tap++) {
    // Ground/aerial state has to be settled BEFORE the press: `aerial` is sampled when the move is
    // queued, so forcing it afterwards resolved air presses as ground lights. The queue is only
    // cleared on the first tap, because a synchronous clear without an intervening frame leaves
    // `wasAttacking` true and the chain would stop advancing.
    await page.evaluate(o => {
      const f = window.fighters[0];
      f.hitstun = 0; f.guardBreak = 0;
      f.isGrounded = !o.airborne; f.position.y = o.airborne ? 3 : 0; f.velocity?.set?.(0, 0, 0);
      if (o.clear) f.attackQueue.length = 0;
    }, { airborne: !!s.airborne, clear: tap === 0 });
    await page.keyboard.press('j');
    // Earlier taps are sampled briefly so the chain step survives to the finisher press; the last
    // tap gets the full window that a pose capture needs.
    const frames = tap < taps - 1 ? 2 : 18;
    const part = await page.evaluate(o => window.__probeStrike(o.frames, o), { frames, hold: true, airborne: !!s.airborne, camera: true, distance: 3.4, yaw: s.yaw || 0 });
    res.rows.push(...part.rows);
    if (!res.shot && part.shot) res.shot = part.shot;
  }
  if (s.up) await page.keyboard.up('w');
  if (s.down) await page.keyboard.up('s');
  if (s.run) await page.keyboard.up('Shift');
  await page.evaluate(() => { const u = window.fighters[0].model.userData; if (u.humanMixer) u.humanMixer.timeScale = 1; });
  const file = await save(s.name, res.shot);
  record(s.name, s.keys, res);
  results[results.length - 1].file = file;
  results[results.length - 1].poseAt = res.shotProg ?? null;
}
await writeFile(`${out}/naruto-strikes.json`, JSON.stringify({ generatedAt: new Date().toISOString(), bind, results, errors }, null, 2));
console.log('BIND', JSON.stringify(bind));
for (const r of results) console.log('STRIKE', JSON.stringify(r));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
