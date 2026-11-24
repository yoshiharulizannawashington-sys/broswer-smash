// Phase 29.7 — the pull as a watchable sequence, one rendered frame per simulation tick.
//
//   bash scripts/run-browser-test.sh scripts/audit-phase297-sequence.mjs
//
// The live recording in `audit-phase297-video.mjs` is honest but useless to watch: headless software
// WebGL manages about 3 fps, so the .webm is a slideshow. This pass steps the simulation one tick at a
// time, renders each tick through the game's own renderer, and assembles the frames at 30 fps — which
// is the motion the game actually presents on a machine that keeps up, without any invented
// interpolation between the frames.
//
// Sequence window: t = 1.00 s to 1.75 s at 7.8 m, which covers the first follow-up, the reel and the
// second follow-up.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, normalize, sep, extname, join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/dev/phase29');
const seqDir = resolve(root, 'artifacts/dev/phase297/sequence');
await mkdir(outDir, { recursive: true });
await mkdir(seqDir, { recursive: true });

const CONFIGS = { baseline: {}, pull: { 'grab-continuity-pull': true } };
const GAP = 7.8;
const FROM = 1.0;
const TO = 1.75;

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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// The selection UI's ONLINE CHARACTERS button overlaps the play button on a small viewport, which
// makes a plain click time out; render at full size and let ffmpeg downscale the clip.
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e)));
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
    headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) }); }
  catch { await route.fulfill({ status: 404, body: 'missing' }); }
});
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashMatch && window.__browserSmashStep && window.__browserSmashRenderer
  && window.fighters?.length === 2, null, { timeout: 150_000, polling: 200 });
await page.evaluate(() => {
  window.__browserSmashSelect.setMode('2p');
  const cards = [...document.querySelectorAll('#selectScreen .bs-card')];
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[0])?.click();
  (cards.find(c => c.dataset.fighter === 'Wonder Woman') || cards[1])?.click();
});
await page.click('#selectScreen [data-nav="next"]', { force: true });
const arenaCard = await page.$('#selectScreen .bs-arena[data-arena="valley"]')
  || await page.$('#selectScreen .bs-arena[data-arena="tournament"]');
await arenaCard.click({ force: true });
await page.click('#play', { force: true });
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 30_000, polling: 100 });
await page.evaluate(() => {
  const renderer = window.__browserSmashRenderer;
  if (!renderer.__originalRender) renderer.__originalRender = renderer.render;
  renderer.render = () => {};
  window.requestAnimationFrame = () => 0;
  window.__seq = {
    begin(flags, gap) {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.combatPowers.clear('p297seq');
      for (const f of [p1, p2]) {
        f.percent = 0; f.velocity.set(0, 0, 0); f.hitstun = 0; f.casting = null; f.grabbedBy = null;
        f.grabTarget = null; f.ko = false; f.attackQueue.length = 0; f.isGrounded = true; f.meter = 0;
        f.shield = 100; f.guardHeld = false; f.grabBreak = 0; f.grabReel = null;
      }
      p1.position.set(0, p1.groundLevel ?? 0, 0); p1.facing = 1;
      p2.position.set(gap, p2.groundLevel ?? 0, 0); p2.facing = -1;
      const keys = window.__browserSmashInput.keys;
      for (const code of Object.keys(keys)) keys[code] = false;
      window.__browserSmashHitTrace = [];
      window.__browserSmashGrabTrace = [];
      window.__browserSmashExperiments = { ...flags };
      window.__browserSmashStep(1 / 60);
      p2.meter = 100;
      const rec = window.combatPowers.tryUltimate(p2);
      if (!rec || rec.ok === false) return { refused: rec?.reason || 'rejected' };
      this.rec = rec; this.cursor = 0;
      return { ok: true, label: rec.label, events: rec.events.map(e => +e.at.toFixed(3)), total: rec.total };
    },
    tick() {
      const p1 = window.fighters[0], p2 = window.fighters[1];
      window.__browserSmashStep(1 / 60);
      this.cursor++;
      const renderer = window.__browserSmashRenderer;
      renderer.__originalRender.call(renderer, window.__browserSmashScene, window.smashCamera.camera);
      return { t: +(this.cursor / 60).toFixed(2),
        gap: +Math.hypot(p1.position.x - p2.position.x, p1.position.z - p2.position.z).toFixed(2),
        damage: +p1.percent.toFixed(1), reel: p1.grabReel ? +p1.grabReel.travel.toFixed(2) : null,
        casterX: +p2.position.x.toFixed(3), victimX: +p1.position.x.toFixed(3) };
    }
  };
});

const clips = [];
for (const [config, flags] of Object.entries(CONFIGS)) {
  const begin = await page.evaluate(({ flags, gap }) => window.__seq.begin(flags, gap), { flags, gap: GAP });
  if (!begin.ok) { console.log(config + ' refused ' + begin.refused); continue; }
  const startTick = Math.round(FROM * 60), endTick = Math.round(TO * 60);
  const samples = [];
  for (let tick = 1; tick <= endTick; tick++) {
    const state = await page.evaluate(() => window.__seq.tick());
    if (tick < startTick) continue;
    const file = config + '-t' + state.t.toFixed(2) + '.png';
    await page.screenshot({ path: resolve(seqDir, file) });
    samples.push({ ...state, file });
  }
  clips.push({ config, label: begin.label, events: begin.events, from: FROM, to: TO, samples });
  console.log(config.padEnd(9) + 'frames ' + samples.length + ' damage ' + samples.at(-1)?.damage
    + ' gap ' + samples.map(s => s.gap).join('>'));
}

// Assemble each clip at 30 fps (every other tick) so it plays at the game's presentation rate.
const clipsJson = [];
for (const clip of clips) {
  const out = resolve(root, 'artifacts/dev/phase297/pull-' + clip.config + '.mp4');
  let encoded = null;
  if (ffmpeg) {
    encoded = await new Promise(done => {
      const proc = spawn(ffmpeg, ['-y', '-framerate', '30', '-pattern_type', 'glob',
        '-i', join(seqDir, clip.config + '-*.png'), '-vf', 'scale=480:-2', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', out], { stdio: 'ignore' });
      proc.on('close', code => done(code === 0)); proc.on('error', () => done(false));
    });
  }
  let bytes = null;
  try { bytes = (await stat(out)).size; } catch {}
  clipsJson.push({ ...clip, video: encoded ? out : null, bytes });
  console.log('clip ' + clip.config + ' encoded=' + encoded + ' bytes=' + bytes);
}

await writeFile(resolve(outDir, 'grab-pull-sequence.json'), JSON.stringify({
  kind: 'grab-pull-sequence', generatedAt: new Date().toISOString(),
  note: 'one rendered frame per 1/60 s tick, assembled at 30 fps; no interpolated frames',
  gap: GAP, ffmpeg: ffmpeg || null, clips: clipsJson, pageErrors }, null, 2));
console.log('clips ' + clipsJson.length + ' page errors ' + pageErrors.length);
await browser.close();
await new Promise(done => server.close(done));
