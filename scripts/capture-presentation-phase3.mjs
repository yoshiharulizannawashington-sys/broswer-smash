// Presentation Phase 3: prove the arena title is a single, unoccluded line at both resolutions,
// that the round-score HUD line no longer runs through it, that subtitles clear the name plates,
// and that skipping restores the HUD it hid.
//
// One app boot, two viewport sizes: booting under SwiftShader costs about a minute, so the second
// resolution resizes the existing page instead of launching a second one.
//
//   bash scripts/run-browser-test.sh scripts/capture-presentation-phase3.mjs
import assert from 'node:assert/strict';
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

let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log('  ok  ' + name); };

// Everything about the rendered title that a screenshot alone cannot prove.
const measure = page => page.evaluate(() => {
  const rect = node => { const r = node.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
  const tag = document.querySelector('#browserSmashCinematic [data-role="tag"]');
  const round = document.querySelector('#roundScore');
  const plates = ['plate-a', 'plate-b'].map(role => document.querySelector(`#browserSmashCinematic [data-role="${role}"]`));
  const sub = document.querySelector('#browserSmashSubtitle');
  const vis = node => Boolean(node) && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
  const over = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
  const tagRect = tag ? tag.getBoundingClientRect() : null;
  const roundRect = round ? round.getBoundingClientRect() : null;

  // Count every element that paints arena/round text itself and can actually be seen: the real test
  // for "two titles". Keep each one's identity so a failure names the culprit.
  const painters = [];
  for (const node of document.querySelectorAll('body *')) {
    // Word boundaries matter: a plain /round/ also matches "ground" in a spoken line.
    const own = Array.from(node.childNodes).some(n => n.nodeType === 3 && /(asgard\b|\bround\s*\d)/i.test(n.textContent || ''));
    if (!own || !vis(node)) continue;
    const cs = getComputedStyle(node);
    if (cs.opacity === '0') continue;
    // A zero-area node cannot paint text: the hidden pause menu keeps labels in the DOM.
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    painters.push({ tag: node.tagName.toLowerCase(), id: node.id || null, cls: typeof node.className === 'string' ? node.className : null, parent: node.parentNode?.id || null, text: (node.textContent || '').trim().slice(0, 48), rect: rect(node), visibility: cs.visibility, opacity: cs.opacity });
  }

  const lineHeight = tag ? parseFloat(getComputedStyle(tag).lineHeight) : 0;
  return {
    tagText: tag?.textContent || '',
    tag: tag ? rect(tag) : null,
    tagLines: tagRect && lineHeight ? +(tagRect.height / lineHeight).toFixed(2) : null,
    roundText: round?.textContent || '',
    roundVisible: vis(round),
    round: roundRect ? rect(round) : null,
    // Only a *visible* HUD line can collide with the title; a hidden one still reports a box.
    overlap: vis(round) && over(tagRect, roundRect),
    overlapsViewport: tagRect ? (tagRect.left < 0 || tagRect.right > innerWidth) : true,
    titlePainters: painters.length,
    painters,
    plates: plates.map(node => node ? rect(node) : null),
    subtitle: sub && vis(sub) ? rect(sub) : null,
    subtitleOverPlates: Boolean(sub && vis(sub)) && plates.some(node => node && over(sub.getBoundingClientRect(), node.getBoundingClientRect())),
    hud: getComputedStyle(document.querySelector('#hud')).visibility
  };
});

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashIntros = true;
    window.__browserSmashIntroSeconds = 16;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', 'Thor');
    window.__browserSmashSelect?.select('p2', 'Naruto Uzumaki');
  });

  for (const [width, height] of [[1280, 800], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await page.evaluate(() => document.querySelector('#play').click());
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro.active === true, null, { timeout: 30_000, polling: 100 });
    // The exchange first: spoken lines appear at 1.5 s and hide 2.2 s later, and a SwiftShader
    // screenshot costs several seconds, so the subtitle is captured before the settled-title shot.
    await page.waitForFunction(() => {
      const node = document.querySelector('#browserSmashSubtitle');
      return node && getComputedStyle(node).display !== 'none';
    }, null, { timeout: 60_000, polling: 100 });
    // A SwiftShader screenshot takes longer than the line's 2.2 s life. Re-say the same real bank
    // line through the game's own dialogue API with a longer display time so the capture contains
    // the subtitle that was just measured; the text is not invented for the shot.
    await page.evaluate(() => {
      const line = window.__browserSmashPresentation?.dialogue;
      line?.say?.('Thor', 'Stand your ground. It will be over quickly.', { seconds: 30, bank: 'intro' });
    });
    const exchange = await measure(page);
    console.log(`EXCHANGE ${width}x${height}`, JSON.stringify({ subtitle: exchange.subtitle, plates: exchange.plates, over: exchange.subtitleOverPlates, painters: exchange.titlePainters, tag: exchange.tag }));
    await page.screenshot({ path: `${out}/intro-exchange-${width}x${height}.png` });
    check(`${width}x${height}: the subtitle is on screen during the exchange`, Boolean(exchange.subtitle));
    check(`${width}x${height}: the subtitle does not overlap the name plates`, exchange.subtitleOverPlates === false);
    check(`${width}x${height}: the round-score line stays hidden while a line is spoken`, exchange.roundVisible === false);

    const opening = exchange;
    console.log(`MEASURE ${width}x${height}`, JSON.stringify({ tag: opening.tag, tagLines: opening.tagLines, painters: opening.painters, roundVisible: opening.roundVisible, overlap: opening.overlap, hud: opening.hud }));
    await page.screenshot({ path: `${out}/intro-opening-${width}x${height}.png` });

    check(`${width}x${height}: the arena title is a single rendered element`, opening.titlePainters === 1, JSON.stringify(opening.painters));
    check(`${width}x${height}: the arena title is one line`, opening.tagLines !== null && opening.tagLines <= 1.4, `${opening.tagLines} lines`);
    check(`${width}x${height}: the arena title fits the viewport`, opening.overlapsViewport === false, JSON.stringify(opening.tag));
    check(`${width}x${height}: the round-score HUD line is hidden during the intro`, opening.roundVisible === false, JSON.stringify(opening.round));
    check(`${width}x${height}: no HUD line overlaps the arena title`, opening.overlap === false);
    check(`${width}x${height}: the intro still clears the gameplay HUD`, opening.hud === 'hidden');

    // Skip: HUD and round-score line must come back exactly as they were.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#browserSmashCinematic'), null, { timeout: 20_000, polling: 100 });
    // Escape is also the pause key, so the same press opens the pause menu. Close it again before
    // judging HUD restoration, otherwise the capture is a pause screen rather than the live HUD.
    const pauseOpen = () => page.evaluate(() => Array.from(document.querySelectorAll('body *')).some(node => {
      const own = Array.from(node.childNodes).some(n => n.nodeType === 3 && /MATCH PAUSED/i.test(n.textContent || ''));
      if (!own) return false;
      const box = node.getBoundingClientRect();
      return box.width > 1 && box.height > 1 && getComputedStyle(node).visibility !== 'hidden';
    }));
    if (await pauseOpen()) {
      // The menu's own Resume control, not a second Escape: Escape after the skip does not resume
      // in every focus state, and a click is the path a player actually takes.
      await page.evaluate(() => {
        const resume = document.querySelector('[data-action="resume"]');
        if (resume) resume.click();
      });
      await page.waitForTimeout(600);
    }
    check(`${width}x${height}: the pause menu opened by Escape is closed again`, (await pauseOpen()) === false);
    const restored = await page.evaluate(() => ({
      hud: getComputedStyle(document.querySelector('#hud')).visibility,
      camera: getComputedStyle(document.querySelector('#cameraSettings')).visibility,
      round: getComputedStyle(document.querySelector('#roundScore')).visibility,
      roundText: document.querySelector('#roundScore')?.textContent || '',
      intro: window.__browserSmashPresentation.report().intro
    }));
    console.log(`RESTORED ${width}x${height}`, JSON.stringify(restored));
    await page.screenshot({ path: `${out}/after-skip-${width}x${height}.png` });
    check(`${width}x${height}: skipping restores the gameplay HUD`, restored.hud === 'visible' && restored.camera === 'visible', JSON.stringify(restored));
    check(`${width}x${height}: skipping restores the round-score line`, restored.round === 'visible' && /ROUND/i.test(restored.roundText), JSON.stringify(restored));
    check(`${width}x${height}: the skip is recorded, not a silent timeout`, restored.intro.skipped >= 1 && restored.intro.active === false, JSON.stringify(restored.intro));
  }
} finally {
  console.log('ERRORS', errors.slice(0, 3).join(' | ') || 'none');
  await browser.close();
  server.close();
}
console.log(`Presentation phase 3 passed (${checks} checks).`);
