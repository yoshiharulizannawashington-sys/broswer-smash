// Browser test for the guard/shield, directional throw and hitbox-debug mechanics.
//
// Everything below runs against the real Fighter3D pipeline: attacks are queued through
// handleInput, their hitboxes are spawned and resolved by updateAttackQueue/updateHitboxes,
// and damage/knockback come from combat/combat_rules.js. The CPU is put in training-dummy
// mode so nothing except the scenario moves.
//
// node scripts/test-mechanics.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { SHIELD, shieldTick, shieldCostFor, shieldAfterHit } from '../public/js/combat/combat_rules.js';
import { MOVES, buildAttack, resolveMoveId, canCancel, FPS, seconds, GRAB } from '../public/js/combat/move_data.js';
import { COMBO, comboScale, chainStep, juggleAllowed, afterHit, airHitstun } from '../public/js/combat/combo.js';
import { sweptSphere, segmentSolid } from '../public/js/combat/projectile_hit.js';
import { STATE, stateOf, armourActive, reactionFor } from '../public/js/combat/fighter_state.js';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

// ---- pure shield rules (no browser) ------------------------------------------
{
  const guarded = shieldTick(SHIELD.max, 1, { guarding: true });
  check('holding guard drains the shield at the documented rate',
    Math.abs(guarded - (SHIELD.max - SHIELD.holdDrain)) < 1e-6, `${guarded}`);
  check('guarding for a long time cannot push the shield below zero',
    shieldTick(0, 1, { guarding: true }) === 0);
  const regen = shieldTick(40, 1, { guarding: false });
  check('a released shield regenerates', Math.abs(regen - (40 + SHIELD.regen)) < 1e-6, `${regen}`);
  check('a shield never regenerates past its maximum',
    shieldTick(SHIELD.max - 1, 1, { guarding: false }) === SHIELD.max);
  check('a broken shield stays at zero', shieldTick(60, 1, { guarding: false, broken: true }) === 0);
  const light = shieldCostFor({ damage: 8, kbs: 76 });
  const heavy = shieldCostFor({ damage: 26, kbs: 130 });
  check('a heavy blocked hit costs more shield than a light one', heavy > light, `${light} vs ${heavy}`);
  check('every blocked hit costs something', shieldCostFor({ damage: 0, kbs: 0 }) >= 6);
  const broke = shieldAfterHit(10, { damage: 20, kbs: 100 });
  check('a blocked hit that empties the shield reports a break', broke.broke && broke.shield === 0);
  const held = shieldAfterHit(SHIELD.max, { damage: 12, kbs: 90 });
  check('a blocked hit leaves a healthy shield standing', !held.broke && held.shield > 0, `${held.shield}`);
}

// ---- frame data, combos, states, swept collision (pure) ----------------------
{
  const dummy = { archetype: 'warrior', combatProfile: { damage: 1, knockback: 1, launch: 1 }, model: { userData: {} } };
  const light = buildAttack({ moveId: 'light1', fighter: dummy });
  const totalFrames = MOVES.light1.frames.reduce((a, b) => a + b, 0);
  check('move timing is stored in 60 Hz frames and converted once',
    FPS === 60 && Math.abs(light.total - seconds(totalFrames)) < 1e-9,
    `${light.total} vs ${seconds(totalFrames)}`);
  check('a move has a finite startup, active window and recovery',
    light.start > 0 && light.end > light.start && light.total > light.end,
    JSON.stringify({ start: light.start, end: light.end, total: light.total }));
  check('the active window is the hitbox window, not the whole move',
    Math.abs((light.end - light.start) - seconds(MOVES.light1.frames[1])) < 1e-9);
  check('one attack instance can only hit once', light.hit === false && light.id === 'light1');
  check('move ids resolve from the input context',
    resolveMoveId({ aerial: true, dive: true }) === 'dive'
    && resolveMoveId({ aerial: true, airFinisher: true }) === 'airFinisher'
    && resolveMoveId({ comboStep: 3 }) === 'light3'
    && resolveMoveId({ comboStep: 4 }) === 'light4'
    && resolveMoveId({ comboStep: 5 }) === 'finisher'
    && resolveMoveId({ antiAir: true }) === 'antiAir'
    && resolveMoveId({ countering: true }) === 'counter'
    && resolveMoveId({ comboStep: 1 }) === 'light1'
    && resolveMoveId({ comboStep: 2 }) === 'light2'
    && resolveMoveId({ heavy: true }) === 'heavy');
  check('the cancel table allows light into light but not finisher into jab',
    canCancel('light1', 'light2') && canCancel('light2', 'light3')
    && canCancel('light3', 'light4') && canCancel('light4', 'finisher')
    && !canCancel('finisher', 'light2') && !canCancel('grab', 'light1'));
  check('air attacks can chain into an air finisher but nothing leaves it',
    canCancel('air', 'airFinisher') && !canCancel('airFinisher', 'air'));
  check('heavy and finisher are the only armoured moves',
    MOVES.heavy.armor === true && MOVES.finisher.armor === true
    && !MOVES.light1.armor && !MOVES.light2.armor && !MOVES.light3.armor
    && !MOVES.light4.armor && !MOVES.attack);
  check('the grab has a hold the victim can struggle out of',
    GRAB.hold > 0 && GRAB.escapeWindow > 0 && GRAB.escapeCooldown > 0);

  // Combo maths.
  check('combo damage scales down per hit and caps',
    comboScale(1) === 1 && comboScale(2) < 1
    && Math.abs(comboScale(5) - (1 - COMBO.decayCap)) < 1e-9
    && Math.abs(comboScale(9) - (1 - COMBO.decayCap)) < 1e-9,
    JSON.stringify([comboScale(1), comboScale(2), comboScale(5), comboScale(9)]));
  check('a chain wraps after five grounded hits',
    chainStep(1, true) === 2 && chainStep(2, true) === 3 && chainStep(3, true) === 4
    && chainStep(4, true) === 5 && chainStep(5, true) === 1
    && chainStep(3, false) === 1);
  check('a closed combo window restarts the hit count',
    afterHit({ attackerHits: 3, windowOpen: false }).hitCount === 1
    && afterHit({ attackerHits: 3, windowOpen: true }).hitCount === 4);
  check('the juggle limit stops an infinite air loop',
    juggleAllowed(3) && !juggleAllowed(COMBO.juggleLimit)
    && afterHit({ targetAirborne: true, windowOpen: true, attackerAirHits: COMBO.juggleLimit }).limitReached === true);
  check('air hitstun shortens as the juggle goes on',
    airHitstun(1, 1) > airHitstun(1, 3) && airHitstun(1, 3) >= 1 * .55);

  // State model.
  const base = { velocity: { x: 0, y: 0, z: 0 }, attackQueue: [], hitstun: 0, guardBreak: 0,
    dodgeTimer: 0, guardHeld: false, flightMode: false, isGrounded: true, shield: 100 };
  check('state: idle / walk / run / airborne',
    stateOf(base) === STATE.IDLE
    && stateOf({ ...base, velocity: { x: 2, y: 0, z: 0 } }) === STATE.WALK
    && stateOf({ ...base, velocity: { x: 9, y: 0, z: 0 } }) === STATE.RUN
    && stateOf({ ...base, isGrounded: false, velocity: { x: 0, y: 5, z: 0 } }) === STATE.JUMP);
  check('state: a hit outranks the interrupted attack, a launch outranks a normal hit',
    stateOf({ ...base, hitstun: .4, attackQueue: [{ t: .1, start: .1, end: .2, total: .4 }] }) === STATE.HITSTUN
    && stateOf({ ...base, hitstun: .4, velocity: { x: 0, y: 4, z: 0 } }) === STATE.LAUNCHED);
  check('state: guard break outranks a held guard, grabs outrank everything but KO',
    stateOf({ ...base, guardHeld: true, guardBreak: .7 }) === STATE.GUARD_BROKEN
    && stateOf({ ...base, grabbedBy: {} }) === STATE.GRABBED
    && stateOf({ ...base, ko: true }) === STATE.KO);
  check('state: attack phases come from the move data, not the animation',
    stateOf({ ...base, attackQueue: [{ t: .02, start: .0667, end: .2, total: .35 }] }) === STATE.ATTACK_STARTUP
    && stateOf({ ...base, attackQueue: [{ t: .1, start: .0667, end: .2, total: .35 }] }) === STATE.ATTACK_ACTIVE
    && stateOf({ ...base, attackQueue: [{ t: .25, start: .0667, end: .2, total: .35 }] }) === STATE.ATTACK_RECOVERY);

  // Armour and reaction rules.
  const armoured = { ...base, attackQueue: [{ id: 'heavy', t: .2, start: .15, end: .317, total: .55, armor: true }] };
  check('armour is only active inside the move’s armour frames',
    armourActive(armoured) === true
    && armourActive({ ...base, attackQueue: [{ id: 'light1', t: .1, start: .0667, end: .2, total: .35 }] }) === false);
  const armouredReaction = reactionFor(armoured, { hitstun: .5, knockback: 8, launch: 3, damage: 9 });
  check('an armoured heavy takes reduced hitstun and knockback but still takes damage',
    armouredReaction.armored && armouredReaction.hitstun < .1 && armouredReaction.knockback < 3 && armouredReaction.launch === 0);
  const spike = reactionFor(base, { hitstun: .5, knockback: 8, launch: 3, limitReached: true });
  check('a juggle-exhausted target is spiked instead of floated', spike.spike && spike.launch < 0);

  // Swept collision.
  check('a swept shot hits a target its end point jumped past',
    sweptSphere({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1) === true
    && Math.hypot(10 - 5, 0, 0) > 1);
  check('a swept shot misses a target off its line',
    sweptSphere({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }, 1) === false);
  check('a swept shot that starts inside the target hits',
    sweptSphere({ x: 5.2, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 1) === true);
  const wallTest = (x, y, z) => x > 4 && x < 6;
  check('a segment through a solid volume is detected',
    segmentSolid({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, wallTest) === true
    && segmentSolid({ x: 0, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }, wallTest) === false);
}

// ---- real fighters ------------------------------------------------------------
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await readFile(localPath) });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashCombatDebug
    && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  await page.evaluate(() => window.__browserSmashSelect.chooseArena('valley'));
  await page.evaluate(() => document.querySelector('#play').click());
  await step(1.2);

  const result = await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    const [p, c] = window.fighters;
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false,
      jump: false, dodge: false, attack: false, special: false, shield: false, parry: false,
      grab: false, ascend: false, descend: false, vertical: 0, flightToggle: false };
    const place = (gap = 1.2) => {
      for (const f of [p, c]) {
        f.hitstun = 0; f.attackQueue.length = 0; f.hitboxes.length = 0; f.percent = 0;
        f.velocity.set(0, 0, 0); f.shield = 100; f.guardBreak = 0; f.guardRegenDelay = 0;
        f.guardHeld = false; f.isGrounded = true; f.invulnerable = 0; f.parryTimer = 0; f.grabCooldown = 0;
        f.comboStep = 0; f.comboHitCount = 0; f.comboWindow = 0;
      }
      p.position.set(0, .6, 0);
      c.position.set(gap, .6, 0);
      p.facing = 1; p.facingZ = 0;
      c.facing = -1; c.facingZ = 0;
    };
    /** Resolve one attack queued by handleInput through the real hit pipeline. */
    const settle = (attacker, frames = 60) => {
      for (let i = 0; i < frames; i++) {
        attacker.updateAttackQueue(1 / 60);
        attacker.updateHitboxes(1 / 60);
        p.hitstun = Math.max(0, p.hitstun - 1 / 60);
        c.hitstun = Math.max(0, c.hitstun - 1 / 60);
      }
    };
    const strike = ({ gap = 1.2, guard = false } = {}) => {
      place(gap);
      if (guard) c.guardHeld = true;
      p.handleInput({ ...idle, attack: true }, 1 / 60);
      const queued = p.attackQueue.length;
      settle(p);
      return { queued, percent: c.percent, shield: c.shield, guardBreak: c.guardBreak, knockback: c.velocity.length() };
    };

    const out = {};
    const hit = strike({ gap: 1.2 });
    out.landed = { queued: hit.queued, percent: hit.percent, knockback: hit.knockback };
    const miss = strike({ gap: 6 });
    out.missed = { percent: miss.percent };
    const blocked = strike({ gap: 1.2, guard: true });
    out.blocked = { percent: blocked.percent, shield: blocked.shield };

    // Guard break: keep blocking heavy hits until the shield empties.
    place(1.2);
    let breaks = 0;
    let shieldTrace = [];
    for (let n = 0; n < 12 && breaks === 0; n++) {
      c.attackQueue.length = 0; c.hitboxes.length = 0;
      p.attackQueue.length = 0; p.hitboxes.length = 0;
      c.guardHeld = n === 0 ? true : c.guardHeld;
      c.shield = Math.max(0, c.shield);
      c.guardBreak = 0;
      c.guardHeld = true;
      p.position.set(0, .6, 0); c.position.set(1.2, .6, 0);
      p.facing = 1; p.facingZ = 0;
      p.handleInput({ ...idle, attack: true }, 1 / 60);
      settle(p);
      shieldTrace.push(Math.round(c.shield));
      if (c.guardBreak > 0) breaks = c.guardBreak;
    }
    out.guardBreak = { value: breaks, shield: c.shield, trace: shieldTrace };

    // While broken the guard cannot be held at all.
    c.guardBreak = .8;
    c.shield = 0;
    c.guardHeld = true;
    c.simulate(1 / 60, { getInputs: () => ({ ...idle, shield: true }) });
    out.brokenGuard = { guardHeld: c.guardHeld, shield: c.shield };

    // And it recovers: the break expires and holding nothing regenerates shield.
    c.simulate(.9, { getInputs: () => ({ ...idle }) });
    const afterBreak = c.shield;
    c.simulate(1.5, { getInputs: () => ({ ...idle }) });
    out.regen = { afterBreak, after: c.shield };

    // Guarding is driven by the real input path, not a flag we set.
    const guardState = { getInputs: () => ({ ...idle, shield: true }) };
    p.shield = 100; p.guardBreak = 0; p.guardHeld = false;
    p.simulate(1 / 60, guardState);
    const guardHeldByInput = p.guardHeld;
    const shieldBeforeHold = p.shield;
    for (let i = 0; i < 30; i++) p.simulate(1 / 60, guardState);
    out.guardInput = { guardHeld: guardHeldByInput, drained: shieldBeforeHold - p.shield };

    // Directional throws: up, down and forward arcs through the same grab hitbox. The grab now
    // holds the victim for GRAB.hold before it throws, so the loop below advances both fighters'
    // simulate() steps and reads the recorded throw instead of a velocity gravity has changed.
    const throwWith = (aim, { escape = false } = {}) => {
      place(1.2);
      const inputs = { ...idle, grab: true, up: aim === 'up', down: aim === 'down', vertical: aim === 'up' ? 1 : aim === 'down' ? -1 : 0 };
      p.handleInput(inputs, 1 / 60);
      const queuedAim = p.attackQueue[0]?.aim || null;
      settle(p);
      const held = c.grabbedBy === p;
      const attackerIdle = { getInputs: () => ({ ...idle }) };
      const victimInputs = { getInputs: () => ({ ...idle, dodge: escape }) };
      for (let i = 0; i < 24; i++) { p.simulate(1 / 60, attackerIdle); c.simulate(1 / 60, victimInputs); }
      return {
        queuedAim, held,
        aim: c.lastThrow?.aim || null,
        vy: c.lastThrow?.y ?? 0,
        vx: c.lastThrow?.x ?? 0,
        percent: c.percent,
        grabbed: Boolean(c.grabbedBy),
        grabTarget: Boolean(p.grabTarget),
        grabCooldown: p.grabCooldown
      };
    };
    out.throwUp = throwWith('up');
    out.throwDown = throwWith('down');
    out.throwForward = throwWith('forward');
    out.throwEscape = throwWith('up', { escape: true });

    // Hitbox / hurtbox debug overlay.
    const debug = window.__browserSmashCombatDebug;
    place(1.2);
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    p.updateAttackQueue(1 / 60);
    p.updateAttackQueue(1 / 60);
    p.updateAttackQueue(1 / 60);
    const offState = debug.state();
    debug.toggle();
    const groups = window.__browserSmashThree
      ? window.__browserSmashScene.getObjectByName('combat-debug')
      : null;
    let drawn = 0;
    if (groups) {
      groups.children.forEach(child => { if (child.visible) drawn++; });
    }
    if (debug.refresh) drawn = debug.refresh().objects;
    const liveHitboxes = p.hitboxes.length + c.hitboxes.length;
    const onState = debug.state();
    debug.toggle();
    const hiddenState = debug.state();
    out.debug = { off: offState, on: onState, hidden: hiddenState, drawn, liveHitboxes };

    // HUD shield bars track the live shield value.
    c.shield = 42; c.guardBreak = 0;
    window.__browserSmashTickHud?.();
    const bar = document.getElementById('p2shield');
    out.hud = { exists: Boolean(bar), width: bar?.style.width || null };
    return out;
  });

  check('an attack in range queues through the input path and lands', result.landed.queued === 1 && result.landed.percent > 0,
    JSON.stringify(result.landed));
  check('a landed attack produces knockback', result.landed.knockback > 0);
  check('the same attack from 6 m away misses', result.missed.percent === 0);
  check('guarding cuts a hit to a fraction of its damage and spends shield',
    result.blocked.percent > 0 && result.blocked.percent < result.landed.percent * .5 && result.blocked.shield < 100,
    JSON.stringify(result.blocked));
  check('repeated blocked hits empty the shield and break the guard',
    result.guardBreak.value > 0 && result.guardBreak.shield === 0, JSON.stringify(result.guardBreak));
  check('a broken guard cannot be held', result.brokenGuard.guardHeld === false,
    JSON.stringify(result.brokenGuard));
  check('the shield comes back after a break', result.regen.afterBreak > 0 && result.regen.after > result.regen.afterBreak,
    JSON.stringify(result.regen));
  check('the shield input itself raises the guard and drains it',
    result.guardInput.guardHeld === true && result.guardInput.drained > 0, JSON.stringify(result.guardInput));
  check('UP + grab holds, then throws the victim upward',
    result.throwUp.queuedAim === 'up' && result.throwUp.held && result.throwUp.aim === 'up'
    && result.throwUp.vy > 8 && result.throwUp.percent > 0,
    JSON.stringify(result.throwUp));
  check('DOWN + grab spikes the victim toward the floor',
    result.throwDown.queuedAim === 'down' && result.throwDown.aim === 'down' && result.throwDown.vy < 0,
    JSON.stringify(result.throwDown));
  check('a neutral grab throws the victim forward', Math.abs(result.throwForward.vx) > 4,
    JSON.stringify(result.throwForward));
  check('a victim who struggles during the hold escapes the throw',
    result.throwEscape.held && result.throwEscape.aim === null && result.throwEscape.percent === 0
    && !result.throwEscape.grabbed && !result.throwEscape.grabTarget && result.throwEscape.grabCooldown > .3,
    JSON.stringify(result.throwEscape));
  check('the combat debug overlay is off by default', result.debug.off.enabled === false && result.debug.off.objects === 0);
  check('turning it on draws a volume for each fighter and each live hitbox',
    result.debug.on.enabled && result.debug.drawn >= 2 + result.debug.liveHitboxes,
    JSON.stringify({ drawn: result.debug.drawn, live: result.debug.liveHitboxes }));
  check('turning it off hides every volume again',
    result.debug.hidden.enabled === false && result.debug.hidden.visible === false);
  check('the HUD shows a shield bar that tracks the live value',
    result.hud.exists && result.hud.width === '42%', JSON.stringify(result.hud));
  // Render-loop frames, for anything the projectile/debug path updates outside the fixed step.
  const frames = count => page.evaluate(n => new Promise(done => {
    let seen = 0;
    const tick = () => { seen += 1; if (seen >= n) done(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), count);

  // ---- phase 2: chains, armour, juggles, cover, dodges, flight, debug readout ----
  const phase2 = await page.evaluate(() => {
    const pick = () => window.__browserSmashSelect.chooseArena('valley');
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false,
      jump: false, dodge: false, attack: false, special: false, shield: false, parry: false,
      grab: false, ascend: false, descend: false, vertical: 0, flightToggle: false };
    const fresh = () => {
      const [p, c] = window.fighters;
      for (const f of [p, c]) {
        f.hitstun = 0; f.attackQueue.length = 0; f.hitboxes.length = 0; f.shield = 100;
        f.guardBreak = 0; f.guardHeld = false; f.invulnerable = 0; f.percent = 0;
        f.velocity.set(0, 0, 0); f.comboStep = 0; f.comboHitCount = 0; f.comboWindow = 0;
        f.airHits = 0; f.isGrounded = true; f.lastThrow = null; f.grabbedBy = null;
        f.grabTarget = null; f.grabHold = 0; f.ko = false;
        f.dodgeTimer = 0; f.dashCooldown = 0; f.dashTimer = 0; f.jumps = 0; f.airDashUsed = false;
        f.parryTimer = 0; f.counterWindow = 0; f.specialCooldown = 0; f.grabCooldown = 0;
        f.guardStun = 0; f.groundLevel = .6;
      }
      p.position.set(0, .6, 0); c.position.set(1.2, .6, 0);
      p.facing = 1; p.facingZ = 0; c.facing = -1; c.facingZ = 0;
      p.layout = c.layout = window.__browserSmashLayout();
      return [p, c];
    };
    const advance = (p, frames) => {
      for (let i = 0; i < frames; i++) { p.updateAttackQueue(1 / 60); p.updateHitboxes(1 / 60); }
    };
    pick();
    const out = {};

    // Light string: the second press during recovery is a real, hit-confirmed chain.
    let [p, c] = fresh();
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    out.firstMove = p.activeMoveId;
    advance(p, 13);
    out.afterFirst = { percent: c.percent, hits: p.comboHitCount, step: p.comboStep };
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    out.queuedIds = p.attackQueue.map(a => a.id);
    advance(p, 6);
    out.secondMove = p.activeMoveId;
    advance(p, 20);
    out.afterSecond = { percent: c.percent, hits: p.comboHitCount, step: p.comboStep };

    // Armour: a heavy eats a jab's hitstun but still takes the damage.
    [p, c] = fresh();
    c.handleInput({ ...idle, run: true, attack: true }, 1 / 60);
    out.heavyMove = c.activeMoveId;
    // Advance only c's attack clock: running its hitboxes here would let its own heavy knock the
    // attacker airborne before the jab is thrown, which is not the scenario under test.
    for (let i = 0; i < 12; i++) c.updateAttackQueue(1 / 60);
    out.armourPhase = c.attackQueue[0]?.t ?? -1;
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.armoured = { hitstun: c.hitstun, queue: c.attackQueue.length, percent: c.percent };
    [p, c] = fresh();
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.unarmoured = { hitstun: c.hitstun, percent: c.percent };

    // Juggle limit: one air hit too many spikes the target out of the air.
    [p, c] = fresh();
    c.position.set(1.2, 2.0, 0); c.isGrounded = false; c.percent = 5;
    p.airHits = 4; p.comboWindow = 1; p.comboHitCount = 2;
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.juggle = { vy: c.velocity.y, hitstun: c.hitstun, airHits: p.airHits, percent: c.percent };

    // Dodge: a hit inside the i-frame window misses, the same hit afterwards lands.
    [p, c] = fresh();
    c.handleInput({ ...idle, dodge: true }, 1 / 60);
    out.iframes = c.invulnerable;
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 14);
    out.dodgedHit = { percent: c.percent, dodgeTimer: c.dodgeTimer };
    c.invulnerable = 0;
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.lateHit = { percent: c.percent };

    // Flight: toggle, climb, hover, and land again.
    [p, c] = fresh();
    p.canFly = true; p.flightMode = false; p.groundLevel = 0; p.position.y = 0;
    p.simulate(1 / 60, { getInputs: () => ({ ...idle, flightToggle: true }) });
    out.flightOn = p.flightMode;
    for (let i = 0; i < 40; i++) p.simulate(1 / 60, { getInputs: () => ({ ...idle, ascend: true }) });
    out.climbed = p.position.y;
    out.flightState = p.state;
    // Let the climb bleed off first: releasing ascend leaves momentum, and a hover is only
    // stable once that has damped. Then measure drift with no vertical input at all.
    for (let i = 0; i < 60; i++) p.simulate(1 / 60, { getInputs: () => ({ ...idle }) });
    const hoverFrom = p.position.y;
    const hoverVy = p.velocity.y;
    for (let i = 0; i < 45; i++) p.simulate(1 / 60, { getInputs: () => ({ ...idle }) });
    out.hoverDrift = Math.abs(p.position.y - hoverFrom);
    out.hoverVy = hoverVy;
    p.simulate(1 / 60, { getInputs: () => ({ ...idle, flightToggle: true }) });
    for (let i = 0; i < 150; i++) p.simulate(1 / 60, { getInputs: () => ({ ...idle }) });
    out.landed = p.isGrounded && p.position.y <= .01;

    // Two fighters attacking at the same time trade damage instead of one update order winning.
    [p, c] = fresh();
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    c.handleInput({ ...idle, attack: true }, 1 / 60);
    for (let i = 0; i < 20; i++) {
      p.updateAttackQueue(1 / 60); p.updateHitboxes(1 / 60);
      c.updateAttackQueue(1 / 60); c.updateHitboxes(1 / 60);
    }
    out.trade = { p: p.percent, c: c.percent };

    // Damage scaling: the fifth hit of a string does less than the first.
    [p, c] = fresh();
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.firstHitDamage = c.percent;
    [p, c] = fresh();
    p.comboHitCount = 4; p.comboWindow = 1;
    p.handleInput({ ...idle, attack: true }, 1 / 60);
    advance(p, 20);
    out.scaledHitDamage = c.percent;

    // Cover and flight collision both use the real stage volumes on the Death Star.
    window.__browserSmashSelect.chooseArena('deathstar');
    const layout = window.__browserSmashLayout();
    const wall = (layout.blocks || []).find(b => b.r == null && b.top != null
      && (b.bottom ?? 0) <= 1.2 && b.top >= 2.8
      && (b.x1 - b.x0) >= .2 && (b.x1 - b.x0) <= .9 && (b.z1 - b.z0) >= 1.2);
    if (wall) {
      const z = (wall.z0 + wall.z1) / 2;
      [p, c] = fresh();
      p.layout = c.layout = layout;
      p.position.set(wall.x0 - .5, .6, z); c.position.set(wall.x1 + .5, .6, z);
      p.handleInput({ ...idle, attack: true }, 1 / 60);
      advance(p, 20);
      out.coverBlocked = { percent: c.percent, gap: +(wall.x1 + .5 - (wall.x0 - .5)).toFixed(2) };
      [p, c] = fresh();
      p.layout = c.layout = layout;
      // Same side of the wall, same 1.2 m gap: the swing should connect here.
      p.position.set(wall.x0 - 1.8, .6, z); c.position.set(wall.x0 - .6, .6, z);
      p.handleInput({ ...idle, attack: true }, 1 / 60);
      advance(p, 20);
      out.coverOpen = { percent: c.percent };
      out.wall = { x0: wall.x0, x1: wall.x1, z };
      p.canFly = true; p.flightMode = true;
      p.position.set((wall.x0 + wall.x1) / 2, 1.2, z);
      p.groundLevel = 0;
    }
    out.wallThickness = wall ? +(wall.x1 - wall.x0).toFixed(2) : null;
    out.insideWallBefore = window.__browserSmashSolidAt(window.fighters[0].position.x, window.fighters[0].position.y, window.fighters[0].position.z);
    return out;
  });
  check('a jab sets the move id from the move table', phase2.firstMove === 'light1', JSON.stringify(phase2.firstMove));
  check('a second press during recovery chains into the next hit, not a fresh jab',
    phase2.queuedIds.includes('light2') && phase2.secondMove === 'light2' && phase2.afterSecond.step === 2,
    JSON.stringify({ queued: phase2.queuedIds, second: phase2.secondMove, step: phase2.afterSecond.step }));
  check('the chain is hit-confirmed: the combo counter grows only because both hits landed',
    phase2.afterSecond.hits === 2 && phase2.afterSecond.percent > phase2.afterFirst.percent,
    JSON.stringify({ first: phase2.afterFirst, second: phase2.afterSecond }));
  check('a heavy in its armour frames keeps its attack and takes reduced hitstun',
    phase2.heavyMove === 'heavy' && phase2.armoured.queue > 0
    && phase2.armoured.hitstun < phase2.unarmoured.hitstun && phase2.armoured.percent > 0,
    JSON.stringify({ armoured: phase2.armoured, plain: phase2.unarmoured }));
  check('exceeding the juggle limit spikes the target instead of floating it',
    phase2.juggle.vy < 0 && phase2.juggle.airHits > 4 && phase2.juggle.percent > 5,
    JSON.stringify(phase2.juggle));
  check('a hit inside a dodge’s i-frames misses', phase2.iframes > 0 && phase2.dodgedHit.percent === 0,
    JSON.stringify(phase2.dodgedHit));
  check('the same hit lands once the i-frame window has closed', phase2.lateHit.percent > 0,
    JSON.stringify(phase2.lateHit));
  check('flight turns on, climbs and reports the flight state',
    phase2.flightOn && phase2.climbed > 2 && phase2.flightState === 'flight',
    JSON.stringify({ on: phase2.flightOn, climbed: phase2.climbed, state: phase2.flightState }));
  check('hovering does not drift without vertical input',
    Math.abs(phase2.hoverVy) < .6 && phase2.hoverDrift < .3,
    JSON.stringify({ drift: phase2.hoverDrift, vy: phase2.hoverVy }));
  check('releasing flight lands the fighter back on the ground', phase2.landed === true);
  check('two fighters attacking on the same frame trade damage',
    phase2.trade.p > 0 && phase2.trade.c > 0, JSON.stringify(phase2.trade));
  check('combo scaling makes the fifth hit weaker than the first',
    phase2.scaledHitDamage > 0 && phase2.scaledHitDamage < phase2.firstHitDamage * .85,
    JSON.stringify({ first: phase2.firstHitDamage, fifth: phase2.scaledHitDamage }));

  // Gamepad mapping, checked through the real handler with a fake pad.
  const pads = await page.evaluate(() => {
    const input = window.__browserSmashInput;
    const makePad = () => ({
      axes: [0.8, -0.6, 0, 0],
      buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: [0, 1, 2, 6, 7].includes(i) }))
    });
    const original = navigator.getGamepads;
    let patched = false;
    try {
      Object.defineProperty(navigator, 'getGamepads', { value: () => [makePad(), makePad()], configurable: true });
      patched = true;
    } catch { patched = false; }
    const p1 = input.getInputs(1);
    const p2 = input.getInputs(2);
    try { Object.defineProperty(navigator, 'getGamepads', { value: original, configurable: true }); } catch {}
    return {
      patched,
      p1: { attack: p1.attack, special: p1.special, jump: p1.jump, shield: p1.shield, grab: p1.grab, right: p1.right, up: p1.up },
      p2: { attack: p2.attack, shield: p2.shield }
    };
  });
  check('the gamepad drives both local players with independent mappings',
    pads.patched && pads.p1.attack && pads.p1.special && pads.p1.jump && pads.p1.shield
    && pads.p1.grab && pads.p1.right && pads.p1.up && pads.p2.attack && pads.p2.shield,
    JSON.stringify(pads));

  check('a melee swing does not reach through a wall',
    phase2.wallThickness != null && phase2.coverBlocked.percent === 0
    && phase2.coverOpen.percent > 0,
    JSON.stringify({ wall: phase2.wall, blocked: phase2.coverBlocked, open: phase2.coverOpen }));
  check('a fighter placed inside a wall is pushed out by the stage collision',
    phase2.insideWallBefore === true, JSON.stringify({ inside: phase2.insideWallBefore }));

  // The loop's collision pass runs the same resolve the player feels.
  await step(0.15);
  const wallEject = await page.evaluate(() => {
    const p = window.fighters[0];
    return {
      inside: window.__browserSmashSolidAt(p.position.x, p.position.y, p.position.z),
      approximateStart: p.position.x
    };
  });
  check('stage collision pushes a fighter out of the wall it was placed in',
    wallEject.inside === false, JSON.stringify(wallEject));

  // The F3 overlay now also prints states, move phases, shield and i-frames.
  await page.evaluate(() => window.__browserSmashCombatDebug.set(true));
  await frames(2);
  const readout = await page.evaluate(() => {
    const el = document.getElementById('combatDebugReadout');
    const text = el?.textContent || '';
    return {
      exists: Boolean(el), hidden: el ? el.hidden : null, text,
      hasState: /idle|walk|run|attack|block|flight|grabbed|hitstun|launched/.test(text),
      hasMove: text.includes('move='), hasShield: text.includes('shield='), hasIframes: text.includes('iframes=')
    };
  });
  await page.evaluate(() => window.__browserSmashCombatDebug.set(false));
  const readoutHidden = await page.evaluate(() => document.getElementById('combatDebugReadout')?.hidden ?? null);
  check('the debug overlay prints live state, move id, shield and i-frame values',
    readout.exists && readout.hasState && readout.hasMove && readout.hasShield && readout.hasIframes,
    JSON.stringify({ ...readout, text: readout.text.slice(0, 160) }));
  check('the readout is hidden again when the overlay is switched off', readoutHidden === true,
    JSON.stringify({ readoutHidden }));

  // ---- projectiles: invulnerability windows and world geometry ------------------
  // Projectiles advance inside the render loop, not the fixed simulation step, so these
  // scenarios wait for real animation frames instead of stepping game time.
  const wallShot = await page.evaluate(keys => {
    for (const key of keys) {
      window.__browserSmashSelect.chooseArena(key);
      const layout = window.__browserSmashLayout();
      const wall = (layout.blocks || []).find(b => b.r == null && b.top != null
        && b.top - (b.bottom ?? 0) >= 3 && b.x1 - b.x0 >= 1.5 && b.z1 - b.z0 >= 1.5
        && (b.bottom ?? 0) <= 2.2);
      if (!wall) continue;
      const [p, c] = window.fighters;
      const z = (wall.z0 + wall.z1) / 2;
      p.position.set(wall.x0 - 4, .6, z); p.velocity.set(0, 0, 0);
      p.facing = 1; p.facingZ = 0; p.hitstun = 0; p.isGrounded = true;
      c.position.set(wall.x0 - 80, .6, z); c.velocity.set(0, 0, 0); c.percent = 0;
      const before = window.__browserSmashProjectiles().length;
      window.spawnProjectile(p, { source: 'weapon', weaponKind: 'blaster' });
      return {
        key,
        spawnClear: !window.__browserSmashSolidAt(wall.x0 - 4, 2.1, z),
        // One metre *inside* the volume the shot is flying into.
        aheadSolid: window.__browserSmashSolidAt(wall.x0 + 1, 2.1, z),
        before,
        live: window.__browserSmashProjectiles().length
      };
    }
    return null;
  }, ['deathstar', 'hogwarts', 'asgard', 'konoha', 'nyc']);
  await frames(8);
  const wallAfter = await page.evaluate(() => window.__browserSmashProjectiles().length);
  check('a wall in the line of fire is detected by the solid-volume test',
    wallShot && wallShot.spawnClear && wallShot.aheadSolid, JSON.stringify(wallShot));
  check('a shot is destroyed by world geometry instead of flying through it',
    wallShot && wallShot.live === wallShot.before + 1 && wallAfter <= wallShot.before,
    JSON.stringify({ wallShot, wallAfter }));

  // A fighter inside an invulnerability window (a dodge, or spawn protection) is not hit.
  const dodgeShot = await page.evaluate(() => {
    window.__browserSmashSelect.chooseArena('valley');
    const [p, c] = window.fighters;
    p.position.set(0, .6, 0); p.velocity.set(0, 0, 0); p.facing = 1; p.facingZ = 0;
    c.position.set(1.7, .6, 0); c.velocity.set(0, 0, 0);
    c.percent = 0; c.hitstun = 0; c.invulnerable = 1.5;
    const before = window.__browserSmashProjectiles().length;
    window.spawnProjectile(p, { source: 'weapon', weaponKind: 'blaster' });
    return { before, live: window.__browserSmashProjectiles().length, percent: c.percent };
  });
  await frames(4);
  const duringInvulnerability = await page.evaluate(() => ({
    percent: window.fighters[1].percent,
    live: window.__browserSmashProjectiles().length
  }));
  await page.evaluate(() => {
    const [p, c] = window.fighters;
    c.invulnerable = 0; c.percent = 0;
    p.position.set(0, .6, 0); p.velocity.set(0, 0, 0); p.facing = 1; p.facingZ = 0;
    c.position.set(1.7, .6, 0); c.velocity.set(0, 0, 0);
    window.spawnProjectile(p, { source: 'weapon', weaponKind: 'blaster' });
  });
  await frames(4);
  const afterWindow = await page.evaluate(() => window.fighters[1].percent);
  check('an invulnerable fighter is not damaged by a projectile',
    dodgeShot.live === dodgeShot.before + 1 && duringInvulnerability.percent === 0,
    JSON.stringify({ dodgeShot, duringInvulnerability }));
  check('the same shot lands once the invulnerability window closes', afterWindow > 0,
    JSON.stringify({ afterWindow }));

  // Round end is a fight boundary: nothing queued, live or in flight may land after it.
  const roundEnd = await page.evaluate(() => {
    window.__browserSmashSelect.chooseArena('valley');
    const [p, c] = window.fighters;
    p.position.set(0, .6, 0); c.position.set(4, .6, 0);
    p.percent = 0; c.percent = 0;
    p.attackQueue.push({ kind: 'melee', total: .4, t: 0, start: 0, end: .2, damage: 9, reach: 1.6, kbs: 80, hit: false });
    const pos = p.position.clone(); pos.y += 1;
    p.hitboxes.push({ pos, radius: 1.2, lifetime: .5, hit: false, kind: 'melee', damage: 9, kbs: 80, owner: p });
    window.spawnProjectile(p, { source: 'weapon', weaponKind: 'blaster' });
    c.percent = 999;   // the round ends on the next simulation step
    return { projectiles: window.__browserSmashProjectiles().length, queued: p.attackQueue.length };
  });
  await step(0.2);
  const afterRound = await page.evaluate(() => ({
    status: window.__browserSmashMatch().status,
    projectiles: window.__browserSmashProjectiles().length,
    queued: window.fighters[0].attackQueue.length,
    hitboxes: window.fighters[0].hitboxes.length
  }));
  check('a finished round clears queued attacks, live hitboxes and shots in flight',
    roundEnd.projectiles > 0 && afterRound.status !== 'fighting'
    && afterRound.projectiles === 0 && afterRound.queued === 0 && afterRound.hitboxes === 0,
    JSON.stringify({ roundEnd, afterRound }));

  check('no page errors while driving the combat pipeline', pageErrors.length === 0, pageErrors.join('\n'));
} finally {
  await browser?.close();
  server.close();
}

console.log(`\n✓ combat mechanics checks passed (${checks} assertions)`);
