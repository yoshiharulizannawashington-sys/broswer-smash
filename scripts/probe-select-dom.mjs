// Dump what actually paints over the preview panel, so the capture hides the right element.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => relative === d || relative.startsWith(d + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(origin + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__browserSmashPreview, null, { timeout: 120000 });
await page.waitForTimeout(2500);
const dump = await page.evaluate(() => {
  const panel = document.querySelector('#selectScreen [data-role="preview"]');
  if (!panel) return { error: 'no preview panel' };
  const pr = panel.getBoundingClientRect();
  const rows = [];
  for (const el of document.querySelectorAll('#selectScreen *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 12) continue;
    const hitsTop = r.top < pr.top + pr.height * 0.5 && r.bottom > pr.top;
    const hitsX = r.left < pr.right && r.right > pr.left;
    if (!hitsTop || !hitsX) continue;
    const cs = getComputedStyle(el);
    const painted = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || cs.backgroundImage !== 'none';
    if (!painted && !el.textContent.trim()) continue;
    rows.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 56),
      role: el.dataset.role || null, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor, image: cs.backgroundImage.slice(0, 30), z: cs.zIndex, pos: cs.position,
      text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 36) });
  }
  const canvas = panel.querySelector('canvas');
  const cr = canvas && canvas.getBoundingClientRect();
  return { panel: [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)],
    canvas: cr ? [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)] : null,
    overlays: rows.slice(0, 40) };
});
console.log(JSON.stringify(dump, null, 2));
await browser.close();
server.close();
