// Trustworthy state-pose evidence for the Knight acting as P1/Kaze.
//
//   bash scripts/run-browser-test.sh scripts/capture-knight-states.mjs <CharacterName> <outDir>
//
// Capture-only: no game code is touched. The inspection camera is entered once and stays active, so it
// tracks the fighter every frame instead of being snapped after the body has moved. Each shot is checked
// before it counts as evidence: the fighter must project inside the viewport and fill a useful fraction
// of the frame, otherwise the state is recorded as unverified rather than substituted with metrics.
//
// The hit reaction is produced by the game's own combat: the CPU is briefly unfrozen next to P1 so it can
// land a real hit, then the camera shoots the hitstun frame. Freezing resumes immediately after.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const characterName = process.argv[2] || 'Kaze';
const outDir = resolve(process.cwd(), process.argv[3] || 'artifacts/dev/phase28420/states');
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
await mkdir(outDir, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));

const manifest = { character: characterName, states: [], errors };

try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 180_000, polling: 200 });
  await page.evaluate(name => {
    const select = document.querySelector('#p1Character');
    if (select) {
      const option = [...select.options].find(item => item.value === name);
      if (option) { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    document.querySelector('#play')?.click();
  }, characterName);
  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(f => f.model), null, { timeout: 180_000, polling: 200 });

  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const [player, cpu] = window.fighters;
    cpu.position.set(player.position.x + 4.5, player.position.y, player.position.z);
    window.__browserSmashStep?.(0.4);
  });

  manifest.identity = await page.evaluate(() => {
    const fighter = window.fighters[0];
    let bones = 0;
    [fighter.model, fighter.root, fighter.mesh].filter(Boolean).forEach(root =>
      root.traverse?.(node => { if (node.isSkinnedMesh) bones = Math.max(bones, node.skeleton?.bones?.length || 0); }));
    return { fighter: fighter.name || null, identity: fighter.identity || null, bones };
  });

  // Frame gate: the fighter must be on screen and large enough to inspect.
  const inspectFrame = () => page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera?.camera;
    const fighter = window.fighters[0];
    const root = fighter.model || fighter.root || fighter.mesh;
    if (!THREE || !camera || !root) return { valid: false, reason: 'missing camera or model' };
    const base = new THREE.Vector3();
    root.getWorldPosition(base);
    const head = base.clone(); head.y += 1.75;
    const feet = base.clone();
    const project = v => { const p = v.clone().project(camera); return { x: p.x, y: p.y }; };
    const h = project(head), f = project(feet);
    const onScreen = [h, f].every(p => Math.abs(p.x) <= 1.0 && Math.abs(p.y) <= 1.0);
    const heightFraction = Math.abs(h.y - f.y) / 2;
    return {
      valid: onScreen && heightFraction >= 0.3,
      onScreen, heightFraction: +heightFraction.toFixed(3),
      clip: root.userData?.currentClip || null,
      grounded: !!fighter.isGrounded,
      speed: +(fighter.speed ?? Math.hypot(fighter.velocity?.x || 0, fighter.velocity?.z || 0)).toFixed(2),
      y: +fighter.position.y.toFixed(2),
      hitstun: +(fighter.hitstun || 0).toFixed(2),
      framing: window.smashCamera.describeSpectate?.() || null
    };
  });

  await page.evaluate(() => {
    window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', yaw: 35, pitch: 0 });
  });
  manifest.camera = await page.evaluate(() => window.smashCamera.describeSpectate?.() || null);

  const capture = async (label, keys, settle = 4) => {
    for (const key of keys) await page.keyboard.down(key);
    for (let i = 0; i < settle; i++) {
      await page.evaluate(() => window.__browserSmashStep?.(0.05));
      await page.waitForTimeout(40);
    }
    const frame = await inspectFrame();
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    const file = `knight-${label}.png`;
    if (!frame.valid) {
      manifest.states.push({ state: label, input: keys.join('+') || 'none', file: null, frame, verified: false,
        reason: frame.onScreen ? 'fighter too small in frame' : 'fighter outside frame' });
      return;
    }
    await page.screenshot({ path: resolve(outDir, file) });
    manifest.states.push({ state: label, input: keys.join('+') || 'none', file, frame, verified: true });
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.__browserSmashStep?.(0.05));
  };

  await capture('idle', []);
  await capture('walk', ['d']);
  await capture('run', ['d', 'Shift']);
  await capture('jump', [' ']);
  await capture('attack', ['j']);
  await capture('grab', ['u']);

  // Hit reaction: unfreeze the CPU beside P1, let it land a real hit, shoot the hitstun frame.
  await page.evaluate(() => {
    const [player, cpu] = window.fighters;
    player.percent = 0;
    cpu.position.set(player.position.x + 0.9, player.position.y, player.position.z);
    window.smashCamera.spectate({ fighter: player, framing: 'full', yaw: 35, pitch: 0 });
    window.__browserSmashFreezeAI = false;
    window.__browserSmashStep?.(0.05);
  });
  let hit = null;
  for (let frame = 0; frame < 240; frame++) {
    const state = await page.evaluate(() => {
      const player = window.fighters[0];
      return { hitstun: +(player.hitstun || 0).toFixed(2), percent: +player.percent.toFixed(2) };
    });
    if (state.hitstun > 0) { hit = { frame, ...state }; break; }
    await page.evaluate(() => window.__browserSmashStep?.(1 / 60));
  }
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; });
  if (hit) {
    const frame = await inspectFrame();
    if (frame.valid) {
      await page.screenshot({ path: resolve(outDir, 'knight-hit-reaction.png') });
      manifest.states.push({ state: 'hit-reaction', input: 'CPU attack (real combat)', file: 'knight-hit-reaction.png',
        frame, hit, verified: true });
    } else {
      manifest.states.push({ state: 'hit-reaction', input: 'CPU attack (real combat)', file: null, frame, hit,
        verified: false, reason: 'frame rejected' });
    }
  } else {
    manifest.states.push({ state: 'hit-reaction', input: 'CPU attack (real combat)', file: null, verified: false,
      reason: 'no hitstun within 240 frames' });
  }

  await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('KNIGHT:' + JSON.stringify(manifest));
} finally {
  await browser.close();
}
