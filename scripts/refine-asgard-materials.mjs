// Asgard material pass - only meaningful now that the Asgard arena is actually the mounted scene.
//
// Before the mounting fix, 1 178 CinematicValleyEnvironment meshes were visible on top of the palace,
// so any material change was judged through a valley skyline. This shoots the palace from a fixed
// camera, applies a small reversible tint to the confirmed Asgard materials, and shoots again from
// the same camera and graphics preset.
//
//   bash scripts/run-browser-test.sh scripts/refine-asgard-materials.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/asgard-mount';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.select('p1', 'Thor');
  window.__browserSmashSelect?.select('p2', 'Superman');
  window.__browserSmashSelect?.chooseArena('asgard');
});
await page.evaluate(() => document.querySelector('#play').click());
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(5000);

// A fixed shot so the only difference between the two images is the material change.
const frame = () => page.evaluate(() => {
  const f = window.fighters[0];
  window.__browserSmashFreezeAI = true;
  f.position.set(0, 0, -6); f.facing = 1; f.facingZ = 0;
  window.fighters[1].position.set(2.4, 0, -6);
  window.smashCamera?.spectate?.({ fighter: f, framing: 'wide', yaw: 0, pitch: 14, distance: 14 });
});
await frame();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/asgard-material-before.png` });
console.log('SHOT', `${out}/asgard-material-before.png`);

const applied = await page.evaluate(() => {
  const scene = window.__browserSmashScene;
  const THREE = window.__browserSmashThree;
  const layer = scene.children.find(child => /Blender cinematic arena/i.test(child.name || ''));
  const arena = layer?.children.find(child => /asgard/i.test(child.name || ''));
  if (!arena) return { ok: false, reason: 'asgard group not mounted' };
  const seen = new Map();
  arena.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid)) continue;
      seen.set(material.uuid, material);
    }
  });
  const changed = [];
  for (const material of seen.values()) {
    const name = String(material.name || '');
    const record = { name, before: {}, after: {} };
    // Royal gold: lift the gold so the palace reads as gold at gameplay distance instead of cream.
    if (/royal gold|gold/i.test(name) && material.emissive) {
      record.before.emissiveIntensity = +(material.emissiveIntensity ?? 1).toFixed(2);
      record.before.emissive = '#' + material.emissive.getHexString();
      material.emissive.setHex(0xffcf74);
      material.emissiveIntensity = 1.22;
      record.after.emissiveIntensity = 1.22;
      record.after.emissive = '#' + material.emissive.getHexString();
    }
    // Cliff and slate: cool the warm browns so the rock separates from the gold architecture.
    if (/cliff|slate/i.test(name) && material.color) {
      record.before.color = '#' + material.color.getHexString();
      const hsl = { h: 0, s: 0, l: 0 };
      material.color.getHSL(hsl);
      material.color.setHSL(hsl.h * 0.94, hsl.s * 0.9, Math.min(0.62, hsl.l * 1.05));
      record.after.color = '#' + material.color.getHexString();
    }
    material.needsUpdate = true;
    if (Object.keys(record.after).length) changed.push(record);
  }
  return { ok: true, materials: seen.size, changed };
});
console.log('ASGARD_MATERIALS', JSON.stringify(applied, null, 1));

await frame();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/asgard-material-after.png` });
console.log('SHOT', `${out}/asgard-material-after.png`);
console.log('ERRORS', JSON.stringify(errors.slice(0, 2)));
await browser.close();
server.close();
