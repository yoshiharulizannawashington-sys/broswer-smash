// Which element(s) actually paint the arena title during the cinematic intro?
// Dumps every visible element whose text contains the arena name or "ROUND", with its
// bounding box and computed typography, so a "doubled title" can be traced to a real node.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/presentation-phase3';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
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
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashIntros = true;
    window.__browserSmashIntroSeconds = 14;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', 'Thor');
    window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
    document.querySelector('#play').click();
  });
  // Mid-intro, with the intro overlay actually painted.
  await page.waitForFunction(() => Boolean(document.querySelector('#browserSmashCinematic')), null, { timeout: 30000, polling: 100 });
  await page.waitForTimeout(1400);

  const report = await page.evaluate(() => {
    const rectOf = node => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const describe = node => {
      const cs = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        id: node.id || null,
        cls: node.className && typeof node.className === 'string' ? node.className : null,
        role: node.dataset?.role || null,
        text: (node.textContent || '').trim().slice(0, 90),
        rect: rectOf(node),
        font: cs.font,
        color: cs.color,
        opacity: cs.opacity,
        visibility: cs.visibility,
        zIndex: cs.zIndex,
        textShadow: cs.textShadow,
        before: getComputedStyle(node, '::before').content,
        after: getComputedStyle(node, '::after').content,
        transform: cs.transform,
        parent: node.parentNode ? (node.parentNode.id || node.parentNode.className || node.parentNode.tagName) : null
      };
    };
    const hits = [];
    for (const node of document.querySelectorAll('body *')) {
      const text = (node.textContent || '').trim();
      if (!text) continue;
      if (!/ASGARD|ROUND|GOLDEN/i.test(text)) continue;
      // Only nodes that paint this text themselves, plus their containers, so a wrapper is
      // not mistaken for a second copy of the text.
      const own = Array.from(node.childNodes).some(n => n.nodeType === 3 && /ASGARD|ROUND|GOLDEN/i.test(n.textContent || ''));
      if (!own) continue;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      hits.push(describe(node));
    }
    const intro = document.querySelector('#browserSmashCinematic');
    return {
      hits,
      introExists: Boolean(intro),
      introChildren: intro ? Array.from(intro.children).map(describe) : [],
      statusText: document.querySelector('#status')?.textContent || null,
      roundScoreText: document.querySelector('#roundScore')?.textContent || null,
      hudVisibility: getComputedStyle(document.querySelector('#hud') || document.body).visibility,
      bodyClass: document.body.className,
      titleOccurrences: (document.body.innerText.match(/ASGARD/g) || []).length
    };
  });
  console.log('HITS', JSON.stringify(report.hits.map(h => ({ id: h.id, role: h.role, text: h.text, rect: h.rect, font: h.font, opacity: h.opacity, zIndex: h.zIndex })), null, 1));
  console.log('SUMMARY', JSON.stringify({ intro: report.introExists, children: report.introChildren.length, titleOccurrences: report.titleOccurrences, status: report.statusText, roundScore: report.roundScoreText, hud: report.hudVisibility, bodyClass: report.bodyClass }));
  const stacked = await page.evaluate(() => document.elementsFromPoint(640, 80).map(n => `${n.tagName.toLowerCase()}#${n.id || ''}.${typeof n.className === 'string' ? n.className : ''}`).slice(0, 8));
  console.log('STACK@640,80', JSON.stringify(stacked));
  const wrappers = await page.evaluate(() => document.querySelectorAll('#browserSmashCinematic').length);
  console.log('CINEMATIC_WRAPPERS', wrappers);
  // A: as rendered. B: after forcing the tag to repaint. C: new text + no shadow.
  await page.screenshot({ path: `${out}/probe-title-a.png` });
  await page.evaluate(() => {
    const tag = document.querySelector('#browserSmashCinematic [data-role="tag"]');
    tag.style.display = 'none'; void tag.offsetHeight; tag.style.display = '';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/probe-title-b-repaint.png` });
  await page.evaluate(() => {
    const tag = document.querySelector('#browserSmashCinematic [data-role="tag"]');
    tag.textContent = 'TITLE TEST 123 · ROUND 01';
    tag.style.textShadow = 'none';
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/probe-title-c-newtext.png` });
  console.log('CAPTURES a/b/c');
} finally {
  console.log('ERRORS', errors.slice(0, 3).join(' | ') || 'none');
  await browser.close();
  server.close();
}
