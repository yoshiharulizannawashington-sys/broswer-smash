// Bake the authored Goku face geometry and expression morph targets into a derived GLB.
//
//   node scripts/bake-goku-face-rig.mjs
//   node scripts/bake-goku-face-rig.mjs <source.glb> <out.glb>
//
// The source GLB is a licensed Sketchfab import. It is never modified: this writes a derived file
// with a Goku_BakedFaceRig group under the existing Head bone, then leaves the original body and
// its skin untouched. The browser exporter is used because it can embed the source textures
// without a Node canvas implementation.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const source = process.argv[2] || 'public/models/characters/bespoke/goku_body.glb';
const output = process.argv[3] || 'public/models/characters/bespoke/goku_body_face_rigged.glb';
const reportPath = 'artifacts/goku-face-bake-report.json';
const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const errors = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 500)));
  await page.goto(origin + '/scripts/bake-goku-face-page.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__bakeReady === true, null, { timeout: 30_000 });
  const result = await page.evaluate(async sourceUrl => {
    const loader = new window.GLTFLoader();
    const gltf = await loader.loadAsync(sourceUrl);
    const scene = gltf.scene || gltf.scenes[0];
    scene.updateMatrixWorld(true);
    const bakeReport = window.bakeGokuFace(window.THREE, scene);
    const exporter = new window.GLTFExporter();
    const data = await new Promise((ok, fail) => exporter.parse(scene, ok, fail, {
      binary: true,
      embedImages: true,
      animations: gltf.animations || [],
      onlyVisible: true
    }));
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), bakeReport };
  }, '/' + source.replace(/^\/+/, ''));
  const buffer = Buffer.from(result.base64, 'base64');
  await writeFile(resolve(output), buffer);
  await writeFile(resolve(reportPath), JSON.stringify({
    generatedAt: new Date().toISOString(),
    source,
    output,
    bytes: buffer.length,
    bake: result.bakeReport,
    pageErrors: errors
  }, null, 2));
  console.log(JSON.stringify({ output, bytes: buffer.length, bake: result.bakeReport, pageErrors: errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
