// Full 1P-vs-CPU match flow on each target arena.
//
// This drives the real Vite game, selects the normal setup screen, plays each round through the
// live simulation with actual KeyboardEvents, and then exercises the result panel, REMATCH action
// and the clean rematch state. A victory match is played with real attacks; the defeat match is
// played with the player idle against the CPU, with a deterministic lethal-percent fallback only
// if the CPU cannot close the round inside the round timer.
//
//   bash scripts/run-browser-test.sh scripts/verify-arena-match-flow.mjs --arena mariokart
//   ... --arena konoha_overlook
//   ... --arena skyloft
//
// Outputs: artifacts/arena-match-flow/<arena>/{report.json,victory.png,defeat.png,rematch.png}
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MAPS = {
  konoha_overlook: 'Konoha · Hidden Leaf Village',
  skyloft: 'Skyloft · Skyward Isle',
  mariokart: 'Mario Kart · Wuhu Island Headland'
};

const requested = process.argv.indexOf('--arena') >= 0 ? process.argv[process.argv.indexOf('--arena') + 1] : null;
const keys = requested ? [requested] : Object.keys(MAPS);
if (keys.some(key => !MAPS[key])) {
  console.error(`Unknown arena: ${keys.find(key => !MAPS[key])}`);
  process.exit(2);
}

const root = process.cwd();
const url = process.env.ARENA_URL || 'http://127.0.0.1:3000/';
const browserExecutable = process.env.BROWSER_BIN || undefined;
const outRoot = resolve(root, 'artifacts/arena-match-flow');
await mkdir(outRoot, { recursive: true });

const wait = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(180000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 300)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = String(message.text());
    if (/favicon\.ico|Failed to load resource.*404/i.test(text)) return;
    consoleErrors.push(text.slice(0, 300));
  });

  const reports = [];
  for (const arena of keys) {
    const arenaDir = resolve(outRoot, arena);
    await mkdir(arenaDir, { recursive: true });
    const checks = [];
    const check = (name, passed, detail = '') => {
      checks.push({ name, status: passed ? 'passed' : 'failed', detail });
      console.log(`${passed ? 'PASS' : 'FAIL'} [${arena}] ${name}${detail ? ' · ' + detail : ''}`);
    };

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.__browserSmashSelect && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });
    await page.evaluate(({ arena }) => {
      // The full match is the test; skip the intro card so the round can start immediately.
      window.__browserSmashIntros = false;
      window.__browserSmashIntroSeconds = 0;
      window.__browserSmashFreezeAI = false;
      const select = window.__browserSmashSelect;
      select.show();
      select.select('p1', 'Naruto Uzumaki');
      select.select('p2', 'Goku');
      select.chooseArena(arena);
      document.querySelector('#selectScreen [data-mode="1p"]')?.click();
      const set = (selector, value) => {
        const node = document.querySelector(selector);
        if (!node) return false;
        node.value = value;
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return node.value === value;
      };
      window.__arenaFlowRules = [
        set('[data-rule="rounds"]', '1'),
        set('[data-rule="timer"]', '120'),
        set('[data-rule="difficulty"]', 'rookie')
      ];
      // Arena fights resolve WASD against the camera, so a blind W run can walk away from the
      // opponent (Wuhu spawns face south while the CPU is east). This helper turns the world-space
      // target vector into the same camera-relative keys the player input uses, and stops the
      // approach at a chosen spacing so the CPU has room to attack or be attacked.
      window.__arenaFlowKeys = new Set();
      window.__arenaFlowFire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, {
        code, key: code === 'Space' ? ' ' : code.replace('Key', '').toLowerCase(), bubbles: true
      }));
      window.__arenaFlowTap = code => {
        window.__arenaFlowFire('keydown', code);
        window.__arenaFlowFire('keyup', code);
      };
      window.__arenaFlowRelease = () => {
        for (const code of [...window.__arenaFlowKeys]) window.__arenaFlowFire('keyup', code);
        window.__arenaFlowKeys.clear();
      };
      window.__arenaFlowDrive = (stop = 3) => {
        const player = window.fighters[0];
        const target = window.fighters[1];
        const camera = window.__browserSmashCamera;
        const THREE = window.__browserSmashThree;
        const fwd = new THREE.Vector3();
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0);
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const dx = target.position.x - player.position.x;
        const dz = target.position.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        const f = dx * fwd.x + dz * fwd.z;
        const r = dx * right.x + dz * right.z;
        const wanted = new Set();
        if (dist > stop) {
          if (f > 0.25) wanted.add('KeyW');
          else if (f < -0.25) wanted.add('KeyS');
          if (r > 0.25) wanted.add('KeyD');
          else if (r < -0.25) wanted.add('KeyA');
        }
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
          if (wanted.has(code) && !window.__arenaFlowKeys.has(code)) {
            window.__arenaFlowKeys.add(code);
            window.__arenaFlowFire('keydown', code);
          } else if (!wanted.has(code) && window.__arenaFlowKeys.has(code)) {
            window.__arenaFlowKeys.delete(code);
            window.__arenaFlowFire('keyup', code);
          }
        }
        return {
          dist: Number(dist.toFixed(2)),
          f: Number(f.toFixed(2)),
          r: Number(r.toFixed(2)),
          p1: [Number(player.position.x.toFixed(2)), Number(player.position.z.toFixed(2))],
          p2: [Number(target.position.x.toFixed(2)), Number(target.position.z.toFixed(2))]
        };
      };
    }, { arena });
    await wait(300);
    await page.evaluate(() => document.querySelector('#play')?.click());
    await page.waitForFunction(key => {
      const match = window.__browserSmashMatch?.();
      return match?.status === 'fighting' && match.mode === '1p' && match.arena === key
        && window.__browserSmashAssets?.arenas?.[key]?.status === 'loaded';
    }, arena, { timeout: 180_000, polling: 250 });

    const start = await page.evaluate(() => ({
      match: window.__browserSmashMatch(),
      rules: window.__arenaFlowRules,
      p1: window.fighters[0].identityKey,
      p2: window.fighters[1].identityKey,
      arena: window.__browserSmashMatch().arena,
      menuHidden: Boolean(document.querySelector('#menu')?.classList.contains('hidden'))
    }));
    check('live 1P vs CPU match starts', start.match.mode === '1p' && start.match.status === 'fighting' && start.menuHidden,
      JSON.stringify({ mode: start.match.mode, arena: start.arena, p1: start.p1, p2: start.p2 }));
    check('one-round rookie rules are applied', start.rules.every(Boolean) && start.match.roundsToWin === 1,
      JSON.stringify({ rules: start.rules, roundsToWin: start.match.roundsToWin }));

    const rematch = async () => {
      await page.click('#bbResultActions [data-result="rematch"]');
      await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting'
        && document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60_000, polling: 200 });
    };

    // ---- Victory match: chase the CPU through the live simulation and finish the round ----------
    // A real CPU can win a round, so retry with full matches when the first attempt is a defeat or
    // a clock win. This keeps every recorded victory a genuine KO, not a forced result.
    const victoryAttempts = [];
    let winFight = null;
    let win = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      if (attempt > 1) await rematch();
      const fight = await page.evaluate(() => {
        const status = () => window.__browserSmashMatch().status;
        const trace = [];
        window.__arenaFlowFire('keydown', 'KeyE');
        for (let i = 0; i < 1500 && status() !== 'match-over'; i += 1) {
          const approach = window.__arenaFlowDrive(5.5);
          if (i % 5 === 0) window.__arenaFlowTap('ShiftLeft');
          if (i % 8 === 0) window.__arenaFlowTap('KeyK');
          if (i % 3 === 0) window.__arenaFlowTap('KeyJ');
          if (i % 30 === 0 && (window.fighters[0].meter || 0) >= 100) window.__arenaFlowTap('KeyO');
          window.__browserSmashStep(0.1);
          if (i % 60 === 0) trace.push({
            i, status: status(), p1: Math.round(window.fighters[0].percent),
            p2: Math.round(window.fighters[1].percent), timer: document.querySelector('#timer')?.textContent || null,
            dist: approach.dist, p1Pos: approach.p1, p2Pos: approach.p2
          });
        }
        window.__arenaFlowRelease();
        window.__arenaFlowFire('keyup', 'KeyE');
        const match = window.__browserSmashMatch();
        const loser = match.winner === 'p1' ? window.fighters[1] : window.fighters[0];
        return {
          status: status(),
          winner: match.winner,
          p1: Math.round(window.fighters[0].percent),
          p2: Math.round(window.fighters[1].percent),
          loserPercent: Math.round(loser?.percent || 0),
          maxPercent: match.maxPercent,
          actualKO: Boolean(loser && loser.percent >= match.maxPercent),
          timer: document.querySelector('#timer')?.textContent || null,
          ko: window.fighters.some(f => Boolean(f.ko)),
          trace
        };
      });
      const result = await readResult(page, 'victory');
      victoryAttempts.push({
        attempt,
        outcome: /^VICTORY/i.test(result.text) ? 'victory' : 'defeat',
        actualKO: fight.actualKO,
        p1: fight.p1,
        p2: fight.p2,
        timer: fight.timer,
        result: result.text.slice(0, 160)
      });
      winFight = fight;
      win = result;
      if (/^VICTORY/i.test(result.text) && fight.actualKO) break;
    }
    if (!win) throw new Error('No victory match attempt produced a result');
    check('victory match reaches a KO', winFight.status === 'match-over' && winFight.actualKO, JSON.stringify(winFight));
    check('victory result is the winning result panel', /^VICTORY/i.test(win.text) && !win.defeatClass,
      win.text.slice(0, 140));
    check('victory result exposes rematch, select and title actions', win.actions.join(',') === 'rematch,select,title',
      win.actions.join(','));
    check('victory statistics come from the played match', win.stats.dealt > 0 && win.stats.hits > 0 && win.stats.biggest > 0,
      JSON.stringify(win.stats));
    await page.screenshot({ path: resolve(arenaDir, 'victory.png') });

    // ---- The real REMATCH action from the results panel --------------------------------------
    await rematch();
    const afterVictoryRematch = await page.evaluate(() => ({
      match: window.__browserSmashMatch(),
      result: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      menuHidden: Boolean(document.querySelector('#menu')?.classList.contains('hidden')),
      hudVisible: (() => { const node = document.querySelector('#bbHudLayer'); if (!node) return true; const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden'; })(),
      p1: window.fighters[0].identityKey,
      arena: window.__browserSmashMatch().arena,
      victoryPose: window.fighters[0].victoryPose,
      ko: window.fighters[0].ko
    }));
    check('victory REMATCH starts a fresh match on the same arena', afterVictoryRematch.menuHidden
      && afterVictoryRematch.match.status === 'fighting' && afterVictoryRematch.match.arena === arena
      && afterVictoryRematch.p1 === 'naruto_uzumaki' && afterVictoryRematch.result === ''
      && afterVictoryRematch.victoryPose === 0 && afterVictoryRematch.ko === false,
      JSON.stringify(afterVictoryRematch));

    // ---- Defeat match: walk into the CPU's range, then let the real CPU finish the round ------
    const defeatAttempts = [];
    let defeatFight = null;
    let defeat = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      if (attempt > 1) await rematch();
      const fight = await page.evaluate(() => {
        const status = () => window.__browserSmashMatch().status;
        const trace = [];
        for (let i = 0; i < 1500 && status() !== 'match-over'; i += 1) {
          // Close all the way: Wuhu's shelf lip leaves a 2.5 m horizontal gap at a 2 m stop, which
          // is just outside the CPU's melee reach. Walking into contact lets the real CPU attack.
          const approach = window.__arenaFlowDrive(0.8);
          window.__browserSmashStep(0.1);
          if (i % 60 === 0) trace.push({
            i, status: status(), p1: Math.round(window.fighters[0].percent),
            p2: Math.round(window.fighters[1].percent), timer: document.querySelector('#timer')?.textContent || null,
            dist: approach.dist, p1Pos: approach.p1, p2Pos: approach.p2,
            freeze: Boolean(window.__browserSmashFreezeAI), aiError: window.__browserSmashAiError || null
          });
        }
        window.__arenaFlowRelease();
        let forced = false;
        if (status() !== 'match-over') {
          forced = true;
          window.fighters[0].percent = 999;
          for (let i = 0; i < 600 && status() !== 'match-over'; i += 1) window.__browserSmashStep(1 / 60);
        }
        const match = window.__browserSmashMatch();
        const loser = match.winner === 'p1' ? window.fighters[1] : window.fighters[0];
        return {
          status: status(),
          forced,
          winner: match.winner,
          p1: Math.round(window.fighters[0].percent),
          p2: Math.round(window.fighters[1].percent),
          loserPercent: Math.round(loser?.percent || 0),
          maxPercent: match.maxPercent,
          actualKO: Boolean(loser && loser.percent >= match.maxPercent),
          timer: document.querySelector('#timer')?.textContent || null,
          ko: window.fighters.some(f => Boolean(f.ko)),
          trace
        };
      });
      const result = await readResult(page, 'defeat');
      defeatAttempts.push({
        attempt,
        outcome: /^DEFEAT/i.test(result.text) ? 'defeat' : 'victory',
        actualKO: fight.actualKO,
        forced: fight.forced,
        p1: fight.p1,
        p2: fight.p2,
        timer: fight.timer,
        result: result.text.slice(0, 160)
      });
      defeatFight = fight;
      defeat = result;
      if (/^DEFEAT/i.test(result.text) && fight.actualKO && !fight.forced) break;
    }
    if (!defeat) throw new Error('No defeat match attempt produced a result');
    check('second match reaches a KO', defeatFight.status === 'match-over' && defeatFight.actualKO,
      JSON.stringify(defeatFight));
    check('second match is a real CPU KO, not a forced fallback', !defeatFight.forced, JSON.stringify({ forced: defeatFight.forced, p1: defeatFight.p1, timer: defeatFight.timer }));
    check('second match produces a defeat result panel', /^DEFEAT/i.test(defeat.text) && defeat.defeatClass,
      defeat.text.slice(0, 140));
    check('defeat result exposes rematch, select and title actions', defeat.actions.join(',') === 'rematch,select,title',
      defeat.actions.join(','));
    await page.screenshot({ path: resolve(arenaDir, 'defeat.png') });

    // ---- Rematch after the defeat clears the result and returns to a clean round --------------
    await rematch();
    const afterDefeatRematch = await page.evaluate(() => ({
      match: window.__browserSmashMatch(),
      result: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      menuHidden: Boolean(document.querySelector('#menu')?.classList.contains('hidden')),
      p1: window.fighters[0].identityKey,
      arena: window.__browserSmashMatch().arena,
      victoryPose: window.fighters[0].victoryPose,
      ko: window.fighters[0].ko,
      forceDefeatPose: Boolean(window.fighters[0].forceDefeatPose)
    }));
    check('defeat REMATCH clears the result and starts a clean match', afterDefeatRematch.menuHidden
      && afterDefeatRematch.match.status === 'fighting' && afterDefeatRematch.match.arena === arena
      && afterDefeatRematch.p1 === 'naruto_uzumaki' && afterDefeatRematch.result === ''
      && afterDefeatRematch.victoryPose === 0 && afterDefeatRematch.ko === false
      && afterDefeatRematch.forceDefeatPose === false,
      JSON.stringify(afterDefeatRematch));
    await page.screenshot({ path: resolve(arenaDir, 'rematch.png') });

    const report = {
      arena,
      label: MAPS[arena],
      checks,
      summary: {
        passed: checks.filter(item => item.status === 'passed').length,
        failed: checks.filter(item => item.status === 'failed').length,
        total: checks.length
      },
      start,
      victoryAttempts,
      winFight,
      win,
      afterVictoryRematch,
      defeatAttempts,
      defeatFight,
      defeat,
      afterDefeatRematch,
      pageErrors: pageErrors.slice(),
      consoleErrors: consoleErrors.slice()
    };
    await writeFile(resolve(arenaDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    reports.push(report);
    console.log(`\n${MAPS[arena]}: ${report.summary.passed}/${report.summary.total} checks passed`);
  }

  const total = reports.reduce((sum, report) => sum + report.summary.total, 0);
  const passed = reports.reduce((sum, report) => sum + report.summary.passed, 0);
  console.log(`\nArena match flow: ${passed}/${total} checks passed`);
  await browser.close();
  process.exit(reports.some(report => report.summary.failed > 0) ? 1 : 0);
}

async function readResult(page, label) {
  // matchEndHold hands the frame to the result panel after the victory/defeat presentation.
  await page.evaluate(() => {
    for (let i = 0; i < 700 && !document.querySelector('#result')?.textContent; i += 1) {
      window.__browserSmashStep(1 / 60);
    }
  });
  await page.waitForFunction(() => Boolean(document.querySelector('#bbResultActions')), null, { timeout: 15_000, polling: 100 }).catch(() => {});
  const result = await page.evaluate(() => {
    const node = document.querySelector('#result');
    const text = (node?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      text,
      defeatClass: Boolean(node?.classList.contains('bb-defeat')),
      actions: [...document.querySelectorAll('#bbResultActions [data-result]')].map(button => button.dataset.result),
      stats: {
        dealt: Number((text.match(/DAMAGE DEALT (\d+)%/) || [])[1]),
        hits: Number((text.match(/HITS LANDED (\d+)/) || [])[1]),
        biggest: Number((text.match(/BIGGEST HIT (\d+)%/) || [])[1])
      }
    };
  });
  if (!result.text) throw new Error(`No ${label} result panel was rendered`);
  return result;
}

await main();
