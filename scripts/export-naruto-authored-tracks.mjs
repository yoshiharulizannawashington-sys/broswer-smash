// Dump the compiled Naruto attack/form clips to JSON so Blender can bake them into a GLB.
//
//   bash scripts/run-browser-test.sh scripts/export-naruto-authored-tracks.mjs
//
// The runtime already compiles the authored keyframes against Naruto's Rigify rig. That compiled
// result is the source of truth: exporting it (instead of re-authoring the same motion in Python)
// means the baked GLB cannot drift from the poses the game has verified.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = 'artifacts/naruto-authored';
await mkdir(outDir, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 400)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());

  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    ready = await page.evaluate(() => {
      const u = window.fighters?.[0]?.model?.userData;
      return !!u?.authoredBindDiag?.bound && Object.keys(u?.authoredFormActions || {}).length === 5;
    });
    if (!ready) await page.waitForTimeout(250);
  }
  if (!ready) throw new Error('Naruto authored clips never bound');

  const data = await page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const serial = (action) => {
      const clip = action.getClip();
      return {
        name: clip.name,
        duration: clip.duration,
        tracks: clip.tracks.map(track => ({
          name: track.name,
          type: track.constructor.name,
          times: Array.from(track.times),
          values: Array.from(track.values)
        }))
      };
    };
    return {
      identity: f.identityKey,
      rig: u.authoredBindDiag?.rig || null,
      strikes: Object.entries(u.authoredAbilityActions || {}).map(([slot, action]) => ({ slot, clip: serial(action) })),
      forms: Object.entries(u.authoredFormActions || {}).map(([form, action]) => ({ form, clip: serial(action) })),
      diag: u.authoredBindDiag || null,
      errors: []
    };
  });

  if (errors.length) data.errors = errors;
  const file = resolve(root, outDir, 'tracks.json');
  await writeFile(file, JSON.stringify(data, null, 2));
  console.log(`identity ${data.identity}`);
  console.log(`rig ${JSON.stringify(data.rig)}`);
  console.log(`strikes ${data.strikes.length}: ${data.strikes.map(s => s.clip.name).join(', ')}`);
  console.log(`forms ${data.forms.length}: ${data.forms.map(s => `${s.form}=${s.clip.name}`).join(', ')}`);
  console.log(`bones per clip ${Math.min(...data.strikes.map(s => new Set(s.clip.tracks.map(t => t.name)).size))}..${Math.max(...data.strikes.map(s => new Set(s.clip.tracks.map(t => t.name)).size))}`);
  console.log(`wrote ${file}`);
  if (data.errors.length) {
    console.error('PAGE ERRORS ' + JSON.stringify(data.errors));
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.close();
}
