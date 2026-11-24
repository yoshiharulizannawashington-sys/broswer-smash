// Infantry's six attacks, verified as ANIMATION in the running game.
//
// Three separate kinds of evidence, because this harness runs on a software renderer at a couple of
// frames per second and any single measurement would be misleading:
//
//  1. Wiring. Every moveset slot the animator can select from is bound to the six authored clips.
//  2. Live play, through the real keyboard path. Strings are advanced in pure simulation steps, so
//     the combo window (which counts simulation time) behaves as it does at 60 fps, and the animator
//     — which only runs in requestAnimationFrame — is given real frames while the measured attack is
//     playing. A write-time log on the animator's strike record captures the clip it selected, and
//     the combat resolver's damage is read from the live fighters. Because this renderer can drop a
//     frame across an entire short attack, a measurement that records nothing is retried; a recorded
//     wrong clip is never retried away.
//  3. Skeletal motion, on the live mounted rig. Each clip is bound to Infantry's own skeleton through
//     a throwaway mixer and sampled across its duration, measuring bone travel without depending on
//     frame rate. That is the proof the body performs the attack, not the renderer.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-attack-animations.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-anim';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
page.setDefaultTimeout(150000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-70)}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 20000, polling: 200 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Infantry"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });

const bindReport = await page.waitForFunction(() => {
  const report = window.__browserSmashAssets?.importedStrikes?.infantry;
  return report && report.status !== 'loading' ? report : null;
}, null, { timeout: 90000, polling: 250 }).then(handle => handle.jsonValue()).catch(() => null);
check('the six imported strike clips bind to the mounted rig',
  bindReport?.status === 'ready' && bindReport?.bound?.length >= 8,
  JSON.stringify(bindReport && { status: bindReport.status, clips: bindReport.clips, bound: bindReport.bound?.length }));

const slotMap = await page.evaluate(() => {
  const actions = window.fighters[0]?.model?.userData?.importedStrikeActions || {};
  const map = {};
  for (const [slot, action] of Object.entries(actions)) map[slot] = action?.getClip?.()?.name || null;
  return map;
});
check('every melee slot the animator selects from is wired to its own clip',
  slotMap.light1 === 'Infantry_RifleButt' && slotMap.light2 === 'Infantry_CombatCross' &&
  slotMap.light3 === 'Infantry_BootKick' && slotMap.heavy === 'Infantry_ArmourBreaker' &&
  slotMap.heavyLauncher === 'Infantry_StockSlam' && slotMap.air === 'Infantry_JumpKnee',
  JSON.stringify(slotMap));

// The round opens with a countdown that swallows input.
await page.waitForTimeout(1800);

await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  if (!p2.__animProbeSim) {
    p2.__animProbeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__animProbeSim(dt, { getInputs: () => ({ ...idle, shield: false }) });
  }
  const bones = {};
  p1.model.traverse(node => { if (node.isBone) bones[node.name] = node; });
  window.__probeBones = bones;
  window.__probeLog = [];
  // Record every strike the animator selects, at write time. The animator only runs in RAF frames,
  // so polling its record from outside can miss a short strike entirely.
  const userData = p1.model.userData || (p1.model.userData = {});
  let shadow = null;
  Object.defineProperty(userData, 'lastAuthoredStrike', {
    configurable: true,
    enumerable: true,
    get: () => shadow,
    set: value => {
      shadow = value;
      if (value && value.clip) window.__probeLog.push({ clip: value.clip, slot: value.slot, id: value.id, at: value.at });
    }
  });
  // Put both fighters back on the line. Holding a sprint key walks the fighter off the mark, so the
  // spacing is re-established immediately before the press, as a player's spacing would be.
  window.__probePlace = (dist = 1.2) => {
    p1.position.set(0, 0, 0); p2.position.set(dist, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100;
    if (p1.model?.userData) p1.model.userData.lastAuthoredStrike = null;
  };
  window.__probeReset = (dist = 1.2) => {
    p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
    p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0; p1.attackPose = 0;
    p1.hitstun = 0; p1.guardBreak = 0; p1.isGrounded = true; p1.ko = false;
    p1.dodgeTimer = 0; p1.dashTimer = 0;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0; p2.ko = false; p2.percent = 0; p2.hitstun = 0;
    window.__browserSmashCombatEvents = [];
    window.__probePlace(dist);
  };
  // Bind a strike clip to Infantry's own skeleton through a throwaway mixer and sample the pose
  // across the whole clip. Independent of render frame rate, and it uses the live mounted rig.
  window.__probeClipTravel = (clipName, boneNames) => {
    const u = p1.model?.userData || {};
    const actions = u.importedStrikeActions || {};
    const entry = Object.values(actions).find(action => action?.getClip?.().name === clipName);
    if (!entry) return null;
    const clip = entry.getClip();
    const Mixer = entry.getMixer().constructor;
    const temp = new Mixer(p1.model);
    const action = temp.clipAction(clip);
    action.play();
    action.paused = true;
    const point = name => {
      const bone = bones[name];
      bone.updateWorldMatrix(true, false);
      const e = bone.matrixWorld.elements;
      return [e[12], e[13], e[14]];
    };
    const spread = samples => {
      let max = 0;
      for (const p of samples) max = Math.max(max, Math.hypot(p[0] - samples[0][0], p[1] - samples[0][1], p[2] - samples[0][2]));
      return +max.toFixed(3);
    };
    const steps = 16;
    const samples = {};
    for (const name of Object.keys(bones)) samples[name] = [];
    for (let i = 0; i <= steps; i += 1) {
      action.time = Math.min((clip.duration * i) / steps, clip.duration - 1e-4);
      temp.update(0);
      for (const name of Object.keys(bones)) samples[name].push(point(name));
    }
    const travel = {};
    for (const name of Object.keys(bones)) travel[name] = spread(samples[name]);
    const maxBone = Object.values(travel).reduce((a, b) => Math.max(a, b), 0);
    temp.stopAllAction();
    temp.uncacheRoot(p1.model);
    return { clip: clip.name, duration: +clip.duration.toFixed(3), strike: boneNames.map(name => travel[name] || 0), maxBone: +maxBone.toFixed(3) };
  };
});

const stepSim = (frames) => page.evaluate(n => window.__browserSmashStep(n / 60), frames);
const reset = (dist = 1.2) => page.evaluate(d => window.__probeReset(d), dist);
const place = (dist = 1.2) => page.evaluate(d => window.__probePlace(d), dist);
const percent = () => page.evaluate(() => +window.fighters[1].percent.toFixed(2));
const logLength = () => page.evaluate(() => window.__probeLog.length);
const logAt = (index) => page.evaluate(i => window.__probeLog[i] || null, index);
// Key down -> step the input layer -> key up. A bare press can start and finish between two frames of
// this software renderer, and the input layer would never observe it as held.
const press = async (key) => { await page.keyboard.down(key); await stepSim(2); await page.keyboard.up(key); };
const waitFrame = (ms = 500) => page.waitForTimeout(ms);

const BONES = {
  light1: ['RightHand'],
  light2: ['RightHand', 'LeftHand'],
  light3: ['RightFoot', 'RightLeg'],
  armourBreaker: ['RightHand'],
  stockSlam: ['RightHand'],
  jumpKnee: ['LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']
};

/**
 * Run `prep` to set up the attack, then `fire` it and capture the clip the animator selects for it.
 * A measurement that sees no selection at all means this renderer dropped every frame across the
 * attack, so the attack is replayed; a recorded selection is final, even if it is the wrong clip.
 */
const measure = async ({ prep, fire, settleFrames = 60, tries = 4 }) => {
  let last = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    await prep();
    const mark = await logLength();
    const before = await percent();
    await fire();
    let entry = null;
    for (let poll = 0; poll < 8 && !entry; poll += 1) {
      await waitFrame(150);
      entry = await logAt(mark);
    }
    await stepSim(settleFrames);
    last = { strike: entry?.clip || null, slot: entry?.slot || null, id: entry?.id || null, attempts: attempt, damage: +((await percent()) - before).toFixed(2) };
    if (entry) return last;
  }
  return last;
};

const results = {};

// Burn any one-shot input gating left from the round start, so the first measured press is not the
// first press the match ever sees.
await press('j');
await stepSim(70);
await waitFrame(400);

const neutral = (dist = 1.2) => async () => {
  await reset(dist);
  // Clearing the queue directly leaves `wasAttacking` latched from the previous strike, and the
  // animator only selects a new strike on the attacking -> not-attacking edge. One real frame with
  // an empty queue re-arms it, exactly as it does between two attacks in normal play.
  await waitFrame(450);
  await place(dist);
};
const stringPrefix = async (hits, dist = 1.2) => {
  for (let i = 0; i < hits; i += 1) {
    await press('j');
    await stepSim(26);
    await place(dist);
  }
};

// --- the J-J-J string, each hit measured on its own run of the same string ---------------------
results.light1 = await measure({ prep: neutral(1.2), fire: () => press('j') });
await page.screenshot({ path: `${out}/1-rifle-butt.png` });

results.light2 = await measure({
  prep: async () => { await neutral(1.2)(); await stringPrefix(1); },
  fire: () => press('j')
});
await page.screenshot({ path: `${out}/2-combat-cross.png` });

results.light3 = await measure({
  prep: async () => { await neutral(1.2)(); await stringPrefix(2); },
  fire: () => press('j')
});
await page.screenshot({ path: `${out}/3-boot-kick.png` });

// --- Armour Breaker (neutral heavy) ------------------------------------------------------------
results.armourBreaker = await measure({
  prep: async () => {
    await neutral(1.3)();
    await page.keyboard.down('Shift');
    await stepSim(24);
    await place(1.3);
  },
  fire: async () => { await press('j'); await page.keyboard.up('Shift'); },
  settleFrames: 90
});
await page.screenshot({ path: `${out}/4-armour-breaker.png` });

// --- Stock Slam (up + heavy) -------------------------------------------------------------------
results.stockSlam = await measure({
  prep: async () => {
    await neutral(1.4)();
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await stepSim(24);
    await place(1.4);
  },
  fire: async () => { await press('j'); await page.keyboard.up('w'); await page.keyboard.up('Shift'); },
  settleFrames: 100
});
await page.screenshot({ path: `${out}/5-stock-slam.png` });

// --- Jump Knee (aerial) ------------------------------------------------------------------------
results.jumpKnee = await measure({
  prep: async () => {
    await reset(1.4);
    await waitFrame(450);
    await place(1.4);
    await page.keyboard.down('Space');
    await stepSim(2);
    await page.keyboard.up('Space');
    await stepSim(9);
  },
  fire: () => press('j'),
  settleFrames: 50
});
await page.screenshot({ path: `${out}/6-jump-knee.png` });

// --- settle back into locomotion ----------------------------------------------------------------
await reset();
await press('j');
await stepSim(180);
await waitFrame(700);
results.afterRecovery = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  return { clip: u.currentClip || null, queued: f.attackQueue.length, grounded: f.isGrounded, y: +f.position.y.toFixed(2) };
});

// --- assertions --------------------------------------------------------------------------------
const STRIKES = {
  light1: 'Infantry_RifleButt',
  light2: 'Infantry_CombatCross',
  light3: 'Infantry_BootKick',
  armourBreaker: 'Infantry_ArmourBreaker',
  stockSlam: 'Infantry_StockSlam',
  jumpKnee: 'Infantry_JumpKnee'
};
const rig = {};
for (const [key, clip] of Object.entries(STRIKES)) {
  const result = results[key];
  check(`${key} selects its own clip`, result.strike === clip, JSON.stringify({ selected: result.strike || null, slot: result.slot || null, id: result.id || null, attempts: result.attempts }));
  rig[clip] = await page.evaluate(([name, b]) => window.__probeClipTravel(name, b), [clip, BONES[key]]);
  const moved = rig[clip];
  const strikeTravel = moved ? Math.max(...moved.strike) : 0;
  check(`${key} drives the mounted skeleton`,
    Boolean(moved) && strikeTravel >= 0.05 && moved.maxBone >= 0.10,
    JSON.stringify(moved && { clip: moved.clip, bones: BONES[key], strikeTravel, maxBoneTravel: moved.maxBone, duration: moved.duration }));
  check(`${key} still resolves damage`, result.damage > 0, 'damage=' + result.damage);
}
check('the six clips are distinct animations, not one shared clip',
  new Set(Object.values(rig).map(entry => entry && `${entry.duration}:${entry.maxBone}`)).size === 6,
  JSON.stringify(Object.values(rig).map(entry => entry && { clip: entry.clip, duration: entry.duration, maxBone: entry.maxBone })));
check('the J-J-J string plays Rifle Butt, Combat Cross, Boot Kick in order',
  [results.light1, results.light2, results.light3].map(entry => entry.strike).join() === 'Infantry_RifleButt,Infantry_CombatCross,Infantry_BootKick' &&
  [results.light2.id, results.light3.id].join() === 'light2,light3',
  JSON.stringify([results.light1, results.light2, results.light3].map(entry => [entry.id || null, entry.strike || null, entry.damage])));
check('the string damages on every hit',
  results.light1.damage > 0 && results.light2.damage > 0 && results.light3.damage > 0,
  JSON.stringify([results.light1.damage, results.light2.damage, results.light3.damage]));
check('after the strike the body returns to locomotion',
  // Recovery now lands on the authored reaction idle, so assert a rest clip rather than
  // "not an imported clip": the imported clip IS locomotion here.
  results.afterRecovery.queued === 0 && /idle/i.test(String(results.afterRecovery.clip || '')) && results.afterRecovery.grounded,
  JSON.stringify(results.afterRecovery));
check('no page errors', errors.length === 0, errors.join(' | '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

await writeFile(`${out}/animations.json`, JSON.stringify({ bindReport, slotMap, results, rig, checks, errors, failedRequests }, null, 2));
const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
