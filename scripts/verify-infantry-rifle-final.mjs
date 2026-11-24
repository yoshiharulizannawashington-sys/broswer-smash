// Second live pass: rifle silhouette from several angles, strike tests with the opponent actually
// in range, and a match Infanry is allowed to win so the victory state can be observed.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-rifle-final.mjs
//
// The strike tests place the opponent at melee distance and hold its inputs neutral (the same
// technique the repo's capture script uses) so the prop, the strike clip and the damage are the only
// things being judged. The round-end phase gives the inputs back, sets the CPU to its easy preset
// through the game's own option, and never writes percent/ko/victoryPose/winner.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-rifle-final';
await mkdir(out, { recursive: true });
const log = async line => { console.log(line); await appendFile(`${out}/run.log`, line + '\n').catch(() => {}); };
await writeFile(`${out}/run.log`, '');

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wasm': 'application/wasm', '.bin': 'application/octet-stream'
};
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    const body = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => { errors.push(String(e.message || e).slice(0, 240)); console.log('PAGEERROR', String(e.message || e).slice(0, 200)); });
page.on('crash', () => console.log('PAGE_CRASHED'));
page.on('requestfailed', r => console.log('REQUEST_FAILED', r.url().slice(0, 120), r.failure()?.errorText));

const checks = [];
const check = (name, ok, detail = '') => {
  const entry = { name, ok: Boolean(ok), detail: String(detail).slice(0, 800) };
  checks.push(entry);
  log(`CHECK ${entry.ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + entry.detail : ''}`);
};
const shot = async file => { try { await page.screenshot({ path: `${out}/${file}.png` }); return true; } catch (error) { await log('SHOT_FAIL ' + file + ' ' + error.message); return false; } };
const step = n => page.evaluate(f => window.__browserSmashStep(f / 60), n);
const report = { checks, errors };

try {
  const bootStart = Date.now();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 45000, polling: 250 }).catch(async error => {
    const diag = await page.evaluate(() => ({
      url: location.href, ready: document.readyState, title: document.title,
      html: document.documentElement?.outerHTML?.slice(0, 260) || null,
      fatal: document.querySelector('#fatalError')?.textContent || null,
      loading: document.querySelector('#loading')?.textContent || null,
      app: window.__browserSmashAssets?.app || null
    })).catch(e => ({ evaluateFailed: String(e.message).slice(0, 160) }));
    await log('BOOT_DIAG ' + JSON.stringify(diag));
    throw error;
  });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
  });
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => /infantry_cc0\.glb/.test(window.fighters?.[0]?.model?.userData?.characterAssetUrl || '')
    && window.fighters?.[0]?.model?.userData?.equippedWeaponRight, null, { timeout: 120000, polling: 250 }).catch(() => {});
  report.bootMs = Date.now() - bootStart;
  await page.evaluate(() => document.activeElement?.blur?.());

  // ---- silhouette from four angles ------------------------------------------------------
  const freeze = async on => page.evaluate(on => {
    const p2 = window.fighters[1];
    if (on && !p2.__probeSim) {
      const idle = {
        left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false,
        attack: false, special: false, special2: false, special3: false, grab: false, dodge: false,
        shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false,
        webSwing: false, vertical: 0
      };
      p2.__probeSim = p2.simulate.bind(p2);
      p2.simulate = dt => p2.__probeSim(dt, { getInputs: () => ({ ...idle }) });
    }
    if (!on && p2.__probeSim) { p2.simulate = p2.__probeSim; p2.__probeSim = null; }
  }, on);

  const place = async (d = 1.2) => page.evaluate(d => {
    const [p1, p2] = window.fighters;
    p1.position.set(0, 0, 0); p2.position.set(d, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.attackQueue.length = 0; p1.hitboxes.length = 0; p1.attackPose = 0; p1.comboStep = 0; p1.comboWindow = 0;
    p1.hitstun = 0; p1.isGrounded = true; p1.ko = false; p1.position.y = 0;
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.shield = 100;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0; p2.ko = false; p2.position.y = 0;
  }, d);

  await freeze(true);
  await place(1.2);
  await step(10);
  for (const yaw of [180, 90, 270, 0]) {
    await page.evaluate(yaw => window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw, pitch: 6 }), yaw);
    await page.waitForTimeout(700);
    await shot(`01-rifle-yaw-${yaw}`);
  }
  // A closer look at the prop itself.
  const propScreen = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const w = window.fighters[0].model.userData.equippedWeaponRight;
    const box = new THREE.Box3().setFromObject(w);
    const centre = box.getCenter(new THREE.Vector3());
    window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'close', yaw: 90, pitch: 10 });
    return { centre: centre.toArray().map(v => +v.toFixed(2)) };
  });
  await page.waitForTimeout(800);
  await shot('02-rifle-close');
  await log('PROP_CENTRE ' + JSON.stringify(propScreen));

  // ---- strikes with the opponent in range ------------------------------------------------
  const strikeOnce = async (key, holdShift = false) => {
    const before = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    if (holdShift) await page.keyboard.down('Shift');
    await page.keyboard.down(key); await step(2); await page.keyboard.up(key);
    if (holdShift) await page.keyboard.up('Shift');
    let seen = null;
    for (let i = 0; i < 45; i += 1) {
      seen = await page.evaluate(() => {
        const f = window.fighters[0];
        return {
          strike: f.model?.userData?.lastAuthoredStrike || null,
          move: f.activeMoveId || null,
          percent: +window.fighters[1].percent.toFixed(2),
          weaponKind: f.model?.userData?.weaponKind,
          weaponParentBone: f.model?.userData?.equippedWeaponRight?.parent?.userData?.attachBone || null
        };
      });
      if (seen.strike && seen.percent > before) break;
      await step(1);
    }
    await step(4);
    const after = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    return { key, clip: seen?.strike?.clip || seen?.move || null, before, after, delta: +(after - before).toFixed(2), weaponKind: seen?.weaponKind, parentBone: seen?.weaponParentBone };
  };

  // Each strike is judged by the clip the game actually played and by the damage it removed from
  // the opponent, read from the live percent, not from a label.
  const observed = [];
  const press = async heavy => {
    if (heavy) await page.keyboard.down('Shift');
    await page.keyboard.down('j'); await step(2); await page.keyboard.up('j');
    if (heavy) await page.keyboard.up('Shift');
  };
  const record = async label => {
    const before = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    const at0 = await page.evaluate(() => window.fighters[0].model?.userData?.lastAuthoredStrike?.at || 0);
    let seen = null;
    for (let i = 0; i < 120; i += 1) {
      seen = await page.evaluate(() => {
        const f = window.fighters[0];
        const strike = f.model?.userData?.lastAuthoredStrike || null;
        return { at: strike?.at || 0, clip: strike?.clip || null, percent: +window.fighters[1].percent.toFixed(2), kind: f.model?.userData?.weaponKind, bone: f.model?.userData?.equippedWeaponRight?.parent?.userData?.attachBone || null };
      });
      if (seen.percent > before) break;
      await step(1);
    }
    await step(4);
    const after = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    const entry = { label, clip: seen?.clip || null, delta: +(after - before).toFixed(2), after, kind: seen?.kind || null, bone: seen?.bone || null };
    observed.push(entry);
    return entry;
  };

  await place(1.15); await step(6);
  await press(false); await record('light1'); await shot('03-rifle-butt');
  await press(false); await record('light2'); await shot('04-combat-cross');
  await press(false); await record('light3'); await shot('05-boot-kick');

  await place(1.15); await step(8);
  await press(true); await record('heavy1');
  await press(true); await record('heavy2');
  if (!/StockSlam/.test(observed.at(-1)?.clip || '')) {
    await place(1.15); await step(8);
    await press(true); await record('heavy1-retry');
    await press(true); await record('heavy2-retry');
  }
  await shot('06-stock-slam');
  await log('HITS ' + JSON.stringify(observed));

  const findClip = re => observed.find(h => re.test(h.clip || '') && h.delta > 0) || null;
  const rifleButt = findClip(/RifleButt/);
  const crossHit = findClip(/CombatCross/);
  const kickHit = findClip(/BootKick/);
  const armourHit = findClip(/ArmourBreaker/);
  const slamHit = findClip(/StockSlam/);
  check('Rifle Butt lands with the rifle equipped', Boolean(rifleButt) && rifleButt.kind === 'rifle', JSON.stringify(rifleButt));
  check('Combat Cross lands', Boolean(crossHit), JSON.stringify(crossHit));
  check('Boot Kick lands', Boolean(kickHit), JSON.stringify(kickHit));
  check('Armour Breaker lands', Boolean(armourHit), JSON.stringify(armourHit));
  check('Stock Slam is the second heavy and lands with the rifle stock', Boolean(slamHit), JSON.stringify(slamHit));
  check('the rifle is still in the hand at every strike contact', observed.every(h => h.kind === 'rifle' && /hand|wrist|palm/i.test(h.bone || '')), JSON.stringify(observed.map(h => ({ clip: h.clip, bone: h.bone }))));

  // ---- a match Infantry can win ----------------------------------------------------------
  await freeze(false);
  await page.evaluate(() => {
    window.__browserSmashSetCpuSkill?.('easy');
    window.__browserSmashSpawnFighters?.();
    window.fighters[0].percent = 0;
    window.fighters[1].percent = 0;
  });
  await page.evaluate(() => window.smashCamera.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 180, pitch: 6 }));
  await step(6);

  const held = new Set();
  const hold = async key => { if (!held.has(key)) { await page.keyboard.down(key); held.add(key); } };
  const release = async key => { if (held.has(key)) { await page.keyboard.up(key); held.delete(key); } };
  const readMatch = () => page.evaluate(() => {
    const [p, c] = window.fighters;
    const state = window.__browserSmashRound.state;
    return {
      px: +p.position.x.toFixed(2), pz: +p.position.z.toFixed(2),
      cx: +c.position.x.toFixed(2), cz: +c.position.z.toFixed(2),
      pct: +c.percent.toFixed(1), ppct: +p.percent.toFixed(1),
      round: state.round, wins: JSON.stringify(state.wins), winner: state.winner,
      result: document.querySelector('#result')?.textContent || ''
    };
  });

  let last = await readMatch();
  const fightStart = Date.now();
  let firstKo = null;
  let finalMoment = false;
  for (let i = 0; i < 2400; i += 1) {
    if (last.result) break;
    if (Date.now() - fightStart > 120000) break;
    const dx = last.cx - last.px, dz = last.cz - last.pz;
    const dist = Math.hypot(dx, dz);
    if (dist > 1.9) {
      await hold(dx > 0 ? 'd' : 'a'); await hold(dz > 0 ? 's' : 'w');
    } else {
      await release('a'); await release('d'); await release('w'); await release('s');
    }
    if (dist > 3.4) await page.keyboard.press('k');
    else if (i % 9 === 4) await page.keyboard.press('o');
    else if (i % 4 === 1) { await page.keyboard.down('Shift'); await page.keyboard.press('j'); await page.keyboard.up('Shift'); }
    else await page.keyboard.press('j');
    await step(5);
    const now = await readMatch();
    if (!finalMoment && now.pct >= 90) { finalMoment = true; await shot('07-final-combat-moment'); await log('FINAL_MOMENT ' + JSON.stringify(now)); }
    if (!firstKo && now.wins !== last.wins) { firstKo = { at: i, state: now }; await shot('08-ko-round-end'); await log('ROUND_END ' + JSON.stringify(firstKo)); }
    last = now;
  }
  for (const key of [...held]) await release(key);
  await log('MATCH_END ' + JSON.stringify({ last, elapsedMs: Date.now() - fightStart }));

  await page.waitForTimeout(900);
  const endState = await page.evaluate(() => {
    const state = window.__browserSmashRound.state;
    const [p, c] = window.fighters;
    const active = f => (f.model?.userData?.humanMixer?._actions || [])
      .filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
      .map(a => ({ clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2) }));
    return {
      winner: state.winner, wins: state.wins, resultText: document.querySelector('#result')?.innerText || '',
      p1: { ko: p.ko, victoryPose: p.victoryPose, active: active(p), percent: +p.percent.toFixed(1) },
      p2: { ko: c.ko, victoryPose: c.victoryPose, active: active(c), percent: +c.percent.toFixed(1) },
      hud: { round: document.querySelector('#roundScore')?.textContent || null, timer: document.querySelector('#timer')?.textContent || null }
    };
  });
  await shot('09-victory-defeat');
  await log('END_STATE ' + JSON.stringify(endState));
  report.endState = endState;
  report.firstRoundEnd = firstKo;

  check('a genuine KO ended a round', Boolean(firstKo), JSON.stringify(firstKo?.state || null));
  check('the game selected a winner without forced state', endState.winner === 'p1' || endState.winner === 'p2', endState.winner);
  const wonAsP1 = endState.winner === 'p1';
  const winner = wonAsP1 ? endState.p1 : endState.p2;
  const loser = wonAsP1 ? endState.p2 : endState.p1;
  const winnerClips = winner.active.map(a => a.clip).join('+');
  const loserClips = loser.active.map(a => a.clip).join('+');
  check('the winner plays its victory animation', /victory|win/i.test(winnerClips), winnerClips);
  check('the loser plays its defeat animation', /defeat|ko|down/i.test(loserClips), loserClips);
  check('Infantry won and plays its own victory clip', wonAsP1 && /Infantry_victory/i.test(winnerClips), JSON.stringify({ wonAsP1, winnerClips, loserClips }));
  check('the result banner is presented', Boolean(endState.resultText.trim()), endState.resultText.replace(/\s+/g, ' ').slice(0, 200));
  check('HUD round and timer are still live', Boolean(endState.hud.round && endState.hud.timer), JSON.stringify(endState.hud));

  // ---- restart ---------------------------------------------------------------------------
  const beforeReturn = await page.evaluate(() => ({
    p1Text: document.querySelector('#result')?.innerText || '',
    menuHidden: document.querySelector('#menu')?.classList.contains('hidden')
  }));
  await page.evaluate(() => window.__browserSmashReturnToTitle?.());
  await page.waitForTimeout(700);
  const title = await page.evaluate(() => ({
    titleVisible: !document.querySelector('#menu')?.classList.contains('hidden'),
    titleText: document.querySelector('#bbTitle')?.innerText?.slice(0, 40) || ''
  }));
  await shot('10-return-to-title');
  await page.click('#bbTitle [data-nav="versus"]').catch(() => {});
  await page.waitForTimeout(700);
  const selectBack = await page.evaluate(() => Boolean(document.querySelector('#selectScreen [data-fighter="Infantry"]')));
  await shot('11-character-select-again');
  await log('RESTART ' + JSON.stringify({ beforeReturn, title, selectBack }));
  check('returning to the title restores the menu', title.titleVisible, JSON.stringify(title));
  check('character selection still works after a match', selectBack, String(selectBack));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  report.fatal = String(error?.stack || error).slice(0, 1000);
  await log('FATAL ' + report.fatal);
} finally {
  const failed = checks.filter(c => !c.ok);
  report.summary = { passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) };
  await log('SUMMARY ' + JSON.stringify(report.summary));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  await browser.close().catch(() => {});
  server.close();
  process.exitCode = failed.length || report.fatal ? 1 : 0;
}
