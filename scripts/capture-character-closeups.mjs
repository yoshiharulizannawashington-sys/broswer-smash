// Close-up character captures, taken from the shipped GLBs in a real browser.
//
// The roster probe (probe-character-bodies.mjs) proves the bodies load, bind and animate, but it
// shoots from the arena camera, where a scouter or a harness socket is a few pixels. This renders
// each named body on its own at head-and-shoulders distance: front, three-quarter, side and rear,
// a face crop, and one mid-attack pose, into artifacts/closeups/.
//
//   bash scripts/run-browser-test.sh scripts/capture-character-closeups.mjs outDir slug,slug
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/closeups');
const slugs = (process.argv[3] || 'vegeta,iron_spider').split(',').map(s => s.trim()).filter(Boolean);
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  await page.goto(origin + '/artifacts/closeup-viewer.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.view), null, { timeout: 60_000 });

  for (const slug of slugs) {
    const info = await page.evaluate(s => window.view.load(s), slug);
    console.log(`${slug}: height ${info.height} m, ${info.clips.length} clips`);
    for (const [name, deg] of [['front', 0], ['three-quarter', 40], ['side', 90], ['rear', 180]]) {
      await page.evaluate(d => window.view.setAngle(d), deg);
      await page.screenshot({ path: resolve(outDir, `${slug}-${name}.png`) });
    }
    await page.evaluate(() => window.view.face());
    await page.screenshot({ path: resolve(outDir, `${slug}-face.png`) });
    await page.evaluate(() => { window.view.play('heavy_punch'); window.view.step(0.16); window.view.setAngle(35); });
    await page.screenshot({ path: resolve(outDir, `${slug}-attack.png`) });
    console.log(`  shot ${slug}: front, three-quarter, side, rear, face, attack`);
  }
  assert.equal(errors.length, 0, errors.slice(0, 2).join('\n'));
  console.log(`\nclose-up captures: ${slugs.length} characters, no page errors`);
} finally {
  await browser?.close();
  server.close();
}
