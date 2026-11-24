// Live arena gameplay verification.
//
// This drives the actual Vite game at http://127.0.0.1:3000 with a real browser and real
// keyboard events. It verifies the character-select -> arena-select -> match-start flow, spawn
// grounding, movement, jumping, attacks, guarding, dodging, signature moves, collision, arena
// boundaries, camera framing/occlusion, animations and runtime asset/console errors.
//
// On Wuhu it also walks the real fighter from the normal spawn to the land bridge and onto the
// Sunshine Airport shelf. The route controller uses the game's own input handler (KeyboardEvent)
// and the same fixed simulation step as the rest of the suite; it never sets velocity directly.
//
//   BROWSER_BIN=/path/to/chrome bash scripts/run-browser-test.sh scripts/verify-live-arenas.mjs --map konoha_overlook
//   ... --map skyloft
//   ... --map mariokart
//
// The report and screenshots are written under artifacts/live-arena-verification/.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAPS = {
  konoha_overlook: {
    key: 'konoha_overlook',
    label: 'Konoha · Hidden Leaf Village',
    fighters: ['Goku', 'Naruto Uzumaki'],
    collisionClasses: ['wall', 'steep', 'low'],
    // The two imported steep cells sit against the east boundary. A west-face approach at the
    // south end is the clear lane: the wall-side lane either slides around the corner or ends
    // inside the face. This is a real world-space approach, still driven by keyboard events.
    collisionApproaches: {
      steep: { block: [2.5, 8.5, -106.5, -105.75], approach: { name: 'west', x: -.1, z: -106.275 } }
    },
    route: false
  },
  skyloft: {
    key: 'skyloft',
    label: 'Skyloft · Skyward Isle',
    fighters: ['Goku', 'Naruto Uzumaki'],
    collisionClasses: ['wall', 'steep', 'low'],
    route: false
  },
  mariokart: {
    key: 'mariokart',
    label: 'Mario Kart · Wuhu Island Headland',
    fighters: ['Goku', 'Naruto Uzumaki'],
    collisionClasses: ['wall', 'steep', 'low'],
    // Use the atoll-side low boulder and an interior steep face. The first generated steep cell
    // is clipped by the east boundary and the first low cell is a 26 m combined cliff, neither of
    // which gives a clean single-face approach.
    collisionApproaches: {
      steep: { block: [-29.25, -25.5, -21.5, -20.75], approach: { name: 'south', x: -27.375, z: -18.95 } },
      low: { block: [-30.75, -29.25, -12.5, -11.75], approach: { name: 'east', x: -27.45, z: -12.125 } }
    },
    route: true
  }
};

const requested = process.argv.indexOf('--map') >= 0 ? process.argv[process.argv.indexOf('--map') + 1] : null;
const keys = requested ? [requested] : Object.keys(MAPS);
if (keys.some(key => !MAPS[key])) {
  console.error(`Unknown map: ${keys.find(key => !MAPS[key])}`);
  process.exit(2);
}

const root = process.cwd();
const url = process.env.ARENA_URL || 'http://127.0.0.1:3000/';
const browserExecutable = process.env.BROWSER_BIN || undefined;
const screenshotDir = resolve(root, 'artifacts/live-arena-verification');

function addCheck(results, id, name, passed, detail, category = 'gameplay') {
  const status = passed === null ? 'skipped' : passed ? 'passed' : 'failed';
  const entry = { id, name, category, status, passed: passed === null ? null : Boolean(passed), detail };
  results.push(entry);
  console.log(`${status.toUpperCase()} [${category}] ${name}${detail === undefined ? '' : ' · ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
  return entry;
}

async function openMap(map) {
  const outDir = resolve(screenshotDir, map.key);
  await mkdir(outDir, { recursive: true });
  const results = [];
  const screenshots = [];
  let animationsReport = null;
  let cameraReport = null;
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const responses = [];
  let browser;
  let fatal = null;

  try {
    browser = await chromium.launch({
      headless: true,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(180_000);
    page.on('pageerror', error => pageErrors.push(String(error?.stack || error?.message || error).split('\n')[0]));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(String(message.text()).slice(0, 500));
    });
    page.on('requestfailed', request => {
      if (!/favicon\.ico/.test(request.url())) requestFailures.push({
        url: request.url(), error: request.failure()?.errorText || 'request failed'
      });
    });
    page.on('response', response => {
      if (!/favicon\.ico/.test(response.url())) responses.push({ url: response.url(), status: response.status() });
    });

    const step = seconds => page.evaluate(value => window.__browserSmashStep(value), Number(seconds));
    const freeze = value => page.evaluate(next => window.__browserSmashSetPaused(next), Boolean(value));
    async function screenshot(name) {
      await page.waitForTimeout(250);
      await freeze(true);
      await page.waitForTimeout(180);
      const path = resolve(outDir, name);
      await page.screenshot({ path });
      await freeze(false);
      screenshots.push({ name, path: path.slice(root.length + 1) });
      console.log(`SHOT ${path.slice(root.length + 1)}`);
    }
    // Route endpoints are also inspected from a fixed world-space camera. The wide duel shot
    // proves the route; these close-ups make the land bridge and airport shelf legible without
    // switching to a mock scene or a hand-built renderer. The bridge sits in a cliff slot, so a
    // high three-quarter view is the only angle that clears the foreground rocks.
    async function endpointCamera(name, { position, target, fov = 50 }) {
      const path = resolve(outDir, name);
      await page.evaluate(({ position, target, fov }) => {
        window.__wuhuCameraUpdate = window.smashCamera.update;
        window.smashCamera.update = () => {};
        window.__browserSmashSetPaused(true);
        const style = document.createElement('style');
        style.id = 'wuhu-evidence-hide';
        style.textContent = '#bbHudLayer,#bbClock,#bbMatchBar,#ocButton,#onlineCharacters,#help,#status{display:none!important}';
        document.head.appendChild(style);
        const camera = window.smashCamera.camera;
        camera.position.set(...position);
        camera.lookAt(...target);
        camera.fov = fov;
        camera.near = .05;
        camera.updateProjectionMatrix();
        window.__browserSmashRenderer?.render?.(window.__browserSmashScene, camera);
      }, { position, target, fov });
      await page.waitForTimeout(350);
      await page.screenshot({ path });
      await page.evaluate(() => {
        document.getElementById('wuhu-evidence-hide')?.remove();
        if (window.__wuhuCameraUpdate) {
          window.smashCamera.update = window.__wuhuCameraUpdate;
          delete window.__wuhuCameraUpdate;
        }
        window.__browserSmashSetPaused(false);
      });
      await page.waitForTimeout(250);
      screenshots.push({ name, path: path.slice(root.length + 1), camera: { position, target, fov } });
      console.log(`SHOT ${path.slice(root.length + 1)}`);
    }

    // ---- Real menu flow -----------------------------------------------------
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
      null, { timeout: 180_000, polling: 250 });
    addCheck(results, 'boot', 'the live game boots to the title screen',
      (await page.title()).includes('Browser Bros'), await page.title(), 'boot');
    await page.click('#bbTitle [data-nav="versus"]');
    await page.waitForSelector('#selectScreen .bs-card', { state: 'visible' });
    const selection = await page.evaluate(() => ({
      cards: document.querySelectorAll('#selectScreen .bs-card').length,
      launch: window.characterRosters?.launch?.length || 0,
      arenas: [...document.querySelectorAll('#selectScreen .bs-arena')].map(node => node.dataset.arena),
      modeButtons: [...document.querySelectorAll('#selectScreen [data-mode]')].map(node => node.dataset.mode)
    }));
    addCheck(results, 'roster', 'the full roster is selectable from the live setup screen',
      selection.cards === selection.launch && selection.cards >= 32, `${selection.cards}/${selection.launch} cards`, 'menu');
    addCheck(results, 'arena-list', 'the three target arenas are present in map select',
      ['konoha_overlook', 'skyloft', 'mariokart'].every(key => selection.arenas.includes(key)),
      selection.arenas.filter(key => /konoha|skyloft|mariokart/.test(key)), 'menu');
    addCheck(results, 'modes', '1P vs CPU and 2P local are both offered', selection.modeButtons.includes('1p')
      && selection.modeButtons.includes('2p'), selection.modeButtons, 'menu');

    // Use 2P local so both bodies are under human control; this removes CPU randomness from the
    // control and collision measurements while still running the real match simulation.
    await page.click('#selectScreen .bs-mode [data-mode="2p"]');
    await page.click('#selectScreen .bs-card[data-fighter="Goku"]');
    await page.click('#selectScreen .bs-side[data-side="p2"]');
    await page.click('#selectScreen .bs-card[data-fighter="Naruto Uzumaki"]');
    await page.click('#selectScreen [data-nav="next"]');
    await page.click(`#selectScreen .bs-arena[data-arena="${map.key}"]`);
    const chosen = await page.evaluate(() => ({
      map: document.querySelector('#menuMapSelect')?.value,
      p1: document.querySelector('#p1Character')?.value,
      p2: document.querySelector('#cpuCharacter')?.value,
      playVisible: !document.querySelector('#play')?.hidden,
      step2: !document.querySelector('.bs-step[data-step="2"]')?.hidden
    }));
    addCheck(results, 'select-map', 'choosing the arena advances to a startable match',
      chosen.map === map.key && chosen.step2 && chosen.playVisible, chosen, 'menu');
    addCheck(results, 'select-fighters', 'both selected fighters reach the live fighter slots',
      chosen.p1 === 'Goku' && chosen.p2 === 'Naruto Uzumaki', chosen, 'menu');

    await page.click('#play');
    await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null,
      { timeout: 60_000, polling: 100 });
    await page.waitForFunction(key => {
      const arena = window.__browserSmashAssets?.arenas?.[key];
      return arena && arena.status !== 'loading';
    }, map.key, { timeout: 180_000, polling: 250 });
    await page.waitForFunction(() => window.fighters.every(fighter => fighter.model?.visible
      && Object.keys(fighter.model?.userData?.animationActions || {}).length > 0),
      null, { timeout: 60_000, polling: 200 }).catch(() => {});
    await step(0.05);
    const arenaStatus = await page.evaluate(key => window.__browserSmashAssets?.arenas?.[key] || null, map.key);
    addCheck(results, 'arena-loaded', `${map.label} finishes streaming into the live match`,
      arenaStatus?.status === 'loaded', arenaStatus, 'assets');
    addCheck(results, 'match-live', 'the live match is fighting on the chosen arena',
      (await page.evaluate(() => window.__browserSmashMatch())).arena === map.key, map.key, 'boot');

    // ---- Spawn -------------------------------------------------------------
    const spawn = await page.evaluate(() => {
      const layout = window.__browserSmashLayout();
      return {
        match: window.__browserSmashMatch(),
        layout: { bounds: layout.bounds, ground: layout.ground, spawns: layout.spawns, blocks: layout.blocks?.length, heightAt: typeof layout.heightAt },
        fighters: window.fighters.map(fighter => ({
          identity: fighter.identity,
          position: fighter.position.toArray(),
          groundLevel: fighter.groundLevel,
          isGrounded: fighter.isGrounded,
          modelVisible: fighter.model?.visible !== false,
          clips: Object.keys(fighter.model?.userData?.animationActions || {}).length,
          radius: fighter.hurtboxRadius
        })),
        gap: window.fighters[0].position.distanceTo(window.fighters[1].position)
      };
    });
    const inBounds = (position, layout) => position.x >= layout.bounds.x0 - .01
      && position.x <= layout.bounds.x1 + .01 && position.z >= layout.bounds.z0 - .01
      && position.z <= layout.bounds.z1 + .01;
    addCheck(results, 'spawn-grounded', 'both fighters spawn grounded on the arena surface',
      spawn.fighters.every(fighter => fighter.isGrounded
        && Math.abs(fighter.position[1] - fighter.groundLevel) <= .15),
      spawn.fighters.map(fighter => ({ y: +fighter.position[1].toFixed(2), ground: +fighter.groundLevel.toFixed(2), grounded: fighter.isGrounded })), 'spawn');
    addCheck(results, 'spawn-bounds', 'both spawns are inside the playable rectangle',
      spawn.fighters.every(fighter => inBounds({ x: fighter.position[0], z: fighter.position[2] }, spawn.layout)),
      spawn.layout.bounds, 'spawn');
    addCheck(results, 'spawn-separated', 'the fighters spawn apart rather than overlapping',
      spawn.gap > 2.0, `${spawn.gap.toFixed(2)} m`, 'spawn');
    addCheck(results, 'spawn-models', 'both selected models and their animation sets are present at spawn',
      spawn.fighters.every(fighter => fighter.modelVisible && fighter.clips > 0),
      spawn.fighters.map(fighter => ({ identity: fighter.identity, clips: fighter.clips })), 'animations');
    await screenshot('01-spawn.png');

    const bounds = spawn.layout.bounds;
    const radius = spawn.fighters[0].radius || .6;

    // ---- Movement, sprint, jump ------------------------------------------
    const moveProbes = [];
    for (const key of ['w', 'a', 's', 'd']) {
      await page.evaluate(() => window.__browserSmashSpawnFighters());
      await step(0.05);
      const start = await page.evaluate(() => window.fighters[0].position.toArray());
      await page.keyboard.down(key);
      await step(0.55);
      await page.keyboard.up(key);
      const end = await page.evaluate(() => window.fighters[0].position.toArray());
      moveProbes.push({ key, distance: +Math.hypot(end[0] - start[0], end[2] - start[2]).toFixed(2), start, end });
    }
    const bestMove = moveProbes.reduce((best, probe) => probe.distance > best.distance ? probe : best, moveProbes[0]);
    addCheck(results, 'movement', 'P1 moves under real keyboard input',
      bestMove.distance > 1.0, moveProbes, 'controls');
    const p2Probes = [];
    for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
      await page.evaluate(() => window.__browserSmashSpawnFighters());
      await step(0.05);
      const start = await page.evaluate(() => window.fighters[1].position.toArray());
      await page.keyboard.down(key);
      await step(0.55);
      await page.keyboard.up(key);
      const end = await page.evaluate(() => window.fighters[1].position.toArray());
      p2Probes.push({ key, distance: +Math.hypot(end[0] - start[0], end[2] - start[2]).toFixed(2), start, end });
    }
    const bestP2 = p2Probes.reduce((best, probe) => probe.distance > best.distance ? probe : best, p2Probes[0]);
    addCheck(results, 'p2-movement', 'P2 steers with the arrow keys', bestP2.distance > 1.0,
      { best: bestP2, probes: p2Probes }, 'controls');

    // A flat, clear pad inside this arena, used only for controlled combat probes. Spawn and route
    // checks above stay on the map's own spawn points.
    const pad = await page.evaluate(() => {
      const layout = window.__browserSmashLayout();
      const b = layout.bounds;
      const solid = (x, z, h) => window.__browserSmashSolidAt(x, h + .25, z)
        || window.__browserSmashSolidAt(x, h + 1.2, z);
      const candidates = [];
      for (let z = b.z0 + 2; z <= b.z1 - 2; z += 1) {
        for (let x = b.x0 + 2; x <= b.x1 - 2; x += 1) {
          const h = layout.heightAt(x, z);
          if (!Number.isFinite(h) || h < -4.05) continue;
          let clear = true;
          for (const [dx, dz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) {
            const hh = layout.heightAt(x + dx, z + dz);
            if (!Number.isFinite(hh) || Math.abs(hh - h) > .55 || solid(x + dx, z + dz, hh)) { clear = false; break; }
          }
          if (clear) candidates.push({ x, z, h, distance: Math.hypot(x - (b.x0 + b.x1) / 2, z - (b.z0 + b.z1) / 2) });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0] || null;
    });
    async function placePad() {
      if (!pad) return null;
      return page.evaluate(pad => {
        const layout = window.__browserSmashLayout();
        const [p1, p2] = window.fighters;
        const p2x = pad.x + 1.05;
        const p2y = layout.heightAt(p2x, pad.z);
        for (const [fighter, x, z, side] of [[p1, pad.x, pad.z, 1], [p2, p2x, pad.z, -1]]) {
          const y = layout.heightAt(x, z);
          fighter.position.set(x, y, z);
          fighter.velocity.set(0, 0, 0);
          fighter.hitstun = 0; fighter.guardBreak = 0; fighter.ko = false; fighter.down = false;
          fighter.isGrounded = true; fighter.groundLevel = y; fighter.jumps = 0; fighter.invuln = 0;
          fighter.invulnerable = 0; fighter.shield = 100; fighter.guardHeld = false;
          fighter.attackQueue.length = 0; fighter.attackBuffer = 0; fighter.hitboxes.length = 0;
          fighter.facing = side; fighter.facingZ = 0;
        }
        window.__browserSmashStep(0.08);
        return { p1: p1.position.toArray(), p2: p2.position.toArray(), pad, p2y };
      }, pad);
    }
    const padState = await placePad();
    addCheck(results, 'clear-pad', 'a clear arena patch is available for controlled combat probes',
      Boolean(padState), padState ? { x: padState.pad.x, z: padState.pad.z } : 'no pad found', 'controls');

    if (padState) {
      const sprintProbes = [];
      for (const key of ['d', 'a', 'w', 's']) {
        await placePad();
        // Fighter3D only switches from run to sprint after the sprint key has been held for .7 s.
        // Hold it in place first, then add a direction, so this measures the sprint lane rather
        // than the run lane (and does not require a runway long enough to cross the whole arena).
        await page.keyboard.down('ShiftLeft');
        await step(0.78);
        await page.keyboard.down(key);
        await step(0.30);
        const probe = await page.evaluate(() => ({
          speed: +Math.hypot(window.fighters[0].velocity.x, window.fighters[0].velocity.z).toFixed(2),
          locomotion: window.fighters[0].lastLocomotion,
          position: window.fighters[0].position.toArray()
        }));
        await page.keyboard.up(key);
        await page.keyboard.up('ShiftLeft');
        sprintProbes.push({ key, ...probe });
      }
      const bestSprint = sprintProbes.reduce((best, probe) => probe.speed > best.speed ? probe : best, sprintProbes[0]);
      addCheck(results, 'sprint', 'holding sprint reaches run speed', bestSprint.speed > 5 && bestSprint.locomotion?.mode === 'sprint',
        { best: bestSprint, probes: sprintProbes.map(probe => ({ key: probe.key, speed: probe.speed, mode: probe.locomotion?.mode || null })) }, 'controls');

      await placePad();
      const jumpStart = await page.evaluate(() => window.fighters[0].position.y);
      await page.keyboard.press('Space');
      await step(0.12);
      const jumpOne = await page.evaluate(() => ({ y: window.fighters[0].position.y, jumps: window.fighters[0].jumps, grounded: window.fighters[0].isGrounded }));
      await step(0.12);
      await page.keyboard.press('Space');
      await step(0.08);
      const jumpTwo = await page.evaluate(() => ({ y: window.fighters[0].position.y, jumps: window.fighters[0].jumps, vy: window.fighters[0].velocity.y }));
      for (let i = 0; i < 30; i++) {
        await step(0.1);
        if (await page.evaluate(() => window.fighters[0].isGrounded && window.fighters[0].jumps === 0)) break;
      }
      const landed = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, jumps: window.fighters[0].jumps, y: window.fighters[0].position.y, ground: window.fighters[0].groundLevel }));
      addCheck(results, 'jump', 'SPACE launches the fighter', jumpOne.y > jumpStart + .35 && jumpOne.jumps === 1, { jumpStart, ...jumpOne }, 'controls');
      addCheck(results, 'double-jump', 'a second jump works in the air', jumpTwo.jumps === 2, jumpTwo, 'controls');
      addCheck(results, 'landing', 'the fighter lands back on the arena surface', landed.grounded && landed.jumps === 0 && Math.abs(landed.y - landed.ground) < .2, landed, 'controls');

      // ---- Combat ---------------------------------------------------------
      await placePad();
      const cleanBefore = await page.evaluate(() => window.fighters[1].percent);
      await page.keyboard.press('j');
      await step(0.2);
      const clean = await page.evaluate(() => ({
        percent: window.fighters[1].percent,
        hitstun: window.fighters[1].hitstun,
        combo: window.fighters[0].comboHitCount,
        active: window.fighters[0].attackQueue.length
      }));
      addCheck(results, 'attack', 'J lands a hit and deals damage', clean.percent > cleanBefore && clean.hitstun > 0,
        { ...clean, before: cleanBefore }, 'combat');

      await placePad();
      await page.evaluate(() => {
        const p2 = window.fighters[1];
        p2.percent = 0; p2.shield = 100; p2.guardHeld = false; p2.hitstun = 0; p2.invulnerable = 0;
      });
      await page.keyboard.down(';');
      await step(0.22);
      const guardState = await page.evaluate(() => ({ guardHeld: window.fighters[1].guardHeld, shield: window.fighters[1].shield }));
      await page.keyboard.press('j');
      await step(0.25);
      const guarded = await page.evaluate(() => ({ percent: window.fighters[1].percent, hitstun: window.fighters[1].hitstun, shield: window.fighters[1].shield }));
      await page.keyboard.up(';');
      addCheck(results, 'guard-input', 'P2 raises guard with ;', guardState.guardHeld === true, guardState, 'combat');
      addCheck(results, 'guard-damage', 'guarding reduces incoming damage', guarded.percent > 0 && guarded.percent < clean.percent,
        { guarded: guarded.percent, clean: clean.percent }, 'combat');

      await placePad();
      await page.keyboard.press('ShiftLeft');
      await step(0.06);
      const dodge = await page.evaluate(() => ({ timer: window.fighters[0].dodgeTimer, cooldown: window.fighters[0].dashCooldown, invuln: window.fighters[0].invulnerable }));
      addCheck(results, 'dodge', 'a dash tap starts the dodge state', dodge.timer > 0 && dodge.cooldown > 0, dodge, 'controls');

      await placePad();
      await page.evaluate(() => {
        const p1 = window.fighters[0], p2 = window.fighters[1];
        p2.position.x = p1.position.x + 3.2;
        p2.position.y = p1.groundLevel; p2.groundLevel = p1.groundLevel;
        p1.specialCooldown = 0;
      });
      await page.keyboard.press('k');
      await step(0.18);
      const special = await page.evaluate(() => ({
        cooldown: window.fighters[0].specialCooldown,
        lastShot: window.__browserSmashLastShot || null,
        label: window.fighters[0].specialProfile?.label || null
      }));
      addCheck(results, 'signature', 'K starts the selected fighter signature move', special.cooldown > 0,
        { cooldown: special.cooldown, label: special.label, lastShot: special.lastShot?.moveType || null }, 'combat');

      await placePad();
      await page.evaluate(() => { const p1 = window.fighters[0]; p1.percent = 0; p1.shield = 100; });
      await page.keyboard.press(',');
      await step(0.2);
      const p2Attack = await page.evaluate(() => ({ percent: window.fighters[0].percent, queue: window.fighters[1].attackQueue.length }));
      addCheck(results, 'p2-attack', 'P2 attacks with , and damages P1', p2Attack.percent > 0 || p2Attack.queue > 0,
        p2Attack, 'combat');

      // ---- Animation state ------------------------------------------------
      await placePad();
      const idleAnimation = await page.evaluate(() => {
        const fighter = window.fighters[0];
        const user = fighter.model?.userData || {};
        const actions = user.humanMixer?._actions || [];
        return {
          clips: Object.keys(user.animationActions || {}).length,
          active: actions.filter(a => a.isRunning?.() && (a.getEffectiveWeight?.() || 0) > .01)
            .map(a => a.getClip?.().name || a._clip?.name || '?'),
          model: Boolean(fighter.model), visible: fighter.model?.visible !== false
        };
      });
      await page.keyboard.press('w');
      await step(0.2);
      const movingAnimation = await page.evaluate(() => {
        const fighter = window.fighters[0];
        const user = fighter.model?.userData || {};
        const actions = user.humanMixer?._actions || [];
        return {
          active: actions.filter(a => a.isRunning?.() && (a.getEffectiveWeight?.() || 0) > .01)
            .map(a => a.getClip?.().name || a._clip?.name || '?'),
          mode: fighter.lastLocomotion?.mode || null
        };
      });
      addCheck(results, 'animations', 'the live models have animation clips and an active mixer', idleAnimation.model
        && idleAnimation.visible && idleAnimation.clips >= 5 && idleAnimation.active.length > 0,
        idleAnimation, 'animations');
      addCheck(results, 'animation-state', 'movement changes the animation/locomotion state',
        movingAnimation.active.length > 0 && (movingAnimation.mode !== idleAnimation.mode
          || movingAnimation.active.join('|') !== idleAnimation.active.join('|')),
        { idle: idleAnimation.active, moving: movingAnimation.active, mode: movingAnimation.mode }, 'animations');

      // ---- Camera ---------------------------------------------------------
      await placePad();
      // Let the damped camera settle onto the close combat pair after the controlled teleport.
      // Without this, the shot is still travelling from the spawn framing and reports a stale
      // distance/occlusion for the position under test.
      await step(1.1);
      const camera = await page.evaluate(() => {
        const THREE = window.__browserSmashThree;
        const camera = window.__browserSmashCamera;
        const scene = window.__browserSmashScene;
        const layout = window.__browserSmashLayout();
        const [a, b] = window.fighters;
        camera.updateMatrixWorld(true);
        const ignored = new Set();
        for (const fighter of window.fighters) fighter.model?.traverse(object => ignored.add(object.uuid));
        // A lingering hit spark, impact ring or signature aura is not world geometry. Ignoring
        // these transient meshes keeps the occlusion check measuring the arena and camera rather
        // than a VFX frame that happens to sit between the lens and a fighter.
        const transient = new Set();
        for (const effect of window.__browserSmashEffects?.() || []) {
          const group = effect?.group || effect;
          group?.traverse?.(object => transient.add(object.uuid));
        }
        const ray = new THREE.Raycaster();
        const checks = [];
        for (const fighter of window.fighters) {
          const target = fighter.position.clone(); target.y += 1.15;
          const direction = target.clone().sub(camera.position);
          const distance = direction.length();
          direction.normalize();
          ray.set(camera.position, direction); ray.near = .08; ray.far = Math.max(.1, distance - .55);
          const visible = object => {
            let node = object;
            while (node) { if (node.visible === false) return false; node = node.parent; }
            return true;
          };
          const hits = ray.intersectObjects(scene.children, true).filter(hit => hit.object?.isMesh
            && visible(hit.object) && !ignored.has(hit.object.uuid) && !transient.has(hit.object.uuid)
            && !hit.object.material?.transparent);
          const ndc = target.clone().project(camera);
          checks.push({
            id: fighter.identity,
            onScreen: Math.abs(ndc.x) < .94 && Math.abs(ndc.y) < .94 && ndc.z < 1,
            ndc: { x: +ndc.x.toFixed(2), y: +ndc.y.toFixed(2) },
            distance: +distance.toFixed(2),
            occludedBy: hits[0] ? { name: hits[0].object.name || hits[0].object.parent?.name || 'mesh', at: +hits[0].distance.toFixed(2), type: hits[0].object.type, path: (() => { const path = []; let node = hits[0].object; while (node && path.length < 6) { path.push(node.name || node.type); node = node.parent; } return path; })() } : null
          });
        }
        const mid = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 + 1, z: (a.position.z + b.position.z) / 2 };
        const p = camera.position;
        return {
          fov: camera.fov,
          position: p.toArray().map(v => +v.toFixed(2)),
          distance: +Math.hypot(p.x - mid.x, p.y - mid.y, p.z - mid.z).toFixed(2),
          aboveGround: p.y > Math.max(a.groundLevel || 0, b.groundLevel || 0) + .8,
          insideSolid: Boolean(window.__browserSmashSolidAt(p.x, p.y, p.z, layout)),
          checks
        };
      });
      addCheck(results, 'camera-framing', 'the gameplay camera frames both fighters on screen',
        camera.checks.every(check => check.onScreen), camera.checks.map(c => ({ id: c.id, onScreen: c.onScreen, ndc: c.ndc })), 'camera');
      addCheck(results, 'camera-clear', 'neither fighter is occluded from the gameplay camera', camera.checks.every(check => !check.occludedBy),
        camera.checks.map(c => ({ id: c.id, occludedBy: c.occludedBy })), 'camera');
      addCheck(results, 'camera-distance', 'the camera stays pulled back, elevated and outside solid geometry',
        camera.distance > 4.5 && camera.aboveGround && !camera.insideSolid, { distance: camera.distance, y: camera.position[1], aboveGround: camera.aboveGround, insideSolid: camera.insideSolid }, 'camera');
      animationsReport = { idle: idleAnimation, moving: movingAnimation };
      cameraReport = camera;

      await screenshot('02-combat.png');
    }

    // ---- Collision and boundaries ---------------------------------------
    const collision = await page.evaluate(({ collisionClasses, collisionApproaches, bounds, radius }) => {
      const THREE = window.__browserSmashThree;
      const layout = window.__browserSmashLayout();
      const [p1, p2] = window.fighters;
      const camera = window.__browserSmashCamera;
      // Keep the camera-relative keyboard mapping stable across collision probes. Without this,
      // the live camera keeps following the fighter and the same world-space approach can produce
      // different key combinations after an earlier probe has moved the bodies.
      const savedCameraUpdate = window.smashCamera.update;
      window.smashCamera.update = () => {};
      const positionProbeCamera = (x, z, h, targetX, targetZ) => {
        const dx = targetX - x, dz = targetZ - z;
        const length = Math.hypot(dx, dz) || 1;
        camera.position.set(x - (dx / length) * 8, h + 5, z - (dz / length) * 8);
        camera.lookAt(targetX, h + 1, targetZ);
        camera.updateMatrixWorld();
      };
      const rayDirection = new THREE.Vector3();
      const right = new THREE.Vector3();
      const pointInBlock = (x, z, block) => block.r != null
        ? Math.hypot(x - block.x, z - block.z) <= block.r
        : x >= block.x0 && x <= block.x1 && z >= block.z0 && z <= block.z1;
      const blockGap = (x, z, block) => {
        if (block.r != null) return Math.max(0, Math.hypot(x - block.x, z - block.z) - block.r);
        const dx = Math.max(block.x0 - x, 0, x - block.x1);
        const dz = Math.max(block.z0 - z, 0, z - block.z1);
        return Math.hypot(dx, dz);
      };
      const solidAt = (x, z, y) => window.__browserSmashSolidAt(x, y, z);
      const startClear = (x, z, h) => {
        if (!Number.isFinite(h) || h < (layout.ground ?? -4.5) - .05) return false;
        for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
          if (solidAt(x + dx, z + dz, h + .25) || solidAt(x + dx, z + dz, h + 1.2)) return false;
        }
        return true;
      };
      const sideCandidates = (block, zc, xc) => [
        { name: 'west', x: block.x0 - 1.8, z: zc, dx: 1, dz: 0 },
        { name: 'east', x: block.x1 + 1.8, z: zc, dx: -1, dz: 0 },
        { name: 'north', x: xc, z: block.z0 - 1.8, dx: 0, dz: 1 },
        { name: 'south', x: xc, z: block.z1 + 1.8, dx: 0, dz: -1 }
      ];
      const findApproach = block => {
        const xc = block.r != null ? block.x : (block.x0 + block.x1) / 2;
        const zc = block.r != null ? block.z : (block.z0 + block.z1) / 2;
        const sides = block.r != null ? [
          { name: 'west', x: xc - block.r - 1.8, z: zc, dx: 1, dz: 0 },
          { name: 'east', x: xc + block.r + 1.8, z: zc, dx: -1, dz: 0 },
          { name: 'north', x: xc, z: zc - block.r - 1.8, dx: 0, dz: 1 },
          { name: 'south', x: xc, z: zc + block.r + 1.8, dx: 0, dz: -1 }
        ] : sideCandidates(block, zc, xc);
        for (const side of sides) {
          if (side.x < bounds.x0 + radius || side.x > bounds.x1 - radius
            || side.z < bounds.z0 + radius || side.z > bounds.z1 - radius) continue;
          const h = layout.heightAt(side.x, side.z);
          if (!startClear(side.x, side.z, h)) continue;
          if (block.top == null || block.top <= h + .55) continue;
          if (block.bottom != null && block.bottom > h + 1.85) continue;
          let clear = true;
          for (let i = 1; i <= 8; i++) {
            const t = i / 8;
            const x = side.x + (xc - side.x) * t * .82;
            const z = side.z + (zc - side.z) * t * .82;
            const hh = layout.heightAt(x, z);
            if (!Number.isFinite(hh) || Math.abs(hh - h) > .30 || hh > block.top - .60
              || solidAt(x, z, hh + .25) || solidAt(x, z, hh + 1.2)) { clear = false; break; }
          }
          if (!clear) continue;
          return { ...side, h };
        }
        return null;
      };
      const press = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
        code, key: code === 'Space' ? ' ' : code.slice(-1).toLowerCase(), bubbles: true
      }));
      const holdTowards = (desiredX, desiredZ, frames = 84) => {
        const held = new Set();
        let minGap = Infinity, maxMove = 0;
        const start = p1.position.clone();
        for (let frame = 0; frame < frames; frame++) {
          camera.getWorldDirection(rayDirection); rayDirection.y = 0; rayDirection.normalize();
          right.set(-rayDirection.z, 0, rayDirection.x);
          const desired = new THREE.Vector3(desiredX, 0, desiredZ).normalize();
          const forwardDot = desired.dot(rayDirection);
          const rightDot = desired.dot(right);
          const wanted = new Set();
          if (forwardDot > .28) wanted.add('KeyW');
          if (forwardDot < -.28) wanted.add('KeyS');
          if (rightDot > .28) wanted.add('KeyD');
          if (rightDot < -.28) wanted.add('KeyA');
          for (const code of [...held]) if (!wanted.has(code)) { press(code, false); held.delete(code); }
          for (const code of wanted) if (!held.has(code)) { press(code, true); held.add(code); }
          window.__browserSmashStep(1 / 60);
          minGap = Math.min(minGap, blockGap(p1.position.x, p1.position.z, testBlock));
          maxMove = Math.max(maxMove, Math.hypot(p1.position.x - start.x, p1.position.z - start.z));
          if (p1.position.y < layout.ground - 5) break;
        }
        for (const code of held) press(code, false);
        window.__browserSmashStep(.08);
        return {
          minGap: +minGap.toFixed(3), moved: +maxMove.toFixed(2),
          end: p1.position.toArray().map(v => +v.toFixed(2)),
          grounded: p1.isGrounded, ground: +p1.groundLevel.toFixed(2)
        };
      };
      let testBlock = null;
      const tests = [];
      for (const kind of collisionClasses) {
        // A map may name a verified clear face where the generated cells are clipped by the arena
        // boundary or cornered by a neighbouring wall. The configured approach is still a normal
        // world-space start point; the fighter reaches it through the same keyboard controller.
        let picked = null, approach = null;
        const configured = collisionApproaches?.[kind];
        if (configured) {
          const [x0, x1, z0, z1] = configured.block;
          picked = (layout.blocks || []).find(block => block.r == null
            && Math.abs(block.x0 - x0) < .01 && Math.abs(block.x1 - x1) < .01
            && Math.abs(block.z0 - z0) < .01 && Math.abs(block.z1 - z1) < .01) || null;
          if (picked) {
            const h = layout.heightAt(configured.approach.x, configured.approach.z);
            approach = { ...configured.approach, h };
            if (!Number.isFinite(h) || !startClear(configured.approach.x, configured.approach.z, h)
              || picked.top == null || picked.top <= h + .55) {
              picked = null; approach = null;
            }
          }
        }
        const predicate = kind === 'wall'
          ? (block => block.wall && !block.steep && block.top != null)
          : kind === 'steep'
            ? (block => block.steep && block.top != null)
            : (block => block.lowBoulder && block.top != null);
        if (!picked) {
          for (const block of layout.blocks || []) {
            if (!predicate(block)) continue;
            const candidate = findApproach(block);
            if (!candidate) continue;
            picked = block; approach = candidate; break;
          }
        }
        if (!picked) {
          tests.push({ kind, skipped: 'no clear approach in this arena' });
          continue;
        }
        testBlock = picked;
        const p2Home = p2.position.clone();
        p1.position.set(approach.x, approach.h, approach.z);
        p1.velocity.set(0, 0, 0); p1.hitstun = 0; p1.guardBreak = 0; p1.ko = false; p1.down = false;
        p1.isGrounded = true; p1.groundLevel = approach.h; p1.attackQueue.length = 0; p1.invulnerable = 0;
        p2.position.set(bounds.x0 + 3, layout.heightAt(bounds.x0 + 3, bounds.z0 + 3), bounds.z0 + 3);
        p2.velocity.set(0, 0, 0);
        window.__browserSmashStep(.05);
        const targetX = picked.r != null ? picked.x : (picked.x0 + picked.x1) / 2;
        const targetZ = picked.r != null ? picked.z : (picked.z0 + picked.z1) / 2;
        positionProbeCamera(approach.x, approach.z, approach.h, targetX, targetZ);
        const result = holdTowards(targetX - p1.position.x, targetZ - p1.position.z, 84);
        const startGap = blockGap(approach.x, approach.z, picked);
        const finalGap = blockGap(p1.position.x, p1.position.z, picked);
        const final = { x: p1.position.x, z: p1.position.z };
        const stoppedOutside = approach.name === 'west' ? final.x <= picked.x0 - radius + .30
          : approach.name === 'east' ? final.x >= picked.x1 + radius - .30
            : approach.name === 'north' ? final.z <= picked.z0 - radius + .30
              : final.z >= picked.z1 + radius - .30;
        const crossed = approach.name === 'west' ? final.x > picked.x1
          : approach.name === 'east' ? final.x < picked.x0
            : approach.name === 'north' ? final.z > picked.z1
              : final.z < picked.z0;
        const climbed = p1.groundLevel > approach.h + .35;
        tests.push({
          kind, skipped: null, block: picked, approach, startGap: +startGap.toFixed(2),
          ...result, finalGap: +finalGap.toFixed(3), stoppedOutside, crossed, climbed,
          penetrates: result.minGap < radius - .12,
          contacted: result.minGap < radius + .45,
          passed: result.moved > .25 && stoppedOutside && !crossed && finalGap >= radius - .30
        });
        p2.position.copy(p2Home);
      }
      window.smashCamera.update = savedCameraUpdate;
      return tests;
    }, { collisionClasses: map.collisionClasses, collisionApproaches: map.collisionApproaches || {}, bounds, radius });
    for (const test of collision) {
      if (test.skipped) {
        addCheck(results, `collision-${test.kind}`, `${test.kind} collision probe`, null, test.skipped, 'collision');
      } else {
        addCheck(results, `collision-${test.kind}`, `${test.kind} solids block a walking fighter without penetration`,
          test.passed, { block: test.block, approach: test.approach, ...test }, 'collision');
      }
    }

    const boundary = await page.evaluate(({ bounds, radius }) => {
      const THREE = window.__browserSmashThree;
      const layout = window.__browserSmashLayout();
      const [p1, p2] = window.fighters;
      const camera = window.__browserSmashCamera;
      const fwd = new THREE.Vector3(), right = new THREE.Vector3();
      const solid = (x, z) => {
        const h = layout.heightAt(x, z);
        return !Number.isFinite(h) || h < -4.05 || window.__browserSmashSolidAt(x, h + .25, z)
          || window.__browserSmashSolidAt(x, h + 1.2, z);
      };
      const lanes = [];
      for (let z = bounds.z0 + 2; z <= bounds.z1 - 2; z += 1) {
        const x = bounds.x1 - 2.2;
        if (!solid(x, z)) lanes.push({ x, z, h: layout.heightAt(x, z), axis: 'x', limit: bounds.x1, dirX: 1, dirZ: 0 });
      }
      for (let x = bounds.x0 + 2; x <= bounds.x1 - 2; x += 1) {
        const z = bounds.z0 + 2.2;
        if (!solid(x, z)) lanes.push({ x, z, h: layout.heightAt(x, z), axis: 'z', limit: bounds.z0, dirX: 0, dirZ: -1 });
      }
      const lane = lanes[0];
      if (!lane) return { skipped: 'no clear boundary lane' };
      p1.position.set(lane.x, lane.h, lane.z); p1.velocity.set(0, 0, 0); p1.hitstun = 0;
      p1.isGrounded = true; p1.groundLevel = lane.h; p1.attackQueue.length = 0;
      p2.position.set(bounds.x0 + 4, layout.heightAt(bounds.x0 + 4, bounds.z0 + 4), bounds.z0 + 4);
      window.__browserSmashStep(.05);
      const start = p1.position.clone();
      const held = new Set();
      let maxCoordinate = lane.axis === 'x' ? p1.position.x : -p1.position.z;
      let minCoordinate = lane.axis === 'x' ? p1.position.x : p1.position.z;
      for (let frame = 0; frame < 78; frame++) {
        camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); right.set(-fwd.z, 0, fwd.x);
        const dotF = lane.dirX * fwd.x + lane.dirZ * fwd.z;
        const dotR = lane.dirX * right.x + lane.dirZ * right.z;
        const wanted = new Set();
        if (dotF > .28) wanted.add('KeyW'); if (dotF < -.28) wanted.add('KeyS');
        if (dotR > .28) wanted.add('KeyD'); if (dotR < -.28) wanted.add('KeyA');
        for (const code of [...held]) if (!wanted.has(code)) { window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); held.delete(code); }
        for (const code of wanted) if (!held.has(code)) { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); held.add(code); }
        window.__browserSmashStep(1 / 60);
        maxCoordinate = Math.max(maxCoordinate, lane.axis === 'x' ? p1.position.x : -p1.position.z);
        minCoordinate = Math.min(minCoordinate, lane.axis === 'x' ? p1.position.x : p1.position.z);
      }
      for (const code of held) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
      window.__browserSmashStep(.08);
      return {
        skipped: null, lane, start: start.toArray(), end: p1.position.toArray(),
        moved: +Math.hypot(p1.position.x - start.x, p1.position.z - start.z).toFixed(2),
        maxCoordinate: +maxCoordinate.toFixed(3), minCoordinate: +minCoordinate.toFixed(3), limit: lane.limit, radius,
        passed: (lane.axis === 'x' ? maxCoordinate <= lane.limit - radius + .06 : minCoordinate >= lane.limit + radius - .06)
          && Math.hypot(p1.position.x - start.x, p1.position.z - start.z) > .2
      };
    }, { bounds, radius });
        addCheck(results, 'boundary', 'the arena boundary clamps a walking fighter', boundary.skipped ? false : boundary.passed,
      boundary, 'collision');

    // ---- Wuhu spawn -> land bridge -> Sunshine Airport -------------------
    let route = null;
    if (map.route) {
      // Physical key state is browser-global: a key left down by an earlier probe can outlive the
      // synthetic keyup used inside the route controller and keep the fighter walking sideways.
      for (const key of ['w', 'a', 's', 'd', 'Shift']) await page.keyboard.up(key).catch(() => {});
      // A previous combat probe can leave the lens aimed at the old test pad. Respawn, restore the
      // authored duel shot and let it settle so screen-relative W/A/S/D starts from the same view
      // a real player gets at round start.
      await page.evaluate(() => {
        window.__browserSmashSpawnFighters();
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space']) {
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code === 'Space' ? ' ' : code.slice(-1).toLowerCase(), bubbles: true }));
        }
        const camera = window.smashCamera;
        if (camera) {
          // The pad probes can leave a composition yaw/lift cached from the old camera position.
          // A fresh round starts with no chosen adjustment, so restore that before the walk.
          camera.composition = { yaw: 0, lift: 0, scale: 1, timer: 0, choice: null, switches: 0 };
          camera.focusState = null;
          camera.cineState = null;
          camera.collisionReach = Infinity;
          camera.collisionLift = 0;
          camera.resetOrbit?.();
          camera.snap?.();
        }
      });
      await step(1.2);
      const runLeg = targets => page.evaluate(targets => {
        const THREE = window.__browserSmashThree;
        const layout = window.__browserSmashLayout();
        const f = window.fighters[0];
        const camera = window.__browserSmashCamera;
        const fwd = new THREE.Vector3(), right = new THREE.Vector3();
        const held = new Set();
        const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
          code, key: code === 'Space' ? ' ' : code.slice(-1).toLowerCase(), bubbles: true
        }));
        const clear = () => { for (const code of [...held]) key(code, false); held.clear(); };
        const log = [];
        for (const target of targets) {
          // Keep the screen-relative control basis stable from target to target. Letting the
          // composition solver retain the previous leg's yaw made the same route diverge after
          // the first waypoint even though the fighter's position was identical.
          if (window.smashCamera) {
            window.smashCamera.composition = { yaw: 0, lift: 0, scale: 1, timer: 0, choice: null, switches: 0 };
            window.smashCamera.orbitYaw = 0;
            window.smashCamera.snap?.();
            window.__browserSmashStep(1 / 60);
          }
          let jumps = 0, stagnant = 0, reached = false, last = f.position.clone();
          const trail = [];
          const debug = [];
          for (let tick = 0; tick < 600; tick++) {
            const dx = target.x - f.position.x, dz = target.z - f.position.z;
            if (Math.hypot(dx, dz) < 1.1) { reached = true; break; }
            camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); right.set(-fwd.z, 0, fwd.x);
            const desired = new THREE.Vector3(dx, 0, dz).normalize();
            const df = desired.dot(fwd), dr = desired.dot(right);
            const wanted = new Set();
            if (df > .14) wanted.add('KeyW'); if (df < -.14) wanted.add('KeyS');
            if (dr > .14) wanted.add('KeyD'); if (dr < -.14) wanted.add('KeyA');
            for (const code of [...held]) if (!wanted.has(code)) { key(code, false); held.delete(code); }
            for (const code of wanted) if (!held.has(code)) { key(code, true); held.add(code); }
            if (debug.length < 16 && (target.name === 'south coast' || target.name === 'south shelf edge') && (tick < 12 || tick % 30 === 0)) debug.push({
              tick, pos: [+f.position.x.toFixed(2), +f.position.y.toFixed(2), +f.position.z.toFixed(2)],
              ground: +f.groundLevel.toFixed(2), grounded: f.isGrounded, jumps,
              velocity: [+f.velocity.x.toFixed(2), +f.velocity.y.toFixed(2), +f.velocity.z.toFixed(2)],
              hitstun: f.hitstun, state: f.state, dodge: f.dodgeTimer, dash: f.dashCooldown,
              inputs: window.__browserSmashInputs?.(1) || null,
              solid: Boolean(window.__browserSmashSolidAt(f.position.x, f.position.y + .3, f.position.z)),
              fwd: [+fwd.x.toFixed(2), +fwd.z.toFixed(2)], right: [+right.x.toFixed(2), +right.z.toFixed(2)],
              df: +df.toFixed(2), dr: +dr.toFixed(2), keys: [...wanted], held: [...held]
            });
            if (jumps < 12 && f.isGrounded && (stagnant >= 2 || tick % 70 === 0)) {
              key('Space', true); window.__browserSmashStep(1 / 60); key('Space', false); jumps++;
              // A single hop clears the low rocks on the south shelf, but a fighter pressed into
              // the ledge can spend the whole arc against the face. Use the real second jump on
              // a confirmed stall; it is a normal player action, not a position or velocity edit.
              if (stagnant >= 2 && jumps < 12) {
                window.__browserSmashStep(0.12);
                key('Space', true); window.__browserSmashStep(1 / 60); key('Space', false); jumps++;
              }
            }
            window.__browserSmashStep(1 / 60);
            if (tick % 30 === 0) trail.push({ x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2) });
            if (tick % 30 === 29) {
              const moved = Math.hypot(f.position.x - last.x, f.position.z - last.z);
              stagnant = moved < .18 ? stagnant + 1 : 0;
              last = f.position.clone();
            }
          }
          clear();
          window.__browserSmashStep(.08);
          const bridgeContact = f.position.x >= -22.3 && f.position.x <= -18.9 && f.position.z >= -39.1 && f.position.z <= -31.3;
          log.push({
            target, reached, jumps, dist: +Math.hypot(target.x - f.position.x, target.z - f.position.z).toFixed(2),
            end: { x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2), ground: +f.groundLevel.toFixed(2) },
            bridgeContact, trail: trail.slice(-8), debug: debug.length ? debug : undefined
          });
          if (!reached) break;
        }
        return {
          log, final: { x: +f.position.x.toFixed(2), y: +f.position.y.toFixed(2), z: +f.position.z.toFixed(2), ground: +f.groundLevel.toFixed(2), grounded: f.isGrounded },
          bridgeContact: log.some(entry => entry.bridgeContact),
          onAirport: f.position.x > -19.4 && f.position.z > -38 && f.position.z < -10 && f.position.y > -.5,
          crossedBridge: f.position.x > -19.2 && f.position.z < -30.5
        };
      }, targets);

      const bridgeLeg = await runLeg([
        { name: 'south shelf', x: -41, z: -26 },
        { name: 'south shelf edge', x: -41.2, z: -28.3 },
        { name: 'south slope', x: -39, z: -31 },
        { name: 'south coast', x: -38, z: -33 },
        { name: 'bridge approach', x: -33, z: -35 },
        { name: 'west bridge landing', x: -25, z: -35.2 },
        { name: 'bridge deck', x: -20.6, z: -35.2 }
      ]);
      await page.waitForTimeout(500);
      await step(.3);
      await screenshot('03-bridge.png');
      await endpointCamera('05-bridge-close.png', {
        position: [-14, 6, -40], target: [-20.6, .6, -35.2], fov: 50
      });
      const airportLeg = bridgeLeg.log.every(entry => entry.reached) ? await runLeg([
        { name: 'airport rim', x: -18.2, z: -35.2 },
        { name: 'airport apron', x: -15, z: -35.2 },
        { name: 'airport interior', x: -15, z: -33 },
        { name: 'airport east edge', x: -12.5, z: -33 }
      ]) : null;
      await page.waitForTimeout(500);
      await step(.3);
      await screenshot('04-airport.png');
      await endpointCamera('06-airport-close.png', {
        position: [-17.5, 2.8, -32.8], target: [-6, 1.2, -34.5], fov: 52
      });
      route = { bridgeLeg, airportLeg, final: airportLeg?.final || bridgeLeg.final };
      addCheck(results, 'wuhu-bridge', 'the live fighter reaches and crosses the Wuhu land bridge from the normal spawn',
        bridgeLeg.bridgeContact && Boolean(bridgeLeg.crossedBridge || airportLeg?.crossedBridge),
        { bridgeContact: bridgeLeg.bridgeContact, final: bridgeLeg.final, log: bridgeLeg.log.map(entry => ({ target: entry.target.name, reached: entry.reached, jumps: entry.jumps, end: entry.end })) }, 'route');
      addCheck(results, 'wuhu-airport', 'the fighter walks off the bridge into the Sunshine Airport playable area',
        Boolean(airportLeg?.onAirport && airportLeg?.crossedBridge),
        airportLeg ? { final: airportLeg.final, onAirport: airportLeg.onAirport, log: airportLeg.log.map(entry => ({ target: entry.target.name, reached: entry.reached, end: entry.end })) } : 'airport leg not attempted', 'route');
      const routeStuck = [...bridgeLeg.log, ...(airportLeg?.log || [])].filter(entry => !entry.reached);
      addCheck(results, 'wuhu-route-complete', 'the Wuhu route does not leave the fighter stuck or below the map',
        Boolean(airportLeg?.onAirport) && routeStuck.length === 0 && (airportLeg?.final.y > -1),
        { stuckAt: routeStuck.map(entry => entry.target.name), final: route?.final }, 'route');
    }

    // ---- Runtime integrity and performance ------------------------------
    await page.evaluate(() => window.__browserSmashSpawnFighters());
    await step(.2);
    const performance = await page.evaluate(async () => {
      const renderer = window.__browserSmashRenderer;
      const before = window.__browserSmashFrames || 0;
      const startedAt = performance.now();
      await new Promise(done => setTimeout(done, 1500));
      const frames = (window.__browserSmashFrames || 0) - before;
      const elapsed = (performance.now() - startedAt) / 1000;
      return {
        frames, seconds: +elapsed.toFixed(2), fps: +(frames / elapsed).toFixed(1),
        calls: renderer?.info?.render?.calls ?? null,
        triangles: renderer?.info?.render?.triangles ?? null,
        geometries: renderer?.info?.memory?.geometries ?? null,
        textures: renderer?.info?.memory?.textures ?? null,
        renderer: (() => { try { const gl = renderer?.getContext?.(); return gl?.getParameter(gl.VERSION) || null; } catch { return null; } })()
      };
    });
    addCheck(results, 'render-loop', 'the live render loop is advancing frames', performance.frames > 0,
      { frames: performance.frames, fps: performance.fps }, 'performance');

    const ignoredResponses = responses.filter(response => /\/api\/models\/sources/.test(response.url)
      || /\/favicon\.ico/.test(response.url));
    const badResponses = responses.filter(response => response.status >= 400 && !ignoredResponses.includes(response));
    const failedAssets = requestFailures.filter(request => !/ERR_ABORTED|cancelled/i.test(request.error)
      && !/\/api\/models\/sources/.test(request.url));
    const assetResponses = responses.filter(response => /\/assets\/(arenas|environments)\//.test(response.url)
      || /\/models\/characters\/roster\//.test(response.url));
    const unexpectedConsole = consoleErrors.filter(message => !/Failed to load resource: the server responded with a status of 404/.test(message));
    const ignored404 = consoleErrors.filter(message => /Failed to load resource: the server responded with a status of 404/.test(message));
    addCheck(results, 'assets', 'all arena and fighter assets requested during play return successfully',
      badResponses.length === 0 && failedAssets.length === 0,
      { bad: badResponses.slice(0, 8), failed: failedAssets.slice(0, 8), assetResponses: assetResponses.slice(-8) }, 'assets');
    addCheck(results, 'page-errors', 'no JavaScript page errors occur during the live match', pageErrors.length === 0, pageErrors.slice(0, 5), 'runtime');
    addCheck(results, 'console-errors', 'no unexpected console errors occur during the live match', unexpectedConsole.length === 0,
      { unexpected: unexpectedConsole.slice(0, 5), ignored404: [...new Set(ignored404)].slice(0, 3), ignoredResponses: ignoredResponses.slice(0, 3) }, 'runtime');

    const report = {
      generatedAt: new Date().toISOString(),
      map: { key: map.key, label: map.label },
      url,
      viewport: '1440x900',
      mode: '2P local (both bodies on human input)',
      method: 'real menu clicks, real Playwright keyboard input, the game fixed-step loop, live Three.js scene',
      summary: {
        passed: results.filter(result => result.status === 'passed').length,
        failed: results.filter(result => result.status === 'failed').length,
        skipped: results.filter(result => result.status === 'skipped').length,
        total: results.length
      },
      checks: results,
      spawn,
      animations: animationsReport,
      camera: cameraReport,
      collision,
      boundary,
      route,
      performance,
      screenshots,
      runtime: {
        pageErrors,
        consoleErrors,
        unexpectedConsole,
        ignored404: [...new Set(ignored404)],
        requestFailures,
        badResponses,
        failedAssets,
        ignoredResponses: ignoredResponses.map(response => response.url)
      }
    };
    await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${map.label}: ${report.summary.passed}/${report.summary.total} checks passed`);
    const failed = results.filter(result => result.status === 'failed');
    if (failed.length) {
      console.log('FAILED CHECKS');
      for (const failure of failed) console.log(`- ${failure.id}: ${failure.name} — ${typeof failure.detail === 'string' ? failure.detail : JSON.stringify(failure.detail)}`);
      process.exitCode = 1;
    }
    console.log(`report: ${resolve(outDir, 'report.json')}`);
    return report;
  } catch (error) {
    fatal = String(error?.stack || error?.message || error);
    console.error('FATAL', fatal);
    const report = {
      generatedAt: new Date().toISOString(),
      map: { key: map.key, label: map.label },
      fatal,
      checks: results,
      screenshots,
      runtime: { pageErrors, consoleErrors, requestFailures, responses }
    };
    await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 1;
    return report;
  } finally {
    await browser?.close();
  }
}

for (const key of keys) {
  await openMap(MAPS[key]);
}
