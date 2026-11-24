// A1 live combat matrix for one fighter at a time.
//
// Everything below is driven through the normal character-select and match path, then through the
// real keyboard and P2 input handler. Damage, hitstun, guard, parry, throws, knockdown and KO are
// all resolved by the shipping combat code. The only helpers are positioning/reset setup and the
// page's own deterministic step hook. No percent, hitstun, ko or animation state is written to make
// a check pass.
//
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Wonder Woman"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Thor"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Saitama"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Hulk (Bruce Banner)"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Aquaman"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "The Flash (Barry Allen)"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Vegeta"
//   bash scripts/run-browser-test.sh scripts/verify-a1-combat-matrix.mjs "Arnold Schwarzenegger"
//
// Evidence is software only: headless Chromium / SwiftShader. Hardware acceptance is not claimed.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { HARDWARE_GPU, assertHardwareGpu, browserLaunchOptions, captureGpu, isSoftwareRenderer } from './lib/hardware-gpu.mjs';

const FIGHTERS = {
  'Wonder Woman': {
    slug: 'wonder-woman', key: 'wonder_woman', opponent: 'Thor',
    formId: 'champion-of-themyscira', formLabel: 'CHAMPION OF THEMYSCIRA',
    signature: 'AMAZON', kit: ['SHIELD THROW', 'SWORD RUSH']
  },
  Thor: {
    slug: 'thor', key: 'thor', opponent: 'Wonder Woman',
    formId: 'all-fathers-storm', formLabel: "ALL-FATHER'S STORM",
    signature: 'STORMBREAKER', kit: ['HAMMER RECALL', 'THUNDERSTORM']
  },
  Saitama: {
    slug: 'saitama', key: 'saitama', opponent: 'Wonder Woman',
    formId: 'serious-mode', formLabel: 'SERIOUS MODE',
    signature: 'SERIOUS', kit: ['CONSECUTIVE NORMAL PUNCHES', 'SHOCKWAVE STRIKE']
  },
  'Hulk (Bruce Banner)': {
    slug: 'hulk', key: 'hulk_bruce_banner', opponent: 'Wonder Woman',
    formId: 'worldbreaker-rage', formLabel: 'WORLDBREAKER RAGE',
    signature: 'GAMMA', kit: ['DEBRIS THROW', 'LEAPING METEOR SLAM']
  },
  Aquaman: {
    slug: 'aquaman', key: 'aquaman', opponent: 'Wonder Woman',
    formId: 'king-of-the-deep', formLabel: 'KING OF THE DEEP',
    signature: 'TRIDENT', kit: ['WATER SURGE', 'TRIDENT THROW']
  },
  'The Flash (Barry Allen)': {
    slug: 'the-flash', key: 'the_flash_barry_allen', opponent: 'Wonder Woman',
    formId: 'speed-force-ascendant', formLabel: 'SPEED FORCE ASCENDANT',
    signature: 'SPEED FORCE', kit: ['LIGHTNING THROW', 'TORNADO SPIN']
  },
  Vegeta: {
    slug: 'vegeta', key: 'vegeta', opponent: 'Wonder Woman',
    formId: 'super-saiyan', formLabel: 'SUPER SAIYAN',
    signature: 'GALICK', kit: ['BIG BANG ATTACK', 'FINAL FLASH']
  },
  'Arnold Schwarzenegger': {
    slug: 't800', key: 'arnold_schwarzenegger', opponent: 'Wonder Woman',
    formId: 'combat-chassis-overdrive', formLabel: 'COMBAT CHASSIS OVERDRIVE',
    signature: 'CYBERNETIC', kit: ['SUPPRESSIVE ATTACK', 'EXPLOSIVE LAUNCHER'],
    // The T-800's light attack also fires its equipped shotgun at startup. That point-blank shot
    // staggers a held guard for 0.1 s and interrupts a dodge, so the guard/dodge probes use its
    // real heavy, which is melee-only. The light interaction stays in the attack matrix above.
    defenceModifiers: ['Shift']
  }
};

const config = FIGHTERS[process.argv[2] || ''];
if (!config) {
  console.error('Unknown fighter. Pass one of: ' + Object.keys(FIGHTERS).map(name => `"${name}"`).join(', '));
  process.exit(2);
}

const root = process.cwd();
const out = resolve(root, 'artifacts/a1-combat', config.slug);
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const observations = {};
const check = (section, name, ok, detail = null) => {
  const row = { section, name, ok: Boolean(ok), detail };
  checks.push(row);
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} [${section}] ${name}${detail ? ' · ' + JSON.stringify(detail) : ''}`);
  return row;
};

const errors = [];
const failedRequests = [];
let browser;
try {
  browser = await chromium.launch(browserLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(String(error?.stack || error).slice(0, 500)));
  page.on('console', message => {
    // Resource-load errors are already captured as failed requests; console noise from the renderer
    // is not a page error.
    if (message.type() === 'error' && !/Failed to load resource|WebGL|GPU stall/i.test(message.text())) {
      errors.push('console: ' + message.text().slice(0, 260));
    }
  });
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url().slice(-140)}`);
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  const gpu = await captureGpu(page);
  const softwareRenderer = isSoftwareRenderer(gpu);
  observations.gpu = { ...gpu, softwareRenderer };
  console.log('GPU ' + JSON.stringify(observations.gpu));
  if (HARDWARE_GPU) assertHardwareGpu(gpu, 'A1 combat matrix hardware acceptance');

  // Observe every combat callout the shipping code emits. This is how a form that ends because of
  // the match KO can be told apart from a form that merely expired; the game's own endTransform()
  // publishes '<FORM> · ENDED' during clear('ko').
  await page.evaluate(() => {
    const original = window.showCombatCallout;
    window.__a1Callouts = [];
    window.showCombatCallout = (...args) => {
      window.__a1Callouts.push({ text: String(args[0] ?? ''), color: args[1] ?? null, at: Math.round(performance.now()) });
      if (window.__a1Callouts.length > 400) window.__a1Callouts.shift();
      return original?.(...args);
    };
  });

  await page.evaluate(({ fighter, opponent }) => {
    const select = window.__browserSmashSelect;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    select?.chooseArena('valley');
    select?.setRules?.({ roundsToWin: 1, roundSeconds: 180 });
    window.__browserSmashSetRules?.({ roundsToWin: 1, roundSeconds: 180 });
    select?.select('p1', fighter);
    select?.select('p2', opponent);
    document.querySelector('#play').click();
  }, { fighter: process.argv[2], opponent: config.opponent });

  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.__bbLoading?.describe?.().visible === false,
  null, { timeout: 90000, polling: 100 });
  await page.locator('canvas').first().click({ position: { x: 320, y: 220 }, force: true });
  await page.waitForTimeout(350);

  const loaded = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const select = window.__browserSmashSelect?.state;
    return {
      p1: {
        identity: p1.identity, identityKey: p1.identityKey, percent: p1.percent,
        asset: p1.model?.userData?.characterAssetUrl || null,
        bones: (() => { let count = 0; p1.model?.traverse?.(node => { if (node.isBone) count++; }); return count; })(),
        height: p1.model?.userData?.placement?.sourceHeight ?? null,
        targetHeight: p1.model?.userData?.placement?.targetHeight ?? null,
        source: p1.model?.userData?.bodySource || null,
        special: String(p1.specialProfile?.label || '')
      },
      p2: { identity: p2.identity, identityKey: p2.identityKey },
      select: select ? { p1: select.p1, p2: select.p2, arena: select.arena, rules: select.rules } : null,
      match: window.__browserSmashMatch?.()
    };
  });
  observations.loaded = loaded;
  check('match', 'the selected fighter is the live P1 body', loaded.p1.identity === process.argv[2]
    && loaded.p1.identityKey === config.key, loaded.p1);
  check('match', 'a one-round 180 s live match is running', loaded.match?.status === 'fighting'
    && loaded.match?.maxPercent === 150, { match: loaded.match, select: loaded.select });

  // ---------------------------------------------------------------------------------------------
  // Page-side control helpers. They only position/reset state and advance the shipping simulation.
  // ---------------------------------------------------------------------------------------------
  await page.evaluate(() => {
    const floorOf = fighter => Number(fighter?.groundLevel ?? 0);
    const pinTarget = (gap, attackerIndex) => {
      const attacker = window.fighters[attackerIndex];
      const target = window.fighters[1 - attackerIndex];
      if (!attacker || !target) return;
      const facing = Number(attacker.facing) || 1;
      const facingZ = Number(attacker.facingZ) || 0;
      target.position.set(
        attacker.position.x + facing * gap,
        floorOf(target),
        attacker.position.z + facingZ * gap
      );
      target.velocity?.set?.(0, 0, 0);
      target.isGrounded = true;
    };
    window.__a1PinTarget = pinTarget;
    window.__a1Step = (seconds, options = {}) => {
      const {
        pin = false, gap = 1.05, attacker = 0, stopOnHit = false
      } = options;
      const ledger = window.__browserSmashCombatEvents = window.__browserSmashCombatEvents || [];
      const start = ledger.length;
      const steps = Math.max(1, Math.floor(seconds * 60));
      for (let i = 0; i < steps; i++) {
        if (pin) pinTarget(gap, attacker);
        window.__browserSmashStep(1 / 60);
        if (stopOnHit && ledger.length > start) break;
      }
      return ledger.slice(start);
    };
    window.__a1Sample = (seconds, options = {}) => {
      const { pin = false, gap = 1.05, attacker = 0 } = options;
      const steps = Math.max(1, Math.floor(seconds * 60));
      const samples = [];
      const clipOf = fighter => fighter?.model?.userData?.currentClip
        || fighter?.animationController?._active || null;
      for (let i = 0; i < steps; i++) {
        if (pin) pinTarget(gap, attacker);
        window.__browserSmashStep(1 / 60);
        const [p1, p2] = window.fighters;
        samples.push({
          t: +(i / 60).toFixed(2),
          p1: {
            percent: +Number(p1.percent || 0).toFixed(1),
            hitstun: +Number(p1.hitstun || 0).toFixed(3),
            grounded: Boolean(p1.isGrounded),
            y: +p1.position.y.toFixed(2),
            vy: +Number(p1.velocity?.y || 0).toFixed(2),
            x: +p1.position.x.toFixed(2),
            vx: +Number(p1.velocity?.x || 0).toFixed(2),
            clip: clipOf(p1),
            knocked: Boolean(p1.model?.userData?.wasKnockedDown),
            getUp: +Number(p1.model?.userData?.getUpTime || 0).toFixed(2)
          },
          p2: {
            percent: +Number(p2.percent || 0).toFixed(1),
            hitstun: +Number(p2.hitstun || 0).toFixed(3),
            grounded: Boolean(p2.isGrounded),
            y: +p2.position.y.toFixed(2),
            clip: clipOf(p2)
          }
        });
      }
      return samples;
    };
  });

  const step = (seconds, options = {}) => page.evaluate(({ seconds, options }) =>
    window.__a1Step(seconds, options), { seconds, options });
  const sample = (seconds, options = {}) => page.evaluate(({ seconds, options }) =>
    window.__a1Sample(seconds, options), { seconds, options });
  const entries = () => page.evaluate(() => (window.__browserSmashCombatEvents || []).slice());
  const callouts = () => page.evaluate(() => (window.__a1Callouts || []).slice());
  const clearCallouts = () => page.evaluate(() => { window.__a1Callouts = []; });
  const probe = inputs => page.evaluate(value => { window.__browserSmashP2Probe = value; }, inputs);

  const read = () => page.evaluate(() => {
    const clipOf = fighter => fighter?.model?.userData?.currentClip
      || fighter?.animationController?._active || null;
    const one = fighter => ({
      identity: fighter.identity,
      identityKey: fighter.identityKey,
      percent: +Number(fighter.percent || 0).toFixed(2),
      hitstun: +Number(fighter.hitstun || 0).toFixed(3),
      grounded: Boolean(fighter.isGrounded),
      y: +fighter.position.y.toFixed(2),
      x: +fighter.position.x.toFixed(2),
      z: +fighter.position.z.toFixed(2),
      vx: +Number(fighter.velocity?.x || 0).toFixed(2),
      vy: +Number(fighter.velocity?.y || 0).toFixed(2),
      vz: +Number(fighter.velocity?.z || 0).toFixed(2),
      clip: clipOf(fighter),
      state: fighter.state || null,
      activeMoveId: fighter.activeMoveId || null,
      attackQueue: fighter.attackQueue?.map(a => a.id || a.kind || null) || [],
      attackPose: +Number(fighter.attackPose || 0).toFixed(2),
      comboStep: fighter.comboStep ?? null,
      comboWindow: +Number(fighter.comboWindow || 0).toFixed(2),
      ko: Boolean(fighter.ko),
      guardHeld: Boolean(fighter.guardHeld),
      guardBreak: +Number(fighter.guardBreak || 0).toFixed(3),
      shield: +Number(fighter.shield || 0).toFixed(1),
      guardStun: +Number(fighter.guardStun || 0).toFixed(3),
      parryTimer: +Number(fighter.parryTimer || 0).toFixed(3),
      counterWindow: +Number(fighter.counterWindow || 0).toFixed(3),
      dodgeTimer: +Number(fighter.dodgeTimer || 0).toFixed(3),
      invulnerable: +Number(fighter.invulnerable || 0).toFixed(3),
      grabTarget: fighter.grabTarget?.identity || null,
      grabbedBy: fighter.grabbedBy?.identity || null,
      grabHold: +Number(fighter.grabHold || 0).toFixed(3),
      lastThrow: fighter.lastThrow ? { ...fighter.lastThrow } : null,
      jumpPulse: +Number(fighter.landPulse || 0).toFixed(3),
      jumps: fighter.jumps ?? null,
      airHits: fighter.airHits ?? 0,
      transform: fighter.transform ? {
        id: fighter.transform.form?.id || null,
        label: fighter.transform.label || fighter.transform.form?.label || null,
        landed: fighter.transform.landed === true,
        time: +Number(fighter.transform.time || 0).toFixed(2)
      } : null,
      special: String(fighter.specialProfile?.label || ''),
      casting: fighter.casting || null,
      meter: +Number(fighter.meter || 0).toFixed(1),
      power: +Number(fighter.power || 0).toFixed(1),
      formStage: fighter.formStage ?? 0,
      formLock: +Number(fighter.formLock || 0).toFixed(2),
      abilityCast: fighter.abilityLastCast ? { ...fighter.abilityLastCast } : null,
      abilityReadyAt: fighter.abilityReadyAt ? { ...fighter.abilityReadyAt } : null,
      specialCooldown: +Number(fighter.specialCooldown || 0).toFixed(2),
      model: {
        asset: fighter.model?.userData?.characterAssetUrl || null,
        bodySource: fighter.model?.userData?.bodySource || null,
        currentClip: fighter.model?.userData?.currentClip || null,
        wasKnockedDown: Boolean(fighter.model?.userData?.wasKnockedDown),
        getUpTime: +Number(fighter.model?.userData?.getUpTime || 0).toFixed(2),
        sprite: Boolean(fighter.model?.userData?.sprite)
      }
    });
    const [p1, p2] = window.fighters;
    return {
      p1: one(p1), p2: one(p2),
      match: window.__browserSmashMatch?.() || null,
      result: window.__browserSmashLastResult || null,
      resultText: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      playText: (document.querySelector('#play')?.textContent || '').trim(),
      victory: window.__browserSmashVictoryState?.() || null,
      control: window.__browserSmashControlMode?.() || null,
      projectiles: (window.browserSmashProjectiles || []).length
    };
  });

  const reset = () => page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashP2Probe = null;
    window.__browserSmashCombatEvents = [];
    window.__a1Callouts = [];
    const [p1, p2] = window.fighters;
    const floorOf = fighter => Number(fighter?.groundLevel ?? 0);
    p1.position.set(0, floorOf(p1), -12);
    p2.position.set(1.05, floorOf(p2), -12);
    p1.facing = 1; p1.facingZ = 0;
    p2.facing = -1; p2.facingZ = 0;
    for (const f of [p1, p2]) {
      f.percent = 0;
      f.hitstun = 0;
      f.ko = false;
      f.victoryPose = 0;
      f.isGrounded = true;
      f.jumps = 0;
      f.airDashUsed = false;
      f.invulnerable = 0;
      f.guardHeld = false;
      f.guardBreak = 0;
      f.guardBreakFlash = 0;
      f.guardRegenDelay = 0;
      f.guardStun = 0;
      f.shield = 100;
      f.parryTimer = 0;
      f.parryCooldown = 0;
      f.counterWindow = 0;
      f.counterFlash = 0;
      f.dodgeTimer = 0;
      f.dashCooldown = 0;
      f.dashTimer = 0;
      f.attackQueue.length = 0;
      f.attackBuffer = 0;
      f.hitboxes.length = 0;
      f.comboStep = 0;
      f.comboWindow = 0;
      f.comboHitCount = 0;
      f.airHits = 0;
      f.specialCooldown = 0;
      f.grabCooldown = 0;
      f.grabAim = 'forward';
      f.grabTarget = null;
      f.grabbedBy = null;
      f.grabHold = 0;
      f.grabEscapeTimer = 0;
      f.heldThrow = null;
      f.lastThrow = null;
      f.throwChain = 0;
      f.casting = null;
      f.velocity.set(0, 0, 0);
      f.activeMoveId = null;
      f.state = 'idle';
      f.flightMode = false;
      f.webSwinging = false;
      f.abilityReadyAt = {};
      f.abilityLastCast = null;
      f.abilityCast = null;
      const userData = f.model?.userData;
      if (userData) {
        userData.wasKnockedDown = false;
        userData.getUpTime = 0;
        userData.heavyStun = false;
        userData.stunPrev = 0;
        userData.landingPoseTime = 0;
        userData.attackTime = 0;
      }
    }
    p1.power = 100;
    p1.meter = 100;
    p1.transformCooldown = 0;
    p1.formLock = 0;
    p1.incomingDamage = 1;
    if (p1.baseSpecialProfile) p1.specialProfile = p1.baseSpecialProfile;
    window.__browserSmashStep(0.05);
    return {
      p1Transform: p1.transform ? p1.transform.form?.id || 'active' : null,
      p1Identity: p1.identity,
      p2Identity: p2.identity
    };
  });

  const place = (gap = 1.05, x = 0, z = -12) => page.evaluate(({ gap, x, z }) => {
    const [p1, p2] = window.fighters;
    const floorOf = fighter => Number(fighter?.groundLevel ?? 0);
    p1.position.set(x, floorOf(p1), z);
    p2.position.set(x + gap, floorOf(p2), z);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0;
    p2.facing = -1; p2.facingZ = 0;
    p1.isGrounded = true; p2.isGrounded = true;
  }, { gap, x, z });

  const capture = async (name) => {
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await page.waitForTimeout(100);
    const path = resolve(out, name.endsWith('.png') ? name : name + '.png');
    await page.screenshot({ path });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    return path;
  };

  const clearInputs = async () => {
    await page.keyboard.up('Shift').catch(() => {});
    await page.keyboard.up('w').catch(() => {});
    await page.keyboard.up('s').catch(() => {});
    await page.keyboard.up('a').catch(() => {});
    await page.keyboard.up('d').catch(() => {});
    await page.keyboard.up('j').catch(() => {});
    await page.keyboard.up('k').catch(() => {});
    await page.keyboard.up('u').catch(() => {});
    await page.keyboard.up('l').catch(() => {});
    await page.keyboard.up('h').catch(() => {});
  };

  // Record which animation action the strike actually selected. A binding can exist and still be
  // ignored by the state machine, so the move ledger alone is not evidence that source motion
  // played. `lastAuthoredStrike` is written when the action is chosen and names the exact clip.
  const animation = async () => page.evaluate(() => {
    const data = window.fighters?.[0]?.model?.userData || null;
    return {
      currentClip: data?.currentClip || null,
      lastStrike: data?.lastAuthoredStrike || null,
      importedStrikes: data?.importedStrikeReport || null,
      importedReactions: data?.importedReactionReport || null,
      authoredReport: data?.importedAuthoredReport || null
    };
  });

  // A single attack establishes the fighter's move identity and real damage. The target is pinned
  // only so the hitbox can resolve; the ledger entry and percent still come from the resolver.
  const singleAttack = async ({ label, modifiers = [], key = 'j', pin = true, gap = 1.05, wait = 1.2, captureName = null }) => {
    await reset();
    await place(gap);
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.keyboard.press(key);
    const fresh = await step(wait, { pin, gap, stopOnHit: true });
    await step(0.12, { pin, gap });
    await clearInputs();
    const state = await read();
    const anim = await animation();
    const entry = fresh.find(item => item.attacker === process.argv[2]) || null;
    const shot = captureName ? await capture(captureName) : null;
    return { label, entry, fresh, state, shot, modifiers, anim };
  };

  // ---------------------------------------------------------------------------------------------
  // A. Attack matrix.
  // ---------------------------------------------------------------------------------------------
  await reset();
  await place();
  // Five real J presses, each followed by enough simulated time for the engine to start that
  // chain step. Pressing by wall-clock interval raced the recoveries on the software renderer.
  for (let wanted = 1; wanted <= 5; wanted++) {
    await page.keyboard.press('j');
    for (let attempt = 0; attempt < 14; attempt++) {
      await step(0.05, { pin: true, gap: 1.05 });
      const sampleState = await page.evaluate(() => window.fighters[0].comboStep);
      if (sampleState >= wanted) break;
    }
  }
  await step(0.9, { pin: true, gap: 1.05 });
  await clearInputs();
  const chainState = await read();
  const chainEntries = (await entries()).filter(item => item.attacker === process.argv[2]);
  const chainMoves = chainEntries.map(item => item.move);
  const chainShot = await capture('01-light-chain');
  observations.lightChain = {
    moves: chainMoves,
    hits: chainEntries.length,
    dealt: +chainEntries.reduce((sum, item) => sum + item.dealt, 0).toFixed(2),
    comboStep: chainState.p1.comboStep,
    targetPercent: chainState.p2.percent,
    clips: [...new Set(chainEntries.map(item => item.move))],
    screenshot: chainShot
  };
  check('attack', 'the full five-input light string resolves as five distinct moves',
    chainMoves.length >= 5
      && ['light1', 'light2', 'light3', 'light4', 'finisher'].every(move => chainMoves.includes(move)),
    observations.lightChain);
  check('attack', 'the light string deals real accumulated damage', chainState.p2.percent > 0
    && chainEntries.every(item => item.dealt > 0), { percent: chainState.p2.percent, dealt: observations.lightChain.dealt });

  observations.animation = await animation();
  const heavy = await singleAttack({ label: 'neutral-heavy', modifiers: ['Shift'], captureName: '02-heavy' });
  check('attack', 'neutral heavy resolves as the heavy move and lands', heavy.entry?.move === 'heavy'
    && heavy.entry.dealt > 0, { entry: heavy.entry, percent: heavy.state.p2.percent, strike: heavy.anim.lastStrike, clip: heavy.anim.currentClip });

  const launcher = await singleAttack({ label: 'up-heavy-launcher', modifiers: ['w', 'Shift'] });
  check('attack', 'up+heavy resolves as the launcher and lands', launcher.entry?.move === 'heavyLauncher'
    && launcher.entry.dealt > 0, { entry: launcher.entry, percent: launcher.state.p2.percent });

  const slam = await singleAttack({ label: 'down-heavy-slam', modifiers: ['s', 'Shift'] });
  check('attack', 'down+heavy resolves as the ground slam and lands', slam.entry?.move === 'heavySlam'
    && slam.entry.dealt > 0, { entry: slam.entry, percent: slam.state.p2.percent });

  const antiAir = await singleAttack({ label: 'up-light-anti-air', modifiers: ['w'] });
  check('attack', 'up+light resolves as the anti-air and lands', antiAir.entry?.move === 'antiAir'
    && antiAir.entry.dealt > 0, { entry: antiAir.entry, percent: antiAir.state.p2.percent });

  // Aerial: jump through Space, then attack while airborne.
  await reset();
  await place(1.2);
  await page.keyboard.press('Space');
  await step(0.18, { pin: true, gap: 1.2 });
  await page.keyboard.press('j');
  const aerialFresh = await step(1.1, { pin: true, gap: 1.2, stopOnHit: true });
  await step(0.15);
  await clearInputs();
  const aerialState = await read();
  const aerialEntry = aerialFresh.find(item => item.attacker === process.argv[2]) || null;
  const aerialShot = await capture('03-aerial');
  check('attack', 'aerial light resolves as the air strike and lands', aerialEntry?.move === 'air'
    && aerialEntry.dealt > 0, { entry: aerialEntry, state: { p1: aerialState.p1, p2: aerialState.p2 }, screenshot: aerialShot });

  await reset();
  await place(1.2);
  await page.keyboard.press('Space');
  await step(0.2, { pin: true, gap: 1.2 });
  await page.keyboard.down('s');
  await page.keyboard.press('j');
  const diveFresh = await step(1.1, { pin: true, gap: 1.2, stopOnHit: true });
  await step(0.15);
  await clearInputs();
  const diveState = await read();
  const diveEntry = diveFresh.find(item => item.attacker === process.argv[2]) || null;
  check('attack', 'air down+light resolves as the dive kick and lands', diveEntry?.move === 'dive'
    && diveEntry.dealt > 0, { entry: diveEntry, percent: diveState.p2.percent });

  // Aerial chain: jump and press attack three times. The third press must resolve as airFinisher.
  await reset();
  await place(1.25);
  await page.keyboard.press('Space');
  await step(0.18, { pin: true, gap: 1.25 });
  // Wait for the engine to enter each aerial chain step instead of assuming a fixed 0.22 s.
  // Hulk's authored aerial attack is 1.43 s long; a short fixed interval buffered only two presses
  // on his body even though the chain itself was available. This waits on the live combo state and
  // still fails if the third press never becomes the air finisher.
  for (let wanted = 1; wanted <= 3; wanted++) {
    await page.keyboard.press('j');
    for (let attempt = 0; attempt < 20; attempt++) {
      await step(0.05, { pin: true, gap: 1.25 });
      const aerialStep = await page.evaluate(() => ({
        comboStep: window.fighters[0].comboStep,
        airHits: window.fighters[0].airHits
      }));
      if (aerialStep.comboStep >= wanted || aerialStep.airHits >= wanted) break;
    }
  }
  await step(0.45, { pin: true, gap: 1.25 });
  await clearInputs();
  const airChainEntries = (await entries()).filter(item => item.attacker === process.argv[2]);
  const airChainMoves = airChainEntries.map(item => item.move);
  check('attack', 'the aerial chain reaches its finisher', airChainMoves.includes('airFinisher'),
    { moves: airChainMoves, hits: airChainEntries.length });

  // Grab and hold: real U input, real hold window, real throw arc.
  await reset();
  await place(1.05);
  await page.keyboard.press('u');
  // Grabs have a real startup and hold window. Hulk's 1.22x startup means the hold begins just
  // after the old fixed 0.13 s read, so wait for the shipping grab state rather than sampling too
  // early; the window is still short and a missed grab cannot pass.
  let grabHeld = await read();
  for (let attempt = 0; attempt < 14; attempt++) {
    if (grabHeld.p1.grabTarget || grabHeld.p2.grabbedBy === process.argv[2]) break;
    await step(0.03, { pin: true, gap: 1.05 });
    grabHeld = await read();
  }
  await step(0.4);
  const thrown = await read();
  await clearInputs();
  const grabShot = await capture('04-grab-throw');
  observations.grab = { held: grabHeld.p1, targetHeld: grabHeld.p2.grabbedBy, thrown: thrown.p2 };
  check('defence', 'grab acquires a held target through the normal grab window',
    Boolean(grabHeld.p1.grabTarget) || grabHeld.p2.grabbedBy === process.argv[2], observations.grab);
  check('attack', 'the hold resolves into a real forward throw with damage and launch',
    thrown.p2.lastThrow?.aim === 'forward' && thrown.p2.percent > 0
      && (thrown.p2.vy > 0 || !thrown.p2.grounded),
    { lastThrow: thrown.p2.lastThrow, percent: thrown.p2.percent, screenshot: grabShot });

  // Down throw: guaranteed spike arc, still resolved by the live grab path.
  await reset();
  await place(1.05);
  await page.keyboard.down('s');
  await page.keyboard.press('u');
  await step(0.13, { pin: true, gap: 1.05 });
  await page.keyboard.up('s');
  await step(0.4);
  await clearInputs();
  const spike = await read();
  check('attack', 'down+grab resolves as a spike throw with negative vertical launch',
    spike.p2.lastThrow?.aim === 'down' && spike.p2.lastThrow?.y < 0 && spike.p2.percent > 0,
    { lastThrow: spike.p2.lastThrow, percent: spike.p2.percent });

  // ---------------------------------------------------------------------------------------------
  // B. Defence matrix.
  // ---------------------------------------------------------------------------------------------
  await reset();
  await place(1.05);
  await probe({ shield: true });
  await step(0.08);
  const guardBefore = await read();
  const defenceModifiers = config.defenceModifiers || [];
  for (const modifier of defenceModifiers) await page.keyboard.down(modifier);
  await page.keyboard.press('j');
  const guardFresh = await step(1.2, { pin: defenceModifiers.length > 0, stopOnHit: true });
  await step(0.12, { pin: defenceModifiers.length > 0 });
  await probe(null);
  await clearInputs();
  const guardAfter = await read();
  const guardEntry = guardFresh.find(item => item.attacker === process.argv[2]) || null;
  const guardShot = await capture('05-guard-block');
  check('defence', 'held guard blocks a real hit and spends shield',
    guardBefore.p2.guardHeld && guardEntry?.guarded === true
      && guardAfter.p2.shield < guardBefore.p2.shield && guardAfter.p2.percent > 0,
    { guardHeld: guardBefore.p2.guardHeld, entry: guardEntry, shield: [guardBefore.p2.shield, guardAfter.p2.shield], screenshot: guardShot });

  // Parry: real P2 parry input inside the active window, then a real counter strike.
  await reset();
  await place(1.05);
  // Parry is a read: arm the real P2 parry input just before the strike's active frames, not
  // after they have already connected.
  await probe({ parry: true });
  await step(0.05);
  await page.keyboard.press('j');
  await step(0.14);
  const parried = await read();
  await probe(null);
  await clearCallouts();
  await step(0.2);
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(p2.position.x - 1.05, Number(p2.groundLevel ?? 0), p2.position.z);
    p1.velocity.set(0, 0, 0);
    p1.isGrounded = true;
    p2.facing = -1; p2.facingZ = 0;
  });
  await probe({ attack: true });
  const counterFresh = await step(0.55, { pin: true, gap: 1.05, attacker: 1, stopOnHit: true });
  await probe(null);
  await step(0.1);
  const countered = await read();
  await clearInputs();
  const counterEntry = counterFresh.find(item => item.attacker === config.opponent) || null;
  const parryShot = await capture('06-parry-counter');
  const parryCallouts = await callouts();
  check('defence', 'a timed parry rejects the hit and opens the counter window',
    parried.p1.hitstun > 0.15 && parried.p2.counterWindow > 0
      && parried.p2.parryTimer === 0,
    { p1: parried.p1, p2: { counterWindow: parried.p2.counterWindow, parryTimer: parried.p2.parryTimer, invulnerable: parried.p2.invulnerable } });
  check('defence', 'the counter window resolves a live counter strike',
    counterEntry?.move === 'counter' && counterEntry.dealt > 0,
    { entry: counterEntry, p1: countered.p1, callouts: parryCallouts.map(item => item.text), screenshot: parryShot });

  // Guard break: three blocked heavies exhaust 100 shield; the fourth is the game's break state.
  await reset();
  await place(1.05);
  await probe({ shield: true });
  await step(0.08);
  const guardBreakTrace = [];
  let guardBreakSeen = 0;
  for (let i = 0; i < 4 && guardBreakSeen === 0; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('j');
    await step(0.55, { pin: true, gap: 1.05 });
    await page.keyboard.up('Shift');
    const trace = await read();
    guardBreakTrace.push({ hit: i + 1, shield: trace.p2.shield, guardBreak: trace.p2.guardBreak, guarded: trace.p2.guardHeld });
    guardBreakSeen = trace.p2.guardBreak;
  }
  await probe(null);
  await clearInputs();
  const guardBreakState = await read();
  check('defence', 'sustained blocked heavy pressure produces a real guard break',
    guardBreakSeen > 0 && guardBreakState.p2.shield === 0, { trace: guardBreakTrace, state: guardBreakState.p2 });

  // Dodge: real P2 dodge input makes the swing miss. A ranged weapon's light shot fires
  // instantly and interrupts the dodge, so those fighters are probed with the melee heavy; its
  // 0.2 s startup still falls inside the 0.48 s dodge window armed just after the input.
  await reset();
  await place(1.05);
  const dodgeModifiers = config.defenceModifiers || [];
  for (const modifier of dodgeModifiers) await page.keyboard.down(modifier);
  await page.keyboard.press('j');
  await step(0.03);
  await probe({ dodge: true });
  await step(0.12);
  const dodging = await read();
  await probe(null);
  await step(0.3);
  const afterDodge = await read();
  const dodgeEntries = (await entries()).filter(item => item.attacker === process.argv[2]);
  await clearInputs();
  check('defence', 'a timed dodge grants invulnerability and avoids the hit',
    dodging.p2.dodgeTimer > 0 && dodging.p2.invulnerable > 0 && dodgeEntries.length === 0,
    { dodging: { dodgeTimer: dodging.p2.dodgeTimer, invulnerable: dodging.p2.invulnerable }, entries: dodgeEntries, afterDodge: afterDodge.p2 });

  // ---------------------------------------------------------------------------------------------
  // C. Knockdown, recovery, jumping, landing and air control.
  // ---------------------------------------------------------------------------------------------
  // Unforced: P1 starts at 120% (already accumulated damage), P2 lands a neutral heavy through its
  // real input handler. No hitstun, launch or ko is written; the collision produces them.
  await reset();
  await place(1.05);
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.percent = 120;
    p1.invulnerable = 0;
    p1.hitstun = 0;
    p1.isGrounded = true;
    p1.velocity.set(0, 0, 0);
    p2.facing = -1; p2.facingZ = 0;
  });
  await probe({ attack: true, run: true });
  const knockdownStrike = await step(0.7, { stopOnHit: true });
  await probe(null);
  const knockdownSamples = await sample(2.6);
  const knockdownEntries = knockdownStrike.concat(await entries()).filter(item => item.attacker === config.opponent);
  const kdClips = [...new Set(knockdownSamples.map(entry => entry.p1.clip).filter(Boolean))];
  const kdWasKnocked = knockdownSamples.some(entry => entry.p1.knocked);
  const kdGetUp = knockdownSamples.some(entry => entry.p1.getUp > 0) || kdClips.some(clip => /get_up|getup|stand_up/i.test(clip));
  const kdAirborne = knockdownSamples.some(entry => !entry.p1.grounded || entry.p1.y > 0.2);
  const kdLanded = knockdownSamples.some(entry => entry.p1.grounded && entry.t > 0.3);
  const kdFinal = await read();
  await capture('07-knockdown-getup');
  observations.knockdown = {
    strike: knockdownEntries, percent: kdFinal.p1.percent,
    maxHitstun: Math.max(0, ...knockdownSamples.map(entry => entry.p1.hitstun)),
    clips: kdClips, wasKnocked: kdWasKnocked, getUp: kdGetUp,
    airborne: kdAirborne, landed: kdLanded, final: kdFinal.p1
  };
  check('defence', 'an unforced heavy collision knocks the fighter down',
    knockdownEntries.length > 0 && kdFinal.p1.percent > 120
      && observations.knockdown.maxHitstun >= 0.8 && kdAirborne && kdWasKnocked,
    observations.knockdown);
  check('defence', 'the knocked-down fighter lands and recovers through a get-up',
    kdLanded && kdGetUp && kdFinal.p1.grounded && kdFinal.p1.hitstun === 0
      && /get_up|getup|stand_up|stand|idle|walk|run/i.test(String(kdFinal.p1.clip || kdFinal.p1.model.currentClip || '')),
    { clips: kdClips, final: kdFinal.p1 });

  // Forced: P2's down throw spikes P1; the throw path guarantees the arc.
  await reset();
  await place(1.05);
  await probe({ grab: true, down: true });
  await step(0.16);
  const forcedHold = await read();
  await probe(null);
  const forcedSamples = await sample(2.4);
  const forcedFinal = await read();
  const forcedClips = [...new Set(forcedSamples.map(entry => entry.p1.clip).filter(Boolean))];
  const forcedAir = forcedSamples.some(entry => !entry.p1.grounded);
  const forcedGetUp = forcedSamples.some(entry => entry.p1.getUp > 0)
    || forcedClips.some(clip => /get_up|getup|stand_up/i.test(clip));
  check('defence', 'a live down throw forces the spike knockdown',
    forcedHold.p1.grabbedBy === config.opponent
      && forcedFinal.p1.lastThrow?.aim === 'down' && forcedFinal.p1.percent > 0,
    { grabbedBy: forcedHold.p1.grabbedBy, lastThrow: forcedFinal.p1.lastThrow, percent: forcedFinal.p1.percent });
  check('defence', 'the forced spike lands and the fighter gets up',
    forcedAir && forcedGetUp && forcedFinal.p1.grounded && forcedFinal.p1.hitstun === 0,
    { airborne: forcedAir, getUp: forcedGetUp, clips: forcedClips, final: forcedFinal.p1 });

  // Jump, air control, landing.
  await reset();
  await place();
  await page.keyboard.press('Space');
  const jumpSample = await sample(0.24);
  const takeoff = jumpSample[jumpSample.length - 1];
  const startX = takeoff.p1.x;
  await page.keyboard.down('d');
  const airSample = await sample(0.34);
  await page.keyboard.up('d');
  const landingSamples = await sample(2.2);
  const allJump = jumpSample.concat(airSample, landingSamples);
  const maxY = Math.max(...allJump.map(entry => entry.p1.y));
  const airControl = airSample[airSample.length - 1].p1.x - startX;
  const landed = landingSamples.find(entry => entry.p1.grounded && entry.t > 0.15) || null;
  const jumpFinal = await read();
  const jumpShot = await capture('08-jump-land');
  observations.jump = {
    takeoffY: +takeoff.p1.y.toFixed(2), maxY: +maxY.toFixed(2),
    airControl: +airControl.toFixed(2), landed, final: jumpFinal.p1, screenshot: jumpShot
  };
  check('movement', 'jump leaves the ground with vertical velocity',
    !takeoff.p1.grounded && takeoff.p1.y > 0.15 && takeoff.p1.vy > 0,
    { takeoff: takeoff.p1 });
  check('movement', 'air control moves the body horizontally while airborne',
    airControl > 0.2 && airSample.some(entry => !entry.p1.grounded && entry.p1.vx > 0.3),
    { airControl: +airControl.toFixed(2), last: airSample[airSample.length - 1].p1 });
  check('movement', 'the fighter lands and returns to a stable grounded state',
    Boolean(landed) && jumpFinal.p1.grounded && Math.abs(jumpFinal.p1.y) < 0.1,
    { landed, final: jumpFinal.p1 });

  // Ground walk -> sprint -> run, then turn and brake. The locomotion snapshot is evidence, not a
  // new pass condition: it records which clip the shipping selector chose at each speed so a source
  // dash cycle that is bound but never selected cannot hide behind a passing movement check.
  await reset();
  await place();
  await page.keyboard.down('d');
  await step(0.55);
  const walkMoving = await read();
  await page.keyboard.down('Shift');
  await step(1.15);
  const sprintMoving = await read();
  await page.keyboard.up('Shift');
  await step(0.7);
  const runMoving = await read();
  await page.keyboard.up('d');
  const movingRight = await read();
  const locomotionRow = state => ({
    clip: state.p1.clip, state: state.p1.state,
    speed: +Math.hypot(state.p1.vx || 0, state.p1.vz || 0).toFixed(2)
  });
  observations.locomotion = {
    walk: locomotionRow(walkMoving), sprint: locomotionRow(sprintMoving), run: locomotionRow(runMoving)
  };
  await page.keyboard.down('a');
  await step(0.55);
  await page.keyboard.up('a');
  const turned = await read();
  await step(0.55);
  const braked = await read();
  await clearInputs();
  check('movement', 'the body can reverse direction under real input',
    movingRight.p1.vx > 0.5 && (turned.p1.vx < 0 || turned.p1.x < movingRight.p1.x - 0.05),
    { movingRight: movingRight.p1, turned: turned.p1, locomotion: observations.locomotion });
  check('movement', 'releasing input brakes the body instead of sliding at full speed',
    Math.hypot(braked.p1.vx, braked.p1.vz) < Math.max(0.6, Math.hypot(turned.p1.vx, turned.p1.vz) * 0.5),
    { turned: turned.p1, braked: braked.p1 });

  // ---------------------------------------------------------------------------------------------
  // D. Character kit: signature, both abilities, ultimate.
  // ---------------------------------------------------------------------------------------------
  await reset();
  await place(1.15);
  await page.keyboard.press('k');
  const signatureFresh = await step(1.8, { pin: true, gap: 1.15, stopOnHit: true });
  await step(0.2, { pin: true, gap: 1.15 });
  await clearInputs();
  const signatureState = await read();
  const signatureEntry = signatureFresh.find(item => item.attacker === process.argv[2]) || null;
  check('abilities', 'the signature fires through K and deals real damage',
    Boolean(signatureEntry) || signatureState.p2.percent > 0,
    { entry: signatureEntry, percent: signatureState.p2.percent, special: signatureState.p1.special });

  const kitOne = await singleAttack({ label: 'kit-1', key: 'l', pin: true, gap: 1.2, wait: 1.8 });
  const kitOneCallouts = await callouts();
  check('abilities', 'kit ability 1 fires through L and deals real damage',
    kitOne.state.p2.percent > 0 && kitOneCallouts.some(item => item.text === config.kit[0]),
    { percent: kitOne.state.p2.percent, cast: kitOne.state.p1.abilityCast, callouts: kitOneCallouts.map(item => item.text) });

  const kitTwo = await singleAttack({ label: 'kit-2', key: 'h', pin: true, gap: 1.2, wait: 1.8 });
  const kitTwoCallouts = await callouts();
  check('abilities', 'kit ability 2 fires through H and deals real damage',
    kitTwo.state.p2.percent > 0 && kitTwoCallouts.some(item => item.text === config.kit[1]),
    { percent: kitTwo.state.p2.percent, cast: kitTwo.state.p1.abilityCast, callouts: kitTwoCallouts.map(item => item.text) });

  await reset();
  await place(1.15);
  await page.evaluate(() => { const p1 = window.fighters[0]; p1.meter = 100; });
  await page.keyboard.press('o');
  await step(1.2, { pin: true, gap: 1.15 });
  const ultimateCast = await read();
  const ultimateShot = await capture('09-ultimate');
  const ultimateFresh = await step(3.4, { pin: true, gap: 1.15 });
  await clearInputs();
  const ultimateEnd = await read();
  const ultimateEntry = ultimateFresh.find(item => item.attacker === process.argv[2]) || null;
  check('abilities', 'the ultimate casts, deals real damage, spends meter and returns control',
    ultimateEnd.p1.meter === 0 && ultimateEnd.p1.casting === null
      && ultimateEnd.p2.percent > 0
      && (ultimateCast.p1.casting === 'ultimate' || Boolean(ultimateEntry)),
    { cast: ultimateCast.p1.casting, meter: ultimateEnd.p1.meter, targetPercent: ultimateEnd.p2.percent, entry: ultimateEntry, screenshot: ultimateShot });

  // ---------------------------------------------------------------------------------------------
  // E. Transformation, form exit, KO during the form and the real result path.
  // ---------------------------------------------------------------------------------------------
  await reset();
  await place(1.2);
  const stageBefore = (await read()).p1.formStage;
  await page.keyboard.press('i');
  await step(0.9);
  const form = await read();
  const formShot = await capture('10-form');
  const formSource = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return {
      clip: p1.model?.userData?.currentClip || null,
      lastFormAnimation: p1.model?.userData?.lastFormAnimation || null,
      formClip: p1.model?.userData?.lastFormAnimation?.clip || null,
      formClipSource: p1.model?.userData?.lastFormAnimation?.source || null,
      special: p1.specialProfile?.label || null,
      aura: Boolean(p1.aura || p1.formAura),
      costume: p1.model?.userData?.formCostume || null
    };
  });
  check('form', 'the declared transformation enters a live form with its source charge',
    form.p1.transform?.id === config.formId && form.p1.transform?.landed === true
      && /charge/i.test(String(formSource.formClip || formSource.clip || '')),
    { transform: form.p1.transform, source: formSource });

  const formCalloutsBeforeExit = await callouts();
  const exitedFresh = await step(11.5);
  const afterForm = await read();
  const formCallouts = formCalloutsBeforeExit.concat(await callouts());
  check('form', 'the form exits naturally and restores the base signature',
    afterForm.p1.transform === null
      && afterForm.p1.special === (loaded.p1.special || afterForm.p1.special)
      && afterForm.p1.formStage === stageBefore + 1,
    { transform: afterForm.p1.transform, special: afterForm.p1.special, formStage: [stageBefore, afterForm.p1.formStage], callouts: formCallouts.map(item => item.text) });

  // Re-enter, then KO through the form's real signature attack. The Flash's form trades damage for
  // speed, so form-boosted heavies are too slow to finish before his 8 s window closes; the
  // form-specific SPEED FORCE STRIKE is the honest, damaging tool that keeps the KO inside the form.
  // The last pre-KO state proves the form was active when the killing blow was queued; the callout
  // trace proves endTransform(..., 'ko') ran.
  await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.power = 100;
    p1.transformCooldown = 0;
    p1.formLock = 0;
    p1.hitstun = 0;
    p1.guardBreak = 0;
  });
  await page.keyboard.press('i');
  await step(0.9);
  const koForm = await read();
  await clearCallouts();
  const koFormState = await read();
  const koTrace = [];
  let preFinal = null;
  let matchOver = false;
  for (let i = 0; i < 18 && !matchOver; i++) {
    await place(1.05);
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.facing = 1; p1.facingZ = 0;
      p2.facing = -1; p2.facingZ = 0;
      p2.hitstun = Math.max(0, p2.hitstun);
      p2.invulnerable = 0;
      p2.ko = false;
      p2.guardBreak = 0;
      p2.guardHeld = false;
      p2.isGrounded = true;
      p2.percent = Math.max(0, p2.percent);
    });
    const beforeHit = await read();
    if (beforeHit.p2.percent >= 100 && beforeHit.p1.transform) preFinal = beforeHit;
    await page.keyboard.press('k');
    const hit = await step(0.7, { pin: true, gap: 1.05 });
    const now = await read();
    koTrace.push({
      attempt: i + 1,
      beforePercent: beforeHit.p2.percent,
      afterPercent: now.p2.percent,
      form: now.p1.transform?.id || null,
      status: now.match?.status || null,
      entry: hit.find(item => item.attacker === process.argv[2]) || null
    });
    matchOver = now.match?.status === 'match-over';
  }
  // The result panel is deliberately held behind the authored victory/defeat pose. Advance the
  // shipping simulation through that hold instead of waiting on the wall clock; a software frame
  // can be slower than the hold's own timer.
  if (matchOver) await step(8);
  await page.waitForFunction(() => Boolean(window.__browserSmashLastResult)
    || /VICTORY|DEFEAT|DRAW/i.test(document.querySelector('#result')?.textContent || ''),
  null, { timeout: 15000, polling: 100 }).catch(() => {});
  const victory = await read();
  const koCallouts = await callouts();
  const victoryShot = await capture('11-victory-ko-during-form');
  observations.formKO = {
    activated: koForm.p1.transform,
    beforeFight: koFormState.p1.transform,
    preFinal: preFinal ? { p2Percent: preFinal.p2.percent, form: preFinal.p1.transform } : null,
    trace: koTrace,
    result: victory.result,
    resultText: victory.resultText,
    callouts: koCallouts.map(item => item.text),
    screenshot: victoryShot
  };
  // Signature strikes are projectiles, so the melee ledger entry is null even though the resolver
  // recorded real damage. Prove it through the target's accumulated percent on the live trace
  // instead of requiring a melee-only entry.
  check('form', 'the transformed fighter deals the match-ending KO with real damage',
    victory.match?.status === 'match-over' && victory.result?.winner === 'p1'
      && victory.p2.percent >= 150
      && koTrace.some(row => row.afterPercent > row.beforePercent + 1)
      && Number(victory.result?.stats?.dealt?.[0] || 0) > 0,
    { trace: koTrace, result: victory.result, targetPercent: victory.p2.percent });
  check('form', 'the KO is delivered while the transformation is active and ends it as a KO',
    Boolean(preFinal?.p1.transform)
      && preFinal.p2.percent < 150
      && koCallouts.some(item => new RegExp(`${config.formLabel}.*ENDED`, 'i').test(item.text)),
    { preFinal, callouts: koCallouts.map(item => item.text) });
  check('match', 'victory presents the correct result headline and winner',
    /VICTORY\s*·\s*/i.test(victory.resultText)
      && victory.result?.winner === 'p1' && victory.result?.text?.startsWith('VICTORY'),
    { text: victory.resultText, result: victory.result });

  // Rematch after victory.
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.percent === 0, null, { timeout: 40000, polling: 100 });
  await step(0.8);
  const rematchVictory = await read();
  const rematchShot = await capture('12-rematch');
  check('match', 'the result-screen rematch starts a fresh match with the form cleared',
    rematchVictory.match?.status === 'fighting'
      && rematchVictory.p1.percent === 0 && rematchVictory.p2.percent === 0
      && rematchVictory.p1.transform === null && rematchVictory.p2.transform === null
      && rematchVictory.resultText === '',
    { match: rematchVictory.match, p1: rematchVictory.p1, p2: rematchVictory.p2, screenshot: rematchShot });

  // Complete live defeat: P2 uses its real input path and P1 is passive. P1 is re-seated only when
  // neutral, never during a hit or knockdown, and no damage or KO is written.
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = false;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashP2Probe = null;
    const [p1, p2] = window.fighters;
    p1.position.set(-1.05, Number(p1.groundLevel ?? 0), -12);
    p2.position.set(0, Number(p2.groundLevel ?? 0), -12);
    p1.velocity.set(0, 0, 0);
    p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0;
    p2.facing = -1; p2.facingZ = 0;
  });
  await probe({ attack: true, run: true });
  const defeatTrace = [];
  let defeated = false;
  for (let i = 0; i < 140 && !defeated; i++) {
    const before = await read();
    if (before.match?.status !== 'fighting') { defeated = true; break; }
    if (before.p1.hitstun <= 0 && before.p1.grounded) {
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.position.set(p2.position.x - 1.05, Number(p1.groundLevel ?? 0), p2.position.z);
        p1.velocity.set(0, 0, 0);
        p1.isGrounded = true;
        p2.facing = -1; p2.facingZ = 0;
      });
    }
    await step(0.32);
    const now = await read();
    if (i % 5 === 0 || now.match?.status !== 'fighting') {
      defeatTrace.push({ i, p1: now.p1.percent, p2: now.p2.percent, status: now.match?.status, p1ko: now.p1.ko });
    }
    defeated = now.match?.status === 'match-over';
  }
  await probe(null);
  if (defeated) await step(8);
  await page.waitForFunction(() => Boolean(window.__browserSmashLastResult)
    || /VICTORY|DEFEAT|DRAW/i.test(document.querySelector('#result')?.textContent || ''),
  null, { timeout: 15000, polling: 100 }).catch(() => {});
  const defeat = await read();
  const defeatShot = await capture('13-defeat');
  observations.defeat = {
    trace: defeatTrace, result: defeat.result, resultText: defeat.resultText, p1: defeat.p1,
    poseClip: defeat.p1.clip, screenshot: defeatShot
  };
  check('match', 'a complete live match can end in defeat with the correct result',
    defeat.match?.status === 'match-over' && defeat.result?.winner === 'p2'
      && /DEFEAT/i.test(defeat.resultText),
    observations.defeat);

  // Rematch after defeat.
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
    && window.fighters?.[0]?.percent === 0, null, { timeout: 40000, polling: 100 });
  await step(0.8);
  const rematchDefeat = await read();
  const rematchDefeatShot = await capture('14-rematch-after-defeat');
  check('match', 'the defeat rematch is a fresh live match with no result state',
    rematchDefeat.match?.status === 'fighting'
      && rematchDefeat.p1.percent === 0 && rematchDefeat.p2.percent === 0
      && rematchDefeat.resultText === '',
    { match: rematchDefeat.match, p1: rematchDefeat.p1, p2: rematchDefeat.p2, screenshot: rematchDefeatShot });

  // ---------------------------------------------------------------------------------------------
  // F. Runtime integrity and report.
  // ---------------------------------------------------------------------------------------------
  const failureRows = checks.filter(row => !row.ok);
  check('runtime', 'no uncaught page errors during the matrix', errors.length === 0, errors.slice(0, 5));
  check('runtime', 'no failed asset requests during the matrix', failedRequests.length === 0, failedRequests.slice(0, 5));

  const report = {
    generatedAt: new Date().toISOString(),
    fighter: process.argv[2],
    identityKey: config.key,
    opponent: config.opponent,
    mode: 'A1 COMPLETE LIVE COMBAT MATRIX',
    hardwareMode: HARDWARE_GPU,
    hardwareVerified: HARDWARE_GPU,
    evidenceClass: HARDWARE_GPU
      ? 'live-browser hardware-GPU acceptance'
      : 'live-browser software (headless Chromium / SwiftShader)',
    renderer: observations.gpu,
    softwareRenderer,
    inputPaths: {
      p1: 'real Playwright keyboard: WASD, J, K, U, E, Shift, Space, I, O, L, H',
      p2: 'real P2 input handler through window.__browserSmashP2Probe; no damage/state writes',
      positioning: 'fighters are re-seated between cases only; every hit is resolved by Fighter3D.spawnHitbox',
      damage: 'never assigned; percent is read after the shipping resolver writes it'
    },
    checks,
    passed: checks.length - failureRows.length,
    total: checks.length,
    failed: failureRows.map(row => `${row.section}: ${row.name}`),
    observations,
    errors,
    failedRequests,
    captures: [
      '01-light-chain.png', '02-heavy.png', '03-aerial.png', '04-grab-throw.png',
      '05-guard-block.png', '06-parry-counter.png', '07-knockdown-getup.png',
      '08-jump-land.png', '09-ultimate.png', '10-form.png',
      '11-victory-ko-during-form.png', '12-rematch.png',
      '13-defeat.png', '14-rematch-after-defeat.png'
    ].map(name => resolve(out, name))
  };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const log = checks.map(row => `${row.ok ? 'PASS' : 'FAIL'} [${row.section}] ${row.name}`).join('\n');
  await writeFile(resolve(out, 'matrix.log'),
    `${log}\n\nA1 COMBAT MATRIX ${report.passed}/${report.total} checks passed\n`
    + `fighter ${report.fighter} · renderer ${softwareRenderer ? 'SwiftShader software' : 'hardware'}\n`, 'utf8');
  console.log(`\nA1 COMBAT MATRIX ${report.passed}/${report.total} checks passed for ${process.argv[2]}`);
  console.log('report ' + resolve(out, 'report.json'));
  if (failureRows.length || errors.length || failedRequests.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
