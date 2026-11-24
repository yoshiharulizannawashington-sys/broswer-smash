// Presentation pipeline: cinematic intro + skip, dialogue, attack timelines, per-map score.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/presentation';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
const check = (name, ok, detail = '') => { assert.ok(ok, `${name}${detail ? ' — ' + detail : ''}`); checks++; console.log('  ok  ' + name); };

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  // Advance real animation frames (the render loop owns presentation beats and the cinematic).
  const frames = count => page.evaluate(async total => {
    for (let index = 0; index < total; index++) await new Promise(done => requestAnimationFrame(done));
  }, count);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashIntros = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  const report = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__browserSmashPresentation.report())));

  // ---- cinematic intro -------------------------------------------------------
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro.active === true, null, { timeout: 20_000, polling: 100 });
  const intro = await report();
  check('the match opens on a cinematic intro', intro.intro.active === true);
  // Read the plates while the overlay is genuinely on screen, before any wall-clock waits.
  const plates = await page.evaluate(() => Array.from(document.querySelectorAll('#browserSmashCinematic div')).map(node => node.textContent));
  check('name plates identify both fighters', plates.some(text => /NARUTO/i.test(text)) && plates.some(text => /THOR/i.test(text)), JSON.stringify(plates.slice(0, 4)));
  const hudVisibility = await page.evaluate(() => ({
    hud: getComputedStyle(document.querySelector('#hud')).visibility,
    camera: getComputedStyle(document.querySelector('#cameraSettings')).visibility
  }));
  check('the intro clears the gameplay HUD', hudVisibility.hud === 'hidden' && hudVisibility.camera === 'hidden', JSON.stringify(hudVisibility));
  await page.screenshot({ path: `${out}/intro.png` });
  check('the intro stages an exchange between the two fighters', intro.intro.lines.length === 2 && intro.intro.lines.every(text => typeof text === 'string' && text.length > 8), JSON.stringify(intro.intro.lines));
  const identities = await page.evaluate(() => window.fighters.map(fighter => fighter.identity));
  check('the intro uses the selected fighters, not the default pair', identities[0] === 'Naruto Uzumaki' && identities[1] === 'Thor', JSON.stringify(identities));
  check('the exchange is written for these characters rather than the fallback bank', !intro.intro.lines.every(text => /finish this properly/i.test(text)), JSON.stringify(intro.intro.lines));
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().dialogue.lines >= 1, null, { timeout: 30_000, polling: 100 });
  const withLine = await report();
  check('the intro renders a spoken line as a subtitle', withLine.dialogue.lines >= 1 && withLine.dialogue.last?.bank === 'intro', JSON.stringify(withLine.dialogue.last));

  // ---- skip: a fresh match, skipped while the intro is genuinely still playing ----------------
  await page.evaluate(() => document.querySelector('#play').click());
  await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro.active === true, null, { timeout: 20_000, polling: 100 });
  await page.keyboard.press('Escape');
  const skipped = await report();
  check('the intro is skippable', skipped.intro.active === false && skipped.intro.skipped >= 1, JSON.stringify(skipped.intro));
  const cleared = await page.evaluate(() => !document.querySelector('#browserSmashCinematic'));
  check('skipping removes the cinematic overlay', cleared === true);
  await page.evaluate(() => window.__browserSmashStep(0.2));

  // ---- attack presentation ---------------------------------------------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.specialCooldown = 0; f.abilityReadyAt = {}; f.power = 100; f.transformCooldown = 0;
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(3.4, .6, 0); window.fighters[1].percent = 0;
  });
  // Exercise the presentation through the same entry points the combat code calls.
  await page.evaluate(() => window.spawnShadowClones(window.fighters[0], 2));
  await page.evaluate(() => window.__browserSmashPresentation.presenter.update(0.9));
  const cloned = await report();
  check('clone summoning plays its own presentation track', (cloned.presenter.byKind.clone || 0) >= 1, JSON.stringify(cloned.presenter.byKind));
  check('the clone track dispatches its beats', cloned.presenter.beats >= 3, JSON.stringify(cloned.presenter));
  check('attack presentation dispatches a real visual effect', cloned.presenter.vfx >= 1, JSON.stringify(cloned.presenter));
  const cloneCallout = cloned.dialogue.last;
  check('the clone callout is written for Naruto', /clone/i.test(cloneCallout?.text || ''), JSON.stringify(cloneCallout));

  // The projectile hook is what spawnProjectile calls for every signature shot.
  await page.evaluate(() => {
    const f = window.fighters[0];
    window.__browserSmashPresent('projectile', { owner: f, label: 'RASENSHURIKEN', origin: f.position, color: 0x7fd8ff });
    window.__browserSmashPresentation.presenter.update(0.9);
  });
  await frames(2);
  const fired = await report();
  check('a projectile presents with charged beats', (fired.presenter.byKind.projectile || 0) >= 1, JSON.stringify(fired.presenter.byKind));
  await page.screenshot({ path: `${out}/naruto-signature.png` });

  // ---- transformation presentation ------------------------------------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.power = 100; f.transformCooldown = 0; f.formLock = 0;
    window.__browserSmashPresent('form', { owner: f, label: 'SAGE MODE', color: 0xffb347 });
    window.__browserSmashPresentation.presenter.update(0.9);
  });
  await frames(2);
  const formedTrack = await report();
  check('a transformation plays its form track and speaks', (formedTrack.presenter.byKind.form || 0) >= 1 && (formedTrack.dialogue.banks.form || 0) >= 1, JSON.stringify(formedTrack.dialogue.banks));
  await page.screenshot({ path: `${out}/naruto-signature.png` });

  // ---- transformation presentation ------------------------------------------
  await page.evaluate(() => { const f = window.fighters[0]; f.power = 100; f.transformCooldown = 0; f.formLock = 0; });
  await page.keyboard.press('i');
  await page.evaluate(() => window.__browserSmashStep(0.6));
  await frames(4);
  const formed = await report();
  await page.screenshot({ path: `${out}/naruto-form-presentation.png` });

  // ---- per-map score ---------------------------------------------------------
  check('the match map selects its own score family', formed.score.started >= 1 && formed.score.missing === false && !!formed.score.family, JSON.stringify(formed.score));
  await page.evaluate(() => { window.__browserSmashSelect?.chooseArena('asgard'); });
  const asgard = await page.evaluate(async () => {
    document.querySelector('#play').click();
    await new Promise(done => setTimeout(done, 300));
    return JSON.parse(JSON.stringify(window.__browserSmashPresentation.report()));
  });
  check('a different map selects a different score family', asgard.score.family === 'asgard' && asgard.score.family !== formed.score.family, JSON.stringify(asgard.score));
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  check('no page errors during the presentation run', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(`\nPresentation verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
