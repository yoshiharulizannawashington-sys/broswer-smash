// Phase 29.7 — the same chain recorded at normal gameplay speed, as video.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase297-video.mjs
//
// The stills in Phase 29.6 could show positions but not motion, so the sequence is also recorded from
// the live loop with no stepping and no pause: what is in the .webm is what a player would be shown.
// Playwright bundles its own ffmpeg for encoding, and the script also cuts evenly spaced frames out of
// each recording so the sequence can be inspected without a video player.
//
// Honest limits, reported in the JSON: this is a software WebGL renderer running headless, so the
// recording's frame rate is whatever the renderer actually managed, not 60 fps.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, normalize, sep, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const videoDir = resolve(root, 'artifacts/dev/phase297/video');
const frameDir = resolve(root, 'artifacts/dev/phase297/video-frames');
await mkdir(outDir, { recursive: true });
await mkdir(videoDir, { recursive: true });
await mkdir(frameDir, { recursive: true });

const CONFIGS = {
  baseline: {},
  both: { 'grab-continuity': true },
  pull: { 'grab-continuity-pull': true }
};
const WATCH_MS = 3800;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

/** Playwright ships an ffmpeg build for video encoding; find it instead of assuming a system one. */
async function findFfmpeg() {
  const roots = [join(homedir(), '.cache', 'ms-playwright'), join(root, 'node_modules', 'playwright-core', '.local-browsers')];
  for (const base of roots) {
    let entries = [];
    try { entries = await readdir(base); } catch { continue; }
    for (const entry of entries) {
      const candidate = join(base, entry);
      let info; try { info = await stat(candidate); } catch { continue; }
      if (info.isFile() && /^ffmpeg/.test(entry)) return candidate;
      if (info.isDirectory()) {
        let children = [];
        try { children = await readdir(candidate); } catch { continue; }
        for (const child of children) if (/^ffmpeg/.test(child)) return join(candidate, child);
      }
    }
  }
  return null;
}
const ffmpeg = await findFfmpeg();
console.log('ffmpeg ' + (ffmpeg || 'not found (videos kept, frames skipped)'));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const recordings = [];
const pageErrors = [];

for (const [config, flags] of Object.entries(CONFIGS)) {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 },
    recordVideo: { dir: videoDir, size: { width: 900, height: 560 } } });
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => pageErrors.push(config + ': ' + String(e.message || e)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashMatch && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
  await page.evaluate(() => {
    window.__browserSmashSelect.setMode('2p');
    const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
    (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
  });
  await page.click('#selectScreen [data-nav="next"]');
  const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
    || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
  await arenaCard.click();
  await page.click('#play');
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });

  const setup = await page.evaluate(({ flags }) => {
    const p1 = window.fighters[0], p2 = window.fighters[1];
    for (const f of [p1, p2]) {
      f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.casting = null; f.ko = false;
      f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0; f.shield = 100;
    }
    p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
    p2.position.set(7.8, p2.groundLevel ?? 0, 0); p2.facing = -1;
    window.__browserSmashExperiments = { ...flags };
    window.__browserSmashHitTrace = [];
    window.__browserSmashGrabTrace = [];
    p2.meter = 100;
    const rec = window.combatPowers.tryUltimate(p2);
    window.__watch = { start: performance.now(), frames0: window.__browserSmashFrames || 0, label: rec?.label };
    return { ok: !!rec && rec.ok !== false, label: rec?.label, total: rec?.total };
  }, { flags });

  await page.waitForTimeout(WATCH_MS);
  const watched = await page.evaluate(() => {
    const w = window.__watch || {};
    const seconds = (performance.now() - (w.start || 0)) / 1000;
    return { seconds: +seconds.toFixed(2),
      fps: +(((window.__browserSmashFrames || 0) - (w.frames0 || 0)) / Math.max(.001, seconds)).toFixed(1),
      damage: +window.fighters[0].percent.toFixed(1),
      gap: +Math.hypot(window.fighters[0].position.x - window.fighters[1].position.x,
        window.fighters[0].position.z - window.fighters[1].position.z).toFixed(2),
      outcomes: (window.__browserSmashGrabTrace || []).map(g => g.outcome) };
  });

  const video = page.video();
  await page.close();
  await context.close();
  const path = await video.path();
  recordings.push({ config, flags, setup, watched, video: path });
  console.log(config.padEnd(9) + 'label=' + setup.label + ' fps=' + watched.fps + ' damage=' + watched.damage
    + ' gap=' + watched.gap + ' outcomes=' + JSON.stringify(watched.outcomes));

  if (ffmpeg) {
    const stem = join(frameDir, config);
    await new Promise(done => {
      const proc = spawn(ffmpeg, ['-y', '-i', path, '-vf', 'fps=12', stem + '-%02d.png'],
        { stdio: 'ignore' });
      proc.on('close', done); proc.on('error', done);
    });
    let cut = 0;
    try { cut = (await readdir(frameDir)).filter(n => n.startsWith(config + '-')).length; } catch {}
    recordings[recordings.length - 1].frames = cut;
    console.log(config.padEnd(9) + 'frames ' + cut);
  }
}

await writeFile(resolve(outDir, 'grab-pull-video.json'), JSON.stringify({
  kind: 'grab-pull-video', generatedAt: new Date().toISOString(),
  method: 'live loop, no pause, no stepping; Playwright recordVideo; frames cut at 12 fps',
  note: 'headless software WebGL: the recording frame rate is what the renderer managed, not 60',
  ffmpeg: ffmpeg || null, recordings, pageErrors }, null, 2));
console.log('recordings ' + recordings.length + ' page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
