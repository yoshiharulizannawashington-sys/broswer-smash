// Why is the title panel still full width? Report the computed box and the rules that win.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(120000);
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const title = document.querySelector('#bbTitle');
  const panel = title.closest('.panel');
  const menu = document.querySelector('#menu');
  const cs = getComputedStyle(panel);
  const ms = getComputedStyle(menu);
  const rect = panel.getBoundingClientRect();
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of list) {
      if (!rule.selectorText || !/panel/.test(rule.selectorText)) continue;
      if (!rule.style.width && !rule.style.maxWidth && !rule.style.flex) continue;
      rules.push({ selector: rule.selectorText, width: rule.style.width, maxWidth: rule.style.maxWidth, flex: rule.style.flex, display: rule.style.display });
    }
  }
  return {
    menuClass: menu.className,
    menuDisplay: ms.display,
    menuFlexDirection: ms.flexDirection,
    menuJustify: ms.justifyContent,
    menuAlign: ms.alignItems,
    panel: { width: cs.width, maxWidth: cs.maxWidth, flex: cs.flex, display: cs.display, boxSizing: cs.boxSizing, rect: { w: Math.round(rect.width), h: Math.round(rect.height), left: Math.round(rect.left) } },
    parent: panel.parentElement?.className,
    rules
  };
});
console.log('PANEL_PROBE ' + JSON.stringify(info, null, 1));
await browser.close();
server.close();
