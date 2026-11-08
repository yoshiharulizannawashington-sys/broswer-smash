// Presentation capture.
//   1. Title screen over each arena, with and without the overlay, so the dimming can be judged
//      against the raw canvas instead of guessed at.
//   2. Environment A/B on the frozen title frame - same arena, same camera, same fighters, same
//      pose, only scene.environment/background changes - which is the only honest same-state test.
//   3. The same three modes inside a live match, to prove the toggle works during play.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const ARENA = process.env.ARENA || 'valley';
const root = process.cwd();
const out = 'artifacts/presentation';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForFunction(() => document.querySelector('#bbTitle') && !document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1500);

const log = { arena: ARENA, title: [], ab: [], match: [], errors };
const state = () => page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const renderer = window.__browserSmashRenderer;
  const sun = window.__browserSmashSun;
  const bg = scene?.background;
  return {
    background: bg?.isTexture ? 'texture(' + (bg.image?.width || '?') + 'x' + (bg.image?.height || '?') + ')' : (bg?.getHexString ? '#' + bg.getHexString() : String(bg)),
    environment: scene?.environment?.uuid?.slice(0, 8) || null,
    exposure: renderer?.toneMappingExposure ?? null,
    sun: sun ? { colour: '#' + sun.color.getHexString(), intensity: sun.intensity } : null,
    hemi: window.__browserSmashHemisphere?.intensity ?? null,
    camera: window.smashCamera?.camera?.position.toArray().map(v => +v.toFixed(2)) ?? null,
    fighters: (window.fighters || []).map(f => ({ name: f.name, position: f.position?.toArray?.().map(v => +v.toFixed(2)) })),
    mode: window.__browserSmashEnvironmentModeState || null
  };
});

for (const arena of ['valley', 'asgard']) {
  await page.evaluate(key => {
    const select = document.querySelector('#menuMapSelect');
    if (!select) return;
    select.value = key;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, arena);
  await page.waitForTimeout(2600);
  const withMenu = await state();
  await page.screenshot({ path: `${out}/title-${arena}.png` });
  // Same frame with the overlay removed: the raw canvas the menu sits on.
  await page.evaluate(() => document.querySelector('#menu')?.classList.add('hidden'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/title-${arena}-clean.png` });
  const clean = await state();
  await page.evaluate(() => document.querySelector('#menu')?.classList.remove('hidden'));
  await page.waitForTimeout(300);
  log.title.push({ arena, withMenu, clean });

  // A/B on this frozen frame: nothing moves between shots but the environment source.
  if (arena === ARENA) {
    await page.evaluate(() => document.querySelector('#menu')?.classList.add('hidden'));
    await page.waitForTimeout(400);
    for (const mode of ['procedural', 'hdri', 'hdri-adjusted']) {
      const applied = await page.evaluate(m => window.__browserSmashEnvironmentMode(m), mode);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/ab-${arena}-${mode}.png` });
      log.ab.push({ mode, applied, state: await state() });
    }
    await page.evaluate(() => window.__browserSmashEnvironmentMode('auto'));
    await page.evaluate(() => document.querySelector('#menu')?.classList.remove('hidden'));
  }
}

// Live match: prove the toggle works while playing.
if (process.env.TITLE_ONLY !== '1') {
await page.evaluate(key => {
  const select = document.querySelector('#menuMapSelect');
  if (select) { select.value = key; select.dispatchEvent(new Event('change', { bubbles: true })); }
}, ARENA);
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2000);

for (const mode of ['hdri', 'procedural', 'hdri-adjusted']) {
  const applied = await page.evaluate(m => window.__browserSmashEnvironmentMode(m), mode);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/match-${ARENA}-${mode}.png` });
  log.match.push({ mode, applied, state: await state() });
}

if (ARENA === 'asgard') {
  // Back to the game's own environment before the gameplay close-up, so the shot shows what a
  // player actually gets rather than a developer test mode.
  await page.evaluate(() => window.__browserSmashEnvironmentMode('auto'));
  await page.waitForTimeout(600);
  await page.keyboard.down('w');
  await page.waitForTimeout(2600);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/asgard-stone-walk.png` });
}

}

await writeFile(`${out}/capture-${ARENA}.json`, JSON.stringify(log, null, 2));
console.log('CAPTURE ' + JSON.stringify({
  arena: ARENA,
  title: log.title.map(t => ({ arena: t.arena, menuBg: t.withMenu.background, cleanBg: t.clean.background })),
  ab: log.ab.map(a => ({ mode: a.mode, bg: a.state.background, cam: a.state.camera, pos: a.state.fighters.map(f => f.position) })),
  match: log.match.map(m => ({ mode: m.mode, bg: m.state.background, exp: m.state.exposure })),
  errors
}));
await browser.close(); server.close();
