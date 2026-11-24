// Capture a fighter stopped at a Wuhu cliff collision block.
//
// This uses the same real game entry point and Wuhu bake as verify-environment-arenas.mjs,
// then places the player at the west face of a 3.8 m cliff block. The spectate camera frames
// the fighter against the rock face, and the screenshot is only taken after the live game step
// confirms the block is solid and the fighter remains outside it.
//
//   bash scripts/run-browser-test.sh scripts/capture-wuhu-cliff-collision.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/environment/arenas/wuhu-collision');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    const relative = normalize(pathname).replace(/^[/\\\\]+/, '') || 'index.html';
    const candidates = relative === 'index.html'
      ? [resolve(root, 'public/index.html')]
      : [resolve(root, relative), resolve(root, 'public', relative)];
    let body = null;
    let filePath = null;
    for (const candidate of candidates) {
      try { body = await readFile(candidate); filePath = candidate; break; } catch {}
    }
    if (!body) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 300)));
page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 240)); });

try {
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashMatch && window.__browserSmashStep
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p1', 'Goku');
    window.__browserSmashSelect.select('p2', 'Naruto Uzumaki');
    window.__browserSmashSelect.chooseArena('mariokart');
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting',
    null, { timeout: 45_000, polling: 100 });
  await page.waitForFunction(() => window.__browserSmashAssets?.arenas?.mariokart?.status === 'loaded',
    null, { timeout: 180_000, polling: 250 });

  const result = await page.evaluate(() => {
    const layout = window.__browserSmashLayout?.() || {};
    const blocks = layout.blocks || [];
    // This is the same 3.8 m wall block used by the walk-around regression. Its west face is
    // open grass, so a west-side camera reads the fighter against the cliff rather than the HUD.
    const block = blocks.find(candidate => candidate.wall
      && candidate.x0 === -39.75 && candidate.x1 === -18.75
      && candidate.z0 === -36 && candidate.z1 === -35.25)
      || blocks.find(candidate => candidate.wall && candidate.x0 < -30 && candidate.z0 < -26)
      || blocks.find(candidate => candidate.wall);
    if (!block) return { found: false };
    const x = block.x0 - .75;
    const z = (block.z0 + block.z1) / 2;
    const y = typeof layout.heightAt === 'function' ? layout.heightAt(x, z) : (layout.ground ?? 0);
    const p = window.fighters[0];
    const other = window.fighters[1];
    window.__browserSmashFreezeAI = true;
    p.position.set(x, y, z);
    p.velocity.set(0, 0, 0);
    p.isGrounded = true;
    p.facing = 1;
    p.facingZ = 0;
    // Move the second fighter out of the evidence frame without changing the match rules.
    other.position.set(-24, typeof layout.heightAt === 'function' ? layout.heightAt(-24, -12) : (layout.ground ?? 0), -12);
    other.velocity.set(0, 0, 0);
    other.model.visible = false;
    // A short live step runs resolveArenaCollision and settles the feet on the terrain.
    for (let i = 0; i < 12; i += 1) window.__browserSmashStep(1 / 60);
    const inside = p.position.x > block.x0 && p.position.x < block.x1
      && p.position.z > block.z0 && p.position.z < block.z1;
    window.smashCamera?.spectate?.({
      fighter: p, framing: 'full', distance: 7.5, yaw: 135, pitch: 12, transition: 0
    });
    for (let i = 0; i < 18; i += 1) window.__browserSmashStep(1 / 60);
    return {
      found: true,
      block: { ...block },
      start: { x: +x.toFixed(3), y: +y.toFixed(3), z: +z.toFixed(3) },
      fighter: {
        x: +p.position.x.toFixed(3), y: +p.position.y.toFixed(3), z: +p.position.z.toFixed(3),
        grounded: Boolean(p.isGrounded), inside
      },
      camera: {
        x: +window.__browserSmashCamera.position.x.toFixed(3),
        y: +window.__browserSmashCamera.position.y.toFixed(3),
        z: +window.__browserSmashCamera.position.z.toFixed(3)
      },
      spectate: window.smashCamera?.describeSpectate?.() || null
    };
  });
  await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
  await page.evaluate(({ block, fighter }) => {
    const label = document.createElement('div');
    label.id = 'wuhu-collision-evidence';
    label.style.cssText = [
      'position:fixed', 'left:24px', 'top:24px', 'z-index:30',
      'padding:14px 18px 13px', 'border-left:4px solid #ff645c', 'border-radius:4px',
      'background:rgba(4,14,22,.84)', 'color:#f2fbff', 'backdrop-filter:blur(8px)',
      'font:500 13px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'letter-spacing:.01em', 'box-shadow:0 8px 30px rgba(0,0,0,.28)'
    ].join(';');
    label.innerHTML = '<div style="color:#7cebd4;font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase">Browser Smash · Wuhu collision</div>'
      + '<div style="font-size:18px;font-weight:700;letter-spacing:-.01em;margin-top:5px">Stopped at the south cliff</div>'
      + `<div style="margin-top:5px;color:#b9d0dc">Goku outside the solid block · inside: ${fighter.inside ? 'true' : 'false'}</div>`
      + `<div style="margin-top:3px;color:#88a5b8;font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace">block x ${block.x0}…${block.x1} · z ${block.z0}…${block.z1}</div>`;
    document.body.appendChild(label);
  }, { block: result.block, fighter: result.fighter });
  await page.waitForTimeout(120);
  const fileName = 'wuhu-cliff-collision.png';
  await page.screenshot({ path: resolve(outDir, fileName) });
  await page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = ''; }));
  const report = {
    title: 'Wuhu cliff collision stop',
    file: `artifacts/environment/arenas/wuhu-collision/${fileName}`,
    viewport: { width: 1280, height: 720 },
    block: result.block,
    fighter: result.fighter,
    camera: result.camera,
    spectate: result.spectate,
    pageErrors: errors
  };
  await writeFile(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  const blockingErrors = errors.filter(error => !/Failed to load resource/.test(error));
  if (!result.found || result.fighter?.inside || blockingErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
