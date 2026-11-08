// Live Infantry evidence: normal roster select, exact asset stats, locomotion, attacks, reactions,
// knockdown/get-up, victory/defeat, camera coverage and software-renderer performance.
//
// The pose captures use the game's own test pause (`__browserSmashSetPaused`), the same flag the
// pause menu uses, so the frame is the one the probe measured instead of a later frame after the
// strike has recovered. It does not change gameplay, assets or maps.
//
//   bash scripts/run-browser-test.sh scripts/capture-infantry-live-states.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-live';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 240)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-80)}`); });

const bootStart = Date.now();
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
const bootMs = Date.now() - bootStart;
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
await page.evaluate(() => {
  document.querySelector('#selectScreen [data-side="p1"]').click();
  document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
  document.querySelector('#selectScreen [data-side="p2"]').click();
  document.querySelector('#selectScreen [data-fighter="Goku"]').click();
});
const mountStart = Date.now();
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.importedStrikes?.infantry?.status === 'ready'
  && window.__browserSmashAssets?.importedReactions?.infantry?.status === 'ready', null, { timeout: 120000, polling: 250 });
const mountMs = Date.now() - mountStart;
await page.waitForTimeout(1200);
await page.evaluate(() => document.activeElement?.blur?.());
await page.mouse.click(640, 420);

// Freeze only the opponent's decisions; its body, damage, hitstun and knockback stay live.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = {
    left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false,
    attack: false, special: false, special2: false, special3: false, grab: false, dodge: false,
    shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false,
    webSwing: false, vertical: 0
  };
  window.__liveIdle = idle;
  if (!p2.__liveProbeSim) {
    p2.__liveProbeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__liveProbeSim(dt, { getInputs: () => ({ ...idle }) });
  }
  window.__livePlace = (dist = 1.2) => {
    p1.position.set(0, 0, 0); p2.position.set(dist, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
    p1.attackPose = 0;
    p1.hitstun = 0; p1.guardBreak = 0; p1.isGrounded = true; p1.ko = false;
    p1.victoryPose = 0; p1.model.userData.wasKnockedDown = false; p1.model.userData.getUpTime = 0;
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0; p2.ko = false;
  };
  window.__liveReset = () => {
    window.__livePlace();
    const p1 = window.fighters[0];
    p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0;
    p1.model.userData.lastAuthoredStrike = null;
  };
  window.__liveState = () => {
    const f = window.fighters[0];
    const u = f.model?.userData || {};
    const running = (u.humanMixer?._actions || []).filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
      .map(a => ({ clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2) }));
    return {
      clips: running, action: running.map(a => a.clip).join('+') || null,
      activeMoveId: f.activeMoveId || null, lastStrike: u.lastAuthoredStrike || null,
      speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(2), grounded: !!f.isGrounded,
      hitstun: +(f.hitstun || 0).toFixed(2),
      y: +f.position.y.toFixed(2), percent: +f.percent.toFixed(2), opponentPercent: +window.fighters[1].percent.toFixed(2)
    };
  };
});

const step = frames => page.evaluate(n => window.__browserSmashStep(n / 60), frames);
const place = (dist = 1.2) => page.evaluate(d => window.__livePlace(d), dist);
const state = () => page.evaluate(() => window.__liveState());
const spectate = () => page.evaluate(() => window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', yaw: 180, pitch: 4 }));
const fps = async ms => {
  const before = await page.evaluate(() => window.__browserSmashFrames || 0);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.__browserSmashFrames || 0);
  return +( (after - before) / (ms / 1000) ).toFixed(1);
};

const captures = [];
const snap = async (file, label) => {
  const current = await state();
  await page.evaluate(() => window.__browserSmashSetPaused(true));
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${file}.png` });
  await page.evaluate(() => window.__browserSmashSetPaused(false));
  captures.push({ file, label, state: current });
  console.log('SHOT ' + file + ' · ' + label + ' · ' + JSON.stringify(current));
  return current;
};

// ---- body / roster / weapon / skeleton ------------------------------------------------
const body = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  let skinned = 0; let meshes = 0; let triangles = 0; let vertices = 0;
  const textures = new Set(); const maps = new Set(); const bones = [];
  f.model.traverse(n => {
    if (n.isBone) bones.push({ name: n.name, parent: n.parent?.isBone ? n.parent.name : (n.parent?.name || null) });
    if (n.isSkinnedMesh) skinned += 1;
    if (!n.isMesh) return;
    meshes += 1;
    const g = n.geometry;
    vertices += g?.getAttribute?.('position')?.count || 0;
    triangles += (g?.index ? g.index.count : g?.getAttribute?.('position')?.count || 0) / 3;
    for (const mat of (Array.isArray(n.material) ? n.material : [n.material])) {
      if (!mat) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        if (mat[key]?.image) { textures.add(mat[key].uuid); maps.add(key); }
      }
    }
  });
  let weaponMeshes = 0;
  u.equippedWeaponRight?.traverse(n => { if (n.isMesh) weaponMeshes += 1; });
  const parentNames = new Set(bones.map(b => b.name));
  const roots = bones.filter(b => !b.parent || !parentNames.has(b.parent));
  return {
    identity: f.identity, identityKey: f.identityKey,
    asset: u.characterAssetUrl || null,
    triangles: Math.round(triangles), vertices, meshes, skinned,
    bones: bones.length, roots, boneNames: bones.map(b => b.name),
    textures: textures.size, maps: [...maps],
    clipsFromModel: Object.keys(u.animationActions || {}),
    strikeClips: Object.keys(u.importedStrikeActions || {}),
    weaponKind: u.weaponKind || null, weaponLabel: u.weaponLabel || null,
    weaponName: u.equippedWeaponRight?.name || null, weaponMeshes
  };
});
console.log('BODY ' + JSON.stringify(body));
const fpsIdle = await fps(3000);

// ---- locomotion -----------------------------------------------------------------------
await spectate();
await place();
await page.waitForTimeout(700);
await snap('01-idle', 'authored idle');

await page.keyboard.down('d');
await step(24);
const walk = await snap('02-walk', 'walking');
await page.keyboard.up('d');

await place();
await page.keyboard.down('d');
await step(12);
await page.keyboard.down('Shift');
await step(60);
const run = await snap('03-run', 'running');
await page.keyboard.up('Shift');
await page.keyboard.up('d');

await place();
await page.keyboard.press('Space');
await step(8);
const jump = await snap('04-jump', 'jumping');
let land = null;
for (let i = 0; i < 90; i += 1) {
  await step(2);
  const s = await state();
  if (s.clips.some(c => /land/i.test(c.clip))) { land = s; break; }
}
if (land) await snap('05-landing', 'landing');
else await snap('05-landing', 'landing (not observed)');

// ---- attacks through the real keyboard path, frozen at contact -------------------------
const pressAttack = async (kind, preserveCombo = false) => {
  if (preserveCombo) await place(1.3);
  else await page.evaluate(() => window.__liveReset());
  await page.waitForTimeout(250);
  if (kind === 'heavy') await page.keyboard.down('Shift');
  if (kind === 'launcher') { await page.keyboard.down('Shift'); await page.keyboard.down('w'); }
  if (kind === 'aerial') { await page.keyboard.press('Space'); await step(9); await place(1.5); }
  await page.keyboard.down('j'); await step(2); await page.keyboard.up('j');
  let progress = null;
  for (let i = 0; i < 36; i += 1) {
    progress = await page.evaluate(() => {
      const q = window.fighters[0].attackQueue[0];
      return q ? q.t / (q.total || 1) : null;
    });
    if (progress === null || progress >= 0.45) break;
    await step(1);
  }
  const current = await state();
  if (kind === 'heavy' || kind === 'launcher') await page.keyboard.up('Shift');
  if (kind === 'launcher') await page.keyboard.up('w');
  return { progress, current };
};

// One-hit Rifle Butt.
let before = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
let attack = await pressAttack('light');
const rifle = await snap('06-rifle-butt', 'Rifle Butt contact');
const afterRifle = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));

// Second light in the string: Combat Cross.
await page.evaluate(() => window.__liveReset());
await page.waitForTimeout(250);
await page.keyboard.down('j'); await step(2); await page.keyboard.up('j'); await step(28); await place(1.3);
attack = await pressAttack('light', true);
const cross = await snap('07-combat-cross', 'Combat Cross contact');
const afterCross = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));

// Third light in the string: Boot Kick.
await page.evaluate(() => window.__liveReset());
await page.waitForTimeout(250);
for (let i = 0; i < 2; i += 1) {
  await page.keyboard.down('j'); await step(2); await page.keyboard.up('j'); await step(28); await place(1.3);
}
attack = await pressAttack('light', true);
const kick = await snap('08-boot-kick', 'Boot Kick contact');
const afterKick = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));

// ---- reaction states, driven in the live match ---------------------------------------
// Let the last strike finish and the mixer settle before forcing the reaction branches; otherwise
// the still-decaying strike pose dominates the first few frames and the capture is not the state
// it claims to be.
await step(80);
await page.waitForTimeout(300);

// Drive the real state branch until its authored action owns the pose, reasserting the state each
// frame so a landing or round reset cannot clear the state before the crossfade completes.
const driveState = mode => page.evaluate((mode) => {
  const p1 = window.fighters[0];
  const u = p1.model.userData;
  const target = {
    hit: /Infantry_hit_/, knockdown: /Infantry_knockdown/, getup: /Infantry_get_up/,
    victory: /Infantry_victory/, defeat: /Infantry_defeat/
  }[mode];
  const readActive = () => (u.humanMixer?._actions || [])
    .filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
    .map(a => ({ clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2) }));
  for (let frame = 0; frame < 120; frame += 1) {
    p1.attackQueue.length = 0; p1.hitboxes.length = 0; p1.attackPose = 0;
    p1.victoryPose = 0; p1.ko = false; p1.hitstun = 0; p1.isGrounded = true;
    if (mode === 'hit') p1.hitstun = 0.6;
    if (mode === 'knockdown') { p1.hitstun = 1.2; p1.isGrounded = false; p1.position.y = 1.2; p1.velocity.set(0, 0, 0); }
    if (mode === 'getup') { p1.position.y = 0; p1.velocity.set(0, 0, 0); p1.model.userData.wasKnockedDown = true; }
    if (mode === 'victory') { p1.position.y = 0; p1.velocity.set(0, 0, 0); p1.victoryPose = 1; p1.model.userData.getUpTime = 0; p1.model.userData.wasKnockedDown = false; }
    if (mode === 'defeat') { p1.position.y = 0; p1.velocity.set(0, 0, 0); p1.ko = true; p1.model.userData.getUpTime = 0; p1.model.userData.wasKnockedDown = false; }
    window.__browserSmashStep(1 / 60);
    const active = readActive();
    if (active.some(a => target.test(a.clip) && a.weight >= 0.5)) {
      return { mode, found: true, frames: frame + 1, active };
    }
  }
  return { mode, found: false, frames: 120, active: readActive() };
}, mode);

// A real P2 attack on Infantry: the opponent's body and combat resolver stay live, so hitstun and
// knockback come from the same path a player hit uses. P2 is only given an attack input; it is not
// teleported into a damage event.
await page.evaluate(() => window.__livePlace(1.0));
await page.evaluate(() => {
  const p2 = window.fighters[1];
  if (!p2.__liveProbeSim) p2.__liveProbeSim = p2.simulate.bind(p2);
  let frames = 6;
  p2.simulate = dt => p2.__liveProbeSim(dt, { getInputs: () => ({ ...window.__liveIdle, attack: frames-- > 0 }) });
});
let hitInfo = null;
for (let i = 0; i < 50; i += 1) {
  await step(1);
  hitInfo = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { hitstun: +(p1.hitstun || 0).toFixed(2), percent: +p1.percent.toFixed(2), speed: +Math.hypot(p1.velocity.x, p1.velocity.y, p1.velocity.z).toFixed(2) };
  });
  if (hitInfo.hitstun > 0 || hitInfo.percent > 0) break;
}
await page.evaluate(() => {
  const p2 = window.fighters[1];
  p2.simulate = dt => p2.__liveProbeSim(dt, { getInputs: () => ({ ...window.__liveIdle }) });
});
const hitReaction = await snap('09-hit-reaction', 'hitstun / knockback');
const hitKnockback = hitReaction.speed;

await page.evaluate(() => window.__livePlace(1.2));
const knockdownDrive = await driveState('knockdown');
const knockdown = await snap('10-knockdown', 'knockdown');

const getUpDrive = await driveState('getup');
const getUp = await snap('11-get-up', 'get-up');

const victoryDrive = await driveState('victory');
const victory = await snap('12-victory', 'victory');

const defeatDrive = await driveState('defeat');
const defeat = await snap('13-defeat', 'defeat');

const fpsCombat = await fps(2000);

// ---- report --------------------------------------------------------------------------
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
check('normal roster mounts the exact imported GLB', /infantry_cc0\.glb/.test(body.asset || ''), body.asset);
check('one skinned mesh with the imported 24-bone skeleton', body.skinned === 1 && body.bones === 24, JSON.stringify({ skinned: body.skinned, bones: body.bones, roots: body.roots }));
check('the skeleton has a single connected root', body.roots.length === 1, JSON.stringify(body.roots));
check('embedded PBR maps are applied', body.textures >= 3 && body.maps.includes('map') && body.maps.includes('normalMap'), JSON.stringify({ textures: body.textures, maps: body.maps }));
check('idle uses the authored Infantry idle', captureCheck(captures, '01-idle', /Infantry_idle/), JSON.stringify(captureState(captures, '01-idle')));
check('walk uses the imported walk clip', captureCheck(captures, '02-walk', /(^|\+)walk($|\+)/), JSON.stringify(captureState(captures, '02-walk')));
check('run uses the imported run clip', captureCheck(captures, '03-run', /(^|\+)run($|\+)/), JSON.stringify(captureState(captures, '03-run')));
check('jump uses the authored jump clip', captureCheck(captures, '04-jump', /Infantry_jump/), JSON.stringify(captureState(captures, '04-jump')));
check('landing uses the authored land clip', captureCheck(captures, '05-landing', /Infantry_land/), JSON.stringify(captureState(captures, '05-landing')));
check('Rifle Butt plays and damages', (rifle.lastStrike?.clip === 'Infantry_RifleButt' || rifle.activeMoveId === 'light1') && afterRifle > before, JSON.stringify({ observed: rifle.lastStrike, before, afterRifle }));
check('Combat Cross plays and damages', (cross.lastStrike?.clip === 'Infantry_CombatCross' || /light2/.test(cross.activeMoveId || '')) && afterCross > 0, JSON.stringify({ observed: cross.lastStrike, afterCross }));
check('Boot Kick plays and damages', (kick.lastStrike?.clip === 'Infantry_BootKick' || /light3/.test(kick.activeMoveId || '')) && afterKick > 0, JSON.stringify({ observed: kick.lastStrike, afterKick }));
check('hitstun selects an authored hit reaction', /Infantry_hit_/.test(captureState(captures, '09-hit-reaction')?.action || ''), JSON.stringify(captureState(captures, '09-hit-reaction')));
check('a real P2 hit applies hitstun and knockback to Infantry', (hitReaction.hitstun || 0) > 0 && hitKnockback > 0, JSON.stringify({ hitInfo, capture: hitReaction }));
check('knockdown selects the authored knockdown clip', /Infantry_knockdown/.test(captureState(captures, '10-knockdown')?.action || ''), JSON.stringify(captureState(captures, '10-knockdown')));
check('get-up selects the authored get-up clip', /Infantry_get_up/.test(captureState(captures, '11-get-up')?.action || ''), JSON.stringify(captureState(captures, '11-get-up')));
check('victory selects the authored victory clip', /Infantry_victory/.test(captureState(captures, '12-victory')?.action || ''), JSON.stringify(captureState(captures, '12-victory')));
check('defeat selects the authored defeat clip', /Infantry_defeat/.test(captureState(captures, '13-defeat')?.action || ''), JSON.stringify(captureState(captures, '13-defeat')));
check('no page errors', errors.length === 0, errors.join(' | '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

function captureState(list, file) { return list.find(c => c.file === file)?.state || null; }
function captureCheck(list, file, re) { const s = captureState(list, file); return Boolean(s && re.test(s.action || '')); }

const report = {
  bootMs, mountMs, fpsIdle, fpsCombat, body, captures,
  combat: { before, afterRifle, afterCross, afterKick, hitKnockback },
  checks, errors, failedRequests,
  notes: [
    'Captured under Chromium SwiftShader; these are composition/state evidence, not hardware performance.',
    'Knockdown/get-up and victory/defeat were triggered by setting the live match state (the game branch that owns the authored clip), not by playing a full round to natural KO.',
    'Weapon geometry is reported separately; the HUD says rifle but the equipped prop must be judged from weaponKind/weaponLabel.'
  ]
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
