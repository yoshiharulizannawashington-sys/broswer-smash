// Live proof that upper/lower body masks layer locomotion, guard and a punch in the actual game.
//
//   BODY_MASK_CHARACTER=Superman bash scripts/run-browser-test.sh scripts/verify-body-mask-layering.mjs
//
// Superman is the fixture on purpose: its GLB has a skeleton and zero baked clips, so attachAnimation()
// gives the rig to AnimationController. Naruto ships 49 baked clips and stays on the legacy
// imported-body mixer, which is why the earlier Naruto captures are not controller evidence.
//
// The harness freezes the CPU and produces the states through held keyboard input and
// __browserSmashStep. It records the live owner in every state, the two masked actions, their bone
// coverage and their weights, then saves three frames for visual review.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const character = process.env.BODY_MASK_CHARACTER || 'Superman';
const characterSlug = character.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fighter';
const outDir = resolve('artifacts/body-mask', characterSlug);
await mkdir(outDir, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const body = await readFile(resolve(root, relative));
    res.writeHead(200, { 'Content-Type': mime[extname(relative).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const errors = [];
const failedRequests = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 240)));
  page.on('requestfailed', request => failedRequests.push(request.url()));

  await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });

  await page.evaluate(character => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.select('p1', character);
  }, character);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => window.__browserSmashControlMode?.().started === true,
    null, { timeout: 120_000, polling: 250 });
  // The simulation can be ready while the arena intro card is still the last rendered frame.
  // Wait on the presentation's real intro state, not wall-clock time.
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
    null, { timeout: 15_000, polling: 100 }).catch(() => {});
  // The loading slate is a separate overlay from the cinematic intro; wait for its own report.
  await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false,
    null, { timeout: 15_000, polling: 100 }).catch(() => {});
  // The selected body can be swapped asynchronously after the match starts. Wait for its final bind
  // before recording the owner; a strict controller check below fails rather than falling back.
  await page.waitForFunction(() => {
    const fighter = window.fighters?.[0];
    return Boolean(fighter?.model && fighter.animationBindModel === fighter.model && fighter.animationController);
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: '#bbHudLayer, #bbHudLayer *, #combatCallout { display: none !important; }' });
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-2, p1.groundLevel ?? 0, 0);
    // Keep the opponent out of the inspection shot; the mask state does not need a nearby target.
    p2.position.set(9, p2.groundLevel ?? 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0);
      f.hitstun = 0; f.attackQueue.length = 0; f.guardHeld = false;
      f.isGrounded = true; f.ko = false;
    }
  });

  const read = () => page.evaluate(() => {
    const f = window.fighters[0];
    const controller = f.animationController || null;
    const u = f.model?.userData || {};
    const describe = controller?.describe?.() || null;
    const layers = controller ? (describe?.layers || null) : (u.bodyMaskLayers || null);
    const baseAction = controller?._baseAction || (controller ? null : u.lastMoveAction);
    const overlayAction = controller?._overlayAction || (controller ? null : u.maskOverlayAction);
    const baseClip = layers ? baseAction?.getClip?.() || null : null;
    const overlayClip = layers ? overlayAction?.getClip?.() || null : null;
    return {
      identity: f.identityKey || f.identity || f.name,
      asset: u.characterAssetUrl || null,
      rightHandBone: u.rightHand?.name || null,
      weapon: u.equippedWeaponRight ? {
        name: u.equippedWeaponRight.name || null,
        mountBone: u.equippedWeaponRight.parent?.userData?.attachBone || null
      } : null,
      owner: controller ? 'controller' : 'legacy',
      controller: Boolean(controller),
      legacyMixer: Boolean(u.humanMixer),
      bakedClips: Boolean(u.hasAnimationClips),
      rig: describe?.rig || null,
      boundBones: describe?.boundBones ?? null,
      missingBones: describe?.missingBones || [],
      active: controller ? (describe?.active || null) : (u.currentClip || null),
      layers,
      speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(3),
      grounded: f.isGrounded !== false,
      guardHeld: Boolean(f.guardHeld),
      attack: f.attackQueue?.[f.attackQueue.length - 1]?.id || f.attackQueue?.[0]?.kind || null,
      baseClip: baseClip?.name || null,
      overlayClip: overlayClip?.name || null,
      baseMask: baseClip?.userData?.mask || null,
      overlayMask: overlayClip?.userData?.mask || null,
      baseBones: baseClip?.userData?.bones || [],
      overlayBones: overlayClip?.userData?.bones || [],
      baseRunning: Boolean(baseAction?.isRunning?.()),
      overlayRunning: Boolean(overlayAction?.isRunning?.()),
      baseWeight: +(baseAction?.getEffectiveWeight?.() || 0).toFixed(3),
      overlayWeight: +(overlayAction?.getEffectiveWeight?.() || 0).toFixed(3)
    };
  });
  const step = seconds => page.evaluate(seconds => {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) window.__browserSmashStep(1 / 60);
  }, seconds);
  const capture = async name => {
    await page.evaluate(() => {
      window.__browserSmashSetPaused?.(true);
      // Superman carries a right-hand gauntlet, and the fighting-idle/guard hand sits at face
      // height. It is animation-neutral but hides the mask, so the inspection frame excludes held
      // equipment. The game's equipment system itself is untouched.
      const userData = window.fighters[0].model.userData;
      for (const key of ['equippedWeaponRight', 'equippedWeaponLeft', 'pickupBlade']) {
        if (userData[key]) userData[key].visible = false;
      }
      const camera = window.smashCamera || window.__browserSmashCamera;
      camera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 35, pitch: 6,
        distance: 3.4, transition: 0 });
    });
    await page.waitForTimeout(450);
    await page.screenshot({ path: resolve(outDir, name) });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
  };

  const boot = await read();
  check('the selected fighter is owned by AnimationController', boot.owner === 'controller' && boot.controller,
    `${boot.owner}: ${boot.identity}`);
  check('the controller-owned body carries no legacy baked-clip library', boot.legacyMixer && boot.bakedClips === false,
    `legacyMixer=${boot.legacyMixer} bakedClips=${boot.bakedClips} asset=${boot.asset}`);
  check('the controller bound the selected body to its own rig', boot.rig && boot.boundBones > 0,
    `${boot.rig}: ${boot.boundBones} bones, missing ${boot.missingBones.length}`);
  check('the match starts grounded', boot.grounded && boot.speed === 0, JSON.stringify(boot));

  // Held movement + guard: the lower lane must keep walking while the upper lane blocks.
  await page.keyboard.down('d');
  await page.keyboard.down('e');
  await step(0.8);
  const guard = await read();
  await capture('01-walk-guard.png');
  check('guard is held while walking', guard.guardHeld && guard.speed > 0.75,
    `guard=${guard.guardHeld} speed=${guard.speed}`);
  const guardBase = String(guard.layers?.base || '').replace(/__lower$/, '');
  const guardOverlay = String(guard.layers?.overlay || '').replace(/__upper$/, '');
  check('guard is split into lower locomotion and upper block',
    guardOverlay === 'block' && guard.layers?.overlayRegion === 'upper'
      && guard.layers?.baseRegion === 'lower' && ['walk', 'run', 'sprint'].includes(guardBase),
    JSON.stringify(guard.layers));
  check('both masked guard actions are running',
    guard.baseRunning && guard.overlayRunning && guard.baseWeight > 0.9 && guard.overlayWeight > 0.9,
    `weights ${guard.baseWeight}/${guard.overlayWeight}`);
  check('the live guard clips carry opposite masks',
    guard.baseMask === 'lower' && guard.overlayMask === 'upper',
    `${guard.baseClip} (${guard.baseMask}) / ${guard.overlayClip} (${guard.overlayMask})`);
  check('the two masks share no bones',
    guard.baseBones.every(bone => !guard.overlayBones.includes(bone)),
    `${guard.baseBones.length} + ${guard.overlayBones.length} bones`);

  // Release guard and punch while still moving: attack must not replace the walk cycle.
  await page.keyboard.up('e');
  await page.keyboard.press('j');
  await step(0.16);
  const attack = await read();
  await capture('02-punch-walk.png');
  check('a punch is selected while the lower body keeps moving',
    Boolean(attack.attack) && attack.speed > 0.75, `attack=${attack.attack} speed=${attack.speed}`);
  check('the punch layer is upper-body only and locomotion stays below',
    attack.layers?.overlayRegion === 'upper' && attack.layers?.baseRegion === 'lower',
    JSON.stringify(attack.layers));
  check('the punch is retimed and active while both lanes run',
    attack.active === attack.layers?.overlay && attack.overlayMask === 'upper'
      && attack.baseRunning && attack.overlayRunning,
    `${attack.active} base=${attack.baseClip} overlay=${attack.overlayClip}`);

  // Release movement: the mask must end and one whole-body action resume.
  await page.keyboard.up('d');
  await step(0.6);
  const released = await read();
  await capture('03-full-body.png');
  check('releasing movement clears both mask lanes',
    released.layers === null && released.guardHeld === false, JSON.stringify(released.layers));
  check('a full-body clip owns the skeleton again',
    Boolean(released.active) && released.baseClip === null && released.overlayClip === null,
    released.active);
  check('AnimationController remains the owner in every captured state',
    [boot, guard, attack, released].every(state => state.owner === 'controller' && state.controller),
    [boot, guard, attack, released].map(state => `${state.owner}:${state.active}`).join(' / '));

  check('no browser runtime errors during the layer test', errors.length === 0, errors.join(' | '));
  check('no failed asset requests during the layer test', failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '));

  await writeFile(resolve(outDir, 'report.json'), JSON.stringify({
    requestedCharacter: character,
    identity: boot.identity,
    owner: boot.owner,
    controllerOwned: boot.owner === 'controller' && boot.controller,
    asset: boot.asset,
    bakedClips: boot.bakedClips,
    rig: boot.rig,
    boundBones: boot.boundBones,
    equipmentHiddenForCapture: ['equippedWeaponRight', 'equippedWeaponLeft', 'pickupBlade'],
    states: { boot, guard, attack, released },
    checks,
    pageErrors: errors,
    failedRequests
  }, null, 2));
  const passed = checks.filter(item => item.ok).length;
  console.log(`\n${passed}/${checks.length} body-mask checks passed`);
  if (passed !== checks.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
