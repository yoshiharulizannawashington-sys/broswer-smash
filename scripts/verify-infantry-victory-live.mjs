// Stock Slam proof + a match Infantry is given a fair chance to win.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-victory-live.mjs
//
// Phase 1 places the opponent at point-blank range, holds its inputs neutral and presses the heavy
// string twice, recording the clip the game selects for each press and the damage it deals. That is
// the only way to see whether the second heavy is Stock Slam.
// Phase 2 hands the inputs back, picks a lighter opponent and plays Infantry to its strength: keep
// the rifle's range, fire the Marksman burst and the ultimate, and only brawl when cornered. Nothing
// writes percent, ko, victoryPose, winner or the result text.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-victory';
await mkdir(out, { recursive: true });
const log = async line => { console.log(line); await appendFile(`${out}/run.log`, line + '\n').catch(() => {}); };
await writeFile(`${out}/run.log`, '');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
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
page.on('pageerror', e => { errors.push(String(e.message || e).slice(0, 240)); console.log('PAGEERROR', String(e.message || e).slice(0, 160)); });

const checks = [];
const check = (name, ok, detail = '') => {
  const entry = { name, ok: Boolean(ok), detail: String(detail).slice(0, 800) };
  checks.push(entry);
  log(`CHECK ${entry.ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + entry.detail : ''}`);
};
const shot = async file => { try { await page.screenshot({ path: `${out}/${file}.png` }); return true; } catch (e) { await log('SHOT_FAIL ' + file); return false; } };
const step = n => page.evaluate(f => window.__browserSmashStep(f / 60), n);
const report = { checks, errors };

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 90000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 30000, polling: 200 });
  await page.evaluate(() => {
    document.querySelector('#selectScreen [data-side="p1"]').click();
    document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
    document.querySelector('#selectScreen [data-side="p2"]').click();
    document.querySelector('#selectScreen [data-fighter="Kaze"]').click();
  });
  const picked = await page.evaluate(() => ({
    p1: document.querySelector('#p1Character')?.selectedOptions?.[0]?.textContent,
    p2: document.querySelector('#cpuCharacter')?.selectedOptions?.[0]?.textContent
  }));
  await log('SELECT ' + JSON.stringify(picked));
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
  await page.waitForFunction(() => window.fighters?.[0]?.model?.userData?.equippedWeaponRight, null, { timeout: 90000, polling: 250 });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.activeElement?.blur?.());
  const skill = await page.evaluate(() => {
    const before = window.__browserSmashCpuSkill?.() || null;
    window.__browserSmashSetCpuSkill?.('easy');
    return { before, after: window.__browserSmashCpuSkill?.() || null };
  });
  await log('CPU_SKILL ' + JSON.stringify(skill));

  // ---- phase 1: heavy string -------------------------------------------------------------
  await page.evaluate(() => {
    const p2 = window.fighters[1];
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false, attack: false, special: false, special2: false, special3: false, grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false, webSwing: false, vertical: 0 };
    p2.__probeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__probeSim(dt, { getInputs: () => ({ ...idle }) });
    window.__probePlace = (d = 0.95) => {
      const [p1, c2] = window.fighters;
      p1.position.set(0, 0, 0); c2.position.set(d, 0, 0);
      p1.velocity.set(0, 0, 0); c2.velocity.set(0, 0, 0);
      p1.facing = 1; p1.facingZ = 0; c2.facing = -1; c2.facingZ = 0;
      p1.attackQueue.length = 0; p1.hitboxes.length = 0; p1.attackPose = 0; p1.comboStep = 0; p1.comboWindow = 0; p1.hitstun = 0; p1.position.y = 0; p1.isGrounded = true;
      c2.percent = 0; c2.hitstun = 0; c2.invulnerable = 0; c2.shield = 0; c2.attackQueue.length = 0; c2.hitboxes.length = 0; c2.position.y = 0;
    };
  });
  await page.evaluate(() => window.__probePlace(0.95));
  await step(6);
  const heavyClips = [];
  for (let press = 0; press < 3; press += 1) {
    const before = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
    await page.keyboard.down('Shift');
    await page.keyboard.down('j'); await step(2); await page.keyboard.up('j');
    await page.keyboard.up('Shift');
    let seen = null;
    let damage = 0;
    for (let i = 0; i < 150; i += 1) {
      seen = await page.evaluate(() => {
        const f = window.fighters[0];
        return { clip: f.model?.userData?.lastAuthoredStrike?.clip || null, percent: +window.fighters[1].percent.toFixed(2), kind: f.model?.userData?.weaponKind, bone: f.model?.userData?.equippedWeaponRight?.parent?.userData?.attachBone || null };
      });
      damage = +(seen.percent - before).toFixed(2);
      if (damage > 0) break;
      await step(1);
    }
    heavyClips.push({ press, clip: seen?.clip || null, damage, kind: seen?.kind || null, bone: seen?.bone || null });
    await shot(`01-heavy-${press + 1}`);
    // Keep the pair close enough for the next link in the string.
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p2.position.set(p1.position.x + 0.95, 0, p1.position.z);
      p2.percent = Math.max(p2.percent, 0);
      p2.hitstun = 0;
    });
    await step(4);
  }
  await log('HEAVY_STRING ' + JSON.stringify(heavyClips));
  const slam = heavyClips.find(h => /StockSlam/.test(h.clip || '') && h.damage > 0);
  check('the heavy string reaches Stock Slam', Boolean(slam), JSON.stringify(heavyClips));
  check('Stock Slam deals damage with the rifle in hand', Boolean(slam && slam.kind === 'rifle' && /hand|wrist|palm/i.test(slam.bone || '')), JSON.stringify(slam));
  check('Armour Breaker still plays', heavyClips.some(h => /ArmourBreaker/.test(h.clip || '')), JSON.stringify(heavyClips.map(h => h.clip)));

  // ---- phase 2: play to the rifle's range ------------------------------------------------
  await page.evaluate(() => {
    const p2 = window.fighters[1];
    if (p2.__probeSim) { p2.simulate = p2.__probeSim; p2.__probeSim = null; }
    window.__browserSmashSpawnFighters?.();
    window.fighters[0].percent = 0; window.fighters[1].percent = 0;
    window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 180, pitch: 6 });
  });
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
      meter: +(p.meter || 0).toFixed(0),
      result: document.querySelector('#result')?.innerText || ''
    };
  });

  let last = await readMatch();
  const fightStart = Date.now();
  let firstKo = null;
  let finalShot = false;
  for (let i = 0; i < 2600; i += 1) {
    if (last.result) break;
    if (Date.now() - fightStart > 135000) break;
    const dx = last.cx - last.px, dz = last.cz - last.pz;
    const dist = Math.hypot(dx, dz);
    // Hold the rifle's lane: back off when the brawler closes, otherwise strafe to keep a shot.
    if (dist < 3.2) {
      await hold(dx > 0 ? 'a' : 'd'); await hold(dz > 0 ? 'w' : 's');
    } else if (dist > 9) {
      await hold(dx > 0 ? 'd' : 'a'); await hold(dz > 0 ? 's' : 'w');
    } else {
      await release('a'); await release('d'); await release('w'); await release('s');
      await hold(dx > 0 ? 'a' : 'd');
    }
    if (last.meter >= 100) await page.keyboard.press('o');
    else if (i % 3 !== 0) await page.keyboard.press('k');
    else if (dist < 1.8) await page.keyboard.press('j');
    await step(5);
    const now = await readMatch();
    if (!finalShot && now.pct >= 100) { finalShot = true; await shot('02-final-combat-moment'); await log('FINAL_MOMENT ' + JSON.stringify(now)); }
    if (!firstKo && now.wins !== last.wins) { firstKo = { at: i, state: now }; await shot('03-ko-round-end'); await log('ROUND_END ' + JSON.stringify(firstKo)); }
    last = now;
  }
  for (const key of [...held]) await release(key);
  await log('MATCH_END ' + JSON.stringify({ last, elapsedMs: Date.now() - fightStart }));

  await page.waitForTimeout(800);
  const endState = await page.evaluate(() => {
    const state = window.__browserSmashRound.state;
    const [p, c] = window.fighters;
    const active = f => (f.model?.userData?.humanMixer?._actions || [])
      .filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
      .map(a => ({ clip: a.getClip().name, weight: +a.getEffectiveWeight().toFixed(2) }));
    return {
      winner: state.winner, wins: state.wins,
      resultText: document.querySelector('#result')?.innerText || '',
      p1: { identity: p.identity, ko: p.ko, victoryPose: p.victoryPose, active: active(p) },
      p2: { identity: c.identity, ko: c.ko, victoryPose: c.victoryPose, active: active(c) },
      roundHud: document.querySelector('#roundScore')?.textContent || null
    };
  });
  await shot('04-victory-defeat');
  await log('END_STATE ' + JSON.stringify(endState));
  report.endState = endState;
  report.heavyClips = heavyClips;

  check('a genuine KO ended a round', Boolean(firstKo), JSON.stringify(firstKo?.state || null));
  check('the game selected the winner itself', endState.winner === 'p1' || endState.winner === 'p2', String(endState.winner));
  const p1Won = endState.winner === 'p1';
  const winner = p1Won ? endState.p1 : endState.p2;
  const loser = p1Won ? endState.p2 : endState.p1;
  const winnerClips = winner.active.map(a => a.clip).join('+');
  const loserClips = loser.active.map(a => a.clip).join('+');
  check('Infantry won and plays Infantry_victory', p1Won && /Infantry_victory/i.test(winnerClips), JSON.stringify({ p1Won, winnerClips }));
  check('the opponent plays its defeat animation', /defeat|down|ko/i.test(loserClips), loserClips);
  check('the result banner is presented', Boolean(endState.resultText.trim()), endState.resultText.replace(/\s+/g, ' ').slice(0, 160));
  check('the HUD round line updated', Boolean(endState.roundHud), endState.roundHud);

  await page.evaluate(() => window.__browserSmashReturnToTitle?.());
  await page.waitForTimeout(700);
  const titleVisible = await page.evaluate(() => !document.querySelector('#menu')?.classList.contains('hidden'));
  await shot('05-return-to-title');
  await page.click('#bbTitle [data-nav="versus"]').catch(() => {});
  await page.waitForTimeout(700);
  const selectBack = await page.evaluate(() => Boolean(document.querySelector('#selectScreen [data-fighter="Infantry"]')));
  await shot('06-character-select-again');
  check('the match can be left and the roster reopened', titleVisible && selectBack, JSON.stringify({ titleVisible, selectBack }));
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  report.fatal = String(error?.stack || error).slice(0, 900);
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
