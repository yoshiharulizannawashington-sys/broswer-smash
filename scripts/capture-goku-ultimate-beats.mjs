// Goku's ultimate, captured as separate beats instead of one ambiguous frame.
//
// The old evidence set labelled the clash beat as the intro because a page screenshot is taken a few
// hundred milliseconds after the state you read: on a software renderer the cast has already advanced
// by the time the PNG lands. This harness therefore steps the simulation and grabs the canvas inside
// the same page evaluation, at the first tick of each phase, and records the observed phase, time and
// cinematic state beside every file. No phase name is assumed.
//
//   bash scripts/run-browser-test.sh scripts/capture-goku-ultimate-beats.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/goku-ultimate-beats';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.waitForTimeout(500);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Goku');
  window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashTrainingDummy = true; });

// Pre-cast frame, from the real rendering path.
await page.screenshot({ path: `${out}/0-before.png` });

// One evaluation owns the whole cast: fill the meter through the game's own value (staging, not
// damage), trigger with the real key, then step 1/60 s at a time and grab the canvas at the first
// tick of every new phase. The key event is the game's own input path.
const shots = await page.evaluate(async () => {
  const mod = await import('/js/combat/ultimate.js');
  const fighter = window.fighters[0];
  const canvas = document.querySelector('canvas');
  const state = () => {
    const record = mod.activeUltimate?.(fighter) || null;
    const shot = (() => { try { return window.smashCamera?.describeCineShot?.() || null; } catch { return null; } })();
    return {
      record,
      phase: record?.phase ?? (record ? 'active' : 'none'),
      t: record ? +Number(record.t || 0).toFixed(3) : null,
      id: record?.id ?? null,
      cine: Boolean(shot?.active),
      shot: shot || null,
      casting: fighter.casting ?? null
    };
  };
  const grab = () => {
    try { return canvas.toDataURL('image/png'); } catch { return null; }
  };
  fighter.meter = 100;
  const frames = [];
  const before = state();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO', key: 'o', bubbles: true }));
  let last = before.phase;
  for (let i = 0; i < 300; i += 1) {
    window.__browserSmashStep(1 / 60);
    const now = state();
    if (now.phase !== last) {
      last = now.phase;
      frames.push({ ...now, record: now.record ? { id: now.record.id, phase: now.record.phase, t: +Number(now.record.t || 0).toFixed(3) } : null, url: grab() });
      if (frames.length >= 5) break;
    }
  }
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO', key: 'o', bubbles: true }));
  return { before, frames, after: state() };
});

const beats = [];
const fs = await import('node:fs/promises');
for (const [index, frame] of shots.frames.entries()) {
  const label = String(frame.phase).replace(/[^a-z0-9_-]+/gi, '-');
  const file = `${index + 1}-${label}.png`;
  if (frame.url && frame.url.length > 5000) {
    await fs.writeFile(resolve(root, out, file), Buffer.from(frame.url.split(',')[1], 'base64'));
    beats.push({ file, phase: frame.phase, t: frame.t, id: frame.id, cine: frame.cine, casting: frame.casting, shot: frame.shot });
    console.log('BEAT', file, JSON.stringify({ phase: frame.phase, t: frame.t, cine: frame.cine, casting: frame.casting }));
  } else {
    console.log('BEAT_MISSING', file, 'canvas grab empty');
  }
}
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/9-after.png` });

const report = {
  before: shots.before,
  beats,
  after: shots.after,
  distinctPhases: [...new Set(beats.map(b => b.phase))],
  errors
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('ULTIMATE_BEATS ' + JSON.stringify({
  count: beats.length,
  files: beats.map(b => b.file),
  phases: report.distinctPhases,
  phasesWithTimes: beats.map(b => `${b.phase}@${b.t}`),
  returned: !shots.after.record && !shots.after.cine,
  errors: errors.length
}));

await browser.close();
server.close();
