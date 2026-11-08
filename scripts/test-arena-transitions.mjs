// Explicit in-session arena transition chain: Asgard → Hogwarts → Death Star → Tournament → Asgard.
//
// For each switch this checks that the intended arena actually mounted and is the only visible
// arena, that floor material, fog, background and exposure match that arena, that the switch
// recorded no error, and that returning to Asgard reproduces the same materials (no compounding,
// no leaked marble from the previous arena).
//
//   bash scripts/run-browser-test.sh scripts/test-arena-transitions.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/arena-transitions';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'image/vnd.radiance', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

const SEQUENCE = ['asgard', 'hogwarts', 'deathstar', 'tournament', 'asgard'];
const EXPECTED = {
  asgard: { background: '7fa3c6', fog: '8fa3b4', exposure: 0.8 },
  hogwarts: { background: '171a2d', fog: '41414b', exposure: 1 },
  deathstar: { background: '070b14', fog: '202b3a', exposure: 1.06 },
  tournament: { background: '4a7596', fog: '9ab5c5', exposure: 0.98 }
};

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(150000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  });

  const read = () => page.evaluate(() => {
    const scene = window.__browserSmashScene;
    // A child of a hidden arena group still reports visible === true, so every visibility test here
    // walks the parent chain instead of trusting the local flag.
    const effectivelyVisible = object => {
      for (let node = object; node; node = node.parent) if (node.visible === false) return false;
      return true;
    };
    const visibleArenas = [];
    scene?.traverse?.(node => {
      if (!node.isGroup || !effectivelyVisible(node)) return;
      for (const child of node.children || []) {
        if (!effectivelyVisible(child)) continue;
        const name = child.name || '';
        const match = name.match(/^Blender arena · (.+)$/) || name.match(/^arena_(.+)$/);
        if (match) visibleArenas.push(match[1]);
      }
    });
    const marble = new Set();
    const architecture = [];
    scene?.traverse?.(node => {
      if (!node.isMesh || !effectivelyVisible(node)) return;
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      if (/city marble/i.test(material?.name || '')) marble.add(material.uuid + ':' + material.color.getHexString());
      if (/Asgard marble architecture/i.test(node.name || '')) architecture.push(node.geometry?.attributes?.position?.count || 0);
    });
    return {
      state: { ...window.__browserSmashApplyMapState },
      floor: window.__browserSmashFloorState(),
      background: scene?.background ? (scene.background.isColor ? scene.background.getHexString() : (scene.background.isTexture ? 'texture' : 'other')) : null,
      skyColour: window.__browserSmashSkyColour || null,
      fog: scene?.fog?.color?.getHexString?.() || null,
      exposure: window.__browserSmashRenderer?.toneMappingExposure ?? null,
      arenas: structuredClone(window.__browserSmashAssets?.arenas || {}),
      visibleArenas: [...new Set(visibleArenas)],
      marbleMaterials: [...marble].sort(),
      architecture,
      asgardArchitecture: window.__browserSmashAsgardArchitecture || null
    };
  });

  const stages = [];
  for (const key of SEQUENCE) {
    await page.evaluate(k => window.__browserSmashApplyMap(k), key);
    await page.waitForFunction(k => window.__browserSmashApplyMapState?.key === k && window.__browserSmashApplyMapState?.ok === true, key, { timeout: 20000, polling: 80 }).catch(() => null);
    await page.waitForFunction(k => {
      const arena = window.__browserSmashAssets?.arenas?.[k];
      return !arena || arena.status !== 'loading';
    }, key, { timeout: 25000, polling: 150 }).catch(() => null);
    await page.waitForTimeout(900);
    const snapshot = await read();
    stages.push({ key, ...snapshot });
    await page.screenshot({ path: `${out}/${stages.length}-${key}.png` });

    check(`${key}: switch recorded no error`, snapshot.state.ok === true && snapshot.state.key === key && !snapshot.state.error, JSON.stringify(snapshot.state));
    check(`${key}: authored arena mounted`, Boolean(snapshot.arenas[key]) && snapshot.arenas[key].status === 'loaded' && snapshot.visibleArenas.length > 0, JSON.stringify({ arena: snapshot.arenas[key], visible: snapshot.visibleArenas }));
    const expected = EXPECTED[key];
    // The sky is an HDRI/sky dome in some environments, so the arena palette is asserted through the
    // colour main.js records for the switch, alongside fog and exposure.
    check(`${key}: lighting, fog and background belong to this arena`,
      snapshot.skyColour === parseInt(expected.background, 16) && snapshot.fog === expected.fog && Math.abs((snapshot.exposure ?? 0) - expected.exposure) < 0.001,
      JSON.stringify({ skyColour: snapshot.skyColour, fog: snapshot.fog, exposure: snapshot.exposure, background: snapshot.background }));
    check(`${key}: floor material is this arena's`, snapshot.floor?.key === key, JSON.stringify(snapshot.floor));    check(`${key}: no other arena is visible at the same time`,
      snapshot.visibleArenas.length === 1 && snapshot.visibleArenas[0] === key, snapshot.visibleArenas.join(', '));
  }

  const firstAsgard = stages[0];
  const lastAsgard = stages[stages.length - 1];
  check('returning to Asgard reuses the same marble materials (no compounding)',
    JSON.stringify(firstAsgard.marbleMaterials) === JSON.stringify(lastAsgard.marbleMaterials),
    `${firstAsgard.marbleMaterials.length} vs ${lastAsgard.marbleMaterials.length} materials`);
  check('Asgard architecture is built once and survives the round trip',
    firstAsgard.architecture.length > 0 && JSON.stringify(firstAsgard.architecture) === JSON.stringify(lastAsgard.architecture),
    `meshes ${firstAsgard.architecture.length} -> ${lastAsgard.architecture.length}, parts ${firstAsgard.asgardArchitecture?.added}`);
  const hogwarts = stages.find(stage => stage.key === 'hogwarts');
  check('Asgard marble does not leak into Hogwarts',
    !hogwarts.marbleMaterials.length, hogwarts.marbleMaterials.slice(0, 2).join(', '));
  check('no uncaught page errors across the whole chain', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  await writeFile(`${out}/report.json`, JSON.stringify({ stages, pageErrors }, null, 2));
  console.log('TRANSITIONS ' + JSON.stringify({
    sequence: SEQUENCE,
    asgardArchitecture: lastAsgard.asgardArchitecture,
    marbleMaterials: lastAsgard.marbleMaterials.length,
    errors: pageErrors.length,
    stages: stages.map(stage => ({ key: stage.key, floor: stage.floor?.color, background: stage.background, exposure: stage.exposure }))
  }));
} finally {
  await browser?.close();
  server.close();
}
console.log(failures === 0 ? '\nArena transition chain passed.' : `\nArena transition chain FAILED (${failures}).`);
process.exitCode = failures === 0 ? 0 : 1;
