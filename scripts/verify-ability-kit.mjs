// Live verification of the ability kit and the five-hit chain in the real game.
//
//   bash scripts/run-browser-test.sh scripts/verify-ability-kit.mjs
//
// Everything here is driven through the game's own input layer and simulation: real key presses,
// real projectile hits, real cooldowns on the fighter, real CPU decisions. Nothing calls the damage
// code directly, so a passing run means the mechanic exists in a match rather than in a table.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { ABILITY_KIT, lightLabelFor } from '../public/js/combat/ability_kit.js';
import { MOVESETS } from '../public/js/combat/movesets.js';

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
  const frames = count => page.evaluate(n => new Promise(done => {
    let i = 0;
    const tick = () => { if (++i >= n) return done(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), count);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 120_000, polling: 200 });

  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Thor');
    window.__browserSmashSelect?.select('p2', 'Wonder Woman');
    document.querySelector('#play').click();
  });
  await step(.6);

  const place = () => page.evaluate(() => {
    const [p, c] = window.fighters;
    p.position.set(0, .6, 0); c.position.set(1.5, .6, 0);
    p.velocity.set(0, 0, 0); c.velocity.set(0, 0, 0);
    p.facing = 1; p.facingZ = 0; c.facing = -1; c.facingZ = 0;
    p.percent = 0; c.percent = 0; c.invulnerable = 0; c.hitstun = 0;
    // Grounded state has to be restored explicitly: a shockwave ability leaves the caster
    // airborne, and an airborne fighter's chain is the air string, not the five light hits.
    p.isGrounded = true; c.isGrounded = true; p.jumps = 0; c.jumps = 0;
    p.flightMode = false; c.flightMode = false;
    p.guardBreak = 0; p.specialCooldown = 0; p.abilityReadyAt = {};
    p.comboStep = 0; p.comboWindow = 0;
  });

  // ---- 1. slot 1 casts through the live pipeline ---------------------------------
  await place();
  await page.keyboard.press('KeyL');
  await frames(2);
  const slot1 = await page.evaluate(() => {
    const p = window.fighters[0];
    return {
      readyAt: p.abilityReadyAt?.[1] || 0,
      cast: p.abilityLastCast || null,
      shot: window.__browserSmashLastShot || null
    };
  });
  check('key L casts the fighter\'s first kit ability', slot1.cast?.label === ABILITY_KIT.thor[0].label
    && slot1.readyAt > 0, JSON.stringify(slot1.cast));
  check('the kit cast goes through the shared projectile pipeline',
    slot1.shot?.source === 'ability' && slot1.shot?.moveType === ABILITY_KIT.thor[0].type,
    JSON.stringify(slot1.shot));

  // Poll on real animation frames until the shot lands: the projectile is advanced by the render
  // loop, and a fixed frame count reads the percentage before the hit at software-renderer rates.
  const hit1 = await page.evaluate(async () => {
    const target = window.fighters[1];
    for (let i = 0; i < 180 && target.percent === 0; i++) {
      await new Promise(done => requestAnimationFrame(done));
    }
    return target.percent;
  });
  const diag = await page.evaluate(() => ({
    live: window.__browserSmashProjectiles?.().length ?? null,
    lastShot: window.__browserSmashLastShot || null,
    distance: Math.hypot(window.fighters[1].position.x - window.fighters[0].position.x,
      window.fighters[1].position.z - window.fighters[0].position.z)
  }));
  check('the kit ability damages the opponent in a live match', hit1 > 0,
    `${hit1}% ` + JSON.stringify(diag));
  // The regression this caught: a kit cast inherited the hammer origin policy and fired from a
  // stale equipped-weapon transform, 1.06 m off-axis and over the target's head.
  check('the kit shot leaves the body, not a stale weapon transform',
    (diag.lastShot?.selfDistance ?? 9) <= 0.95 && (diag.lastShot?.spawn?.y ?? 9) < 2.1,
    JSON.stringify(diag.lastShot));

  // ---- 2. the same slot cannot be spammed ----------------------------------------
  const before = await page.evaluate(() => window.__browserSmashProjectiles().length);
  await page.keyboard.press('KeyL');
  await frames(3);
  const before2 = await page.evaluate(() => window.__browserSmashProjectiles().length);
  check('an ability on cooldown does not fire again', before2 <= before + 0, `${before} -> ${before2}`);

  // ---- 3. slot 2 is a different move --------------------------------------------
  await place();
  await page.keyboard.press('KeyH');
  await frames(2);
  const slot2 = await page.evaluate(() => window.fighters[0].abilityLastCast || null);
  check('key H casts the second, different kit ability',
    slot2?.label === ABILITY_KIT.thor[1].label && slot2?.type !== ABILITY_KIT.thor[0].type,
    JSON.stringify(slot2));

  // ---- 4. five-hit light chain, with the character's own names -------------------
  await place();
  // Settle onto the floor before the first press: the first frame after a teleport still has the
  // fighter flagged airborne, and that frame legitimately selects the air string.
  await page.evaluate(() => {
    const p = window.fighters[0];
    p.position.y = p.groundLevel ?? .6;
    for (let i = 0; i < 60 && !p.isGrounded; i++) window.__browserSmashStep(1 / 60);
  });
  const groundedAfterPlace = await page.evaluate(() => window.fighters[0].isGrounded);
  check('Thors chain starts from the ground, not from the air string', groundedAfterPlace === true);
  const observed = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('j');
    // Sample while the chain advances instead of once per press: a press can be buffered and
    // fire on a later frame, and sampling only at the end misses the middle hits.
    const batch = await page.evaluate(() => {
      const p = window.fighters[0];
      const seen = [];
      for (let f = 0; f < 30; f++) {
        window.__browserSmashStep(1 / 60);
        const last = p.attackQueue[p.attackQueue.length - 1] || null;
        if (last && last.id && !seen.some(m => m.id === last.id)) {
          seen.push({ id: last.id, label: last.label || null });
        }
      }
      return seen;
    });
    observed.push(...batch);
  }
  const ids = [...new Set(observed.map(o => o.id).filter(Boolean))];
  const observedByLabel = observed.map(o => o.label).filter(Boolean);
  check('five light presses walk the full chain',
    ['light1', 'light2', 'light3', 'light4', 'finisher'].every(id => ids.includes(id)),
    ids.join(' > '));
  const fifth = observed.find(o => o.id === 'finisher') || {};
  check('the fifth hit is the character\'s finisher, not a generic jab',
    fifth.label === lightLabelFor('thor', 5, MOVESETS.thor.lights),
    JSON.stringify(observed));
  const labels = observedByLabel;
  check('the chain uses Thor\'s own move names',
    labels.includes('Thunder Knee') && labels.includes('Lightning Strike'),
    labels.join(' > '));

  // ---- 4b. three heavies, not one ------------------------------------------------
  for (const [variant, keys, expected] of [
    ['forward', [], 'heavy'],
    ['launcher', ['KeyW'], 'heavyLauncher'],
    ['slam', ['KeyS'], 'heavySlam']
  ]) {
    await place();
    await page.evaluate(() => {
      const p = window.fighters[0];
      p.position.y = p.groundLevel ?? .6;
      for (let i = 0; i < 60 && !p.isGrounded; i++) window.__browserSmashStep(1 / 60);
      p.attackQueue.length = 0; p.comboStep = 0; p.comboWindow = 0; p.attackBuffer = 0;
    });
    await page.keyboard.down('Shift');
    for (const code of keys) await page.keyboard.down(code);
    await page.keyboard.press('j');
    await step(1 / 60);
    const heavy = await page.evaluate(() => {
      const p = window.fighters[0];
      const last = p.attackQueue[p.attackQueue.length - 1] || null;
      return { id: p.activeMoveId, label: last?.label || null, launcher: !!last?.launcher };
    });
    for (const code of keys) await page.keyboard.up(code);
    await page.keyboard.up('Shift');
    await step(.4);
    check(`shift+${variant === 'forward' ? 'J' : 'W/S'} + J resolves the ${variant} heavy`,
      heavy.id === expected, JSON.stringify(heavy));
    if (variant === 'launcher') {
      check('the launcher is a real launcher with its own name',
        heavy.launcher === true && heavy.label === MOVESETS.thor.heavy[1], JSON.stringify(heavy));
    }
    if (variant === 'slam') {
      check('the ground slam has its own third heavy name',
        heavy.label === 'Mjolnir Ground Slam', JSON.stringify(heavy));
    }
  }

  // ---- 5. the CPU spends its kit slots too --------------------------------------
  // The CPU decides in the render loop (its getInputs runs per frame), so stepping the fixed
  // simulation does not give it a turn. Wait on real animation frames instead.
  const cpu = await page.evaluate(async () => {
    window.__browserSmashTrainingDummy = false;
    const [, c] = window.fighters;
    c.abilityReadyAt = {};
    c.abilityLastCast = null;
    for (let i = 0; i < 480 && !c.abilityLastCast; i++) {
      await new Promise(done => requestAnimationFrame(done));
    }
    return { last: c.abilityLastCast, readyAt: c.abilityReadyAt || {} };
  });
  check('the CPU casts kit abilities without a scripted call', Boolean(cpu.last?.label),
    JSON.stringify(cpu));

  check('no page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  console.log(`\nAbility kit verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
