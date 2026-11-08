import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd(), out = 'artifacts/konoha-audit', baseline = process.env.AUDIT_BASELINE || '';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    if (baseline && rel.endsWith('js/worlds/world_catalog.js')) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(await readFile(baseline)); }
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
const t0 = Date.now();
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
const loadMs = Date.now() - t0;
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki'); window.__browserSmashSelect?.select?.('p2', 'Goku'); window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForTimeout(1600);
const measure = () => page.evaluate(async () => {
  let root = window.fighters?.[0]?.model; while (root?.parent) root = root.parent;
  let tris = 0, verts = 0, meshes = 0, objects = 0, veg = 0, instancedMeshes = 0;
  const geos = new Set(), mats = new Set(), texs = new Set(); let geoBytes = 0;
  const visitMat = m => { if (!m || mats.has(m)) return; mats.add(m); for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); } };
  root.traverse(o => {
    objects++;
    if (o.name === 'konoha_vegetation') veg++;
    if (o.isInstancedMesh) instancedMeshes++;
    if (!o.isMesh || o.visible === false) return;
    meshes++;
    const g = o.geometry; if (g) {
      geos.add(g.uuid);
      const n = g.index ? g.index.count : (g.attributes?.position?.count || 0);
      const count = n / 3 * (o.isInstancedMesh ? o.count : 1);
      tris += count;
      verts += (g.attributes?.position?.count || 0) * (o.isInstancedMesh ? o.count : 1);
      if (!g.__bytes) { let b = 0; for (const a of Object.values(g.attributes || {})) b += a.array?.byteLength || 0; b += g.index?.array?.byteLength || 0; g.__bytes = b; }
      geoBytes += g.__bytes;
    }
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(visitMat);
  });
  const frame = () => new Promise(done => {
    const times = []; let last = performance.now(); const start = last;
    const tick = now => { times.push(now - last); last = now; if (now - start < 1200) requestAnimationFrame(tick); else done(times); };
    requestAnimationFrame(tick);
  });
  const times = (await frame()).sort((a, b) => a - b);
  const q = p => times[Math.min(times.length - 1, Math.floor(times.length * p))] || 0;
  const r = window.__browserSmashRenderer || window.renderer || null;
  return {
    triangles: Math.round(tris), vertices: verts, meshes, objects,
    vegetationMeshes: veg, instancedMeshes,
    geometries: geos.size, materials: mats.size, textures: texs.size,
    geometryBytes: geoBytes,
    rendererTriangles: r?.info?.render?.triangles ?? null, drawCalls: r?.info?.render?.calls ?? window.__browserSmashWorld?.drawCalls ?? null,
    points: r?.info?.render?.points ?? null, lines: r?.info?.render?.lines ?? null,
    gpuGeometries: r?.info?.memory?.geometries ?? null, gpuTextures: r?.info?.memory?.textures ?? null,
    avgFps: +(1000 / (times.reduce((a, b) => a + b, 0) / times.length)).toFixed(1),
    medianFrameMs: +q(.5).toFixed(2), p95FrameMs: +q(.95).toFixed(2), worstFrameMs: +(times[times.length - 1] || 0).toFixed(2),
    frames: times.length
  };
});
const stages = [['konoha_main_street', 'main-street'], ['konoha_hokage_rock', 'hokage-rock'], ['konoha_gates', 'gates'], ['konoha_academy', 'academy']];
const result = { baseline: !!baseline, loadMs, stages: {}, errors };
for (const [id, name] of stages) {
  await page.evaluate(k => { const s = document.querySelector('#mapSelect'); if (s) { s.value = k; s.dispatchEvent(new Event('change')); } window.__browserSmashApplyMap(k); }, id);
  await page.waitForTimeout(2400);
  const m = await measure();
  result.stages[name] = m;
  console.log('STAGE', name, JSON.stringify(m));
}
result.errors = errors;
await writeFile(`${out}/${baseline ? 'baseline' : 'current'}.json`, JSON.stringify(result, null, 2));
console.log('WROTE', baseline ? 'baseline' : 'current', 'loadMs=' + loadMs);
await Promise.race([browser.close(), new Promise(d => setTimeout(d, 2500))]);
server.close(); process.exit(0);
