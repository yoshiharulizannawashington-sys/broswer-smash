// Tournament + AI probe: proves the mode works in a real browser, not just in unit tests.
//
//   bash scripts/run-browser-test.sh scripts/probe-tournament.mjs
//
// What it checks:
//   * starting a tournament shows the bracket with a named opponent;
//   * FIGHT actually starts a match against that opponent (CPU selector + live simulation);
//   * the CPU fights on its own with a real personality (it deals damage without any scripted input);
//   * a reported result advances the bracket, and three wins produce a champion;
//   * no page errors.
//
// Match results are injected as the same 'browsersmash:matchend' event the game itself emits. That
// is deliberate: it tests the wiring between match end and bracket, not the ability to win a fight
// in software rendering, which would take minutes at 1-4 fps.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const artifacts = resolve(root, 'artifacts', 'p72');
await mkdir(artifacts, { recursive: true });
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
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const results = [];
const fail = message => { results.push({ ok: false, message }); console.log('  FAIL ' + message); };
const pass = message => { results.push({ ok: true, message }); console.log('  ok   ' + message); };

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.fighters?.length === 2, null, { timeout: 180_000, polling: 250 });

  // ---- start the tournament ------------------------------------------------
  const opened = await page.evaluate(() => {
    const state = window.__browserSmashTournamentStart?.();
    const panel = document.querySelector('#tournamentPanel');
    return {
      state,
      visible: Boolean(panel) && panel.hidden === false,
      hasFightButton: Boolean(panel?.querySelector('[data-act="start"]')),
      panelText: panel?.textContent?.slice(0, 200) || ''
    };
  });
  if (opened.state?.pending) pass(`bracket opened: ${opened.state.pending.player} vs ${opened.state.pending.opponent} (${opened.state.pending.roundName})`);
  else fail('starting a tournament did not produce a pending match');
  opened.visible ? pass('the tournament panel is visible') : fail('the tournament panel stayed hidden');
  opened.hasFightButton ? pass('the panel offers a FIGHT action') : fail('no FIGHT button in the panel');

  // ---- FIGHT must start a real match against the named opponent -----------
  const started = await page.evaluate(async () => {
    const before = window.__browserSmashTournament();
    document.querySelector('#tournamentPanel [data-act="start"]')?.click();
    await new Promise(done => setTimeout(done, 2500));
    return {
      opponent: before?.pending?.opponent || null,
      cpuIdentity: window.fighters?.[1]?.identity || null,
      matchRunning: typeof window.__browserSmashMatch === 'function',
      menuHidden: document.querySelector('#menu')?.classList.contains('hidden') || false,
      persona: window.__browserSmashCpuPersona?.() || null
    };
  });
  started.opponent && started.cpuIdentity === started.opponent
    ? pass(`FIGHT put ${started.opponent} in the CPU slot`)
    : fail(`FIGHT did not select the bracket opponent (wanted ${started.opponent}, got ${started.cpuIdentity})`);
  started.menuHidden ? pass('the match left the menu and entered play') : fail('the match did not start');
  if (started.persona?.id) pass(`CPU personality resolved: ${started.persona.label} (${started.persona.source})`);
  else fail('the CPU has no personality');

  // ---- the CPU must actually fight ---------------------------------------
  const engagement = await page.evaluate(async () => {
    let maxPlayerDamage = 0, cpuAttackFrames = 0, samples = 0;
    const startedAt = performance.now();
    while (performance.now() - startedAt < 12000) {
      const player = window.fighters?.[0];
      const cpu = window.fighters?.[1];
      maxPlayerDamage = Math.max(maxPlayerDamage, player?.percent || 0);
      if (cpu?.attackQueue?.length || cpu?.attacking) cpuAttackFrames++;
      samples++;
      await new Promise(done => setTimeout(done, 250));
    }
    return { maxPlayerDamage: Math.round(maxPlayerDamage), cpuAttackFrames, samples };
  });
  engagement.maxPlayerDamage > 0
    ? pass(`the CPU dealt damage on its own (${engagement.maxPlayerDamage}% on the player)`)
    : fail('the CPU never damaged the player during 12 s of live play');
  engagement.cpuAttackFrames > 0
    ? pass(`the CPU entered attack states (${engagement.cpuAttackFrames} of ${engagement.samples} samples)`)
    : fail('the CPU never attacked');

  // ---- result → bracket advancement --------------------------------------
  const advance = await page.evaluate(async () => {
    const report = text => window.dispatchEvent(new CustomEvent('browsersmash:matchend', { detail: { text, winner: 'p1' } }));
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      report('VICTORY · TEST');
      await new Promise(done => setTimeout(done, 300));
      const state = window.__browserSmashTournament();
      rounds.push({
        round: state?.round,
        pending: state?.pending ? `${state.pending.roundName}: ${state.pending.opponent}` : null,
        champion: state?.champion,
        complete: state?.complete
      });
      if (state?.pending) {
        document.querySelector('#tournamentPanel [data-act="start"]')?.click();
        await new Promise(done => setTimeout(done, 1200));
      }
    }
    return { rounds, panelText: document.querySelector('#tournamentPanel')?.textContent || '' };
  });
  const rounds = advance.rounds;
  rounds[0]?.round === 1 ? pass('a win advanced the bracket to round 2') : fail(`round did not advance (${rounds[0]?.round})`);
  rounds[1]?.round === 2 ? pass('the second win reached the final') : fail(`second win did not reach the final (${rounds[1]?.round})`);
  rounds[2]?.complete ? pass('the third win completed the tournament') : fail('the tournament did not complete');
  advance.panelText.includes('TOURNAMENT VICTORY')
    ? pass('the panel shows the tournament victory screen')
    : fail('the victory screen was not shown: ' + advance.panelText.slice(0, 120));

  // A loss must end the run rather than quietly continuing.
  const lossRun = await page.evaluate(async () => {
    window.__browserSmashTournamentStart();
    await new Promise(done => setTimeout(done, 200));
    const before = window.__browserSmashTournament();
    window.dispatchEvent(new CustomEvent('browsersmash:matchend', { detail: { text: 'DEFEAT · TEST', winner: 'p2' } }));
    await new Promise(done => setTimeout(done, 200));
    return { before, after: window.__browserSmashTournament() };
  });
  lossRun.after?.eliminatedBy
    ? pass(`a loss eliminated the player (${lossRun.after.eliminatedBy}) and crowned ${lossRun.after.champion}`)
    : fail('a loss did not end the tournament run');

  await page.screenshot({ path: resolve(artifacts, 'p18-tournament.png') });
  errors.length ? fail('page errors: ' + errors.slice(0, 3).join(' | ')) : pass('no page errors');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

const failed = results.filter(result => !result.ok).length;
console.log(`\nTournament probe: ${results.length - failed}/${results.length} checks passed.`);
if (failed) process.exitCode = 1;
