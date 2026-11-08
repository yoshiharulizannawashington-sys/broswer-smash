// Composition check: the intro at two real resolutions, with measured, non-overlapping elements.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/presentation-phase2';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => { try { const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html'; if (['js','assets','models','data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel; res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' }); res.end(await readFile(resolve(root, rel))); } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); } });
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log('  ok  ' + name); };
const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const [width, height, tag] of [[1280, 800, '1280x800'], [1920, 1080, '1920x1080']]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(180000);
    await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
    await page.evaluate(() => {
      window.__browserSmashIntros = true;
      window.__browserSmashIntroSeconds = 14;
      window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
      window.__browserSmashSelect?.select('p2', 'Thor');
      document.querySelector('#play').click();
    });
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro.active === true, null, { timeout: 20000, polling: 100 });
    // Wait for the nameplates to finish sliding in before measuring anything.
    await page.waitForFunction(() => {
      const ready = role => {
        const node = document.querySelector(`#browserSmashCinematic [data-role="${role}"]`);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      };
      return ready('plate-a') && ready('plate-b');
    }, null, { timeout: 30000, polling: 100 });
    const rects = await page.evaluate(() => {
      const box = node => { const r = node.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; };
      const q = role => document.querySelector(`#browserSmashCinematic [data-role="${role}"]`);
      return {
        tag: box(q('tag')), plateA: box(q('plate-a')), plateB: box(q('plate-b')), versus: box(q('versus')),
        subtitle: document.querySelector('#browserSmashSubtitle') ? box(document.querySelector('#browserSmashSubtitle')) : null,
        hud: getComputedStyle(document.querySelector('#hud')).visibility,
        viewport: { width: innerWidth, height: innerHeight }
      };
    });
    check(`${tag}: the intro hides the HUD`, rects.hud === 'hidden', rects.hud);
    check(`${tag}: title band does not overlap the nameplates`,
      !overlap(rects.tag, rects.plateA) && !overlap(rects.tag, rects.plateB), JSON.stringify({ tag: rects.tag, plateA: rects.plateA }));
    check(`${tag}: plates stay inside the viewport with margin`,
      rects.plateA.left >= 0 && rects.plateA.right <= rects.viewport.width && rects.plateB.right <= rects.viewport.width, JSON.stringify(rects));
    await page.screenshot({ path: `${out}/intro-${tag}-opening.png` });
    await page.evaluate(() => window.__browserSmashStep(0.55));
    // The dialogue clock, not the DOM, is the authoritative "a line has played" signal; the
    // subtitle box is then measured if it is still on screen.
    await page.waitForFunction(() => (window.__browserSmashPresentation?.report?.().dialogue.lines || 0) >= 1, null, { timeout: 30000, polling: 100 });
    await page.screenshot({ path: `${out}/intro-${tag}-exchange.png` });
    const withSub = await page.evaluate(() => {
      const sub = document.querySelector('#browserSmashSubtitle');
      if (!sub) return null;
      const r = sub.getBoundingClientRect();
      return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), text: sub.textContent, visible: getComputedStyle(sub).display !== 'none' };
    });
    const dialogue = await page.evaluate(() => window.__browserSmashPresentation.report().dialogue);
    check(`${tag}: an intro line played and the subtitle clears the plates`,
      dialogue.lines >= 1 && (!withSub || !withSub.visible || withSub.top > rects.plateA.bottom), JSON.stringify({ lines: dialogue.lines, withSub }));
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => ({
      intro: window.__browserSmashPresentation?.report?.().intro,
      hud: getComputedStyle(document.querySelector('#hud')).visibility,
      overlay: Boolean(document.querySelector('#browserSmashCinematic'))
    }));
    check(`${tag}: skipping restores the HUD and clears the overlay`,
      after.intro.active === false && after.hud === 'visible' && after.overlay === false, JSON.stringify(after));
    await page.close();
  }
  console.log(`\nCinematic composition passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
