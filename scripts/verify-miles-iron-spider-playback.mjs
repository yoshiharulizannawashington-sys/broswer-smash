// Live proof that the appended Iron Spider clip actually poses Miles's own skeleton.
// The game is paused after mount so the selected clip cannot be overwritten by the state machine.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/miles/iron-spider-animation-merge/live';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const check = (name, ok, detail = null) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + JSON.stringify(detail) : ''}`);
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));
page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 160)); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.characterModels?.spider_man?.status === 'loaded', null, { timeout: 120000, polling: 300 });
await page.waitForTimeout(1000);

const mounted = await page.evaluate(() => {
  const p1 = window.fighters[0];
  const u = p1.model.userData;
  return {
    asset: u.characterAssetUrl || null,
    boneCount: (() => { let n = 0; p1.model.traverse(o => { if (o.isBone) n += 1; }); return n; })(),
    actionCount: Object.keys(u.animationActions || {}).length,
    originalActions: ['fearlessflight_male_idle', 'jab', 'heavy_punch', 'walk', 'victory'].filter(key => Boolean(u.animationActions?.[key])),
    newActionKeys: Object.keys(u.animationActions || {}).filter(key => key.startsWith('ironspider__')).length,
    mixer: Boolean(u.humanMixer),
  };
});
check('the live body is the merged Miles GLB', /miles_morales_animated\.glb/.test(mounted.asset || '') && mounted.boneCount === 178, mounted);
check('the original Miles actions are still loaded', mounted.originalActions.length === 5 && mounted.mixer, mounted);
// 57 clips are appended. The zero-duration `collection` pose is intentionally skipped by the
// existing static-clip guard; the other 56 (including the static skill07-03 source pose) are
// exposed as actions. The GLB still contains all 57 clips.
check('all 56 playable Iron Spider actions are loaded on the same mixer', mounted.newActionKeys === 56 && mounted.actionCount >= 82, mounted);

const playback = await page.evaluate(() => {
  const p1 = window.fighters[0];
  const u = p1.model.userData;
  const key = 'ironspider__armature|hero_spiderman01_s05@atk-01';
  const action = u.animationActions?.[key];
  if (!action || !u.humanMixer) return { error: 'new action or mixer missing' };
  // Freeze the gameplay state machine; the manual mixer is now the only pose writer.
  window.__browserSmashSetPaused?.(true);
  const mixer = u.humanMixer;
  let hand = null;
  p1.model.traverse(bone => { if (!hand && bone.isBone && /hand/i.test(bone.name) && /r/i.test(bone.name)) hand = bone; });
  const rest = hand ? hand.quaternion.clone() : null;
  mixer.stopAllAction();
  action.reset();
  action.setLoop(0, 1); // THREE.LoopOnce
  action.clampWhenFinished = true;
  action.setEffectiveWeight(1);
  action.play();
  let peakDeg = 0;
  let peakTime = 0;
  // Stop before the 0.467 s clip clamps, so the measured action is still running when sampled.
  for (let i = 0; i < 12; i += 1) {
    mixer.update(1 / 30);
    if (!rest || !hand) continue;
    const deg = rest.angleTo(hand.quaternion) * 180 / Math.PI;
    if (deg > peakDeg) { peakDeg = deg; peakTime = action.time; }
  }
  // Hold the measured peak for the screenshot; the render loop still runs while paused.
  if (hand && rest) {
    action.time = peakTime;
    mixer.update(0);
  }
  return {
    clip: action.getClip().name,
    duration: +action.getClip().duration.toFixed(3),
    tracks: action.getClip().tracks.length,
    running: action.isRunning(),
    peakDeg: +peakDeg.toFixed(2),
    peakTime: +peakTime.toFixed(3),
    hand: hand?.name || null,
    bodyVisible: p1.model.visible,
    newActions: Object.keys(u.animationActions || {}).filter(k => k.startsWith('ironspider__')).length,
  };
});
check('an Iron Spider clip plays on Miles and moves his skeleton', !playback.error && playback.running && playback.peakDeg > 2, playback);
check('the played clip contains the full retargeted track set', playback.tracks === 20, playback);

await page.waitForTimeout(400);
// Frame the actual mounted body; the duel camera is extremely wide on Final Valley and would
// make the clip look as though it had not changed the model.
await page.evaluate(() => {
  const camera = window.smashCamera || window.__browserSmashCamera;
  camera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 0, pitch: 4, distance: 3.1, transition: 0 });
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/iron-spider-clip-on-miles.png` });
await page.evaluate(() => document.querySelector('#bbHudLayer')?.style.setProperty('display', 'none'));
await page.locator('canvas').first().screenshot({ path: `${out}/iron-spider-clip-on-miles-canvas.png` }).catch(() => {});
check('no page or console errors during playback', errors.length === 0, { errors });

const report = { mounted, playback, checks, passed: checks.filter(c => c.ok).length, total: checks.length, errors };
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${report.total} checks passed`);
await browser.close();
server.close();
if (report.passed !== report.total) process.exit(1);
