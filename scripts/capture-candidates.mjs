// Candidate survey for a refinement pass: one fighter, front close-up and gameplay-distance shot,
// through the supported spectate path (HUD hidden, opponent model hidden for the shot only).
//
//   CANDIDATES=slug1,slug2 OUT=artifacts/compare/refine5-before \
//     bash scripts/run-browser-test.sh scripts/capture-candidates.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/candidates';
const slugs = (process.env.CANDIDATES || '').split(',').map(s => s.trim()).filter(Boolean);
const NAMES = {
  green_lantern_hal_jordan: 'Green Lantern (Hal Jordan)', kratos: 'Kratos', aquaman: 'Aquaman',
  link: 'Link', captain_jack_sparrow: 'Captain Jack Sparrow', edward_elric: 'Edward Elric',
  professor_x_charles_xavier: 'Professor X (Charles Xavier)', hulk_bruce_banner: 'Hulk (Bruce Banner)',
  lord_voldemort: 'Lord Voldemort', iron_man_tony_stark: 'Iron Man (Tony Stark)',
  wonder_woman: 'Wonder Woman', naruto_uzumaki: 'Naruto Uzumaki', thor: 'Thor'
};
await mkdir(out, { recursive: true });

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (p === '/api/models/sources') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sources":[],"roster":{"launch":[],"manifestKeys":[]}}'); return; }
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });

const SHOTS = [
  { name: 'front', yaw: 0, distance: 1.6, framing: 'upper' },
  { name: 'three-quarter', yaw: 40, distance: 3.0, framing: 'upper' },
  { name: 'gameplay', yaw: 20, distance: 6.0, framing: 'full' }
];

for (const slug of slugs) {
  const name = NAMES[slug] || slug;
  await page.evaluate((fighterName) => {
    const s = window.__browserSmashSelect;
    s?.select('p1', fighterName); s?.chooseArena?.('valley');
    document.querySelector('#practice')?.click();
  }, name);
  await page.waitForTimeout(2600);
  const actual = await page.evaluate(() => window.fighters?.[0]?.identity || null);
  if (actual && actual !== name) throw new Error(`capture selected "${actual}" instead of "${name}"`);
  console.log(slug, 'fighter=' + actual);
  for (const shot of SHOTS) {
    const info = await page.evaluate(({ s }) => {
      const f = window.fighters || [];
      f.forEach((x, k) => { if (x.model) x.model.visible = (k === 0); });
      const described = window.smashCamera.spectate({ fighter: f[0], framing: s.framing, distance: s.distance, yaw: s.yaw, pitch: 2 });
      const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
      return { spectate: described, hudVisible: vis(document.querySelector('#hud')), roundBannerVisible: vis(document.querySelector('#roundScore')) };
    }, { s: shot });
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${out}/${slug}-${shot.name}.png` });
    console.log(slug, shot.name, 'hudVisible=' + info.hudVisible, 'roundBannerVisible=' + info.roundBannerVisible);
  }
}
await browser.close(); server.close();
