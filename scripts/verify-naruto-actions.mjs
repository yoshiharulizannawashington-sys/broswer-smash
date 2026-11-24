// Individual verification of every Naruto action, with bone motion measured on the real rig bones.
//
// Earlier samplers looked for a bone literally named "torso"; this rig names its spine and chest
// bones differently, so the measurement silently returned nothing. Here the sampler collects every
// deform bone whose name looks like spine/chest/arm/leg/head, then reports which bone moved most.
//
// Each action records: the resolved move id, the authored clip actually running, the biggest bone
// rotation delta from the rest frame, the opponent's percent (gameplay effect), and the clip the
// body returns to once the action ends (recovery).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-actions';
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
  // Close enough for the strikes to connect, so the gameplay effect is observable.
  a.position.set(0, 0, 0); b.position.set(1.15, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  const THREE = window.__browserSmashThree;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
  window.__draw = async (frames, opts = {}) => {
    const f = window.fighters[0], u = f.model.userData, b = window.fighters[1];
    const bones = [];
    f.model.traverse(o => {
      if (o.isBone && /spine|chest|arm|forearm|hand|leg|shin|head|pelvis|hip|shoulder|neck/i.test(o.name || '') && !/weapon/i.test(o.name || '')) bones.push(o);
    });
    const rows = [];
    for (let i = 0; i < frames; i++) {
      if (opts.airborne) { f.isGrounded = false; f.position.y = Math.max(f.position.y, 3); f.velocity.y = 0; }
      // Velocity is pinned in every axis, not just y: holding sprint with W/S still slid the fighter,
      // which swapped the authored strike for a sprint clip and carried it out of reach.
      if (opts.holdGround) { f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0); }
      if (opts.camera) window.smashCamera?.spectate?.({ fighter: f, framing: opts.framing || 'torso', yaw: window.__frontYaw + (opts.yaw || 0), pitch: 4, distance: opts.distance || 3.0 });
      await new Promise(r => requestAnimationFrame(r));
      const q = {};
      for (const bone of bones) q[bone.name] = bone.quaternion.toArray();
      const strike = u.authoredStrikeAction;
      // Capture hold only: the game's own strike timer, extended so the authored pose is observable
      // at this frame delta. No bone is written here.
      if (opts.hold && strike && u.authoredStrikeTime > 0) u.authoredStrikeTime = 4;
      rows.push({
        moveId: f.activeMoveId || null,
        clip: u.currentClip || null,
        strike: strike && strike.isRunning() ? strike.getClip().name : null,
        last: u.lastAuthoredStrike || null,
        equip: u.equipmentState?.state || null,
        thorPercent: b.percent ?? null,
        q
      });
    }
    return { rows, bones: bones.map(bone => bone.name) };
  };
});
await page.locator('canvas').first().click({ position: { x: 340, y: 230 }, force: true });

const settle = () => page.evaluate(() => {
  const f = window.fighters[0], b = window.fighters[1];
  f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0; f.hitLag = 0; f.comboWindow = 0; f.comboStep = 0;
  f.isGrounded = true; f.position.y = 0; f.velocity?.set?.(0, 0, 0);
  b.hitstun = 0; b.percent = 0; b.velocity?.set?.(0, 0, 0); b.position.set(1.15, 0, 0);
  const u = f.model.userData; u.authoredStrikeTime = 0; u.authoredStrikeAction = null;
});

const angle = (a, b) => {
  if (!a || !b) return 0;
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += a[i] * b[i];
  dot = Math.min(1, Math.abs(dot));
  return +(2 * Math.acos(dot) * 180 / Math.PI).toFixed(1);
};

const actions = [
  { name: 'light-combo', taps: 5, keys: 'j x5', press: 'j' },
  { name: 'heavy', keys: 'Shift+j', run: true, press: 'j' },
  { name: 'heavyLauncher', keys: 'Shift+w+j', run: true, up: true, press: 'j' },
  { name: 'heavySlam', keys: 'Shift+s+j', run: true, down: true, press: 'j' },
  { name: 'air', keys: 'airborne+j', airborne: true, press: 'j' },
  { name: 'airFinisher', keys: 'airborne+j x3', airborne: true, taps: 3, press: 'j' },
  { name: 'rasengan', keys: 'h', press: 'h' },
  { name: 'shadowClone', keys: 'l', press: 'l' },
  { name: 'special', keys: 'k', press: 'k' }
];

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const results = [];
for (const action of actions) {
  if (only && !only.has(action.name)) continue;
  await settle();
  await page.evaluate(() => window.__draw(1, {}));
  const before = await page.evaluate(() => ({ percent: window.fighters[1].percent ?? 0 }));
  if (action.run) {
    // Shift is edge-triggered as `dodge` and held as `run`: pressing it and J together dodged away
    // from the target before the heavy could land. Hold it, let the one-shot dodge finish, re-pin
    // both fighters, then attack while `run` is still held.
    await page.keyboard.down('Shift');
    await page.evaluate(() => window.__draw(3, { holdGround: true }));
    await page.evaluate(() => {
      const f = window.fighters[0], b = window.fighters[1];
      f.position.set(0, 0, 0); f.velocity?.set?.(0, 0, 0);
      b.position.set(1.15, 0, 0); b.velocity?.set?.(0, 0, 0);
    });
  }
  if (action.up) await page.keyboard.down('w');
  if (action.down) await page.keyboard.down('s');
  let res = { rows: [], bones: [] };
  const taps = action.taps || 1;
  for (let tap = 0; tap < taps; tap++) {
    await page.evaluate(a => { const f = window.fighters[0]; f.isGrounded = !a; f.position.y = a ? 3 : 0; f.velocity?.set?.(0, 0, 0); }, !!action.airborne);
    await page.keyboard.press(action.press);
    const part = await page.evaluate(o => window.__draw(o.frames, o), {
      frames: action.taps > 1 ? (tap < taps - 1 ? 2 : 8) : 8,
      airborne: !!action.airborne, holdGround: !action.airborne, hold: !process.env.NO_HOLD && tap === taps - 1,
      camera: tap === taps - 1, distance: 2.9, yaw: 26
    });
    res.rows.push(...part.rows);
    if (part.bones?.length) res.bones = part.bones;
  }
  if (action.up) await page.keyboard.up('w');
  if (action.down) await page.keyboard.up('s');
  if (action.run) await page.keyboard.up('Shift');
  const after = await page.evaluate(() => ({ percent: window.fighters[1].percent ?? 0 }));
  const recovery = await page.evaluate(() => window.__draw(4, {}));
  const rest = res.rows[0]?.q || {};
  let top = { bone: null, deg: 0 };
  for (const boneName of res.bones) {
    let max = 0;
    for (const row of res.rows) max = Math.max(max, angle(rest[boneName], row.q?.[boneName]));
    if (max > top.deg) top = { bone: boneName, deg: max };
  }
  results.push({
    name: action.name, keys: action.keys,
    ids: [...new Set(res.rows.map(r => r.moveId).filter(Boolean))],
    clips: [...new Set(res.rows.map(r => r.strike || r.clip).filter(Boolean))],
    selected: res.rows.map(r => r.last).filter(Boolean).pop() || null,
    topBone: top,
    bonesSampled: res.bones.length,
    thorPercentDelta: +((after.percent || 0) - (before.percent || 0)).toFixed(1),
    equip: [...new Set(res.rows.map(r => r.equip).filter(Boolean))],
    recoveryClip: recovery.rows.map(r => r.clip).filter(Boolean).pop() || null
  });
}

const ult = await page.evaluate(async () => {
  const m = await import('/js/combat/ultimate.js');
  const f = window.fighters[0];
  f.casting = null; f.hitstun = 0; f.attackQueue.length = 0;
  f.meter = 0;
  const atZero = m.canUltimate(f);
  f.meter = m.ULTIMATE.max;
  const atFull = m.canUltimate(f);
  return { max: m.ULTIMATE.max, atZero, atFull, refusals: m.ULTIMATE_REFUSAL };
});
await page.keyboard.press('o');
const drawn = await page.evaluate(() => window.__draw(5, {}));
const ultDispatch = {
  clips: drawn.rows.map(r => r.clip).filter(Boolean),
  meterAfter: await page.evaluate(() => +Number(window.fighters[0].meter || 0).toFixed(1)),
  casting: await page.evaluate(() => window.fighters[0].casting || null),
  ultimate: await page.evaluate(() => window.fighters[0].ultimateDef?.label || null)
};

await writeFile(`${out}/naruto-actions.json`, JSON.stringify({ generatedAt: new Date().toISOString(), results, ultimate: { ...ult, dispatch: ultDispatch }, errors }, null, 2));
for (const r of results) console.log('ACTION', JSON.stringify(r));
console.log('ULTIMATE', JSON.stringify({ ...ult, dispatch: ultDispatch }));
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close(); server.close();
