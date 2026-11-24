// Focused live acceptance for the full-size Super Smash Bros. Ultimate Link replacement.
// Exercises the real selection path, the mounted imported body, the 25 retargeted clips, sword
// combo, guard, dodge, bow draw/fire, projectile damage and the ultimate, then captures evidence.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const out = 'artifacts/link-upgrade/live-final';
await mkdir(out, { recursive: true });
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
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
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 220)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)); });
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const pause = async value => {
    await page.evaluate(on => window.__browserSmashSetPaused?.(on), value);
    await page.waitForTimeout(value ? 160 : 0);
  };
  const shot = async name => {
    await pause(true);
    await page.screenshot({ path: `${out}/${name}.png` });
    await pause(false);
  };
  await page.addInitScript(() => {
    localStorage.setItem('browserSmashP1', 'Link');
    localStorage.setItem('browserSmashCPU', 'Mario');
  });
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 80000, polling: 250 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/title.png` });

  await page.evaluate(() => document.querySelector('[data-nav="versus"]')?.click());
  await page.waitForSelector('#selectScreen', { state: 'visible', timeout: 15000 });
  await page.evaluate(() => window.__browserSmashSelect?.select('p1', 'Link'));
  await page.waitForFunction(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    return status && ['ready', 'fallback', 'unavailable'].includes(status.dataset.state);
  }, null, { timeout: 40000, polling: 200 });
  const previewState = await page.evaluate(() => {
    const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
    const canvas = document.querySelector('#selectScreen [data-role="previewcanvas"]');
    return { state: status?.dataset.state || 'missing', text: status?.textContent || '', width: canvas?.clientWidth || 0, height: canvas?.clientHeight || 0 };
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/selection.png` });
  report.preview = previewState;
  check('character-select preview renders the new Link', previewState.state === 'ready' && previewState.width > 0, JSON.stringify(previewState));
  await page.evaluate(() => document.querySelector('#selectScreen')?.classList.add('hidden'));

  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
  await page.waitForTimeout(1000);

  const body = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const model = fighter.model;
    let meshes = 0, skinned = 0;
    const clips = new Set();
    model?.traverse(node => { if (node.isSkinnedMesh) skinned += 1; if (node.isMesh) meshes += 1; });
    const mixer = model?.userData?.humanMixer;
    if (mixer) for (const action of mixer._actions || []) clips.add(action._clip?.name || action.getClip?.().name);
    const jointNames = ['pelvis', 'spine', 'torso', 'neck', 'head', 'leftClavicle', 'rightClavicle',
      'leftArm', 'leftFore', 'leftHand', 'rightArm', 'rightFore', 'rightHand',
      'leftLeg', 'leftShin', 'leftFoot', 'rightLeg', 'rightShin', 'rightFoot'];
    return {
      identity: fighter.identity,
      asset: model?.userData?.characterAssetUrl || null,
      meshes, skinned,
      boundJoints: jointNames.filter(j => model?.userData?.[j]).length,
      clips: [...clips],
      height: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.height?.toFixed?.(3); } catch { return null; } })(),
      feetY: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.feetY?.toFixed?.(3); } catch { return null; } })(),
      gear: {
        sword: model?.userData?.equippedWeaponRight?.name || null,
        shield: model?.userData?.equippedWeaponLeft?.name || null,
        bow: model?.userData?.linkBow?.name || null,
        arrow: model?.userData?.linkArrow?.name || null
      }
    };
  });
  report.body = body;
  console.log('BODY', JSON.stringify(body));

  const resetArena = async () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-1.0, 0, 2); p2.position.set(0.8, 0, 2);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.percent = 0; p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0;
    p1.facing = 1; p1.facingZ = 0; p1.attackCooldown = 0; p1.attackTimer = 0;
    p1.state = 'idle'; p1.hitstun = 0; p1.guardBreak = 0; p1.guardHeld = false; p1.invulnerable = 99; p2.attackCooldown = 999; p2.specialCooldown = 999; if (window.browserSmashProjectiles) window.browserSmashProjectiles.length = 0;
    window.smashCamera.spectate({ fighter: p1, framing: 'full', distance: 4.2, yaw: 25, pitch: 8 });
  });
  await resetArena();
  await step(0.25);
  await shot('idle');

  // Locomotion and jump/land: the body's own walk/run, jump and landing lanes must be driven by
  // the live controller, not merely registered in the clip list.
  await page.keyboard.down('d');
  await step(0.3);
  const locomotion = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { clip: p1.model?.userData?.currentClip || null, x: +p1.position.x.toFixed(2), speed: +Math.hypot(p1.velocity.x, p1.velocity.z).toFixed(2) };
  });
  await shot('run');
  await page.keyboard.up('d');
  await step(0.12);
  await page.keyboard.press('Space');
  await step(0.14);
  const jump = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { grounded: p1.isGrounded, y: +p1.position.y.toFixed(2), clip: p1.model?.userData?.currentClip || null };
  });
  await shot('jump');
  await step(1.25);
  const landing = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { grounded: p1.isGrounded, y: +p1.position.y.toFixed(2), clip: p1.model?.userData?.currentClip || null };
  });
  await resetArena();
  await step(0.2);

  // Sword combo: three light presses, each advanced deterministically so the chain, hitbox and
  // damage resolver actually run rather than only the animation being present.
  const combo = await page.evaluate(() => ({ before: window.fighters[1].percent, hits: [] }));
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p2.position.set(0.8, p2.position.y, 2); p2.hitstun = 0; p2.invulnerable = 0;
      p1.attackCooldown = 0; p1.attackTimer = 0;
    });
    await page.keyboard.down('j');
    await step(0.03);
    await page.keyboard.up('j');
    if (i === 2) {
      await step(0.18);
      combo.mid = await page.evaluate(() => {
        const p1 = window.fighters[0], u = p1.model.userData, a = u.authoredStrikeAction;
        return {
          currentClip: u.currentClip, strikeTime: +(u.authoredStrikeTime || 0).toFixed(3),
          action: a ? { clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(3), running: a.isRunning(), time: +a.time.toFixed(3), tracks: a.getClip().tracks.length } : null,
          hitstun: p1.hitstun, rightArm: u.rightArm?.quaternion.toArray().map(v => +v.toFixed(2)), leftArm: u.leftArm?.quaternion.toArray().map(v => +v.toFixed(2)),
          lastMove: u.lastMoveAction?.getClip?.().name || null
        };
      });
      await shot('sword-combo');
      await step(0.22);
    } else {
      await step(0.34);
    }
    combo.hits.push(await page.evaluate(() => +window.fighters[1].percent.toFixed(2)));
  }
  combo.after = await page.evaluate(() => window.fighters[1].percent);
  combo.animation = await page.evaluate(() => {
    const p1 = window.fighters[0], u = p1.model.userData;
    return {
      currentClip: u.currentClip, lastStrike: u.lastAuthoredStrike || null,
      authoredStrikeTime: +(u.authoredStrikeTime || 0).toFixed(3),
      lastMove: u.lastMoveAction?.getClip?.().name || null,
      queue: (p1.attackQueue || []).length, transition: u.lastAnimationTransition || null,
      actions: Object.fromEntries(['light1', 'light3', 'heavy'].map(slot => {
        const a = u.authoredAbilityActions?.[slot];
        const c = a?.getClip?.();
        return [slot, c ? { name: c.name, duration: +c.duration.toFixed(3), tracks: c.tracks.map(t => t.name), bones: c.userData?.bones || [] } : null];
      }))
    };
  });
  report.combo = combo;

  // Guard: hold the shield button and confirm the controller enters its blocking state.
  await page.keyboard.down('e');
  await step(0.18);
  const guard = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { guardHeld: p1.guardHeld, shield: +p1.shield.toFixed(2), clip: p1.model?.userData?.currentClip || null };
  });
  await shot('guard');
  await page.keyboard.up('e');
  report.guard = guard;

  // Dodge: a sprint press is the dodge input; verify the invulnerability/dash window opens.
  await page.keyboard.press('Shift');
  await step(0.04);
  const dodge = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { dodgeTimer: +p1.dodgeTimer.toFixed(3), invulnerable: +p1.invulnerable.toFixed(3), dashTimer: +p1.dashTimer.toFixed(3) };
  });
  await shot('dodge');
  await step(0.5);
  report.dodge = dodge;

  // Kit ability: Link's BOMB THROW is separate from the bow special and must still cast.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-1, 0, 2); p2.position.set(0.6, 0, 2); p2.percent = 0; p2.hitstun = 0;
    p1.facing = 1; p1.facingZ = 0; p1.abilityCast = null; p1.abilityReadyAt = {};
    p1.guardBreak = 0; p1.hitstun = 0; p1.invulnerable = 99;
    window.smashCamera.spectate({ fighter: p1, framing: 'full', distance: 4.2, yaw: 25, pitch: 8 });
  });
  await page.keyboard.press('l');
  await step(0.14);
  const ability = await page.evaluate(() => {
    const p1 = window.fighters[0], u = p1.model.userData;
    return {
      cast: p1.abilityCast || null, percent: p1.percent,
      bowVisible: !!u.linkBow?.visible, swordVisible: u.equippedWeaponRight?.visible,
      aim: { ...(u.linkAim || {}) },
      projectiles: (window.browserSmashProjectiles || []).map(p => p.moveType)
    };
  });
  await shot('ability');
  report.ability = ability;

  // Bow: raise, draw for 0.9 s, confirm the nocked arrow and hidden sword/shield, then release
  // a real projectile and wait for it to hit Mario.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, 0, 0); p1.velocity.set(0, 0, 0);
    p2.position.set(0, 0, 5); p2.velocity.set(0, 0, 0); p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.isGrounded = true;
    p1.facing = 0; p1.facingZ = 1; p1.specialCooldown = 0; p1.hitstun = 0; p1.guardBreak = 0;
    p1.linkBow = { aiming: false, draw: 0, release: 0 }; p1.bowAiming = false;
    window.smashCamera.spectate({ fighter: p1, framing: 'full', distance: 4.6, yaw: 0, pitch: 5 });
  });
  await page.keyboard.down('k');
  await step(0.9);
  const draw = await page.evaluate(() => {
    const f = window.fighters[0], u = f.model.userData;
    return {
      aiming: f.linkBow.aiming, draw: +f.linkBow.draw.toFixed(3), bowVisible: !!u.linkBow?.visible,
      arrowVisible: !!u.linkArrow?.visible, arrowLocalZ: +(u.linkArrow?.position.z || 0).toFixed(3),
      swordParentVisible: u.equippedWeaponRight?.visible, shieldParentVisible: u.equippedWeaponLeft?.visible,
      arrowWorld: u.linkArrow ? u.linkArrow.getWorldPosition(new window.__browserSmashThree.Vector3()).toArray().map(v => +v.toFixed(2)) : null
    };
  });
  await shot('bow-draw');
  report.bowDraw = draw;

  await page.keyboard.up('k');
  await step(0.08);
  const release = await page.evaluate(() => ({
    shot: window.__browserSmashLastShot,
    last: window.fighters[0].lastBowShot,
    p2: window.fighters[1].percent,
    projectiles: (window.browserSmashProjectiles || []).map(p => ({ type: p.moveType, damage: +p.damage.toFixed(2), pos: p.group.position.toArray().map(v => +v.toFixed(2)) }))
  }));
  await shot('bow-release');
  await step(1.25);
  const bowHit = await page.evaluate(() => ({
    p2: window.fighters[1].percent,
    impact: window.__browserSmashLastImpact || null,
    last: window.fighters[0].lastBowShot,
    bowState: window.fighters[0].linkBow
  }));
  report.bowRelease = release;
  report.bowHit = bowHit;

  // Ultimate: fill the meter directly and cast through the regular input/ultimate path.
  await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.meter = 100; p1.hitstun = 0; p1.guardBreak = 0; p1.casting = null; p1.specialCooldown = 0;
    p1.position.set(-1, 0, 2); p1.facing = 1; p1.facingZ = 0;
    window.fighters[1].position.set(1.2, 0, 2);
  });
  await page.keyboard.press('o');
  await step(0.18);
  await page.evaluate(() => window.smashCamera.spectate({ fighter: window.fighters[0], framing: 'full', distance: 7.5, yaw: 35, pitch: 12 }));
  await step(0.05);
  const ultimate = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { label: p1.ultimateDef?.label || p1.ultimateDef?.name || null, casting: Boolean(p1.casting), meter: p1.meter, callout: document.querySelector('#combatCallout')?.textContent || null };
  });
  await shot('ultimate');
  report.ultimate = ultimate;

  // Victory is a registered state on the body and must be selected by the existing state machine.
  await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.casting = null; p1.victoryPose = 1; p1.hitstun = 0; p1.guardBreak = 0; p1.isGrounded = true;
    p1.position.set(-1, 0, 2);
  });
  await step(0.12);
  const victory = await page.evaluate(() => {
    const p1 = window.fighters[0];
    return { clip: p1.model?.userData?.currentClip || null, pose: p1.victoryPose };
  });
  await shot('victory');
  await page.evaluate(() => { window.fighters[0].victoryPose = 0; });
  report.victory = victory;

  check('real selection path loads Link', body.identity === 'Link', JSON.stringify({ identity: body.identity }));
  check('full-size imported Link body is mounted', body.asset === '/models/characters/roster/link.glb' && body.meshes >= 10 && body.skinned >= 10, JSON.stringify({ asset: body.asset, meshes: body.meshes, skinned: body.skinned }));
  check('all 19 canonical joints are bound', body.boundJoints === 19, JSON.stringify({ boundJoints: body.boundJoints }));
  check('25 retargeted clips are wired', body.clips.length >= 25, JSON.stringify({ clips: body.clips.length }));
  check('feet are on the arena floor', body.feetY == null || Math.abs(body.feetY) < 0.2, JSON.stringify({ feetY: body.feetY, height: body.height }));
  check('walk/run lane is driven by the controller', /walk|run|sprint|strafe/i.test(locomotion.clip || '') && locomotion.speed > 0.5, JSON.stringify(locomotion));
  check('jump leaves the ground and lands', jump.grounded === false && landing.grounded === true, JSON.stringify({ jump, landing }));
  check('Master Sword and Hylian Shield are the native props', /Master Sword|link_sword/i.test(body.gear.sword || '') && /Hylian Shield|link_shield/i.test(body.gear.shield || ''), JSON.stringify(body.gear));
  check('a three-press sword combo lands', combo.after > combo.before && combo.hits.filter(h => h > 0).length >= 2, JSON.stringify(combo));
  check('guard enters blocking state', guard.guardHeld === true, JSON.stringify(guard));
  check('dodge opens the invulnerability window', dodge.dodgeTimer > 0 && dodge.invulnerable > 0, JSON.stringify(dodge));
  check('BOMB THROW kit ability still casts', ability.cast?.slot === 1, JSON.stringify(ability));
  check('bow raises and draws a visible nocked arrow', draw.aiming && draw.draw >= 0.9 && draw.bowVisible && draw.arrowVisible && draw.arrowLocalZ < -0.1, JSON.stringify(draw));
  check('bow hides sword and shield while aiming', draw.swordParentVisible === false && draw.shieldParentVisible === false, JSON.stringify({ sword: draw.swordParentVisible, shield: draw.shieldParentVisible }));
  check('release spawns a bow-origin projectile', release.shot?.policy === 'bow' && /Nocked Arrow/i.test(release.shot?.originObject || '') && release.projectiles.some(p => p.type === 'arrow'), JSON.stringify(release.shot));
  check('bow arrow damaged Mario', bowHit.p2 > release.p2, JSON.stringify({ before: release.p2, after: bowHit.p2, impact: bowHit.impact }));
  check('ultimate casts through the existing system', ultimate.casting === true || ultimate.meter < 100, JSON.stringify(ultimate));
  check('victory clip is selected by the state machine', /victory/i.test(victory.clip || ''), JSON.stringify(victory));
  check('no page errors', errors.length === 0, errors.join(' | '));

  report.checks = checks;
  report.errors = errors;
  await writeFile(`${out}/live-check.json`, JSON.stringify(report, null, 2));
  const failed = checks.filter(c => !c.ok);
  console.log('SUMMARY', JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(f => `${f.name}: ${f.detail}`), errors: errors.length }));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
