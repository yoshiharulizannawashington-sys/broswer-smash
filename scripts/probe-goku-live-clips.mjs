// Inspect which actual clip objects the live Goku state machine is playing for idle/walk/run/guard,
// including track counts and clip names. Runtime evidence, not manifest assumptions.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream'
};
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) rel = 'public' + sep + rel;
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.setDefaultTimeout(120000);
page.on('pageerror', e => console.log('PAGEERROR', String(e.message || e).slice(0, 200)));

await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 120000, polling: 200 });
await page.evaluate(() => {
  const s = window.__browserSmashSelect; s.show();
  s.select('p1', 'Goku'); s.select('p2', 'Vegeta'); s.chooseArena('tournament');
  document.querySelector('#play')?.click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false
  && (window.__browserSmashFrames || 0) > 2, null, { timeout: 90000, polling: 100 });
await page.waitForFunction(() => {
  const u = window.fighters?.[0]?.model?.userData || {};
  return u.idleAction?.getClip?.()?.name === 'Goku_Idle';
}, null, { timeout: 60000, polling: 100 });
await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashTrainingDummy = true; window.__browserSmashStep(0.3); });

const read = label => page.evaluate(label => {
  const f = window.fighters[0], u = f.model.userData;
  const clip = a => a?.getClip ? { name: a.getClip().name, tracks: a.getClip().tracks.length, running: a.isRunning(), time: +a.time.toFixed(3), weight: +a.getEffectiveWeight().toFixed(2) } : null;
  const names = {};
  for (const [key, a] of Object.entries(u.animationActions || {})) if (a?.getClip) names[key] = a.getClip().name;
  return {
    label, speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
    idle: clip(u.idleAction), walk: clip(u.walkAction), run: clip(u.runAction), block: clip(u.blockAction),
    last: clip(u.lastMoveAction), currentClip: u.currentClip,
    lastTransition: u.lastAnimationTransition || null,
    actionNames: names,
    reactionReport: u.importedReactionReport || null,
    strikesReport: u.importedStrikeReport || null,
    supplement: u.libraryStateSupplement || null
  };
}, label);

console.log('IDLE ' + JSON.stringify(await read('idle')));
await page.keyboard.down('d');
await page.evaluate(() => window.__browserSmashStep(0.32));
console.log('WALK ' + JSON.stringify(await read('walk')));
await page.keyboard.up('d');
await page.keyboard.down('Shift'); await page.keyboard.down('d');
await page.evaluate(() => window.__browserSmashStep(0.36));
console.log('RUN ' + JSON.stringify(await read('run')));
await page.keyboard.up('d'); await page.keyboard.up('Shift');
await page.evaluate(() => window.__browserSmashStep(0.2));

await browser.close();
server.close();
