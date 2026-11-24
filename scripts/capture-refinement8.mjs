// Refinement 8 evidence.
//
//   bash scripts/run-browser-test.sh scripts/capture-refinement8.mjs --target=characters
//   bash scripts/run-browser-test.sh scripts/capture-refinement8.mjs --target=asgard
//
// Characters: front head, side head and normal gameplay-distance views for Jack Sparrow, Lord
// Voldemort and Aquaman, through the game's own spectator camera (the same camera the roster
// close-ups use) so the frames are not a bespoke inspection lens.
//
// Asgard: identical-camera before/after (weather + props off, then on), a normal gameplay-camera
// shot, a brazier flare caused by a live damage frame, and a pillar destruction sequence.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const target = (process.argv.find(arg => arg.startsWith('--target=')) || '--target=characters').split('=')[1];
const out = `artifacts/compare/refine8/${target}`;
// `--only=jack,voldemort` captures just those fighters, so a two-character fix does not pay for a
// third boot and a third set of frames inside the 5-minute command budget.
const only = (process.argv.find(arg => arg.startsWith('--only=')) || '').replace('--only=', '');
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

const boot = async (p1, p2, arena) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(({ p1, p2, arena }) => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena(arena);
    window.__browserSmashSelect?.select('p1', p1);
    window.__browserSmashSelect?.select('p2', p2);
    document.querySelector('#play').click();
  }, { p1, p2, arena });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => window.__browserSmashStep(0.4));
  await page.waitForTimeout(600);
  return page;
};

const shoot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('CAPTURE', name);
};

try {
  if (target === 'characters') {
    const roster = [
      ['Captain Jack Sparrow', 'jack'],
      ['Lord Voldemort', 'voldemort'],
      ['Aquaman', 'aquaman']
    ].filter(([, slug]) => !only || only.split(',').includes(slug));
    for (const [identity, slug] of roster) {
      const page = await boot(identity, 'Thor', 'valley');
      const spectate = async (framing, yaw, name) => {
        const info = await page.evaluate(({ framing, yaw }) => {
          const camera = window.smashCamera;
          if (!camera?.spectate) return { ok: false };
          camera.spectate({ fighter: window.fighters[0], framing, yaw, pitch: 0 });
          return { ok: true, state: camera.describeSpectate?.() || null };
        }, { framing, yaw });
        if (!info.ok) return false;
        await page.waitForTimeout(700);
        await shoot(page, name);
        return true;
      };
      // Put the fighter on open ground before framing the head. In the last pass the head framing
      // left the camera inside an arena pillar, so Voldemort's face was never actually in shot.
      await page.evaluate(() => {
        const f = window.fighters[0];
        f.position.set(0, .6, 0);
        f.facing = 0;
        f.facingZ = 1;
        f.velocity?.set?.(0, 0, 0);
        const other = window.fighters[1];
        if (other) {
          other.position.set(14, .6, 14);
          // Isolated capture: hide the second body instead of cropping it out of the image. The
          // brief requires the head shots to contain only the fighter being judged.
          other.model.visible = false;
        }
      });
      await page.waitForTimeout(500);
      const front = await spectate('head', 0, `${slug}-head-front`);
      const threeQuarter = await spectate('head', 42, `${slug}-head-three-quarter`);
      const side = await spectate('head', 90, `${slug}-head-side`);
      await page.evaluate(() => window.smashCamera?.endSpectate?.());
      await page.waitForTimeout(500);
      console.log(slug, JSON.stringify({ front, threeQuarter, side }));
      // Normal gameplay camera, the view a player actually fights at.
      await page.evaluate(() => {
        const select = document.querySelector('#cameraMode');
        if (select && select.value !== 'over-p1') { select.value = 'over-p1'; select.dispatchEvent(new Event('change')); }
        window.smashCamera?.setZoom?.(.86);
      });
      await page.waitForTimeout(700);
      await shoot(page, `${slug}-gameplay`);
      await page.close();
    }
  } else {
    const page = await boot('Thor', 'Naruto Uzumaki', 'asgard');
    await page.waitForFunction(() => window.__browserSmashAsgard?.() != null, null, { timeout: 30000, polling: 100 });
    const frames = n => page.evaluate(async total => { for (let i = 0; i < total; i++) await new Promise(done => requestAnimationFrame(done)); }, n);

    // Identical camera, atmosphere + props off, then on.
    await page.evaluate(() => {
      window.__browserSmashAsgardDisabled = true;
      window.__browserSmashAsgardToggle(false);
    });
    await frames(2);
    await shoot(page, 'asgard-before');
    await page.evaluate(() => {
      window.__browserSmashAsgardDisabled = false;
      window.__browserSmashAsgardToggle(true);
    });
    await page.evaluate(() => window.__browserSmashStep(0.3));
    await frames(2);
    console.log('ASGARD', JSON.stringify(await page.evaluate(() => window.__browserSmashAsgard())));
    await shoot(page, 'asgard-after');
    await shoot(page, 'asgard-gameplay');

    // Brazier interaction: stand beside one and land a live damage frame.
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.position.set(6.4, .6, 3.4); f.facing = 0; f.facingZ = -1;
      f.attackQueue.push({ start: 0, active: 0, duration: 2.2, t: .05, damage: 18, hit: false, kind: 'heavy' });
      window.smashCamera?.setZoom?.(1.05);
    });
    await frames(2);
    await shoot(page, 'asgard-brazier-flare');

    // Pillar destruction sequence: intact, impact frame, debris on the ground.
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.position.set(-4, .6, -5.2); f.facing = 0; f.facingZ = -1;
      f.attackQueue.length = 0;
      window.smashCamera?.setZoom?.(1.0);
    });
    await frames(2);
    await shoot(page, 'asgard-pillar-intact');
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.attackQueue.push({ start: 0, active: 0, duration: 2.2, t: .05, damage: 22, hit: false, kind: 'heavy' });
    });
    await frames(2);
    await shoot(page, 'asgard-pillar-impact');
    console.log('BREAK', JSON.stringify(await page.evaluate(() => window.__browserSmashAsgard())));
    await frames(8);
    await shoot(page, 'asgard-pillar-debris');
    await page.close();
  }
} finally {
  console.log('ERRORS', errors.slice(0, 3).join(' | ') || 'none');
  await browser.close();
  server.close();
}
