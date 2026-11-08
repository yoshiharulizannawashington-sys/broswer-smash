// Browser-level verification for the engine gameplay API.
//
// This test never clicks a hidden gameplay control. It selects fighters and arenas, starts a real
// match, plays a real round to a result, rematches, trains, explores and returns to the title
// through window.BrowserSmash, while the legacy controls remain available for older callers.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, condition, detail = '') => {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks.push(name);
  console.log(`  ok  ${name}`);
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.BrowserSmash && window.__browserSmashMatch && window.__browserSmashStep
    && window.fighters?.length === 2, null, { timeout: 120_000, polling: 200 });
  await page.waitForTimeout(400);

  const surface = await page.evaluate(() => {
    const api = window.BrowserSmash;
    return ['getArena', 'setArena', 'startMatch', 'startTraining', 'startExplore', 'rematch',
      'returnToTitle', 'selectFighter', 'getFighter', 'onResult', 'setCameraZoom', 'getCameraZoom',
      'setCameraMode', 'getCameraMode', 'setGraphicsPreset']
      .map(name => [name, typeof api[name]]);
  });
  check('the gameplay API is exposed with every requested method', surface.every(([, kind]) => kind === 'function'), JSON.stringify(surface));

  // Arena ownership.
  const arena = await page.evaluate(() => {
    const api = window.BrowserSmash;
    const before = api.getArena();
    const changed = api.setArena('tournament');
    const invalid = api.setArena('not-a-real-arena');
    return {
      before, changed, invalid, after: api.getArena(),
      hidden: document.querySelector('#mapSelect')?.value,
      menu: document.querySelector('#menuMapSelect')?.value,
      state: window.__browserSmashSelect?.state?.arena
    };
  });
  check('setArena changes the authoritative arena', arena.changed === true && arena.after === 'tournament', JSON.stringify(arena));
  check('arena selection reaches the live map and both legacy controls', arena.hidden === 'tournament' && arena.menu === 'tournament' && arena.state === 'tournament', JSON.stringify(arena));
  check('an unknown arena is refused without changing state', arena.invalid === false && arena.after === 'tournament', JSON.stringify(arena));

  // Fighter ownership.
  const fighters = await page.evaluate(() => {
    const api = window.BrowserSmash;
    const p1 = api.selectFighter('p1', 'Goku');
    const cpu = api.selectFighter('cpu', 'Vegeta');
    const invalid = api.selectFighter('p1', 'Not A Fighter');
    return {
      p1, cpu, invalid,
      identities: window.fighters.map(f => f.identity),
      hidden: [document.querySelector('#p1Character')?.value, document.querySelector('#cpuCharacter')?.value],
      state: [window.__browserSmashSelect?.state?.p1, window.__browserSmashSelect?.state?.p2],
      readback: [api.getFighter('p1'), api.getFighter('cpu')]
    };
  });
  check('selectFighter validates and selects P1', fighters.p1?.name === 'Goku' && fighters.p1?.identity === 'Goku', JSON.stringify(fighters.p1));
  check('selectFighter validates and selects the CPU', fighters.cpu?.name === 'Vegeta' && fighters.cpu?.identity === 'Vegeta', JSON.stringify(fighters.cpu));
  check('an unknown fighter is refused without changing state', fighters.invalid === null && fighters.readback[0].identity === 'Goku', JSON.stringify(fighters.invalid));
  check('fighter selection reaches the live models and legacy selects', fighters.identities.join('|') === 'Goku|Vegeta' && fighters.hidden.join('|') === 'Goku|Vegeta', JSON.stringify(fighters.hidden));
  check('getFighter returns the selected fighter state', fighters.readback[0].side === 'p1' && fighters.readback[1].side === 'cpu', JSON.stringify(fighters.readback));

  // Settings ownership.
  const settings = await page.evaluate(() => {
    const api = window.BrowserSmash;
    const zoom = api.setCameraZoom(1.25);
    const mode = api.setCameraMode('third-person');
    return {
      zoom, readZoom: api.getCameraZoom(), zoomInput: document.querySelector('#cameraZoom')?.value,
      mode, readMode: api.getCameraMode(), modeInput: document.querySelector('#cameraMode')?.value,
      preset: typeof window.setGraphicsPreset === 'function'
    };
  });
  check('camera zoom API drives the live camera and legacy input', Math.abs(settings.readZoom - 1.25) < 0.001 && settings.zoomInput === String(settings.zoom), JSON.stringify(settings));
  check('camera mode API drives the live camera and legacy input', settings.readMode === 'third-person' && settings.modeInput === 'third-person', JSON.stringify(settings));
  check('graphics preset API remains available', settings.preset === true);

  // Start a real match through the API, not through #play.
  await page.evaluate(() => {
    window.BrowserSmash.setCameraMode('overhead');
    window.BrowserSmash.setCameraZoom(1);
    window.__apiResult = null;
    window.__apiOff = window.BrowserSmash.onResult(result => { window.__apiResult = result; });
  });
  const start = await page.evaluate(() => {
    const ok = window.BrowserSmash.startMatch();
    window.__browserSmashStep(0.08);
    return {
      ok, menuHidden: document.querySelector('#menu')?.classList.contains('hidden'),
      match: window.__browserSmashMatch(), fighters: window.fighters.map(f => ({ identity: f.identity, percent: f.percent }))
    };
  });
  check('startMatch starts a real match without a synthetic click', start.ok === true && start.match.status === 'fighting' && start.match.arena === 'tournament' && start.match.timer > 0, JSON.stringify(start.match));
  check('the menu is gone and the selected fighters are fighting', start.menuHidden === true && start.fighters.map(f => f.identity).join('|') === 'Goku|Vegeta', JSON.stringify(start.fighters));

  // Play the match with real keyboard input until the engine presents a result.
  const round = await page.evaluate(() => {
    const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const held = new Set();
    const hold = code => { if (!held.has(code)) { held.add(code); fire('keydown', code); } };
    const release = code => { if (held.delete(code)) fire('keyup', code); };
    const tap = code => { fire('keydown', code); fire('keyup', code); };
    let ended = false;
    for (let i = 0; i < 900; i += 1) {
      if (i % 10 < 6) { hold('KeyS'); release('KeyW'); } else { hold('KeyW'); release('KeyS'); }
      if (i % 5 === 0) tap('ShiftLeft');
      if (i % 8 === 0) tap('KeyK');
      if (i % 3 === 0) tap('KeyJ');
      if (i % 30 === 0 && (window.fighters[0].meter || 0) >= 100) tap('KeyO');
      window.__browserSmashStep(0.1);
      const menu = document.querySelector('#menu');
      const text = document.querySelector('#result')?.textContent || '';
      if (menu && !menu.classList.contains('hidden') && /VICTORY|DEFEAT|DRAW/i.test(text)) { ended = true; break; }
    }
    ['KeyE', 'KeyS', 'KeyW'].forEach(release);
    return {
      ended,
      state: window.__browserSmashVictoryState?.(),
      result: window.__apiResult,
      text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
      menuHidden: document.querySelector('#menu')?.classList.contains('hidden')
    };
  });
  check('real gameplay produces a match result', round.ended === true && round.menuHidden === false, JSON.stringify({ ended: round.ended, menuHidden: round.menuHidden, p1: round.state?.trace?.length }));
  check('the result is delivered through the API callback', Boolean(round.result) && /VICTORY|DEFEAT|DRAW/.test(round.result.text), JSON.stringify(round.result && { text: round.result.text, winner: round.result.winner }));
  check('the results screen is still rendered for the player', /VICTORY|DEFEAT|DRAW/i.test(round.text), round.text.slice(0, 100));

  // Rematch through the API after the result.
  const rematch = await page.evaluate(() => {
    const ok = window.BrowserSmash.rematch();
    window.__browserSmashStep(0.08);
    return { ok, menuHidden: document.querySelector('#menu')?.classList.contains('hidden'), match: window.__browserSmashMatch() };
  });
  check('rematch starts a fresh live match', rematch.ok === true && rematch.match.status === 'fighting' && rematch.match.arena === 'tournament' && rematch.match.timer > 0, JSON.stringify(rematch.match));
  check('rematch clears the result screen', rematch.menuHidden === true, JSON.stringify(rematch));

  // Training and exploration lifecycle.
  const training = await page.evaluate(() => {
    window.BrowserSmash.returnToTitle();
    const title = { menu: document.querySelector('#menu')?.className, hidden: document.querySelector('#menu')?.classList.contains('hidden') };
    const ok = window.BrowserSmash.startTraining();
    window.__browserSmashStep(0.08);
    return { title, ok, match: window.__browserSmashMatch(), status: document.querySelector('#status')?.textContent };
  });
  check('returnToTitle restores the title state', /bb-title/.test(training.title.menu || '') && training.title.hidden === false, JSON.stringify(training.title));
  check('startTraining starts a live training session', training.ok === true && training.match.status === 'fighting' && /PRACTICE|TRAINING/i.test(training.status || ''), JSON.stringify({ status: training.status, match: training.match }));

  const explore = await page.evaluate(() => {
    window.BrowserSmash.returnToTitle();
    const ok = window.BrowserSmash.startExplore();
    return { ok, state: window.__browserSmashExploreState?.(), titleHidden: document.querySelector('#menu')?.classList.contains('hidden') };
  });
  check('startExplore starts a real exploration session', explore.ok === true && explore.state?.exploring === true && explore.titleHidden === true, JSON.stringify(explore));

  const left = await page.evaluate(() => {
    const ok = window.BrowserSmash.returnToTitle();
    return { ok, state: window.__browserSmashExploreState?.(), menu: document.querySelector('#menu')?.className };
  });
  check('returnToTitle leaves exploration and restores the title', left.ok === true && left.state?.exploring === false && /bb-title/.test(left.menu || ''), JSON.stringify(left));

  // Tournament opponent selection still uses the engine and the real bracket.
  const tournament = await page.evaluate(() => {
    window.__browserSmashTournamentStart?.();
    const pending = window.__browserSmashTournament?.()?.pending;
    const ok = window.__browserSmashTournamentFight?.();
    return {
      pending, ok, cpu: window.BrowserSmash.getFighter('cpu'),
      match: window.__browserSmashMatch()
    };
  });
  check('a tournament match uses the bracket opponent', Boolean(tournament.pending) && tournament.cpu?.identity === tournament.pending.opponent && tournament.match.status === 'fighting',
    JSON.stringify({ pending: tournament.pending && { opponent: tournament.pending.opponent }, cpu: tournament.cpu?.identity, started: tournament.match?.started }));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\nGameplay API verified (${checks.length} checks).`);
} finally {
  if (browser) await browser.close();
  server.close();
}
