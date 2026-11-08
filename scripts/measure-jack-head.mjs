// Measure Jack Sparrow's head before touching it again.
//
// The previous hat attempt used guessed head-local coordinates and produced a black ring across the
// eyes. This probe reports the numbers the geometry must be authored against: the head group's real
// bounding box and transform, every child mesh of the head with its position/size/colour (face and
// hat both), the hat pieces by material colour with their parent, and the camera positions used for
// front / three-quarter / side framing.
//
//   bash scripts/run-browser-test.sh scripts/measure-jack-head.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/diagnostics';
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

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Captain Jack Sparrow');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 0; f.facingZ = 1;
    const other = window.fighters[1];
    other.position.set(14, .6, 14);
    other.model.visible = false;
  });
  await new Promise(r => setTimeout(r, 900));

  const data = await page.evaluate(() => {
    const f = window.fighters[0];
    f.model.updateMatrixWorld(true);
    const head = f.model.userData.head;
    const round = n => +Number(n).toFixed(4);
    const vec = v => v ? [round(v.x), round(v.y), round(v.z)] : null;

    // Box3 is not in page scope, so extents are derived from each mesh's own geometry box, offset by
    // the mesh's position (local, in the head frame) and transformed by its world matrix (world).
    const measure = node => {
      if (!node?.geometry) return null;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const bb = node.geometry.boundingBox;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      const lmin = [Infinity, Infinity, Infinity], lmax = [-Infinity, -Infinity, -Infinity];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const world = node.position.clone().set(x, y, z).applyMatrix4(node.matrixWorld);
        const local = node.position.clone().set(x, y, z);
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], world.getComponent(i));
          max[i] = Math.max(max[i], world.getComponent(i));
          lmin[i] = Math.min(lmin[i], local.getComponent(i));
          lmax[i] = Math.max(lmax[i], local.getComponent(i));
        }
      }
      return {
        local: { min: lmin.map(round), max: lmax.map(round), size: lmax.map((v, i) => round(v - lmin[i])) },
        world: { min: min.map(round), max: max.map(round), size: max.map((v, i) => round(v - min[i])) }
      };
    };

    const headBox = measure(head);
    const rows = [];
    const walk = (node, depth, parentName) => {
      node.children.forEach(child => {
        const geo = measure(child);
        const mat = Array.isArray(child.material) ? child.material[0] : child.material;
        rows.push({
          depth,
          name: child.name || '(unnamed)',
          type: child.type,
          parent: parentName,
          materialColor: mat?.color ? '#' + mat.color.getHexString() : null,
          position: vec(child.position),
          rotation: child.rotation ? [round(child.rotation.x), round(child.rotation.y), round(child.rotation.z)] : null,
          isMesh: Boolean(child.isMesh),
          localSize: geo ? geo.local.size : null,
          localBox: geo ? geo.local : null,
          worldSize: geo ? geo.world.size : null
        });
        walk(child, depth + 1, child.name || '(unnamed)');
      });
    };
    walk(head, 0, 'head');

    const HAT_COLOURS = { '#241b14': 'leather', '#3a2c1f': 'leatherEdge', '#c39a52': 'hatGold' };
    const hat = rows.filter(r => r.materialColor && HAT_COLOURS[r.materialColor]).map(r => ({ ...r, part: HAT_COLOURS[r.materialColor] }));

    const worldPos = head.position.clone();
    head.getWorldPosition(worldPos);

    return {
      head: {
        name: head?.name || null,
        isBone: Boolean(head?.isBone),
        localPosition: vec(head.position),
        localRotation: head.rotation ? [round(head.rotation.x), round(head.rotation.y), round(head.rotation.z)] : null,
        scale: vec(head.scale),
        worldPosition: vec(worldPos),
        box: headBox
      },
      children: rows,
      hat,
      skinnedMeshes: (() => { let n = 0; f.model.traverse(o => { if (o.isSkinnedMesh) n++; }); return n; })(),
      modelScale: vec(f.model.scale),
      fighterScale: f.model.userData.visualScale || 1
    };
  });

  const cameras = {};
  for (const [name, yaw] of [['front', 0], ['threeQuarter', 42], ['side', 90]]) {
    const info = await page.evaluate(yaw => {
      window.smashCamera?.spectate?.({ fighter: window.fighters[0], framing: 'head', yaw, pitch: 0 });
      const cam = window.smashCamera?.camera;
      return cam ? { position: cam.position.toArray().map(v => +v.toFixed(3)), fov: cam.fov } : null;
    }, yaw);
    await new Promise(r => setTimeout(r, 350));
    cameras[name] = { yaw, ...(info || {}) };
  }
  await page.evaluate(() => window.smashCamera?.endSpectate?.());

  console.log('HEAD', JSON.stringify(data.head, null, 1));
  console.log('\nHEAD CHILDREN (head-local frame; y is vertical from the head group origin)');
  for (const row of data.children) {
    console.log(`  ${'  '.repeat(row.depth)}${row.name.padEnd(28)} ${String(row.materialColor || '').padEnd(9)} y=${String(row.position?.[1]).padStart(8)} z=${String(row.position?.[2]).padStart(8)} size=${JSON.stringify(row.localSize)}`);
  }
  console.log(`\nHAT PARTS (${data.hat.length})`);
  for (const row of data.hat) {
    console.log(`  ${row.part.padEnd(12)} ${row.name.padEnd(20)} y=${String(row.position?.[1]).padStart(8)} z=${String(row.position?.[2]).padStart(8)} size=${JSON.stringify(row.localSize)} parent=${row.parent}`);
  }
  console.log('\nCAMERAS', JSON.stringify(cameras));
  console.log('skinnedMeshes', data.skinnedMeshes, 'modelScale', JSON.stringify(data.modelScale), 'fighterScale', data.fighterScale);

  await page.screenshot({ path: `${out}/jack-head-measure.png` });
  await writeFile(`${out}/jack-head-measurements.json`, JSON.stringify({ ...data, cameras, errors, generatedAt: new Date().toISOString() }, null, 2));
  console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
  console.log('wrote', `${out}/jack-head-measurements.json`);
} finally {
  await browser?.close();
  server.close();
}
