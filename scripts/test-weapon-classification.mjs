// Phase 22.4 gameplay validation: a fighter keeps its weapon classification while fighting.
//
//   bash scripts/run-browser-test.sh scripts/test-weapon-classification.mjs
//
// The classification is metadata, so under-verifying it is easy: a build can pass while every
// sword fighter is silently read as unarmed by the attack code. This drives a real 2P match and
// reads `model.userData.weaponKind` / `offhandKind` for each phase of a fight - idle, light attack,
// guard, signature move, taking a hit, switching characters - plus the blade pickup override and
// its expiry, which is the code path that used to erase the classification.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/phase22-4');
await mkdir(outDir, { recursive: true });
// Owned weapons: the three selectable fighters whose prefab declares 'sword', plus Kaze, who has no
// prefab and gets the procedural weapon whose default kind is 'sword'. Thor and Aquaman are
// controls: they were never affected, so they prove the fix did not change unrelated fighters.
// Geralt of Rivia also declares sword in the prefab library but is not in the launch roster, so he
// cannot be driven in a match; each case below also verifies that the requested fighter is the one
// actually mounted instead of assuming the select took.
const CASES = ['Wonder Woman', 'Link', 'Captain Jack Sparrow', 'Kaze', 'Thor', 'Aquaman'];

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

const report = { phase: '22.4', kind: 'classification-gameplay', cases: [], unverified: [], failures: [], pageErrors: [], status: 'complete' };
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  // Wait for real loop frames: the bug being guarded is frame-driven, so a state read in the same
  // tick as the weapon mount cannot see it.
  const liveFrames = async (count = 3) => page.evaluate(async count => {
    const start = window.__browserSmashAssets?.app?.frames || 0;
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (window.__browserSmashAssets?.app?.frames || 0) - start < count) {
      await new Promise(done => setTimeout(done, 50));
    }
    return (window.__browserSmashAssets?.app?.frames || 0) - start;
  }, count);
  // Poll a state instead of sleeping a fixed time: fighters have different attack recoveries, and
  // a guard pressed during recovery is refused by the game - which is not a classification defect.
  const until = (expression, timeout = 2500) => page.evaluate(async ({ expression, timeout }) => {
    const test = new Function('p1', 'return ' + expression);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (test(window.fighters[0])) return true;
      await new Promise(done => setTimeout(done, 50));
    }
    return false;
  }, { expression, timeout });
  const waitIdle = () => until('!(p1.attackPose > 0) && !(p1.attackQueue && p1.attackQueue.length)'
    + ' && !(p1.hitstun > 0) && !(p1.dodgeTimer > 0)', 4000);
  const read = () => page.evaluate(() => {
    const fighter = window.fighters[0];
    const model = fighter.model;
    return {
      identity: fighter.identity,
      weaponKind: model.userData.weaponKind ?? null,
      weaponLabel: model.userData.weaponLabel ?? null,
      offhandKind: model.userData.offhandKind ?? null,
      offhandLabel: model.userData.offhandLabel ?? null,
      right: model.userData.equippedWeaponRight?.name ?? null,
      left: model.userData.equippedWeaponLeft?.name ?? null,
      guard: !!fighter.guardHeld,
      pose: +(fighter.attackPose || 0).toFixed(3),
      special: +(fighter.specialCooldown || 0).toFixed(3),
      hitstun: +(fighter.hitstun || 0).toFixed(3),
      percent: +fighter.percent.toFixed(1),
      matchStatus: window.__browserSmashMatch().status,
      frames: window.__browserSmashAssets?.app?.frames || 0
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
  const place = (gap = 1.0) => page.evaluate(gap => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, p1.groundLevel, 0);
    p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
    p1.attackQueue.length = 0; p1.comboWindow = 0; p1.hitstun = 0; p1.invulnerable = 0;
    p2.position.set(gap, p2.groundLevel, 0);
    p2.velocity.set(0, 0, 0); p2.facing = -1; p2.facingZ = 0;
    p2.attackQueue.length = 0; p2.hitstun = 0;
  }, gap);

  // Per-case damage is test setup: six cases of hits in one match would KO the fighter and the loop
  // would stop applying guard and special input, which is not a classification defect.
  const resetFighter = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    // Both fighters: the attacks each case performs land on the opponent, so without this the
    // opponent is KO'd partway through and the match ends under the remaining cases.
    for (const fighter of [p1, p2]) {
      fighter.percent = 0;
      fighter.velocity.set(0, 0, 0);
      fighter.hitstun = 0; fighter.invulnerable = 0; fighter.guardBreak = 0; fighter.dodgeTimer = 0;
      fighter.attackQueue.length = 0; fighter.comboWindow = 0;
    }
    p1.specialCooldown = 0;
    p1.itemWeaponTimer = 0; p1.itemWeaponActive = false;
    p1.itemWeaponModel = null; p1.itemPreviousWeaponKind = null;
    return { status: window.__browserSmashMatch().status,
      inMenu: document.body.classList.contains('in-menu'), percent: p1.percent };
  });

  await boot();
  await startMatch('Wonder Woman');

  const runCase = async label => {
    const entry = { fighter: label, phases: {}, failures: [] };
    await selectFighter(label);
    await liveFrames(3);
    const mounted = await read();
    if (mounted.identity !== label) {
      // Never record a case for a body that was not the requested fighter.
      report.unverified.push({ fighter: label, note: `select did not mount this fighter (mounted ${mounted.identity})` });
      console.log(`${label.padEnd(22)} SKIPPED: not selectable (mounted ${mounted.identity})`);
      return;
    }
    // The status of a healthy, playing match is learned from the first case rather than hard-coded;
    // any other status means the match ended and has to be re-armed before trusting input.
    const resetState = await resetFighter();
    if (report.playingStatus === undefined) report.playingStatus = resetState.status;
    else if (resetState.inMenu || resetState.status !== report.playingStatus) {
      report.restarts = (report.restarts || 0) + 1;
      await boot();
      await startMatch(label);
      await liveFrames(3);
      await resetFighter();
    }
    await place();
    await step(0.2);
    entry.phases.armed = await read();

    await waitIdle();
    await page.keyboard.press('j');
    await step(0.12);
    entry.phases.lightAttack = await read();
    entry.returnedToIdle = await waitIdle();

    await page.keyboard.down('e');
    entry.guardEngaged = await until('p1.guardHeld === true');
    await step(0.1);
    entry.phases.guard = await read();
    await page.keyboard.up('e');
    await waitIdle();

    await place();
    await waitIdle();
    await page.keyboard.press('k');
    entry.specialFired = await until('p1.specialCooldown > 0');
    entry.phases.special = await read();
    await step(0.4);

    await place(0.95);
    await waitIdle();
    await page.keyboard.press(',');
    entry.hitLanded = await until('p1.hitstun > 0 || p1.percent > 0');
    entry.phases.hitReaction = await read();
    await step(0.3);

    // Blade pickup override: the item system writes 'sword' and, on expiry, must restore what the
    // fighter actually carries. Before the fix the expiry deleted the classification instead.
    // Collection and expiry both run inside the match loop's item update, so wait on the item
    // system's own state instead of counting frames.
    const beforePickup = entry.phases.armed.weaponKind;
    await place();
    const waitForPickup = on => page.evaluate(async on => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (Boolean(window.fighters[0].itemWeaponActive) === on) return true;
        await new Promise(done => setTimeout(done, 50));
      }
      return false;
    }, on);
    await page.evaluate(() => {
      const p1 = window.fighters[0];
      window.spawnItemDrop?.('blade', p1.position.x + 0.6, p1.position.z);
    });
    entry.pickupCollected = await waitForPickup(true);
    entry.phases.afterPickup = await read();
    await page.evaluate(() => { window.fighters[0].itemWeaponTimer = 0.05; });
    entry.pickupExpired = await waitForPickup(false);
    entry.phases.afterPickupExpiry = await read();
    entry.pickup = { expectedDuringPickup: 'sword', expectedAfterExpiry: beforePickup };

    const phases = entry.phases;
    for (const [name, state] of Object.entries(phases)) {
      if (name === 'afterPickup') continue;
      if (name === 'afterPickupExpiry') {
        if (state.weaponKind !== beforePickup) {
          entry.failures.push(`after pickup expiry weaponKind is ${state.weaponKind}, expected ${beforePickup}`);
        }
        continue;
      }
      if (state.weaponKind !== beforePickup) {
        entry.failures.push(`${name}: weaponKind became ${state.weaponKind} (was ${beforePickup})`);
      }
    }
    if (phases.afterPickup.weaponKind !== 'sword') {
      entry.failures.push(`blade pickup did not set weaponKind for sword combat (got ${phases.afterPickup.weaponKind})`);
    }
    if (!phases.guard.guard) entry.failures.push('guard was not reported while E was held');
    // A fighter whose classification survived is still driving the bladed attack path, so an
    // attack must have produced a pose rather than nothing.
    if (phases.lightAttack.pose <= 0) entry.failures.push('no attack pose from J');
    if (phases.special.special <= 0) entry.failures.push('no special cooldown from K');
    report.cases.push(entry);
    if (entry.failures.length) report.failures.push({ fighter: label, failures: entry.failures });
    console.log(`${label.padEnd(22)} kind ${String(phases.armed.weaponKind).padEnd(13)} `
      + `offhand ${String(phases.armed.offhandKind).padEnd(7)} attack ${phases.lightAttack.pose} `
      + `guard ${phases.guard.guard} special ${phases.special.special} `
      + `pickup ${String(phases.afterPickup.weaponKind)}→${String(phases.afterPickupExpiry.weaponKind)}`);
  };

  for (const label of CASES) await runCase(label);

  // A body swap while a blade is held: the override belonged to the old body, and expiring it must
  // not erase the classification of the fighter who is now on screen.
  await selectFighter('Thor');
  await liveFrames(3);
  await place();
  await page.evaluate(() => {
    const p1 = window.fighters[0];
    window.spawnItemDrop?.('blade', p1.position.x + 0.6, p1.position.z);
  });
  // Wait until the blade is actually in hand, then swap bodies with the override still running.
  await page.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !window.fighters[0].itemWeaponActive) {
      await new Promise(done => setTimeout(done, 50));
    }
  });
  const heldSword = await read();
  await selectFighter('Aquaman');
  await liveFrames(3);
  const afterSwap = await read();
  await page.evaluate(() => { window.fighters[0].itemWeaponTimer = 0.01; });
  await page.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && window.fighters[0].itemWeaponActive) {
      await new Promise(done => setTimeout(done, 50));
    }
  });
  const afterStaleExpiry = await read();
  report.swapWhilePickup = { heldSword, afterSwap, afterStaleExpiry };
  if (heldSword.weaponKind !== 'sword') {
    report.failures.push({ fighter: 'Thor', failures: [`blade pickup did not apply (${heldSword.weaponKind})`] });
  }
  if (afterSwap.weaponKind !== 'trident') {
    report.failures.push({ fighter: 'Aquaman', failures: [`after a swap mid-pickup weaponKind is ${afterSwap.weaponKind}, expected trident`] });
  }
  if (afterStaleExpiry.weaponKind !== 'trident') {
    report.failures.push({ fighter: 'Aquaman', failures: [`stale pickup expiry changed weaponKind to ${afterStaleExpiry.weaponKind}`] });
  }

  // A second match in a fresh page load: the classification has to survive the whole boot and
  // select path again, not just a body swap inside a match already running.
  await boot();
  await startMatch('Kaze');
  await selectFighter('Kaze');
  await liveFrames(3);
  const secondMatch = await read();
  await page.keyboard.press('j');
  await step(0.12);
  const secondAttack = await read();
  report.secondMatch = { armed: secondMatch, attack: secondAttack };
  if (secondMatch.weaponKind !== 'sword') report.failures.push({ fighter: 'Kaze', failures: [`second match booted with weaponKind ${secondMatch.weaponKind}`] });
  if (secondAttack.weaponKind !== 'sword') report.failures.push({ fighter: 'Kaze', failures: [`second match attack had weaponKind ${secondAttack.weaponKind}`] });

  report.totals = {
    cases: report.cases.length,
    failures: report.failures.length,
    pageErrors: report.pageErrors.length,
    affectedSet: 'weaponKind "sword": Wonder Woman, Link, Captain Jack Sparrow, Geralt of Rivia, Kaze'
  };
  assert.deepEqual(report.failures, [], 'classification failures: ' + JSON.stringify(report.failures, null, 2));
  assert.deepEqual(report.pageErrors, [], 'page errors: ' + report.pageErrors.join('\n'));
} catch (error) {
  report.status = 'failed';
  report.error = String(error.message || error).split('\n').slice(0, 10).join('\n');
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
await writeFile(resolve(outDir, 'classification-gameplay.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, error: report.error || null,
  totals: report.totals, secondMatch: report.secondMatch
    ? { armed: report.secondMatch.armed.weaponKind, attack: report.secondMatch.attack.weaponKind } : null,
  failures: (report.failures || []).slice(0, 5) }, null, 2));
if (report.status === 'failed') process.exitCode = 1;
