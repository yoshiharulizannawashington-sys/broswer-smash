import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/environment/konoha/source';
await mkdir(out, { recursive: true });
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.bin':'application/octet-stream', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.hdr':'image/vnd.radiance', '.wasm':'application/wasm' };
const server = createServer(async (req,res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const views = [
  ['village-full', 'artifacts/asset-fetch/d9830d4348e94e32a9745b8bc130fd19/model.glb', ''],
  ['village-trimmed', 'artifacts/asset-fetch/d9830d4348e94e32a9745b8bc130fd19/model.glb', 'Object_3,Object_29,Object_32,Object_33'],
  ['office', 'artifacts/asset-fetch/07512299acb64f40a4b36d63286de7cf/model.glb', ''],
  ['mountain', 'artifacts/asset-fetch/c9cc3357a6ee46c2bff49c94e409fa99/model.glb', '']
];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  const report = [];
  for (const [name, model, hide] of views) {
    const url = `${origin}/scripts/_environment_viewer.html?model=${encodeURIComponent(model)}&hide=${encodeURIComponent(hide)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__environmentViewer?.ready === true || window.__environmentViewer?.error, null, { timeout: 120000, polling: 200 });
    const state = await page.evaluate(() => window.__environmentViewer);
    if (!state.ready) throw new Error(`${name}: ${state.error}`);
    await page.screenshot({ path: `${out}/${name}.png` });
    report.push({ name, model, hide, ...state });
    console.log(name, JSON.stringify(state.bounds.size.map(v => Math.round(v))), state.meshes, state.triangles);
  }
  await writeFile(`${out}/viewer-report.json`, JSON.stringify({ views: report, errors }, null, 2));
  if (errors.length) throw new Error(errors.join(' | '));
} finally { await browser?.close(); server.close(); }
