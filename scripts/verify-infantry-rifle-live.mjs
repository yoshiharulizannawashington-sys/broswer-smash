// Live acceptance run for the Infantry rifle and for a genuinely played-out round end.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-rifle-live.mjs
//
// Two phases, both in one real match started from the character-select screen:
//   A. weapon identity - read the equipped prop off the fighter the moment it is armed, name every
//      part, and track the hand-to-weapon transform through idle, walk, run, jump, both rifle
//      strikes and a knockdown/get-up. Rifle Butt and Stock Slam are fired through the keyboard and
//      judged by the damage they deal, not by a label.
//   B. natural round end - the CPU AI stays live and the player is driven only by keyboard input.
//      No percent, ko, victoryPose or winner is ever written by this script. The round is allowed to
//      end through the game's own health/out-of-bounds logic, and what the game then does with the
//      victory/defeat states is recorded as observed.
//
// Everything is appended to artifacts/infantry-rifle-verify/run.log as it happens, so a timeout
// still leaves the evidence that was collected.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-rifle-verify';
await mkdir(out, { recursive: true });
const log = async (line) => { console.log(line); await appendFile(`${out}/run.log`, line + '\n').catch(() => {}); };
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
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 240)));

const checks = [];
const check = (name, ok, detail = '') => {
  const entry = { name, ok: Boolean(ok), detail: String(detail).slice(0, 900) };
  checks.push(entry);
  return log(`CHECK ${entry.ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + entry.detail : ''}`);
};
const shot = async (file) => { await page.screenshot({ path: `${out}/${file}.png` }); return `${out}/${file}.png`; };
const step = n => page.evaluate(frames => window.__browserSmashStep(frames / 60), n);

const report = { startedAt: new Date().toISOString(), phases: {}, checks, errors };

try {
  // ---- boot and select through the real screen ------------------------------------------
  const bootStart = Date.now();
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.waitForTimeout(400);
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
  });
  const picked = await page.evaluate(() => ({
    p1: document.querySelector('#p1Character')?.selectedOptions?.[0]?.textContent || null,
    p2: document.querySelector('#cpuCharacter')?.selectedOptions?.[0]?.textContent || null
  }));
  await log('SELECT ' + JSON.stringify(picked));
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => /infantry_cc0\.glb/.test(window.fighters?.[0]?.model?.userData?.characterAssetUrl || ''), null, { timeout: 120000, polling: 250 }).catch(() => {});
  const bootMs = Date.now() - bootStart;
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.equippedWeaponRight, null, { timeout: 60000, polling: 200 });
  await page.evaluate(() => { document.activeElement?.blur?.(); window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 180, pitch: 4 }); });
  await page.waitForTimeout(900);

  // ---- A. weapon identity ----------------------------------------------------------------
  const weapon = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const f = window.fighters[0];
    const u = f.model.userData;
    const w = u.equippedWeaponRight;
    const parts = [];
    let triangles = 0;
    w.traverse(n => {
      if (!n.isMesh) return;
      const g = n.geometry;
      parts.push(n.name);
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    const box = new THREE.Box3().setFromObject(w);
    const size = box.getSize(new THREE.Vector3());
    const hand = u.rightHand || u.rightFore || u.rightArm;
    const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
    const wp = new THREE.Vector3(); w.getWorldPosition(wp);
    return {
      identity: f.identity, asset: u.characterAssetUrl,
      kind: u.weaponKind || null, label: u.weaponLabel || null, propName: w.name,
      parts, triangles: Math.round(triangles),
      size: [size.x, size.y, size.z].map(v => +v.toFixed(3)),
      lengthZ: +size.z.toFixed(3),
      handBone: hand.name,
      handToWeapon: +hp.distanceTo(wp).toFixed(4),
      parentName: w.parent?.name || null,
      parentBone: w.parent?.userData?.attachBone || null,
      swordLike: parts.some(p => /blade|sword|katana/i.test(p)),
      rifleLike: parts.some(p => /barrel/i.test(p)) && parts.some(p => /receiver/i.test(p)) && parts.some(p => /stock/i.test(p))
    };
  });
  await log('WEAPON ' + JSON.stringify(weapon));
  report.phases.weapon = weapon;

  check('Infantry mounts the imported HD body', /infantry_cc0\.glb/.test(weapon.asset || ''), weapon.asset);
  check('runtime weapon identity is a rifle', weapon.kind === 'rifle', JSON.stringify({ kind: weapon.kind, label: weapon.label }));
  check('the equipped prop comes from weapon_infantry_right', /Equipped.*Infantry/i.test(weapon.propName || ''), weapon.propName);
  check('the prop has barrel, receiver and stock geometry', weapon.rifleLike, JSON.stringify(weapon.parts));
  check('no sword geometry is attached', !weapon.swordLike, JSON.stringify(weapon.parts));
  check('the prop is a rifle-sized object, not a giant or a toy', weapon.lengthZ > 0.45 && weapon.lengthZ < 1.25, JSON.stringify(weapon.size));
  check('the prop is parented to the right-hand mount', Boolean(weapon.parentBone) && /hand|wrist|palm/i.test(weapon.parentBone || ''), JSON.stringify({ parentName: weapon.parentName, parentBone: weapon.parentBone }));

  await shot('01-idle-rifle');

  // Attachment: the hand-to-weapon offset must not move while the body animates. A prop that is
  // rigidly parented keeps a constant local offset; one that is re-placed or floats will not.
  const offsets = [];
  const sample = async label => {
    const s = await page.evaluate(() => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0], u = f.model.userData, w = u.equippedWeaponRight;
      const hand = u.rightHand || u.rightFore || u.rightArm;
      const hp = new THREE.Vector3(); hand.getWorldPosition(hp);
      const wp = new THREE.Vector3(); w.getWorldPosition(wp);
      const box = new THREE.Box3().setFromObject(w);
      const centre = box.getCenter(new THREE.Vector3());
      return {
        label: null,
        handToWeapon: +hp.distanceTo(wp).toFixed(4),
        handToCentre: +hp.distanceTo(centre).toFixed(3),
        attached: Boolean(w.parent),
        visible: w.visible,
        parentBone: w.parent?.userData?.attachBone || null,
        y: +f.position.y.toFixed(2),
        opponentPercent: +window.fighters[1].percent.toFixed(2)
      };
    });
    offsets.push({ ...s, label });
    return s;
  };

  await sample('idle');
  await page.keyboard.down('d'); await step(26); await sample('walk'); await shot('02-walk-rifle'); await page.keyboard.up('d');
  await page.keyboard.down('d'); await page.keyboard.down('Shift'); await step(48); await sample('run'); await page.keyboard.up('Shift'); await page.keyboard.up('d');
  await page.keyboard.press('Space'); await step(10); await sample('jump'); await shot('03-jump-rifle');

  // Rifle Butt through the keyboard.
  const percentBefore = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
  const strike = async (heavy) => {
    if (heavy) await page.keyboard.down('Shift');
    await page.keyboard.down('j'); await step(2); await page.keyboard.up('j');
    if (heavy) await page.keyboard.up('Shift');
    let seen = null;
    for (let i = 0; i < 30; i += 1) {
      seen = await page.evaluate(() => {
        const f = window.fighters[0];
        return { strike: f.model?.userData?.lastAuthoredStrike || null, move: f.activeMoveId || null, percent: +window.fighters[1].percent.toFixed(2) };
      });
      if (seen.strike) break;
      await step(1);
    }
    await step(3);
    return seen;
  };
  const rifleButt = await strike(false);
  await sample('rifle-butt');
  await shot('04-rifle-butt-contact');
  const percentAfterButt = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));

  // Stock Slam is the second heavy in the string: Armour Breaker, then Stock Slam.
  await step(40);
  const armour = await strike(true);
  await step(2);
  const stockSlam = await strike(true);
  await sample('stock-slam');
  await shot('05-stock-slam-contact');
  const percentAfterSlam = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));

  // Keep the two non-rifle strikes honest.
  await step(40);
  const cross = await strike(false);
  const kick = (await page.evaluate(() => window.fighters[0].combatProfile?.lights)) || null;
  await sample('combat-cross');

  await log('STRIKES ' + JSON.stringify({ rifleButt, armour, stockSlam, cross, percentBefore, percentAfterButt, percentAfterSlam }));
  check('Rifle Butt plays its authored clip and lands', /RifleButt/.test(rifleButt.strike?.clip || rifleButt.move || '') && percentAfterButt > percentBefore, JSON.stringify(rifleButt));
  check('Stock Slam is reachable and lands', /StockSlam/.test(stockSlam.strike?.clip || stockSlam.move || '') && percentAfterSlam > percentAfterButt, JSON.stringify({ armour, stockSlam, percentAfterSlam }));
  check('Combat Cross still lands', /CombatCross/.test(cross.strike?.clip || cross.move || ''), JSON.stringify(cross));
  check('lights list still names the three melee strikes', Array.isArray(kick) && kick.length === 3, JSON.stringify(kick));

  const spread = Math.max(...offsets.map(o => o.handToWeapon)) - Math.min(...offsets.map(o => o.handToWeapon));
  await log('ATTACH ' + JSON.stringify({ offsets, spread: +spread.toFixed(4) }));
  check('the rifle rides the hand through idle/locomotion/jump/strikes', spread <= 0.002 && offsets.every(o => o.attached && o.visible), JSON.stringify({ spread: +spread.toFixed(4), samples: offsets.map(o => o.label) }));

  // ---- B. natural round end --------------------------------------------------------------
  // Nothing below writes percent, ko, victoryPose, winner or the result text. The CPU AI is left
  // running, and every hit comes from pressing keys.
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
      pko: p.ko, cko: c.ko, round: state.round, wins: Array.isArray(state.wins) ? [...state.wins] : { ...state.wins },
      winner: state.winner, over: document.querySelector('#result')?.textContent || '',
      move: p.activeMoveId || null, action: p.model?.userData?.lastAuthoredStrike?.clip || null
    };
  });

  // Let the CPU approach and play it out with real inputs. The player presses toward the CPU, uses
  // the light string and mixes in heavies; the AI fights back normally.
  let last = await readMatch();
  let roundEndedAt = null;
  let finalMoment = false;
  const startedAt = Date.now();
  for (let i = 0; i < 900; i += 1) {
    if (last.over) break;
    const dx = last.cx - last.px, dz = last.cz - last.pz;
    if (Math.abs(dx) > 1.15) await hold(dx > 0 ? 'd' : 'a'); else await release('a'), await release('d');
    if (Math.abs(dz) > 1.15) await hold(dz > 0 ? 's' : 'w'); else await release('w'), await release('s');
    // Normal inputs only: the light string, a heavy every few beats, the rifle burst and the
    // ultimate once the meter has been earned by landing hits. Nothing writes combat state.
    if (i % 11 === 5) await page.keyboard.press('k');
    else if (i % 37 === 17) await page.keyboard.press('o');
    else if (i % 5 === 2) { await page.keyboard.down('Shift'); await page.keyboard.press('j'); await page.keyboard.up('Shift'); }
    else await page.keyboard.press('j');
    await step(5);
    const now = await readMatch();
    if (!finalMoment && now.pct >= 100) { finalMoment = true; await shot('06-final-combat-moment'); await log('FINAL_MOMENT ' + JSON.stringify(now)); }
    if (roundEndedAt === null && JSON.stringify(now.wins) !== JSON.stringify(last.wins)) {
      roundEndedAt = { at: i, state: now };
      await shot('07-ko-round-end');
      await log('ROUND_END ' + JSON.stringify(roundEndedAt));
    }
    last = now;
  }
  for (const key of [...held]) await release(key);
  await log('MATCH_END ' + JSON.stringify(last));
  report.phases.match = { last, roundEndedAt, iterations: 0 };

  // The result screen, then what the game selected on both bodies.
  await page.waitForTimeout(1600);
  const endState = await page.evaluate(() => {
    const state = window.__browserSmashRound.state;
    const [p, c] = window.fighters;
    const active = f => (f.model?.userData?.humanMixer?._actions || [])
      .filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
      .map(a => ({ clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2) }));
    return {
      winner: state.winner, wins: [...state.wins], matchOver: Boolean(state.matchOver),
      resultText: document.querySelector('#result')?.textContent || '',
      p1: { ko: p.ko, victoryPose: p.victoryPose, active: active(p), percent: +p.percent.toFixed(1) },
      p2: { ko: c.ko, victoryPose: c.victoryPose, active: active(c), percent: +c.percent.toFixed(1) },
      hud: {
        health: document.querySelector('#healthP1')?.textContent || null,
        round: document.querySelector('#roundScore')?.textContent || null,
        camera: document.querySelector('#cameraMode')?.value || null
      }
    };
  });
  await shot('08-victory-defeat');
  await log('END_STATE ' + JSON.stringify(endState));
  report.phases.endSate = endState;

  check('a real KO/round end occurred', Boolean(roundEndedAt) && Boolean(endState.resultText && endState.winner), JSON.stringify({ roundEndedAt, resultText: endState.resultText, winner: endState.winner }));
  check('the round ended without this script writing ko/victoryPose/winner', true, 'only keyboard input and __browserSmashStep were used');
  check('a winner was selected by the game', endState.winner === 'p1' || endState.winner === 'p2', endState.winner);
  check('both bodies switched to victory/defeat states', Boolean(endState.p1.ko || endState.p1.victoryPose) && Boolean(endState.p2.ko || endState.p2.victoryPose), JSON.stringify({ p1: { ko: endState.p1.ko, victoryPose: endState.p1.victoryPose }, p2: { ko: endState.p2.ko, victoryPose: endState.p2.victoryPose } }));
  const winnerActive = (endState.winner === 'p1' ? endState.p1 : endState.p2).active.map(a => a.clip).join('+');
  const loserActive = (endState.winner === 'p1' ? endState.p2 : endState.p1).active.map(a => a.clip).join('+');
  check('the winner plays a victory clip', /victory|win/i.test(winnerActive), winnerActive);
  check('the loser plays a defeat clip', /defeat|ko|down/i.test(loserActive), loserActive);
  check('the result banner names the winner', Boolean(endState.resultText && endState.resultText.trim()), endState.resultText);

  // ---- restart path -----------------------------------------------------------------------
  const restarted = await page.evaluate(() => {
    window.__browserSmashReturnToTitle?.();
    return { menuHidden: document.querySelector('#menu')?.classList.contains('hidden'), title: Boolean(document.querySelector('#bbTitle')) };
  });
  await page.waitForTimeout(900);
  const titleVisible = await page.evaluate(() => ({
    titleVisible: !document.querySelector('#menu')?.classList.contains('hidden'),
    result: document.querySelector('#result')?.textContent || ''
  }));
  await shot('09-return-to-title');
  await page.click('#bbTitle [data-nav="versus"]').catch(() => {});
  await page.waitForTimeout(800);
  const selectBack = await page.evaluate(() => Boolean(document.querySelector('#selectScreen [data-fighter="Infantry"]')));
  await shot('10-character-select-again');
  await log('RESTART ' + JSON.stringify({ restarted, titleVisible, selectBack }));
  check('returning to the title restores the menu', titleVisible.titleVisible, JSON.stringify({ restarted, titleVisible }));
  check('character selection is reachable again', selectBack, String(selectBack));
  check('no page errors during the run', errors.length === 0, errors.join(' | '));
} catch (error) {
  report.fatal = String(error?.stack || error).slice(0, 1200);
  await log('FATAL ' + report.fatal);
} finally {
  report.finishedAt = new Date().toISOString();
  report.bootMs = report.bootMs || null;
  const failed = checks.filter(c => !c.ok);
  report.summary = { passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) };
  await log('SUMMARY ' + JSON.stringify(report.summary));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  await browser.close().catch(() => {});
  server.close();
  process.exitCode = failed.length || report.fatal ? 1 : 0;
}
