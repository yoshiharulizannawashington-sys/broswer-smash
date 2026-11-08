// Asgard material before/after, shot from identical cameras.
//
// The tuned pass is skipped when `__browserSmashAsgardTuning` is false, so both runs load the same
// GLB, the same arena and the same camera, and the only difference is the material values. Three
// distances are captured because the earlier attempt judged the palace from one wide shot and could
// not tell the difference.
//
//   bash scripts/run-browser-test.sh scripts/compare-asgard-materials.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/asgard-refine';
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

const VIEWS = [
  ['gameplay', { framing: 'full', yaw: 0, pitch: 14, distance: 14 }],
  ['fighter', { framing: 'torso', yaw: 0, pitch: 6, distance: 4 }],
  ['cinematic', { framing: 'full', yaw: 0, pitch: 24, distance: 26 }]
];
const report = {};

for (const mode of ['before', 'after']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  const logs = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  page.on('console', m => { if (/Asgard material tuning/.test(m.text())) logs.push(m.text()); });
  await page.addInitScript(enabled => { window.__browserSmashAsgardTuning = enabled; }, mode === 'after');
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', 'Thor');
    window.__browserSmashSelect?.select('p2', 'Superman');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const a = window.fighters[0], b = window.fighters[1];
    a.position.set(-1.2, 0, -2); a.facing = 1; a.facingZ = 0;
    b.position.set(1.6, 0, -2);
  });

  const materials = await page.evaluate(() => {
    const layer = window.__browserSmashScene.children.find(c => /Blender cinematic arena/i.test(c.name || ''));
    const arena = layer?.children.find(c => /asgard/i.test(c.name || ''));
    if (!arena) return { mounted: false };
    const seen = new Map();
    arena.traverse(n => {
      if (!n.isMesh || !n.material) return;
      for (const m of (Array.isArray(n.material) ? n.material : [n.material])) if (m && !seen.has(m.uuid)) seen.set(m.uuid, m);
    });
    return {
      mounted: true,
      tuning: window.__browserSmashArenaState?.()?.asgardTuning || null,
      materials: [...seen.values()].map(m => ({
        name: m.name,
        colour: m.color ? '#' + m.color.getHexString() : null,
        metalness: +(m.metalness ?? 0).toFixed(2),
        roughness: +(m.roughness ?? 0).toFixed(2),
        emissiveIntensity: +(m.emissiveIntensity ?? 1).toFixed(2),
        emissive: m.emissive ? '#' + m.emissive.getHexString() : null
      }))
    };
  });

  const views = [];
  for (const [name, pose] of VIEWS) {
    await page.evaluate(cfg => {
      // The fighters drift between runs, and the spectate camera orbits a fighter, so the pair is
      // pinned immediately before every shot. Without this the "before" and "after" cameras were
      // 1.19 m apart and the comparison was worthless.
      const a = window.fighters[0], b = window.fighters[1];
      a.position.set(-1.2, 0, -2); a.velocity?.set?.(0, 0, 0);
      b.position.set(1.6, 0, -2); b.velocity?.set?.(0, 0, 0);
      a.model.updateMatrixWorld(true);
      window.smashCamera.spectate({ fighter: a, ...cfg });
    }, pose);
    await page.waitForTimeout(1400);
    const file = `${out}/asgard-${mode}-${name}.png`;
    await page.screenshot({ path: file });
    const camera = await page.evaluate(() => {
      const c = window.smashCamera.camera;
      return { pos: [+c.position.x.toFixed(3), +c.position.y.toFixed(3), +c.position.z.toFixed(3)], fov: +c.fov.toFixed(2) };
    });
    views.push({ name, file, camera, pose });
  }
  report[mode] = { materials, views, errors, tuningLog: logs };
  await page.close();
}

// Camera parity is the whole point of the comparison.
const parity = report.before.views.map((v, i) => {
  const a = report.after.views[i].camera.pos, b = v.camera.pos;
  return { view: v.name, delta: +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4), before: b, after: a };
});
await writeFile(`${out}/asgard-materials.json`, JSON.stringify({ generatedAt: new Date().toISOString(), report, parity }, null, 2));
console.log('PARITY', JSON.stringify(parity));
console.log('BEFORE_MATERIALS', JSON.stringify(report.before.materials.materials || report.before.materials));
console.log('AFTER_MATERIALS', JSON.stringify(report.after.materials.materials || report.after.materials));
console.log('TUNING', JSON.stringify(report.after.materials.tuning));
console.log('ERRORS', JSON.stringify({ before: report.before.errors, after: report.after.errors }));
console.log(`Captured ${Object.keys(report).length * VIEWS.length} Asgard frames.`);
await browser.close();
server.close();
