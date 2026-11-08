// Texture allocation sources across character swaps, arena switches and match lifecycles.
//
//   bash scripts/run-browser-test.sh scripts/probe-texture-sources.mjs
//
// renderer.info.memory.textures only says how many textures exist. This probe names each new one:
// every texture reachable from the scene (and scene.environment) is inventoried by uuid, and after
// each action the newly appeared uuids are reported with the material and mesh that mount them,
// the surface-detail class if any, and the arena whose switch introduced them. That is what turns
// "textures grow" into "this allocation path grows".
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const flagValue = name => {
  const hit = process.argv.slice(2).find(arg => arg.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const outDir = resolve(root, 'artifacts/phase22-2');
await mkdir(outDir, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const SWAPS = Math.max(1, Number(flagValue('swaps') ?? 30) || 30);
const CYCLES = Math.max(1, Number(flagValue('cycles') ?? 5) || 5);
const report = { swaps: [], arenas: [], lifecycle: [], errors: [] };
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc']
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => report.errors.push(String(error.message || error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push('console: ' + message.text()); });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
    } catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });

  // Inventory by uuid, with the first place each texture was seen. Textures are attached to
  // materials, so a name alone would not identify the allocation path; the material name and the
  // mesh that carried it do.
  const inventory = () => page.evaluate(() => {
    const renderer = window.__browserSmashRenderer;
    const scene = window.__browserSmashScene;
    const seen = new Map();
    const note = (texture, where) => {
      if (!texture) return;
      const index = texture.uuid;
      if (seen.has(index)) return;
      seen.set(index, {
        uuid: index, name: texture.name || '', type: texture.type || texture.constructor?.name || '',
        width: texture.image?.width || null, height: texture.image?.height || null,
        where, surfaceDetail: texture.userData?.surfaceDetail || null
      });
    };
    scene?.traverse(node => {
      const list = Array.isArray(node.material) ? node.material : (node.material ? [node.material] : []);
      for (const material of list) {
        const maps = {};
        for (const [slot, value] of Object.entries(material || {})) {
          if (value && value.isTexture) { note(value, `${node.name || node.type} · ${material.name || 'unnamed'}.${slot}`); maps[slot] = value.name || value.type; }
        }
      }
    });
    if (scene?.environment) note(scene.environment, 'scene.environment');
    if (scene?.background?.isTexture) note(scene.background, 'scene.background');
    return {
      textures: renderer?.info?.memory?.textures ?? null,
      geometries: renderer?.info?.memory?.geometries ?? null,
      calls: renderer?.info?.render?.calls ?? null,
      ownership: window.__browserSmashTextureOwnership?.() || null,
      entries: [...seen.values()]
    };
  });

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.fighters?.length === 2 && window.__browserSmashRenderer, null, { timeout: 180_000 });
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForTimeout(2000);

  const known = new Map();
  const noteNew = (entries, label) => {
    const added = [];
    for (const entry of entries) {
      if (known.has(entry.uuid)) continue;
      known.set(entry.uuid, entry);
      added.push(entry);
    }
    return added;
  };
  const first = await inventory();
  noteNew(first.entries, 'baseline');
  report.baseline = { textures: first.textures, geometries: first.geometries, calls: first.calls };

  const names = ['Superman', 'Goku', 'Vegeta', 'Thor', 'Hulk (Bruce Banner)', 'Spider-Man', 'Kratos', 'Aang'];
  for (let i = 0; i < SWAPS; i++) {
    const p1 = names[i % names.length];
    const p2 = names[(i + 3) % names.length];
    await page.evaluate(([a, b]) => {
      window.__browserSmashSelect?.select('p1', a);
      window.__browserSmashSelect?.select('p2', b);
    }, [p1, p2]);
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__browserSmashStep?.(0.1));
    const now = await inventory();
    const added = noteNew(now.entries, `swap ${i + 1}`);
    report.swaps.push({ i: i + 1, p1, p2, textures: now.textures, geometries: now.geometries, calls: now.calls, added });
  }

  // Arena cycle, five times over: a stable map must not allocate on its second visit.
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    for (const map of ['volcano', 'ice', 'neon', 'valley']) {
      await page.evaluate(key => {
        const select = document.querySelector('#mapSelect');
        if (!select) return;
        select.value = key;
        select.dispatchEvent(new Event('change'));
      }, map);
      await page.waitForTimeout(1100);
      const now = await inventory();
      const added = noteNew(now.entries, `${map} cycle ${cycle + 1}`);
      report.arenas.push({ cycle: cycle + 1, map, textures: now.textures, geometries: now.geometries, calls: now.calls, added,
        environment: now.entries.find(e => e.where === 'scene.environment')?.uuid || null });
    }
  }

  // Full lifecycle: enter a match, return to setup, change fighter and arena.
  for (let cycle = 0; cycle < Math.min(3, CYCLES); cycle++) {
    await page.evaluate(key => {
      const select = document.querySelector('#mapSelect');
      if (select) { select.value = key; select.dispatchEvent(new Event('change')); }
    }, ['volcano', 'ice', 'neon', 'valley'][cycle % 4]);
    await page.evaluate(() => document.querySelector('#play')?.click());
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__browserSmashStep?.(0.4));
    await page.evaluate(() => window.__browserSmashPause?.open());
    await page.click('#pauseMenu [data-action="select"]');
    await page.waitForTimeout(500);
    await page.evaluate(name => window.__browserSmashSelect?.select('p1', name), names[cycle % names.length]);
    await page.waitForTimeout(500);
    const now = await inventory();
    const added = noteNew(now.entries, `lifecycle ${cycle + 1}`);
    report.lifecycle.push({ cycle: cycle + 1, textures: now.textures, geometries: now.geometries, calls: now.calls,
      ownership: now.ownership, added });
  }

  const tail = report.swaps.slice(-8);
  report.plateau = {
    textureSpreadLast8: Math.max(...tail.map(s => s.textures)) - Math.min(...tail.map(s => s.textures)),
    texturesAfterSwap30: report.swaps.at(-1).textures,
    arenaGrowth: report.arenas.slice(-4).map(a => a.textures),
    lifecycleGrowth: report.lifecycle.map(l => l.textures),
    uniqueAddedTextures: known.size
  };
  await writeFile(resolve(outDir, 'texture-sources.json'), JSON.stringify(report, null, 2));
  console.log('BASELINE ' + JSON.stringify(report.baseline));
  console.log('SWAPS ' + report.swaps.map(s => `${s.i}:t${s.textures}/g${s.geometries}`).join(' '));
  console.log('ARENAS ' + report.arenas.map(a => `${a.map[0]}${a.cycle}:t${a.textures}/+${a.added.length}`).join(' '));
  console.log('LIFECYCLE ' + report.lifecycle.map(l => `t${l.textures}/g${l.geometries}/+${l.added.length}`).join(' '));
  console.log('SAMPLE ADDED ' + JSON.stringify(report.swaps.flatMap(s => s.added).slice(0, 12)));
  console.log('ERRORS ' + JSON.stringify(report.errors.slice(0, 3)));
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
