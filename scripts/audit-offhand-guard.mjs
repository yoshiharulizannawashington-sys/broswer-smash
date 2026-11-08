// Phase 22.5: shield-based defensive combat, verified in a real 2P match.
//
//   mkdir -p artifacts/phase22-5
//   bash scripts/run-browser-test.sh scripts/audit-offhand-guard.mjs
//
// Read-only with respect to the repository: it boots the game, runs a match and measures.
//
//   A  guard table      one guarded and one open light hit per fighter (6 fighters)
//   B  shield stripped  removing the shield's classification restores the bare numbers exactly
//   C  parry            an armed parry still prevents all damage and earns the shield no credit
//   D  shield economy   a shield refills more slowly and drains at the standard rate
//   E  guard break      an emptied meter still breaks the guard
//   F  projectile path  a projectile hitting a guard uses the same shield rules as melee
//
// The guard key also arms the parry window (smash_input.js maps guard and parry to the same key),
// so the guarded-hit measurement holds the parry shut; case C measures the parry on purpose.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-5');
await mkdir(outDir, { recursive: true });
const FIGHTERS = ['Wonder Woman', 'Link', 'Captain Jack Sparrow', 'Kaze', 'Thor', 'Aquaman'];
const SHIELD_BEARERS = ['Wonder Woman', 'Link'];
// The bare comparisons use the four fighters the roster classifies with no defensive offhand.
const BARE = ['Captain Jack Sparrow', 'Kaze', 'Thor', 'Aquaman'];
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const report = {
  phase: '22.5', kind: 'shield-defence-verification', status: 'running',
  guard: [], stripped: [], parry: [], economy: [], guardBreak: [], projectile: [],
  failures: [], unverified: [], pageErrors: []
};
const fail = (label, detail) => report.failures.push({ check: label, detail });
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.pageErrors.push(String(error.message || error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  const boot = async () => {
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashMatch && window.__browserSmashStep && window.fighters?.length === 2,
      null, { timeout: 150_000, polling: 200 });
  };
  const startMatch = async label => {
    await page.evaluate(({ label }) => {
      window.__browserSmashSelect.setMode('2p');
      document.querySelector('#selectScreen .bs-card[data-fighter="' + CSS.escape(label) + '"]')?.click();
      const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
      cards.find(card => card.dataset.fighter !== label)?.click();
    }, { label });
    await page.click('#selectScreen [data-nav="next"]');
    await page.click('#selectScreen .bs-arena[data-arena="tournament"]');
    await page.click('#play');
    await page.evaluate(() => window.__browserSmashStep(0.1));
  };
  const liveFrames = async (count = 3) => page.evaluate(async count => {
    const start = window.__browserSmashAssets?.app?.frames || 0;
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && (window.__browserSmashAssets?.app?.frames || 0) - start < count) {
      await new Promise(done => setTimeout(done, 50));
    }
    return (window.__browserSmashAssets?.app?.frames || 0) - start;
  }, count);
  const until = (expression, timeout = 2500) => page.evaluate(async ({ expression, timeout }) => {
    const test = new Function('p1', 'p2', 'return ' + expression);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (test(window.fighters[0], window.fighters[1])) return true;
      await new Promise(done => setTimeout(done, 40));
    }
    return false;
  }, { expression, timeout });
  const read = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const model = p1.model;
    return {
      identity: p1.identity,
      kind: model?.userData?.weaponKind ?? null,
      offhand: model?.userData?.offhandKind ?? null,
      hasShieldMesh: !!model?.userData?.equippedWeaponLeft,
      // Which clip the animator actually chose this frame (human_fighter records it for probes).
      pose: p1.model?.userData?.currentClip ?? p1.animationController?._active ?? null,
      leftArm: p1.model?.userData?.leftArm?.rotation
        ? [+p1.model.userData.leftArm.rotation.x.toFixed(2),
          +p1.model.userData.leftArm.rotation.y.toFixed(2),
          +p1.model.userData.leftArm.rotation.z.toFixed(2)] : null,
      // The live guard meter style, so the shield-specific HUD treatment is measured, not assumed.
      guardBar: document.getElementById('p1shield')?.style.background || null,
      shield: +(p1.shield ?? 100).toFixed(1),
      t: +(p1.t || 0).toFixed(3),
      percent: +p1.percent.toFixed(2),
      hitstun: +(p1.hitstun || 0).toFixed(3),
      guardStun: +(p1.guardStun || 0).toFixed(3),
      guardBreak: +(p1.guardBreak || 0).toFixed(3),
      parryTimer: +(p1.parryTimer || 0).toFixed(3),
      attackerHitstun: +(p2.hitstun || 0).toFixed(3),
      guardHeld: !!p1.guardHeld,
      inMenu: document.body.classList.contains('in-menu')
    };
  });
  const selectFighter = async label => {
    await page.evaluate(async ({ label, slug }) => {
      const select = document.querySelector('#p1Character');
      select.value = label;
      select.dispatchEvent(new Event('change'));
      const fighter = window.fighters[0];
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const model = fighter.model;
        const asset = String(model?.userData?.characterAssetUrl || '');
        const landed = asset.includes('/roster/' + slug + '.glb') || asset.endsWith('/' + slug + '/' + slug + '.glb');
        if (fighter.identity === label && landed
          && (model.userData.equippedWeaponRight || model.userData.weaponKind)) break;
        await new Promise(done => setTimeout(done, 40));
      }
    }, { label, slug: slugOf(label) });
  };
  // Both fighters reset: the hit each measurement lands also damages the opponent, and an ended
  // match stops applying input. This is test setup, not gameplay.
  const reset = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    for (const fighter of [p1, p2]) {
      fighter.percent = 0; fighter.velocity.set(0, 0, 0);
      fighter.hitstun = 0; fighter.invulnerable = 0; fighter.guardBreak = 0; fighter.guardStun = 0;
      fighter.guardRegenDelay = 0; fighter.dodgeTimer = 0; fighter.attackQueue.length = 0;
      fighter.comboWindow = 0; fighter.specialCooldown = 0; fighter.attackBuffer = 0;
      fighter.parryTimer = 0; fighter.parryCooldown = 0; fighter.counterWindow = 0;
    }
    p1.shield = 100;
    p1.position.set(0, p1.groundLevel, 0); p1.facing = 1; p1.facingZ = 0;
    p2.position.set(1.02, p2.groundLevel, 0); p2.facing = -1; p2.facingZ = 0;
    return { inMenu: document.body.classList.contains('in-menu'),
      status: window.__browserSmashMatch().status };
  });
  const waitIdle = () => until('!(p1.attackPose > 0) && !(p1.attackQueue && p1.attackQueue.length)'
    + ' && !(p1.hitstun > 0) && !(p1.dodgeTimer > 0)', 4000);
  const readyOpponent = () => until('!(p2.attackQueue && p2.attackQueue.length)'
    + ' && !(p2.hitstun > 0) && !(p2.attackPose > 0)', 4000);
  // One hit from the opponent, resolved by the live loop. A keyboard press raced the frame that
  // samples input and was refused intermittently, so the opponent is driven through the same
  // `attackBuffer` field that press writes: the attack is still queued, hitboxed and resolved by
  // the real simulation, it just always happens.
  const takeHit = async () => {
    await readyOpponent();
    // Measure the guard, not the parry: a parry window eats the hit entirely (no damage, no
    // hitstun, shield only drained by holding), so it is held shut for this measurement.
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      p1.parryTimer = 0; p1.parryCooldown = 1.5;
      window.fighters[1].attackBuffer = .62;
    });
    const queued = await until('p2.attackQueue && p2.attackQueue.length > 0', 1500);
    const connected = await until('p1.percent > 0 || p1.hitstun > 0', 2000);
    await liveFrames(4);
    return { queued, landed: queued && connected };
  };
  /** Guard one hit and report what it cost and what it took. */
  const guardOneHit = async () => {
    await waitIdle();
    await page.keyboard.down('e');
    const engaged = await until('p1.guardHeld === true');
    await liveFrames(2);
    const before = await read();
    const hit = await takeHit();
    const after = await read();
    await page.keyboard.up('e');
    await waitIdle();
    return {
      guardEngaged: engaged, queued: hit.queued, landed: hit.landed,
      shieldBefore: before.shield, shieldAfter: after.shield,
      shieldSpent: +(before.shield - after.shield).toFixed(1),
      percent: +(after.percent - before.percent).toFixed(2),
      hitstun: after.hitstun, guardStun: after.guardStun, guardBreak: after.guardBreak,
      parryTimer: after.parryTimer, attackerHitstun: after.attackerHitstun,
      pose: after.pose, leftArm: after.leftArm, offhand: after.offhand, guardBar: after.guardBar
    };
  };
  const takeOpenHit = async () => {
    await waitIdle();
    const before = await read();
    const hit = await takeHit();
    const after = await read();
    return {
      queued: hit.queued, landed: hit.landed,
      percent: +(after.percent - before.percent).toFixed(2), hitstun: after.hitstun
    };
  };
  const ensureLive = async label => {
    const state = await reset();
    if (state.inMenu) { await boot(); await startMatch(label); await liveFrames(3); await reset(); }
  };

  await boot();
  await startMatch('Wonder Woman');
  await liveFrames(5);

  // ---------------------------------------------------------------- A: guard table
  for (const label of FIGHTERS) {
    await selectFighter(label);
    await liveFrames(3);
    const mounted = await read();
    if (mounted.identity !== label) {
      report.unverified.push({ fighter: label, note: `mounted ${mounted.identity}` });
      console.log(`${label.padEnd(22)} SKIPPED: not selectable`);
      continue;
    }
    await ensureLive(label);
    const guarded = await guardOneHit();
    await ensureLive(label);
    const open = await takeOpenHit();
    const row = {
      fighter: label, identity: mounted.identity, kind: mounted.kind, offhand: mounted.offhand,
      isShield: mounted.offhand === 'shield',
      guardEngaged: guarded.guardEngaged, guardedLanded: guarded.landed, openLanded: open.landed,
      guardedPercent: guarded.percent, openPercent: open.percent,
      reduction: open.percent > 0 && guarded.landed ? +(guarded.percent / open.percent).toFixed(3) : null,
      shieldBefore: guarded.shieldBefore, shieldAfter: guarded.shieldAfter,
      shieldSpent: guarded.shieldSpent, hitstun: guarded.hitstun, guardStun: guarded.guardStun,
      guardBreak: guarded.guardBreak, parryTimer: guarded.parryTimer,
      blockPose: guarded.pose, leftArm: guarded.leftArm, guardBar: guarded.guardBar
    };
    report.guard.push(row);
    if (!guarded.landed || !open.landed) report.unverified.push({ fighter: label, note: 'a measurement hit did not land' });
    console.log(`${label.padEnd(22)} offhand ${String(row.offhand).padEnd(7)}`
      + ` guard ${String(row.guardEngaged).padEnd(5)} shield ${row.shieldBefore}→${row.shieldAfter} (-${row.shieldSpent})`
      + ` guarded ${row.guardedPercent}% open ${row.openPercent}% reduction ${row.reduction}`
      + ` stun ${row.hitstun}/${row.guardStun} pose ${row.blockPose}`);
  }

  const guardRows = report.guard.filter(row => row.guardedLanded && row.openLanded);
  const shielded = guardRows.filter(row => row.isShield);
  const bare = guardRows.filter(row => !row.isShield);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const barePercent = +(mean(bare.map(row => row.guardedPercent))).toFixed(2);
  const bareSpent = +(mean(bare.map(row => row.shieldSpent))).toFixed(1);
  report.baseline = { guardedPercent: barePercent, shieldSpent: bareSpent, fighters: bare.map(row => row.fighter) };

  // Every guarding fighter must still be on the block clip: the shield adds to the pose, it does
  // not replace the defensive animation.
  for (const row of guardRows) {
    if (row.blockPose !== 'block') fail(`${row.fighter} guard pose`, `clip ${row.blockPose}, expected block`);
  }

  // The guard meter must read differently for a shield bearer (updateShieldBars tints it) while a
  // fighter with nothing in the offhand keeps the standard bar.
  const shieldBars = new Set(shielded.map(row => row.guardBar));
  const bareBars = new Set(bare.map(row => row.guardBar));
  report.guardBars = { shield: [...shieldBars], bare: [...bareBars] };
  if (!shieldBars.size || [...shieldBars].some(bar => !bar)) {
    fail('shield guard meter', 'no guard bar style was recorded');
  } else if ([...shieldBars].some(bar => bareBars.has(bar))) {
    fail('shield guard meter', 'shield bearers share the bare guard meter style');
  }

  // Every shield bearer must block strictly better than every bare-handed fighter.
  for (const row of shielded) {
    if (Math.abs(row.reduction - 0.18) > 0.01) {
      fail(`${row.fighter} shield block`, `reduction ${row.reduction}, expected ~0.18`);
    }
    if (!(row.guardedPercent < barePercent - 0.5)) {
      fail(`${row.fighter} shield advantage`, `${row.guardedPercent}% is not clearly below the bare ${barePercent}%`);
    }
    if (!(row.shieldSpent > bareSpent)) {
      fail(`${row.fighter} shield cost`, `spent ${row.shieldSpent}, expected more than the bare ${bareSpent}`);
    }
  }
  // A fighter without a shield must be unchanged: exactly the bare guard.
  for (const row of bare) {
    if (Math.abs(row.reduction - 0.28) > 0.01) fail(`${row.fighter} bare guard`, `reduction ${row.reduction}, expected 0.28`);
    if (Math.abs(row.guardedPercent - barePercent) > 0.6) {
      fail(`${row.fighter} bare consistency`, `${row.guardedPercent}% differs from the group's ${barePercent}%`);
    }
  }

  // ------------------------------------------------------- B: strip the shield
  for (const label of SHIELD_BEARERS) {
    await selectFighter(label);
    await liveFrames(3);
    await ensureLive(label);
    const stripped = await page.evaluate(() => {
      const p1 = window.fighters[0];
      const model = p1.model;
      const mesh = model?.userData?.equippedWeaponLeft;
      const before = { offhand: model?.userData?.offhandKind ?? null, visible: mesh ? mesh.visible : null };
      // Removing the shield's classification is exactly what "no shield" means to the combat
      // rules; hiding the mesh keeps the visible fighter honest about what it is carrying.
      if (model?.userData) { delete model.userData.offhandKind; delete model.userData.offhandLabel; }
      if (mesh) mesh.visible = false;
      return before;
    });
    await liveFrames(2);
    const guarded = await guardOneHit();
    const armedRow = guardRows.find(candidate => candidate.fighter === label);
    // The brace is a bone offset applied only while a real shield is in the offhand, so the same
    // fighter's left arm must move less when the shield is gone.
    const braceDelta = armedRow?.leftArm && guarded.leftArm
      ? +Math.max(...armedRow.leftArm.map((value, index) => Math.abs(value - guarded.leftArm[index]))).toFixed(2)
      : null;
    const row = {
      fighter: label, removed: stripped,
      guardedPercent: guarded.percent, shieldSpent: guarded.shieldSpent,
      leftArm: guarded.leftArm, braceDelta,
      reduction: guarded.percent > 0 ? +(guarded.percent / (bare.length ? guardRows.find(r => r.fighter === label).openPercent : 1)).toFixed(3) : null,
      restoredPercent: barePercent, restoredSpent: bareSpent, landed: guarded.landed
    };
    report.stripped.push(row);
    if (!guarded.landed) fail(`${label} stripped measurement`, 'the hit did not land');
    if (Math.abs(row.guardedPercent - barePercent) > 0.6) {
      fail(`${label} without a shield`, `${row.guardedPercent}% does not match the bare ${barePercent}%`);
    }
    if (Math.abs(row.shieldSpent - bareSpent) > 0.6) {
      fail(`${label} without a shield: meter`, `spent ${row.shieldSpent}, expected ${bareSpent}`);
    }
    if (braceDelta !== null && braceDelta < 0.05) {
      fail(`${label} shield brace`, `left arm is identical with and without the shield (delta ${braceDelta})`);
    }
    console.log(`${label.padEnd(22)} shield removed → guarded ${row.guardedPercent}% (-${row.shieldSpent})`
      + ` vs bare ${barePercent}% (-${bareSpent}) brace delta ${braceDelta}`);
    // Re-selecting remounts the model with its own offhand classification intact.
    await selectFighter(label);
    await liveFrames(2);
  }

  // ------------------------------------------------------------- C: the parry
  // An armed parry must still prevent every point of damage, and must not be credited to the
  // shield: shield bearer and bare fighter must behave identically.
  for (const label of ['Wonder Woman', 'Thor']) {
    await selectFighter(label);
    await liveFrames(3);
    await ensureLive(label);
    await waitIdle();
    await readyOpponent();
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      // The same 0.22 s window the input layer arms when guard is pressed (smash_input.js).
      p1.parryTimer = 0.22; p1.parryCooldown = 0;
      p2.attackBuffer = .62;
    });
    const queued = await until('p2.attackQueue && p2.attackQueue.length > 0', 1500);
    await until('p1.parryTimer === 0 || p2.hitstun > 0', 2000);
    await liveFrames(4);
    const after = await read();
    const row = {
      fighter: label, offhand: after.offhand, queued,
      parried: after.percent === 0 && after.attackerHitstun > 0,
      damageTaken: after.percent, attackerHitstun: after.attackerHitstun,
      shieldSpent: +(100 - after.shield).toFixed(1)
    };
    report.parry.push(row);
    if (!row.parried) fail(`${label} parry`, `damage ${row.damageTaken}% / attacker hitstun ${row.attackerHitstun}`);
    console.log(`${label.padEnd(22)} parry damage ${row.damageTaken}% attacker stun ${row.attackerHitstun}`);
  }

  // ------------------------------------------------------ D: shield economy
  // Regen is measured over the same rendered frames for both, so only the rate itself differs.
  for (const label of ['Wonder Woman', 'Thor']) {
    await selectFighter(label);
    await liveFrames(3);
    await ensureLive(label);
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      p1.shield = 40; p1.guardRegenDelay = 0; p1.guardBreak = 0;
    });
    const before = await read();
    const frames = await liveFrames(70);
    const after = await read();
    // Regen is linear in simulated time, but a software-rendered browser does not advance the same
    // simulated span on two runs. Measure the rate, not the raw gain, so this compares the rule
    // rather than the frame rate.
    const simSeconds = Math.max(0.01, after.t - before.t);
    const row = {
      fighter: label, offhand: after.offhand, frames, simSeconds: +simSeconds.toFixed(3),
      regained: +(after.shield - before.shield).toFixed(2),
      perSecond: +((after.shield - before.shield) / simSeconds).toFixed(2)
    };
    report.economy.push(row);
    console.log(`${label.padEnd(22)} regen ${row.regained} over ${row.simSeconds}s simulated`
      + ` (${row.perSecond}/s, offhand ${row.offhand})`);
  }
  const shieldRegen = report.economy.find(row => row.offhand === 'shield');
  const bareRegen = report.economy.find(row => row.offhand !== 'shield');
  if (!shieldRegen || !bareRegen) fail('shield economy', 'missing a regen measurement');
  else {
    const ratio = +(shieldRegen.perSecond / Math.max(0.01, bareRegen.perSecond)).toFixed(3);
    report.regenRatio = ratio;
    if (Math.abs(ratio - 0.82) > 0.05) fail('shield regen', `rate ratio ${ratio}, expected ~0.82`);
  }

  // --------------------------------------------------------- E: guard break
  for (const label of ['Wonder Woman', 'Thor']) {
    await selectFighter(label);
    await liveFrames(3);
    await ensureLive(label);
    await page.evaluate(() => { window.fighters[0].shield = 40; });
    await waitIdle();
    await page.keyboard.down('e');
    await until('p1.guardHeld === true');
    let broke = false;
    const hits = [];
    for (let i = 0; i < 4 && !broke; i++) {
      const hit = await takeHit();
      const state = await read();
      hits.push({ landed: hit.landed, shield: state.shield, guardBreak: state.guardBreak });
      broke = state.guardBreak > 0;
    }
    await page.keyboard.up('e');
    const row = { fighter: label, offhand: (await read()).offhand, broke, hits };
    report.guardBreak.push(row);
    if (!broke) fail(`${label} guard break`, 'the meter emptied but the guard never broke');
    console.log(`${label.padEnd(22)} guard break ${broke} after ${hits.length} blocked hit(s)`);
  }

  // ------------------------------------------------------- F: projectile path
  for (const label of ['Wonder Woman', 'Thor']) {
    await selectFighter(label);
    await liveFrames(3);
    await ensureLive(label);
    await page.evaluate(() => {
      const [, p2] = window.fighters;
      p2.position.set(3.4, p2.groundLevel, 0);
      p2.facing = -1; p2.facingZ = 0;
    });
    await waitIdle();
    await page.keyboard.down('e');
    const engaged = await until('p1.guardHeld === true');
    // Hold the parry window shut, or the shot is reflected instead of blocked (the guard key
    // arms a parry, smash_input.js) and this measures the wrong branch.
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      p1.parryTimer = 0; p1.parryCooldown = 1.5;
    });
    await page.evaluate(() => {
      const [, p2] = window.fighters;
      // The same entry point a signature move uses; the projectile itself is resolved by the
      // live loop's swept-sphere check, not by this call.
      window.spawnProjectile(p2, {
        source: 'special', type: 'orb', label: 'AUDIT BEAM', damage: 20, speed: 26,
        stun: 0.42, knockback: 5, color: 0x66ddff
      });
    });
    const hit = await until('p1.percent > 0', 4000);
    await liveFrames(3);
    const after = await read();
    await page.keyboard.up('e');
    const row = {
      fighter: label, offhand: after.offhand, guardEngaged: engaged, hit,
      damage: after.percent, shieldSpent: +(100 - after.shield).toFixed(1)
    };
    report.projectile.push(row);
    if (!hit) fail(`${label} projectile`, 'the projectile never connected');
    console.log(`${label.padEnd(22)} projectile block ${row.damage}% (offhand ${row.offhand})`);
  }
  const shieldShot = report.projectile.find(row => row.offhand === 'shield');
  const bareShot = report.projectile.find(row => row.offhand !== 'shield');
  if (shieldShot && bareShot && shieldShot.hit && bareShot.hit) {
    const ratio = +(shieldShot.damage / Math.max(0.01, bareShot.damage)).toFixed(3);
    report.projectileRatio = ratio;
    // 0.18/0.28 = 0.643: the shield improves the projectile path by the same proportion.
    if (Math.abs(ratio - 0.643) > 0.06) fail('projectile shield rule', `ratio ${ratio}, expected ~0.643`);
  }

  // ------------------------------------------------------------------ summary
  report.measured = guardRows.length;
  report.shieldBearers = shielded.map(row => row.fighter);
  report.offhandFree = bare.map(row => row.fighter);
  if (report.pageErrors.length) fail('page errors', `${report.pageErrors.length} uncaught error(s)`);
  // The shield-specific guard pose must actually be selected for a shield bearer.
  const poses = report.guard.filter(row => row.isShield).map(row => row.blockPose);
  report.blockPoses = poses;
  // Both shield users animate from their own baked clips, so the shield brace is an additive bone
  // offset on top of the block clip - asserted by the brace delta in the stripped-shield case -
  // rather than a second authored clip. The defensive clip itself must stay the block clip.
  if (poses.some(pose => pose !== 'block')) {
    report.unverified.push({ note: 'a shield bearer was not on the block clip while guarding', poses });
  }
  report.status = report.failures.length === 0 && report.measured === FIGHTERS.length
    && report.stripped.length === SHIELD_BEARERS.length ? 'complete' : 'failed';
  report.verdict = report.status === 'complete'
    ? 'shield bearers block ordinary hits to ~18% and loose the shield restores the 28% guard'
    : 'shield defence did not meet its acceptance criteria';
  console.log(JSON.stringify({ ...report, guard: undefined, stripped: undefined }, null, 2));
  await writeFile(resolve(outDir, 'offhand-guard-audit.json'), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
process.exit(report.status === 'complete' ? 0 : 1);
