// Death Star visual check: enters through arena selection, captures the floor at match scale and
// close range, then proves repeated switching does not compound the floor-tone adjustment.
//
//   ARENA=deathstar bash scripts/run-browser-test.sh scripts/capture-deathstar.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/deathstar';
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

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
const errors = [];
const failed = [];
const textures = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('requestfailed', r => failed.push({ url: r.url().split('/').pop(), error: r.failure()?.errorText }));
page.on('response', r => { const name = r.url().split('/').pop().split('?')[0]; if (/\.(jpg|jpeg|png)$/i.test(name)) textures.push(`${r.status()} ${name}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });

// Normal arena-selection path (the same change event the menu raises).
await page.evaluate(() => {
  const select = document.querySelector('#menuMapSelect');
  select.value = 'deathstar';
  select.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Goku');
  window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(2600);

const shoot = async (name, camera = null, settle = 700) => {
  if (camera) {
    await page.evaluate(c => {
      const target = c.fighter === 'p1' ? window.fighters?.[0] : c.fighter === 'p2' ? window.fighters?.[1] : c.fighter;
      window.smashCamera?.spectate?.({ ...c, fighter: target });
    }, camera);
    await page.waitForTimeout(settle);
  }
  await page.screenshot({ path: `${out}/${name}.png` });
  if (camera) await page.evaluate(() => window.smashCamera?.endSpectate?.());
};

// Back off the spawn wall first: the default match camera spawned facing it, which produced a
// featureless grey frame that said nothing about the floor.
await page.keyboard.down('s');
await page.waitForTimeout(900);
await page.keyboard.up('s');
await page.waitForTimeout(600);
await shoot('deathstar-match', null, 0);
// Low angles that actually look at the deck. A steeper pitch put the camera under the deck and
// returned a near-black frame, so this stays shallow.
await shoot('deathstar-floor-closeup', { fighter: 'p1', framing: 'full', yaw: 24, pitch: -11 }, 1100);
await shoot('deathstar-fighters-on-floor', { fighter: 'p1', framing: 'full', yaw: 42, pitch: -6 }, 1100);
// Walk the player forward so the floor fills more of the frame, then capture again.
await page.keyboard.down('w');
await page.waitForTimeout(700);
await page.keyboard.up('w');
await page.waitForTimeout(400);
await shoot('deathstar-floor-walk');

const floor = () => page.evaluate(() => window.__browserSmashFloorState());

const first = await floor();
const switches = [];
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__browserSmashApplyMap('valley'));
  await page.waitForTimeout(300);
  const valley = await floor();
  await page.evaluate(() => window.__browserSmashApplyMap('deathstar'));
  await page.waitForTimeout(500);
  switches.push({ valley, deathstar: await floor() });
}
await shoot('deathstar-after-repeated-switching');
const hogwarts = await page.evaluate(() => { window.__browserSmashApplyMap('hogwarts'); return window.__browserSmashFloorState(); });
const asgard = await page.evaluate(() => { window.__browserSmashApplyMap('asgard'); return window.__browserSmashFloorState(); });
await page.screenshot({ path: `${out}/asgard-after-deathstar-switching.png` });

const ids = new Set(switches.map(s => s.deathstar.uuid));
const colors = new Set(switches.map(s => s.deathstar.color));
const report = {
  firstFloor: first,
  switches,
  compounding: { distinctMaterials: ids.size, distinctColors: colors.size },
  otherArenas: { hogwarts, asgard },
  textures: [...new Set(textures)].filter(t => /marble|rock|metal|stone/i.test(t)),
  errors, failed
};
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log('DEATHSTAR ' + JSON.stringify({
  floor: { material: first.material, color: first.color, exposure: first.tone },
  compounding: report.compounding,
  distinctFloorPerSwitch: ids.size === 1 && colors.size === 1,
  hogwartsFloor: hogwarts.color, asgardFloor: asgard.color,
  textures: report.textures.length, errors: errors.length, failed: failed.length
}));
await browser.close();
server.close();
