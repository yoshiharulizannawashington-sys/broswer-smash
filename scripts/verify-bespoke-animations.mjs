// Bespoke Superman / Goku / Spider-Man animation verification.
//
//   bash scripts/run-browser-test.sh scripts/verify-bespoke-animations.mjs
//
// A clip name in a manifest is not an animation. Every check below reads the live mounted body:
// the imported GLB must bind, the resolved move must select the authored slot, the action must be
// running on the fighter's own mixer, and the hand/foot/head bones must actually travel. Timing is
// compared across the three fighters so the set cannot be three renamed copies of one table.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/bespoke-animations';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.wasm': 'application/wasm' };
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

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));

const KITS = {
  superman: { label: 'Superman', prefix: 'Superman_', durations: { Jab: .833, Kick: 1.083, Heavy: 1.333, Air: 1.083, Special: 1.333 } },
  goku: { label: 'Goku', prefix: 'Goku_', durations: { Jab: .417, Kick: .667, Heavy: .917, Air: .750, Special: 1.167 } },
  spider_man: { label: 'Spider-Man', prefix: 'SpiderMan_', durations: { Jab: .375, Kick: .583, Heavy: .750, Air: .667, Special: .667 } }
};
const BESPOKE_ONLY = (process.env.BESPOKE_ONLY || '').split(',').map(part => part.trim()).filter(Boolean);
const order = ['superman', 'goku', 'spider_man'].filter(key => !BESPOKE_ONLY.length || BESPOKE_ONLY.includes(key));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter]'), null, { timeout: 30000, polling: 200 });
await page.evaluate(first => {
  document.querySelector('#selectScreen [data-side="p1"]')?.click();
  document.querySelector(`#selectScreen [data-fighter="${first}"]`)?.click();
  document.querySelector('#play')?.click();
}, KITS[order[0]].label);
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForTimeout(1200);

const NEUTRAL = Object.freeze({
  left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false,
  attack: false, special: false, special2: false, special3: false, special4: false, special5: false,
  grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false,
  flightToggle: false, brake: false, webSwing: false, vertical: 0
});

async function stage() {
  await page.evaluate(idle => {
    const [p1, p2] = window.fighters;
    for (const fighter of [p1, p2]) {
      fighter.ko = false;
      fighter.hitstun = 0;
      fighter.guardBreak = 0;
      fighter.guardStun = 0;
      fighter.invulnerable = 0;
      fighter.attackPose = 0;
      fighter.attackQueue.length = 0;
      fighter.attackBuffer = 0;
      fighter.comboStep = 0;
      fighter.comboWindow = 0;
      fighter.comboHitCount = 0;
      fighter.specialCooldown = 0;
      fighter.dodgeTimer = 0;
      fighter.parryTimer = 0;
      fighter.counterWindow = 0;
      fighter.guardHeld = false;
      fighter.guardBreak = 0;
      fighter.airHits = 0;
      fighter.jumps = 0;
      fighter.webSwinging = false;
      fighter.abilityReadyAt = {};
      fighter.abilityLastCast = null;
      fighter.percent = 0;
      fighter.meter = 0;
      fighter.power = 0;
      fighter.hitboxes.length = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.isGrounded = true;
      fighter.position.y = 0;
    }
    p1.position.set(-.8, 0, 0); p2.position.set(.8, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    const u = p1.model.userData;
    u.lastAuthoredStrike = null;
    u.authoredStrikeTime = 0;
    u.authoredStrikeAction = null;
    // Clearing the queue alone is not enough: the animation latch remains true until the next
    // animateHumanFighter call sees an empty queue, and an attack begun inside that gap is never
    // recorded or played. Reset the latch with the state it mirrors.
    u.wasAttacking = false;
    u.attackLock = 0;
    u.proceduralAttackTime = 0;
    u.landingPoseTime = 0;
    u.authoredSpecialTime = 0;
    u.specialPoseTime = 0;
    u.stunPrev = 0;
    u.heavyStun = false;
    u.lastSpecialCooldown = 0;
    u.currentClip = null;
    // The CPU must not turn this into a different exchange while the probe reads P1's pose.
    if (!p2.__bespokeIdle) {
      p2.__bespokeIdle = p2.simulate.bind(p2);
      p2.simulate = dt => p2.__bespokeIdle(dt, { getInputs: () => ({ ...idle }) });
    }
  }, NEUTRAL);
}

async function waitForClip(clip, timeout = 8000) {
  return page.waitForFunction(name => {
    const strike = window.fighters[0]?.model?.userData?.lastAuthoredStrike;
    return strike?.clip === name ? strike : null;
  }, clip, { timeout, polling: 100 }).then(handle => handle.jsonValue()).catch(() => null);
}

async function boneBase() {
  return page.evaluate(() => {
    const model = window.fighters[0].model;
    model.updateMatrixWorld(true);
    const names = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot', 'Head'];
    const out = {};
    model.traverse(node => {
      if (!node.isBone || !names.includes(node.name)) return;
      const point = node.getWorldPosition(node.position.clone());
      out[node.name] = { x: +point.x.toFixed(4), y: +point.y.toFixed(4), z: +point.z.toFixed(4) };
    });
    return out;
  });
}

async function motionTravel(base) {
  return page.evaluate(async starting => {
    const model = window.fighters[0].model;
    const u = model.userData;
    const names = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot', 'Head'];
    const bones = [];
    model.traverse(node => { if (node.isBone && names.includes(node.name)) bones.push(node); });
    let max = 0, peak = null, frames = 0;
    const started = performance.now();
    await new Promise(done => {
      const tick = () => {
        model.updateMatrixWorld(true);
        for (const bone of bones) {
          const point = bone.getWorldPosition(bone.position.clone());
          const from = starting[bone.name];
          if (!from) continue;
          const distance = Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z);
          if (distance > max) { max = distance; peak = bone.name; }
        }
        frames += 1;
        if (frames < 10 && performance.now() - started < 1200) requestAnimationFrame(tick);
        else done();
      };
      tick();
    });
    return {
      travel: +max.toFixed(3), peak, frames,
      clip: u.lastAuthoredStrike?.clip || null,
      currentClip: u.currentClip || null,
      special: u.authoredSpecialAction?.getClip?.().name || null,
      specialTime: +(u.authoredSpecialTime || 0).toFixed(3)
    };
  }, base);
}

async function bindReport(key) {
  return page.evaluate(() => {
    const model = window.fighters[0].model;
    const u = model.userData;
    const actions = u.authoredAbilityActions || {};
    const slots = ['light', 'light1', 'light3', 'heavy', 'air', 'special'];
    const clip = slot => actions[slot]?.getClip?.()?.name || null;
    const duration = slot => +(actions[slot]?.getClip?.()?.duration || 0).toFixed(3);
    const allClips = [...new Set([
      ...Object.values(actions).map(action => action?.getClip?.()?.name),
      u.hitLightAction?.getClip?.()?.name,
      u.hitHeavyAction?.getClip?.()?.name
    ].filter(Boolean))];
    return {
      identity: window.fighters[0].identityKey,
      strikeSet: u.importedStrikeSet || null,
      reactionSet: u.importedReactionSet || null,
      strike: u.importedStrikeReport || null,
      reaction: u.importedReactionReport || null,
      clips: allClips,
      slots: Object.fromEntries(slots.map(slot => [slot, clip(slot)])),
      durations: Object.fromEntries(['Jab', 'Kick', 'Heavy', 'Air', 'Special'].map(name => [name, duration(name === 'Jab' ? 'light' : name === 'Kick' ? 'light3' : name.toLowerCase())])),
      reactions: {
        light: u.hitLightAction?.getClip?.().name || null,
        heavy: u.hitHeavyAction?.getClip?.().name || null
      },
      special: u.authoredSpecialClipId || null,
      importedSpecial: u.importedSpecialAction?.getClip?.().name || null
    };
  });
}

const metrics = {};
for (let index = 0; index < order.length; index += 1) {
  const key = order[index];
  const expected = KITS[key];
  console.log(`\n=== ${key}`);
  if (index > 0) {
    await page.evaluate(async target => {
      const select = document.querySelector('#p1Character');
      if (!select) return false;
      select.value = target;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(done => setTimeout(done, 500));
      return true;
    }, KITS[key].label);
    await page.waitForFunction(target => window.fighters[0]?.identityKey === target, key, { timeout: 20000, polling: 200 });
  }
  // Wait on the match model's bound actions, not the global diagnostic: a menu preview can
  // publish a "ready" report for the same identity and then a second, still-loading match model
  // can overwrite it. The actions below are the object the state machine actually plays.
  await page.waitForFunction(prefix => {
    const u = window.fighters[0]?.model?.userData;
    const actions = u?.authoredAbilityActions || {};
    return actions.light?.getClip?.().name === prefix + 'Jab'
      && actions.light3?.getClip?.().name === prefix + 'Kick'
      && actions.heavy?.getClip?.().name === prefix + 'Heavy'
      && actions.air?.getClip?.().name === prefix + 'Air'
      && u.hitLightAction?.getClip?.().name === prefix + 'HitLight'
      && u.hitHeavyAction?.getClip?.().name === prefix + 'HitHeavy'
      && u.authoredSpecialClipId === prefix + 'Special';
  }, expected.prefix, { timeout: 20000, polling: 200 });
  await page.waitForTimeout(100);

  const bound = await bindReport(key);
  const expectedClips = ['Jab', 'Kick', 'Heavy', 'Air', 'HitLight', 'HitHeavy', 'Special'].map(name => expected.prefix + name);
  check(`${key}: both clip-only GLBs are bound to the mounted body`, bound.strikeSet?.key === key && bound.reactionSet?.key === key,
    JSON.stringify({ strike: bound.strikeSet, reaction: bound.reactionSet }));
  check(`${key}: all seven bespoke clips are bound`, expectedClips.every(name => bound.clips.includes(name)),
    JSON.stringify(bound.clips));
  check(`${key}: every strike slot binds an action`, ['light', 'light1', 'light3', 'heavy', 'air', 'special'].every(slot => bound.slots[slot]),
    JSON.stringify(bound.slots));
  check(`${key}: light resolves to ${expected.prefix}Jab`, bound.slots.light === expected.prefix + 'Jab', String(bound.slots.light));
  check(`${key}: third light resolves to ${expected.prefix}Kick`, bound.slots.light3 === expected.prefix + 'Kick', String(bound.slots.light3));
  check(`${key}: heavy resolves to ${expected.prefix}Heavy`, bound.slots.heavy === expected.prefix + 'Heavy', String(bound.slots.heavy));
  check(`${key}: aerial resolves to ${expected.prefix}Air`, bound.slots.air === expected.prefix + 'Air', String(bound.slots.air));
  check(`${key}: reactions bind to HitLight and HitHeavy`, bound.reactions.light === expected.prefix + 'HitLight' && bound.reactions.heavy === expected.prefix + 'HitHeavy',
    JSON.stringify(bound.reactions));
  check(`${key}: signature is the authored ${expected.prefix}Special`, bound.special === expected.prefix + 'Special' && bound.importedSpecial === expected.prefix + 'Special',
    JSON.stringify({ special: bound.special, imported: bound.importedSpecial }));
  check(`${key}: attached clip durations match the authored tables`, Object.entries(expected.durations).every(([name, value]) => Math.abs(bound.durations[name] - value) < .002),
    JSON.stringify(bound.durations));
  metrics[key] = bound.durations;

  // ---- light: real input, selected slot, mounted bone travel -----------------
  await stage();
  let base = await boneBase();
  await page.keyboard.press('j');
  const lightClip = await waitForClip(expected.prefix + 'Jab');
  const lightMotion = lightClip ? await motionTravel(base) : { travel: 0 };
  check(`${key}: J selects the authored jab on the live fighter`, Boolean(lightClip) && lightClip.slot === 'light1',
    JSON.stringify(lightClip));
  check(`${key}: the jab actually moves the mounted skeleton`, lightClip && lightMotion.travel > .05, JSON.stringify(lightMotion));

  // ---- kick: third light in the string, not a renamed jab --------------------
  await stage();
  base = await boneBase();
  await page.evaluate(() => { const f = window.fighters[0]; f.comboStep = 2; f.comboWindow = 1; });
  await page.keyboard.press('j');
  const kickClip = await waitForClip(expected.prefix + 'Kick');
  const kickMotion = kickClip ? await motionTravel(base) : { travel: 0 };
  check(`${key}: the third light selects the authored kick`, Boolean(kickClip) && kickClip.slot === 'light3',
    JSON.stringify(kickClip));
  check(`${key}: the kick actually moves the mounted skeleton`, kickClip && kickMotion.travel > .05, JSON.stringify(kickMotion));

  // ---- heavy ----------------------------------------------------------------
  await stage();
  base = await boneBase();
  await page.keyboard.down('Shift');
  await page.keyboard.press('j');
  // Hold Shift until the attack is actually selected: `i.run` is sampled when the next simulation
  // frame builds the attack, not when the keydown arrives. Releasing it on a wall-clock timeout is
  // frame-rate dependent and made this check flaky on the software renderer.
  let heavyClip = await waitForClip(expected.prefix + 'Heavy', 1500);
  await page.keyboard.up('Shift');
  let heavyVia = 'keyboard';
  if (!heavyClip) {
    // The software renderer can starve the key edge under a combined three-fighter run. Exercise
    // the same Fighter3D heavy branch directly instead of failing an animation check on input
    // delivery; the state machine, slot selection and mounted action are identical.
    await stage();
    base = await boneBase();
    await page.evaluate(() => {
      const fighter = window.fighters[0];
      fighter.attackBuffer = .62;
      fighter.simulate(1 / 60, { getInputs: () => ({ run: true }) });
    });
    heavyClip = await waitForClip(expected.prefix + 'Heavy');
    heavyVia = 'simulation';
  }
  const heavyMotion = heavyClip ? await motionTravel(base) : { travel: 0 };
  check(`${key}: the heavy path selects the authored heavy`, Boolean(heavyClip) && heavyClip.slot === 'heavy',
    JSON.stringify({ ...heavyClip, via: heavyVia }));
  check(`${key}: the heavy actually moves the mounted skeleton`, heavyClip && heavyMotion.travel > .05,
    JSON.stringify({ ...heavyMotion, via: heavyVia }));

  // ---- air ------------------------------------------------------------------
  await stage();
  // Launch upward, not merely lift: a stationary body can fall back to the floor during the
  // frame or two before the buffered J is consumed, which changes the move from aerial to ground.
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.isGrounded = false; f.position.y = 4; f.velocity.set(0, 8, 0);
  });
  base = await boneBase();
  await page.keyboard.press('j');
  const airClip = await waitForClip(expected.prefix + 'Air');
  const airMotion = airClip ? await motionTravel(base) : { travel: 0 };
  check(`${key}: J while airborne selects the authored aerial`, Boolean(airClip) && airClip.slot === 'air',
    JSON.stringify(airClip));
  check(`${key}: the aerial actually moves the mounted skeleton`, airClip && airMotion.travel > .05, JSON.stringify(airMotion));

  // ---- special --------------------------------------------------------------
  await stage();
  base = await boneBase();
  await page.keyboard.press('k');
  const special = await page.waitForFunction(() => {
    const u = window.fighters[0]?.model?.userData;
    return u?.authoredSpecialTime > 0 && u.authoredSpecialAction?.getClip?.().name
      ? { name: u.authoredSpecialAction.getClip().name, time: +u.authoredSpecialTime.toFixed(3), cooldown: +window.fighters[0].specialCooldown.toFixed(3), current: u.currentClip }
      : null;
  }, null, { timeout: 8000, polling: 100 }).then(handle => handle.jsonValue()).catch(() => null);
  const specialMotion = special ? await motionTravel(base) : { travel: 0 };
  check(`${key}: K plays the authored signature clip`, special?.name === expected.prefix + 'Special' && special.time > 0,
    JSON.stringify(special));
  check(`${key}: the signature actually moves the mounted skeleton`, special && specialMotion.travel > .05,
    JSON.stringify(specialMotion));

  // ---- reactions: the real state branches, not just bound action names ------
  await stage();
  base = await boneBase();
  await page.evaluate(() => { const f = window.fighters[0]; f.hitstun = .4; f.model.userData.stunPrev = 0; f.model.userData.heavyStun = false; });
  const lightReaction = await page.waitForFunction(() => {
    const u = window.fighters[0]?.model?.userData;
    return u?.currentClip === u?.hitLightAction?.getClip?.().name
      ? { clip: u.currentClip, running: u.hitLightAction.isRunning() } : null;
  }, null, { timeout: 5000, polling: 100 }).then(handle => handle.jsonValue()).catch(() => null);
  const lightReactionMotion = lightReaction ? await motionTravel(base) : { travel: 0 };
  check(`${key}: a light hitstun plays HitLight`, lightReaction?.clip === expected.prefix + 'HitLight', JSON.stringify(lightReaction));
  check(`${key}: the light hit reaction moves the mounted skeleton`, lightReaction && lightReactionMotion.travel > .02,
    JSON.stringify(lightReactionMotion));

  await stage();
  base = await boneBase();
  await page.evaluate(() => { const f = window.fighters[0]; f.hitstun = .8; f.model.userData.stunPrev = 0; f.model.userData.heavyStun = false; });
  const heavyReaction = await page.waitForFunction(() => {
    const u = window.fighters[0]?.model?.userData;
    return u?.currentClip === u?.hitHeavyAction?.getClip?.().name
      ? { clip: u.currentClip, running: u.hitHeavyAction.isRunning() } : null;
  }, null, { timeout: 5000, polling: 100 }).then(handle => handle.jsonValue()).catch(() => null);
  const heavyReactionMotion = heavyReaction ? await motionTravel(base) : { travel: 0 };
  check(`${key}: a heavy hitstun plays HitHeavy`, heavyReaction?.clip === expected.prefix + 'HitHeavy', JSON.stringify(heavyReaction));
  check(`${key}: the heavy hit reaction moves the mounted skeleton`, heavyReaction && heavyReactionMotion.travel > .02,
    JSON.stringify(heavyReactionMotion));

  await page.screenshot({ path: `${out}/${key}.png` }).catch(() => {});
}

// Timing is the part a renamed copy would hide: durations must differ and must keep the intended
// speed order (Superman's committed swing > Goku's tight strike > Spider-Man's snap).
if (order.length === 3) {
  for (const name of ['Jab', 'Kick', 'Heavy', 'Air', 'Special']) {
    const values = order.map(key => metrics[key][name]);
    const unique = new Set(values.map(value => value.toFixed(3))).size;
    check(`${name}: the three fighters have distinct authored timing`,
      unique === 3 && values[0] > values[1] && values[1] > values[2],
      JSON.stringify(Object.fromEntries(order.map((key, i) => [key, values[i]]))));
  }
}

check('no page errors during the bespoke-animation run', errors.length === 0, errors.slice(0, 3).join(' | '));

const passed = checks.filter(entry => entry.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
server.close();
process.exit(passed === checks.length ? 0 : 1);
