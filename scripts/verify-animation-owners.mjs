
// Which production roster fighter is driven by which animation owner?
//
// attachAnimation() refuses a rig with baked clips, so a roster body only reaches the controller when
// it has a skeleton but no clips. This enumerates the real roster instead of assuming.
//
//   bash scripts/run-browser-test.sh scripts/verify-animation-owners.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
await mkdir('artifacts/diagnostics', { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.setDefaultTimeout(180000);
  await page.goto('http://127.0.0.1:' + server.address().port + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; document.querySelector('#play').click(); });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  const identities = await page.evaluate(() => {
    const select = document.querySelector('#p1') || [...document.querySelectorAll('select')].find(s => s.options.length > 4);
    return [...(select?.options || [])].map(o => o.value).filter(Boolean);
  });
  console.log('ROSTER SIZE', identities.length);
  const rows = [];
  for (const identity of identities) {
    await page.evaluate(value => window.__browserSmashSelect?.select('p1', value), identity);
    const info = await page.waitForFunction(() => {
      const f = window.fighters?.[0];
      if (!f?.model || f.animationBindModel !== f.model) return null;
      const u = f.model.userData || {};
      return {
        identity: f.identity || f.name || '?',
        mixer: Boolean(u.humanMixer),
        bakedClips: Boolean(u.hasAnimationClips),
        controller: Boolean(u.animationController),
        skinned: (() => { let s = false; f.model.traverse(n => { if (n.isSkinnedMesh) s = true; }); return s; })()
      };
    }, null, { timeout: 6000, polling: 150 }).then(h => h.jsonValue()).catch(() => null);
    const row = { requested: identity, ...(info || { identity, mixer: null, bakedClips: null, controller: null, skinned: null, note: 'never bound' }) };
    rows.push(row);
    console.log('ROW', JSON.stringify(row));
  }
  const owners = { controller: 0, mixer: 0, none: 0 };
  for (const row of rows) {
    if (row.controller) owners.controller++;
    else if (row.mixer) owners.mixer++;
    else owners.none++;
  }
  console.log('OWNERS', JSON.stringify(owners));
  await writeFile('artifacts/diagnostics/animation-owners.json', JSON.stringify({ generatedAt: new Date().toISOString(), owners, rows }, null, 2));
  console.log('wrote artifacts/diagnostics/animation-owners.json');
} finally { await browser.close(); server.close(); }
