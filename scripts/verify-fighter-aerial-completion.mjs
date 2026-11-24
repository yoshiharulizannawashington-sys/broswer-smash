// Live aerial / result completion probe for the two supplied bodies that lacked a second jump.
//
//   bash scripts/run-browser-test.sh scripts/verify-fighter-aerial-completion.mjs hulk
//   bash scripts/run-browser-test.sh scripts/verify-fighter-aerial-completion.mjs iron
//
// The probe drives the real character-select and input paths, samples the clip the state machine
// actually selected (`userData.currentClip`), and writes a JSON report plus screenshots. It does not
// touch the model, the source GLB or the mixer inventory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const key = String(process.argv[2] || 'hulk').toLowerCase();
const specs = {
  hulk: {
    display: 'Hulk (Bruce Banner)', assetKey: 'hulk_bruce_banner',
    sourceClip: 'succ_cam', expectedActions: null,
    output: 'artifacts/hulk/aerial-completion', screenshot: 'artifacts/hulk/aerial-completion.png'
  },
  iron: {
    display: 'Iron Spider', assetKey: 'iron_spider',
    sourceClip: 'succ_cam', expectedClips: 57,
    output: 'artifacts/iron-spider/aerial-completion', screenshot: 'artifacts/iron-spider/aerial-completion.png'
  }
};
const spec = specs[key];
if (!spec) throw new Error('usage: verify-fighter-aerial-completion.mjs <hulk|iron>');
await mkdir(resolve(spec.output), { recursive: true });

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const errors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 300)));

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2,
    null, { timeout: 120_000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(({ display }) => {
    window.__browserSmashSelect?.select?.('p1', display);
    window.__browserSmashSelect?.select?.('p2', 'Goku');
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  }, spec);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => {
    const f = window.fighters?.[0];
    return document.querySelector('#menu')?.classList.contains('hidden')
      && f?.characterModelLoaded === true
      && f?.model?.userData?.humanMixer;
  }, null, { timeout: 120_000, polling: 250 });
  await page.waitForFunction(() => {
    const r = window.fighters?.[0]?.model?.userData?.importedReactionReport;
    return r && (r.status === 'ready' || r.status === 'failed');
  }, null, { timeout: 45_000, polling: 200 }).catch(() => {});
  await page.evaluate(() => window.__browserSmashStep(0.6));

  const binding = await page.evaluate(({ assetKey }) => {
    const f = window.fighters[0], u = f.model.userData;
    const clip = action => action?.getClip?.()?.name || null;
    const asset = window.__browserSmashAssets?.characterModels?.[assetKey] || null;
    return {
      identity: f.identity, key: f.identityKey, status: asset?.status || null, url: asset?.url || null,
      assetAnimations: (asset?.animations || []).length,
      clipCount: Object.keys(u.animationActions || {}).length,
      keys: Object.keys(u.animationActions || {}),
      librarySupplement: u.libraryStateSupplement || null,
      proceduralJointKeys: Object.keys(u.proceduralJoints || {}),
      sourceClips: (u.animationActions ? Object.values(u.animationActions).map(a => clip(a)).filter(Boolean) : []),
      reaction: u.importedReactionReport || null,
      actions: {
        idle: clip(u.idleAction), walk: clip(u.walkAction), run: clip(u.runAction),
        jump: clip(u.jumpAction), doubleJump: clip(u.doubleJumpAction), fall: clip(u.fallAction),
        land: clip(u.landAction), victory: clip(u.victoryAction), defeat: clip(u.defeatAction)
      },
      doubleJumpInPublicMap: Boolean(u.animationActions?.double_jump),
      fallInPublicMap: Boolean(u.animationActions?.fall),
      nativeArm: u.nativeSpiderLegs || null
    };
  }, spec);

  check('the real roster body is mounted', binding.status === 'loaded' && binding.identity === spec.display, JSON.stringify({ status: binding.status, identity: binding.identity, url: binding.url }));
  check('the imported reaction set is ready', binding.reaction?.status === 'ready', JSON.stringify(binding.reaction));
  check('the second jump is a distinct semantic action', Boolean(binding.actions.doubleJump) && binding.actions.doubleJump !== binding.actions.jump, JSON.stringify(binding.actions));
  check('the falling state is a distinct semantic action', Boolean(binding.actions.fall) && binding.actions.fall !== binding.actions.jump, JSON.stringify(binding.actions));
  check('the semantic air states do not alter the supplied GLB clip inventory',
    binding.actions.doubleJump === 'double_jump' && binding.actions.fall === 'fall'
      && !binding.doubleJumpInPublicMap && !binding.fallInPublicMap
      && (!spec.expectedClips || binding.assetAnimations === spec.expectedClips),
    JSON.stringify({ glbClips: binding.assetAnimations, actionAliases: binding.clipCount, doubleJump: binding.actions.doubleJump, fall: binding.actions.fall, public: [binding.doubleJumpInPublicMap, binding.fallInPublicMap] }));
  check('the authored success animation owns victory',
    /succ_cam/i.test(binding.actions.victory || ''), String(binding.actions.victory));
  if (key === 'iron') {
    check('the native Object_122 appendage is mounted', binding.nativeArm?.mesh === 'Object_122' && binding.nativeArm.bones >= 20, JSON.stringify(binding.nativeArm));
  }

  // ---- Double jump and fall on real Space presses ------------------------
  await page.evaluate(() => {
    const [f, foe] = window.fighters;
    f.position.set(0, f.groundLevel ?? 0, -12); f.velocity.set(0, 0, 0);
    f.facing = 1; f.facingZ = 0; f.jumps = 0; f.isGrounded = true;
    f.hitstun = 0; f.attackQueue.length = 0; f.attackBuffer = 0;
    foe.position.set(9, foe.groundLevel ?? 0, -12); foe.velocity.set(0, 0, 0);
    window.__browserSmashStep(0.35);
  });
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__browserSmashStep(0.12));
  const firstJump = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    return { jumps: f.jumps, y: f.position.y, vy: f.velocity.y, grounded: f.isGrounded, clip: u.currentClip, selected: u.lastMoveAction?.getClip?.()?.name || null };
  });
  await page.keyboard.press('Space');
  await page.evaluate(() => window.__browserSmashStep(0.06));
  const secondJump = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    return { jumps: f.jumps, y: f.position.y, vy: f.velocity.y, grounded: f.isGrounded, clip: u.currentClip, selected: u.lastMoveAction?.getClip?.()?.name || null };
  });
  const trajectory = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    const seen = [];
    let fallAt = null, landAt = null, maxY = 0;
    for (let i = 0; i < 240; i += 1) {
      window.__browserSmashStep(1 / 60);
      const clip = u.currentClip || null;
      if (clip && seen[seen.length - 1]?.clip !== clip) seen.push({ clip, y: +f.position.y.toFixed(3), vy: +f.velocity.y.toFixed(3), grounded: f.isGrounded });
      if (!fallAt && clip === 'fall' && f.velocity.y < 0) fallAt = i;
      if (!landAt && f.isGrounded && i > 3) landAt = i;
      maxY = Math.max(maxY, f.position.y);
    }
    return { seen, fallAt, landAt, maxY: +maxY.toFixed(2), grounded: f.isGrounded, y: +f.position.y.toFixed(3) };
  });
  check('the first Space press starts the ground jump', firstJump.jumps === 1 && firstJump.vy > 0 && !firstJump.grounded, JSON.stringify(firstJump));
  check('the second Space press selects the distinct double-jump clip',
    secondJump.jumps === 2 && secondJump.vy > 0 && [secondJump.clip, secondJump.selected].includes('double_jump'),
    JSON.stringify(secondJump));
  check('the live jump arc plays a separate falling clip',
    trajectory.fallAt !== null && trajectory.seen.some(entry => entry.clip === 'fall'),
    JSON.stringify(trajectory));
  check('the double jump returns to the floor', trajectory.grounded && trajectory.landAt !== null, JSON.stringify(trajectory));

  // ---- Authored victory on the real state action ------------------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.velocity.set(0, 0, 0); f.isGrounded = true; f.hitstun = 0; f.victoryPose = 4;
    window.__browserSmashStep(0.22);
  });
  const victory = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    return { clip: u.currentClip, selected: u.lastMoveAction?.getClip?.()?.name || null,
      actionClip: u.victoryAction?.getClip?.()?.name || null,
      weight: u.victoryAction?.getEffectiveWeight?.() ?? null,
      time: u.victoryAction?.time ?? null };
  });
  await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
  // Hold the authored beat past the opening floor push-up so the capture shows the recognizable
  // success pose, not the first recovery frame.
  await page.evaluate(() => window.__browserSmashStep(0.9));
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(root, spec.screenshot) });
  check('the victory state plays the authored success clip',
    /succ_cam/i.test(victory.clip || '') && /succ_cam/i.test(victory.actionClip || '') && victory.weight >= 0.99,
    JSON.stringify(victory));

  // ---- Iron Spider ultimate and native appendages -----------------------
  let ultimate = null;
  if (key === 'iron') {
    const before = await page.evaluate(() => {
      const f = window.fighters[0], foe = window.fighters[1];
      const arm = f.model.getObjectByName?.('Object_122');
      arm?.skeleton?.update?.();
      f.victoryPose = 0; f.meter = 100; f.abilityReadyAt = {}; f.attackQueue.length = 0;
      f.attackBuffer = 0; f.hitstun = 0; f.isGrounded = true;
      f.position.set(0, f.groundLevel ?? 0, -12); f.velocity.set(0, 0, 0);
      f.facing = 1; f.facingZ = 0;
      foe.position.set(1.55, foe.groundLevel ?? 0, -12); foe.velocity.set(0, 0, 0);
      foe.percent = 0; foe.hitstun = 0; foe.guardHeld = false; foe.invulnerable = 0;
      window.__browserSmashStep(0.1);
      return { legs: (arm?.skeleton?.bones || []).filter(b => /spider/i.test(b.name || '')).map(b => ({ name: b.name, q: b.quaternion.toArray() })) };
    });
    await page.keyboard.press('o');
    await page.evaluate(() => window.__browserSmashStep(0.14));
    const during = await page.evaluate(() => {
      const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
      const arm = f.model.getObjectByName?.('Object_122');
      arm?.skeleton?.update?.();
      return {
        casting: f.casting || null, meter: Math.round(f.meter || 0),
        ultimate: u.lastUltimateAnimation || null, clip: u.currentClip,
        percent: foe.percent, hitstun: foe.hitstun,
        legs: (arm?.skeleton?.bones || []).filter(b => /spider/i.test(b.name || '')).map(b => ({ name: b.name, q: b.quaternion.toArray() }))
      };
    });
    await page.evaluate(() => {
      const foe = window.fighters[1];
      for (let i = 0; i < 220 && foe.percent <= 0; i += 1) window.__browserSmashStep(1 / 60);
    });
    const afterHits = await page.evaluate(() => {
      const f = window.fighters[0], foe = window.fighters[1];
      return { percent: foe.percent, hitstun: foe.hitstun, casting: f.casting || null, clip: f.model.userData.currentClip };
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(root, spec.output, 'ultimate.png') });
    let maxAngle = 0, bone = null;
    const beforeByName = new Map(before.legs.map(entry => [entry.name, entry.q]));
    for (const after of during.legs) {
      const prev = beforeByName.get(after.name);
      if (!prev) continue;
      const dot = Math.abs(prev.reduce((sum, value, index) => sum + value * after.q[index], 0));
      const angle = 2 * Math.acos(Math.min(1, dot));
      if (angle > maxAngle) { maxAngle = angle; bone = after.name; }
    }
    ultimate = { before: before.legs.length, during, legMotionDeg: +(maxAngle * 180 / Math.PI).toFixed(2), legBone: bone };
    check('the Iron Spider ultimate starts through the live input path',
      during.casting === 'ultimate' && /skill07-02/.test(String(during.ultimate?.clip || '')),
      JSON.stringify({ casting: during.casting, clip: during.ultimate?.clip, current: during.clip }));
    check('the ultimate uses the supplied mechanical-leg clip', /spider/i.test(String(during.ultimate?.id || '')) || /EIGHT-POINT/i.test(String(during.ultimate?.id || '')), JSON.stringify(during.ultimate));
    check('the native appendages animate during the ultimate', ultimate.legMotionDeg > 3, JSON.stringify(ultimate));
    check('the ultimate damages the adjacent opponent', afterHits.percent > 0, `${afterHits.percent.toFixed(1)}% · ${JSON.stringify(afterHits)}`);
  }

  const report = { fighter: key, binding, firstJump, secondJump, trajectory, victory, ultimate, checks, errors };
  await writeFile(resolve(root, spec.output, 'report.json'), JSON.stringify(report, null, 2));
  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  check('probe completed', false, String(error?.stack || error).slice(0, 500) + ' | pageErrors=' + errors.join(' | '));
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter(check => !check.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
