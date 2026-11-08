// Arena-switch regression gate.
//
// Every in-game arena switch goes through window.__browserSmashApplyMap, which now records one fresh
// state object per switch. This gate fails if any supported switch records an error, proves a
// deliberately injected failure IS detected (so the gate cannot pass by ignoring errors), and proves
// a later successful switch is not reported as failed because of that earlier failure.
//
//   bash scripts/run-browser-test.sh scripts/test-arena-switch.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/arena-switch';
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

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

// Static proof that no switch can bypass the guard: applyMap may appear only inside the wrapper.
const mainSource = (await readFile('public/js/main.js', 'utf8')).replace(/\/\/[^\n]*/g, '');
const occurrences = [...mainSource.matchAll(/applyMap\(/g)].length;
check('applyMap is declared once and called once (inside the guarded wrapper)',
  occurrences === 2 && mainSource.includes('function applyMap(key){'), `found ${occurrences} occurrences`);

const ARENAS = ['valley', 'finalvalley', 'asgard', 'hogwarts', 'deathstar', 'tournament', 'starktower'];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(150000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  const hookReady = await page.evaluate(() => typeof window.__browserSmashApplyMap === 'function' && Boolean(window.__browserSmashApplyMapState) && typeof window.__browserSmashFloorState === 'function');
  check('the guarded wrapper and its state hooks are installed', hookReady, String(hookReady));

  // ---------------------------------------------------------------- successful switches
  const results = [];
  for (const key of ARENAS) {
    const state = await page.evaluate(k => {
      window.__browserSmashApplyMap(k);
      return { ...window.__browserSmashApplyMapState, floor: window.__browserSmashFloorState() };
    }, key);
    results.push(state);
    check(`switch to ${key} completes with no recorded error`,
      state.ok === true && state.key === key && state.error === null,
      `ok=${state.ok} key=${state.key} error=${state.error ?? 'none'}`);
    check(`${key} reports its own floor material`, Boolean(state.floor?.uuid) && state.floor.key === key, JSON.stringify(state.floor));
  }
  const seqs = results.map(r => r.seq);
  check('each switch advances its own sequence number', seqs.every((n, i) => i === 0 || n === seqs[i - 1] + 1), seqs.join(','));

  // ---------------------------------------------------------------- intentional failure
  const injected = await page.evaluate(() => {
    window.__injectedSkyOriginal = window.__browserSmashApplySky;
    window.__browserSmashApplySky = () => { throw new Error('injected sky failure'); };
    window.__browserSmashApplyMap('deathstar');
    const failed = { ...window.__browserSmashApplyMapState, legacy: window.__browserSmashApplyMapError };
    window.__browserSmashApplySky = window.__injectedSkyOriginal;
    delete window.__injectedSkyOriginal;
    window.__browserSmashApplyMap('deathstar');
    return { failed, recovered: { ...window.__browserSmashApplyMapState }, history: window.__browserSmashApplyMapHistory.slice(-4) };
  });
  const failed = injected.failed;
  check('an injected arena-switch failure is recorded as a failure',
    failed.ok === false && failed.key === 'deathstar' && /injected sky failure/.test(String(failed.error)),
    JSON.stringify(failed));
  check('the failure carries arena context for diagnosis',
    String(failed.context || '').includes('deathstar') && String(failed.context || '').includes('injected sky failure'),
    String(failed.context));
  check('the legacy error hook still reports the failure', /injected sky failure/.test(String(failed.legacy)), String(failed.legacy));
  check('the failure is preserved in the switch history',
    injected.history.some(entry => entry.ok === false && /injected sky failure/.test(String(entry.error))),
    JSON.stringify(injected.history.map(e => ({ key: e.key, ok: e.ok, error: e.error }))));
  check('a later successful switch is NOT reported as failed by the earlier error',
    injected.recovered.ok === true && injected.recovered.error === null && injected.recovered.key === 'deathstar',
    JSON.stringify(injected.recovered));

  // ---------------------------------------------------------------- no compounding on repeat switches
  const repeats = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__browserSmashApplyMap('valley'));
    repeats.push(await page.evaluate(() => { window.__browserSmashApplyMap('deathstar'); return window.__browserSmashFloorState(); }));
  }
  const floorIds = new Set(repeats.map(r => r.uuid));
  const floorColors = new Set(repeats.map(r => r.color));
  check('repeated Death Star switches reuse one floor material (no compounding)',
    floorIds.size === 1 && floorColors.size === 1, JSON.stringify(repeats.map(r => `${r.uuid}/${r.color}`)));
  const hogwartsFloor = await page.evaluate(() => { window.__browserSmashApplyMap('hogwarts'); return window.__browserSmashFloorState(); });
  check('other arenas keep their own floor material',
    hogwartsFloor.uuid !== repeats[0].uuid, `hogwarts=${hogwartsFloor.uuid} deathstar=${repeats[0].uuid}`);

  const unexpected = pageErrors.filter(message => !/injected sky failure/.test(message));
  check('no uncaught page errors during the sweep', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
  await page.screenshot({ path: `${out}/after-arena-sweep.png` });
  await writeFile(`${out}/report.json`, JSON.stringify({ results, injected, repeats, hogwartsFloor, pageErrors }, null, 2));
} finally {
  await browser?.close();
  server.close();
}
console.log(failures === 0 ? '\nArena-switch gate passed.' : `\nArena-switch gate FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
