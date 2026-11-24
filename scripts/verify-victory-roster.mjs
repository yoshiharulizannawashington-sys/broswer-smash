// Roster victory/defeat coverage (B–E): the presentation that was verified on Hulk must work for
// other fighters through real matches, with each body's own authored clips.
//
//   bash scripts/run-browser-test.sh scripts/verify-victory-roster.mjs
//
// Per fighter: one match won with real attacks, then a rematch lost through the real round/match
// resolution. Both runs go through the normal menu, match loop, camera presentation, result panel
// and rematch button — no preview scene and no synthetic animation player.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/roster-victory';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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

// Alphabetical B–E bucket of the 38-fighter launch roster.
const ALL_FIGHTERS = ['Captain Jack Sparrow', 'Doctor Strange', 'Edna Mode', 'Edward Elric'];
// Split runs so a slow software-rendered match cannot exceed the shell's five-minute budget.
const ONLY = (process.env.ROSTER_ONLY || '').split(',').filter(Boolean).map(Number);
const FIGHTERS = ONLY.length ? ONLY.map(i => ALL_FIGHTERS[i]) : ALL_FIGHTERS;
const SLUG = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

let failures = 0;
const rows = [];
const check = (fighter, name, ok, detail = '') => {
  if (!ok) failures++;
  rows.push({ fighter, name, ok, detail });
  console.log(`${ok ? '  ok ' : ' FAIL'} [${fighter}] ${name}${detail ? ' — ' + detail : ''}`);
};

let browser;
const pageErrors = [];
const consoleErrors = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 200)); });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });

  // One round per match keeps the probe honest and bounded; the presentation contract is identical.
  // Rules go through the same selects the UI uses, so the simulation actually reads them. The
  // opponent is a real CPU body (not the practice dummy), which is what makes its defeat clip real.
  await page.evaluate(() => {
    const set = (selector, value) => { const n = document.querySelector(selector); if (n) { n.value = value; n.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('[data-rule="rounds"]', '1');
    set('[data-rule="timer"]', '60');
    // The rematch intro card otherwise covers the match while a forced KO resolves under it.
    window.__browserSmashIntroSeconds = 0;
    window.__browserSmashFreezeAI = true;
  });

  for (const [fi, fighter] of FIGHTERS.entries()) {
    const slug = SLUG(fighter);
    if (fi > 0) {
      // A fresh page per fighter: selecting a new body while a rematch is live is ignored by the
      // select screen, which silently kept the previous fighter and stalled the run.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });
      await page.evaluate(() => {
        const set = (selector, value) => { const n = document.querySelector(selector); if (n) { n.value = value; n.dispatchEvent(new Event('change', { bubbles: true })); } };
        set('[data-rule="rounds"]', '1'); window.__browserSmashIntroSeconds = 0; window.__browserSmashFreezeAI = true;
      });
    }
    // ---- start a real match with this fighter on P1
    await page.evaluate(name => {
      window.__browserSmashSelect?.select?.('p1', name);
      window.__browserSmashSelect?.select?.('p2', 'Goku');
      document.querySelector('#play')?.click();
    }, fighter);
    await page.waitForFunction(n => {
      const f = window.fighters?.[0];
      return window.__browserSmashMatch?.().status === 'fighting'
        && f?.identityKey === n
        && Boolean(f?.model?.userData?.victoryAction?.getClip?.())
        && Boolean(f?.model?.userData?.defeatAction?.getClip?.());
    }, slug, { timeout: 90000, polling: 200 });
    // The opponent's body binds its clip set asynchronously; give the PEM body the same head start a
    // real player gives it before the first hit, so the loser's authored clip exists by match end.
    await page.waitForFunction(() => Boolean(window.fighters?.[1]?.model?.userData?.defeatAction), null, { timeout: 30000, polling: 200 }).catch(() => {});

    const model = await page.evaluate(() => {
      const f = window.fighters[0], u = f.model.userData;
      return {
        identity: f.identityKey,
        modelLoaded: Boolean(f.characterModelLoaded),
        mixerRoot: Boolean(u.humanMixer),
        clipCount: Object.keys(u.animationActions || {}).length,
        victoryClip: u.victoryAction?.getClip?.()?.name || null,
        defeatClip: u.defeatAction?.getClip?.()?.name || null
      };
    });
    check(fighter, 'correct body loaded for this identity', model.identity === slug && model.modelLoaded && model.mixerRoot, `${model.identity} clips=${model.clipCount}`);
    check(fighter, 'body ships its own authored victory/defeat clips', /victory/i.test(model.victoryClip || '') && /defeat/i.test(model.defeatClip || ''), `${model.victoryClip} / ${model.defeatClip}`);

    // ---- win the match with real movement and attacks
    const win = await page.evaluate(() => {
      const f = window.fighters[0], u = f.model.userData, foe = window.fighters[1];
      const tick = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
      const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
      const held = {};
      const hold = (code, on) => { if (!!held[code] === on) return; held[code] = on; key(code, on); };
      const release = () => { for (const code of Object.keys(held)) hold(code, false); };
      const status = () => window.__browserSmashMatch().status;
      const walkTo = target => {
        for (let i = 0; i < 900; i += 1) {
          const dx = foe.position.x - f.position.x, dz = foe.position.z - f.position.z;
          if (Math.hypot(dx, dz) <= target) break;
          const V = window.__browserSmashThree, cam = window.smashCamera.camera;
          const fwd = new V.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
          const right = new V.Vector3().crossVectors(fwd, new V.Vector3(0, 1, 0)).normalize();
          const d = Math.hypot(dx, dz) || 1, tx = dx / d, tz = dz / d;
          const along = tx * fwd.x + tz * fwd.z, across = tx * right.x + tz * right.z;
          hold('KeyW', along > 0.25); hold('KeyS', along < -0.25);
          hold('KeyD', across > 0.25); hold('KeyA', across < -0.25);
          tick(1);
          if (status() !== 'fighting') break;
        }
        release(); tick(4);
      };
      const settle = () => { for (let i = 0; i < 300 && status() === 'fighting' && (foe.invulnerable > 0 || foe.hitstun > 0); i += 1) tick(1); };
      const attack = () => { key('KeyJ', true); tick(1); key('KeyJ', false); tick(16); };
      for (let n = 0; n < 30 && status() !== 'match-over'; n += 1) {
        if (status() === 'round-over') { for (let i = 0; i < 240 && status() === 'round-over'; i += 1) tick(1); n -= 1; continue; }
        walkTo(1.7);
        if (status() === 'fighting') settle();
        for (let c = 0; c < 5 && status() === 'fighting'; c += 1) { settle(); if (status() === 'fighting') attack(); }
        if (status() !== 'match-over') tick(40);
      }
      // victoryShot blends for .7 s; measure after the lens has landed, not on the first frame.
      for (let i = 0; i < 55; i += 1) tick(1);
      const cam = window.smashCamera, report = cam.report?.(f, foe) || null;
      return {
        status: status(),
        subject: f.identityKey,
        wins: window.__browserSmashMatch().wins.slice(),
        victoryRunning: Boolean(u.victoryAction?.isRunning?.()),
        victoryClip: u.victoryAction?.getClip?.()?.name || null,
        victoryWeight: u.victoryAction?.getEffectiveWeight?.() ?? null,
        victoryTime: u.victoryAction?.time ?? null,
        victoryPose: f.victoryPose,
        loserKo: Boolean(foe.ko),
        loserDefeatRunning: Boolean(foe.model.userData.defeatAction?.isRunning?.()),
        loserDefeatClip: foe.model.userData.defeatAction?.getClip?.()?.name || null,
        defeatedPose: Boolean(foe.forceDefeatPose),
        insideGeometry: report?.insideGeometry ?? null,
        heightFraction: report?.fighters?.[0]?.bounds?.heightFraction ?? null,
        onScreen: report?.fighters?.[0]?.bounds?.onScreen ?? null,
        spectating: Boolean(cam.spectateState),
        layoutKey: window.__browserSmashActiveLayout,
        subjectPos: [f.position.x, f.position.y, f.position.z].map(n => +n.toFixed(2)),
        camPos: [cam.camera.position.x, cam.camera.position.y, cam.camera.position.z].map(n => +n.toFixed(2)),
        report,
        foe: { loaded: Boolean(foe.characterModelLoaded), clips: Object.keys(foe.model?.userData?.animationActions || {}).length, mixer: Boolean(foe.model?.userData?.humanMixer) },
        trace: (window.__browserSmashVictoryTrace || []).slice(-1)[0] || null
      };
    });
    check(fighter, 'real match reaches match-over on a win', win.status === 'match-over', JSON.stringify(win.wins));
    check(fighter, 'winner plays its authored victory clip', win.victoryRunning && /victory/i.test(win.victoryClip || '') && (win.victoryWeight ?? 0) > 0.5, `${win.victoryClip} w=${win.victoryWeight} t=${win.victoryTime}`);
    check(fighter, 'loser plays its authored defeat clip', win.loserKo && win.loserDefeatRunning && /defeat/i.test(win.loserDefeatClip || ''), `${win.loserDefeatClip} foe=${JSON.stringify(win.foe)}`);
    check(fighter, 'victory camera is outside geometry and frames the body', win.insideGeometry === false && (win.heightFraction ?? 0) > 0.55, `inside=${win.insideGeometry} height=${win.heightFraction}`);
    check(fighter, 'victory presentation is staged before the result panel', win.spectating && win.trace?.where === 'roster-victory', JSON.stringify(win.trace));
    await page.screenshot({ path: `${out}/${slug}-victory.png` });

    // result panel after the hold
    await page.evaluate(() => { for (let i = 0; i < 400 && !document.querySelector('#result')?.textContent; i += 1) window.__browserSmashStep(1 / 60); });
    const victoryPanel = await page.evaluate(() => ({ text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(), actions: [...document.querySelectorAll('#bbResultActions button')].map(b => b.dataset.result) }));
    check(fighter, 'result panel reports VICTORY with rematch actions', /^VICTORY/i.test(victoryPanel.text) && victoryPanel.actions.join(',') === 'rematch,select,title', victoryPanel.text.slice(0, 48));

    // ---- rematch, then lose through the real round/match resolution
    await page.evaluate(() => document.querySelector('#play')?.click());
    await page.waitForFunction(n => window.__browserSmashMatch?.().status === 'fighting' && window.fighters?.[0]?.identityKey === n, slug, { timeout: 60000, polling: 200 });
    // A rematch opens with the arena intro card over the scene. Forcing the KO under it captured
    // the title card instead of the defeat presentation, so wait for the intro to clear first.
    // The arena title card fades over the live match; give it the duration a player sees so the
    // defeat capture is the presentation and not the card.
    await page.waitForTimeout(2600);
    const defeat = await page.evaluate(() => {
      const f = window.fighters[0], foe = window.fighters[1];
      // A real round: the KO is applied to the player's percent, then the game's own round and
      // match resolution decides the outcome, sets the poses and runs the presentation.
      f.percent = 999;
      for (let i = 0; i < 600 && window.__browserSmashMatch().status !== 'match-over'; i += 1) window.__browserSmashStep(1 / 60);
      // Same settle for the defeat shot before measuring its framing.
      for (let i = 0; i < 55; i += 1) window.__browserSmashStep(1 / 60);
      const cam = window.smashCamera, report = cam.report?.(f, foe) || null;
      return {
        status: window.__browserSmashMatch().status,
        wins: window.__browserSmashMatch().wins.slice(),
        subject: f.identityKey,
        defeatRunning: Boolean(f.model.userData.defeatAction?.isRunning?.()),
        defeatClip: f.model.userData.defeatAction?.getClip?.()?.name || null,
        defeatWeight: f.model.userData.defeatAction?.getEffectiveWeight?.() ?? null,
        defeatTime: f.model.userData.defeatAction?.time ?? null,
        defeatDuration: f.model.userData.defeatAction?.getClip?.()?.duration ?? null,
        defeatPaused: Boolean(f.model.userData.defeatAction?.paused),
        grounded: Boolean(f.isGrounded),
        forceDefeatPose: Boolean(f.forceDefeatPose),
        opponentVictoryRunning: Boolean(foe.model.userData.victoryAction?.isRunning?.()),
        insideGeometry: report?.insideGeometry ?? null,
        heightFraction: report?.fighters?.[0]?.bounds?.heightFraction ?? null,
        onScreen: report?.fighters?.[0]?.bounds?.onScreen ?? null,
        spectating: Boolean(cam.spectateState),
        trace: (window.__browserSmashVictoryTrace || []).slice(-1)[0] || null
      };
    });
    check(fighter, 'real rematch reaches match-over on a loss', defeat.status === 'match-over', JSON.stringify(defeat.wins));
    // The defeat clip is authored; what matters is that it is the state the body is in. Clamped
    // one-shot actions stop reporting isRunning() at the end, so judge the dominant weight instead.
    check(fighter, 'loser plays its authored defeat clip on defeat',
      /defeat/i.test(defeat.defeatClip || '') && (defeat.defeatWeight ?? 0) > 0.5 && (defeat.forceDefeatPose || defeat.grounded),
      `${defeat.defeatClip} w=${defeat.defeatWeight} t=${defeat.defeatTime}/${defeat.defeatDuration} paused=${defeat.defeatPaused} running=${defeat.defeatRunning} force=${defeat.forceDefeatPose} grounded=${defeat.grounded}`);
    check(fighter, 'defeat camera is outside geometry and frames the body', defeat.insideGeometry === false && (defeat.heightFraction ?? 0) > 0.55, `inside=${defeat.insideGeometry} height=${defeat.heightFraction}`);
    check(fighter, 'defeat presentation is staged before the result panel', defeat.spectating && defeat.trace?.where === 'roster-defeat', JSON.stringify(defeat.trace));
    await page.screenshot({ path: `${out}/${slug}-defeat.png` });

    await page.evaluate(() => { for (let i = 0; i < 400 && !document.querySelector('#result')?.textContent; i += 1) window.__browserSmashStep(1 / 60); });
    const defeatPanel = await page.evaluate(() => ({ text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim() }));
    check(fighter, 'result panel reports DEFEAT', /^DEFEAT/i.test(defeatPanel.text), defeatPanel.text.slice(0, 48));

    // ---- rematch after the defeat restores a clean fight
    await page.evaluate(() => document.querySelector('#play')?.click());
    await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 }).catch(() => {});
    const clean = await page.evaluate(() => ({
      status: window.__browserSmashMatch().status,
      victoryPose: window.fighters[0].victoryPose,
      ko: window.fighters[0].ko,
      forceDefeatPose: Boolean(window.fighters[0].forceDefeatPose)
    }));
    check(fighter, 'rematch clears the previous result state', clean.status === 'fighting' && clean.victoryPose === 0 && clean.ko === false && clean.forceDefeatPose === false, JSON.stringify(clean));
  }

  check('roster', 'no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  check('roster', 'no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
} catch (error) {
  check('harness', 'completed', false, String(error?.message || error).slice(0, 300));
} finally {
  await browser?.close();
  server.close();
}

await writeFile(`${out}/report.json`, JSON.stringify({ fighters: FIGHTERS, rows, failures, pageErrors, consoleErrors }, null, 2));
console.log(`\n${rows.length - failures}/${rows.length} checks passed across ${FIGHTERS.length} fighters`);
process.exit(failures ? 1 : 0);
