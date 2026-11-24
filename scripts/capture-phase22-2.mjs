// Phase 22.2 capture harness: one requested fighter, seven deterministic views, verified model.
//
//   node scripts/capture-phase22-2.mjs --self-test
//   bash scripts/run-browser-test.sh scripts/capture-phase22-2.mjs --only=thor
//   bash scripts/run-browser-test.sh scripts/capture-phase22-2.mjs --only=thor --force
//
// Arguments are parsed and validated BEFORE a browser starts, and `--self-test` exercises the
// parser with no browser at all. A requested slug must be an enabled manifest entry; a slug that
// is unknown stops the run instead of quietly capturing a different body.
//
// Every view re-applies its own yaw through the preview's setYaw() and re-frames the camera from
// the measured bounding box. The earlier harness wrote root.rotation.y directly, but the preview's
// animation frame re-applied its stored yawOverride on the next frame - so a "head front" shot
// taken after the rear view was rendered from behind. setYaw(0) is the only correct reset.
//
// Before any image is written the loaded body is checked against the GLB named by the manifest:
// the triangle and mesh counts read from the file on disk must equal the counts in the preview.
// A fallback procedural body cannot pass that check.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const DEFAULT_OUT = 'artifacts/phase22-2/roster';
const PHASE = '22.2';
const W = 420, H = 560;

// ---------------------------------------------------------------- argument parsing (testable)
const KNOWN_FLAGS = new Set(['only', 'slugs', 'output', 'force', 'self-test']);

function parseArgs(raw, enabledSlugs) {
  const options = { slugs: [], output: DEFAULT_OUT, force: false, selfTest: false };
  const picked = [];
  for (const arg of raw) {
    if (arg === '--force') { options.force = true; continue; }
    if (arg === '--self-test') { options.selfTest = true; continue; }
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`unrecognised argument "${arg}" (expected --flag=value)`);
    const [, name, value] = match;
    if (!KNOWN_FLAGS.has(name)) throw new Error(`unknown flag --${name}`);
    if (name === 'output') {
      if (!value.trim()) throw new Error('--output needs a directory');
      options.output = value.trim();
      continue;
    }
    if (name === 'self-test' || name === 'force') throw new Error(`--${name} does not take a value`);
    if (!value.trim()) throw new Error(`--${name} needs at least one fighter slug`);
    const list = value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) throw new Error(`--${name} needs at least one fighter slug`);
    for (const slug of list) {
      if (!/^[a-z0-9_]+$/.test(slug)) throw new Error(`"${slug}" is not a fighter slug`);
      if (!enabledSlugs.has(slug)) throw new Error(`"${slug}" is not an enabled fighter in the manifest`);
      if (!picked.includes(slug)) picked.push(slug);
    }
  }
  if (!options.selfTest && !picked.length) {
    throw new Error('nothing requested: pass --only=<slug> (or --self-test)');
  }
  options.slugs = picked;
  return options;
}

// ---------------------------------------------------------------- GLB ground truth (no browser)
function glbStats(path) {
  const buffer = require('node:fs').readFileSync(path);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const accessorCount = index => {
    const accessor = json.accessors?.[index];
    if (!accessor) throw new Error('missing accessor ' + index + ' in ' + path);
    return accessor.count;
  };
  let triangles = 0, meshes = 0, primitives = 0;
  for (const mesh of json.meshes || []) {
    meshes++;
    for (const primitive of mesh.primitives || []) {
      primitives++;
      const count = primitive.indices !== undefined
        ? accessorCount(primitive.indices)
        : accessorCount(primitive.attributes?.POSITION);
      triangles += count / 3;
    }
  }
  return { triangles: Math.round(triangles), meshes, primitives, bytes: buffer.length, clips: (json.animations || []).length };
}

// CommonJS require inside an ES module, for the synchronous GLB read above.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------- parser self-test
async function selfTest() {
  const manifest = JSON.parse(await readFile(resolve(root, 'public/models/characters/manifest.json'), 'utf8'));
  const enabled = new Set(Object.entries(manifest.characters || {})
    .filter(([, entry]) => entry?.enabled === true && entry.url)
    .map(([slug]) => slug));
  const cases = [];
  const expect = (name, fn, check) => {
    try { check(fn()); cases.push({ name, ok: true }); }
    catch (error) { cases.push({ name, ok: false, detail: String(error.message || error) }); }
  };
  const expectThrows = (name, fn, fragment) => {
    try { fn(); cases.push({ name, ok: false, detail: 'did not throw' }); }
    catch (error) {
      const ok = String(error.message || error).includes(fragment);
      cases.push({ name, ok, detail: ok ? '' : String(error.message || error) });
    }
  };
  expect('--only=thor selects only Thor', () => {
    const o = parseArgs(['--only=thor'], enabled);
    if (o.slugs.length !== 1 || o.slugs[0] !== 'thor') throw new Error(JSON.stringify(o));
    return o;
  }, o => o.slugs.join(',') === 'thor');
  expect('--only=wonder_woman keeps the underscore slug', () => {
    const o = parseArgs(['--only=wonder_woman'], enabled);
    if (o.slugs[0] !== 'wonder_woman') throw new Error(o.slugs.join(','));
    return o;
  }, o => o.slugs[0] === 'wonder_woman');
  expect('--slugs=thor,wonder_woman accepts a list', () => {
    const o = parseArgs(['--slugs=thor,wonder_woman'], enabled);
    if (o.slugs.join(',') !== 'thor,wonder_woman') throw new Error(o.slugs.join(','));
    return o;
  }, o => o.slugs.length === 2);
  expect('--output=artifacts/example is honoured', () => {
    const o = parseArgs(['--only=thor', '--output=artifacts/example'], enabled);
    if (o.output !== 'artifacts/example') throw new Error(o.output);
    return o;
  }, o => o.output === 'artifacts/example');
  expect('duplicates collapse', () => {
    const o = parseArgs(['--slugs=thor,thor'], enabled);
    if (o.slugs.length !== 1) throw new Error(o.slugs.join(','));
    return o;
  }, o => o.slugs.length === 1);
  expectThrows('unknown slug is rejected by name',
    () => parseArgs(['--only=not_a_fighter'], enabled), 'not_a_fighter');
  expectThrows('unknown flag is rejected', () => parseArgs(['--nope=1'], enabled), 'unknown flag');
  expectThrows('missing value is rejected', () => parseArgs(['--only='], enabled), 'at least one');
  expectThrows('no request is rejected', () => parseArgs([], enabled), 'nothing requested');

  const failed = cases.filter(c => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  // Ground truth has to work too, or the pre-flight model check is meaningless.
  let sample = null;
  try {
    sample = glbStats(resolve(root, 'public/models/characters/roster/thor.glb'));
    console.log(`  ok   GLB reader: thor ${sample.triangles} triangles, ${sample.meshes} meshes, ${sample.clips} clips`);
  } catch (error) {
    failed.push({ name: 'GLB reader', detail: String(error.message || error) });
    console.log('  FAIL GLB reader — ' + String(error.message || error));
  }
  if (failed.length) { console.error(`\n${failed.length} parser checks failed`); process.exit(1); }
  console.log(`\nparser self-test: ${cases.length} checks passed`);
}

// ---------------------------------------------------------------- capture
if (argv.includes('--self-test')) {
  await selfTest();
  process.exit(0);
}

const manifest = JSON.parse(await readFile(resolve(root, 'public/models/characters/manifest.json'), 'utf8'));
const entries = Object.entries(manifest.characters || {}).filter(([, entry]) => entry?.enabled === true && entry.url);
const enabledSlugs = new Set(entries.map(([slug]) => slug));
const options = parseArgs(argv, enabledSlugs);
const outDir = resolve(root, options.output);
const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const TRI_TOLERANCE = 1;

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
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const VIEWS = [
  { view: 'front', yaw: 0, framing: 'body' },
  { view: 'quarter', yaw: Math.PI / 4, framing: 'body' },
  { view: 'side', yaw: Math.PI / 2, framing: 'body' },
  { view: 'rear', yaw: Math.PI, framing: 'body' },
  { view: 'head-front', yaw: 0, framing: 'head' },
  { view: 'head-quarter', yaw: Math.PI / 4, framing: 'head' },
  { view: 'equipment', yaw: 0.5, framing: 'equipment' }
];

let browser;
const pageErrors = [];
const failed = [];
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 520, height: 640 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', error => pageErrors.push(String(error).split('\n')[0]));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120_000 });

  // The page's own launch roster is the authority on which fighters this screen can show.
  const launch = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
  if (!launch.length) throw new Error('the page published no launch roster');
  const launchSlugs = new Map(launch.map(name => [slugOf(name), name]));
  const unknown = options.slugs.filter(slug => !launchSlugs.has(slug));
  if (unknown.length) throw new Error(`not in the launch roster: ${unknown.join(', ')}`);

  // Strip the setup screen to the preview canvas once, at the capture size.
  await page.evaluate(({ w, h }) => {
    const panel = document.querySelector('#selectScreen [data-role="preview"]');
    const canvasEl = panel.querySelector('canvas');
    for (const el of document.querySelectorAll('#selectScreen *')) {
      if (el === canvasEl || el.contains(canvasEl)) continue;
      el.style.setProperty('display', 'none', 'important');
    }
    const screen = document.querySelector('#selectScreen');
    if (screen) screen.style.setProperty('background', 'transparent', 'important');
    const force = (el, prop, value) => el.style.setProperty(prop, value, 'important');
    for (const [prop, value] of [['height', h + 'px'], ['min-height', h + 'px'], ['width', w + 'px'],
      ['max-width', 'none'], ['border', 'none'], ['background', 'transparent'],
      ['box-shadow', 'none'], ['position', 'static'], ['padding', '0']]) force(panel, prop, value);
    for (const [prop, value] of [['width', w + 'px'], ['height', h + 'px'], ['display', 'block'], ['background', 'transparent']]) force(canvasEl, prop, value);
  }, { w: W, h: H });
  await page.waitForTimeout(300);
  const size = await page.evaluate(() => {
    const canvas = document.querySelector('#selectScreen [data-role="preview"] canvas');
    const rect = canvas.getBoundingClientRect();
    return { rw: Math.round(rect.width), rh: Math.round(rect.height) };
  });
  if (Math.abs(size.rw - W) > 3 || Math.abs(size.rh - H) > 3) {
    throw new Error('preview canvas is not the capture size: ' + JSON.stringify(size));
  }
  const box = await page.locator('#selectScreen [data-role="preview"] canvas').boundingBox();
  if (!box) throw new Error('preview canvas has no layout box');
  const cdp = await page.context().newCDPSession(page);
  const shoot = async path => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1.25 }
    });
    await writeFile(path, Buffer.from(data, 'base64'));
  };

  // Aim the preview's own camera at either the whole body, the head or the chest/hands band.
  const aim = (framing, yaw) => page.evaluate(({ framing, yaw }) => {
    const debug = window.__fighterPreviewDebug;
    if (!debug?.root || !debug?.camera) return { error: 'no preview debug handle' };
    window.__browserSmashPreview.setYaw(yaw);
    const rootEl = debug.root;
    rootEl.updateMatrixWorld(true);
    const boxMin = debug.boxMin, boxMax = debug.boxMax;
    const height = Math.max(0.5, boxMax[1] - boxMin[1]);
    const camera = debug.camera;
    let target, span;
    if (framing === 'head') {
      const head = rootEl.getObjectByName('head') || rootEl.getObjectByName('Head') || rootEl.getObjectByName('mixamorigHead');
      const v = camera.position.clone();
      if (head) head.getWorldPosition(v);
      else v.set((boxMin[0] + boxMax[0]) / 2, boxMax[1] - height * 0.09, (boxMin[2] + boxMax[2]) / 2);
      target = v.toArray();
      span = Math.max(0.30, height * 0.26);
    } else if (framing === 'equipment') {
      target = [(boxMin[0] + boxMax[0]) / 2, boxMin[1] + height * 0.56, (boxMin[2] + boxMax[2]) / 2];
      span = Math.max(0.62, height * 0.46);
    } else {
      target = [(boxMin[0] + boxMax[0]) / 2, (boxMin[1] + boxMax[1]) / 2, (boxMin[2] + boxMax[2]) / 2];
      span = height;
    }
    const fov = camera.fov * Math.PI / 180;
    const distance = (span * 0.5) / Math.tan(fov / 2) * (framing === 'body' ? 1.04 : 1.0);
    camera.position.set(target[0], target[1], target[2] + distance);
    camera.near = Math.max(0.01, distance * 0.04);
    camera.far = distance * 8;
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
    rootEl.updateMatrixWorld(true);
    return {
      yawRequested: yaw,
      yawApplied: +rootEl.rotation.y.toFixed(4),
      camera: camera.position.toArray().map(v => +v.toFixed(3)),
      target: target.map(v => +v.toFixed(3)),
      headBone: rootEl.getObjectByName('head')?.name || null
    };
  }, { framing, yaw });

  const frames = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));

  for (const slug of options.slugs) {
    const dir = resolve(outDir, slug);
    if (!options.force && existsSync(resolve(dir, 'metadata.json'))) {
      const previous = JSON.parse(await readFile(resolve(dir, 'metadata.json'), 'utf8'));
      if (previous?.status === 'complete' && previous?.current === true) {
        console.log(`cached ${slug} (metadata complete; --force to recapture)`);
        continue;
      }
    }
    await mkdir(dir, { recursive: true });
    pageErrors.length = 0;
    const local = { slug, label: launchSlugs.get(slug), status: 'failed', phase: PHASE, current: true };
    try {
      const entry = manifest.characters[slug];
      const glbPath = resolve(root, 'public' + entry.url);
      const declared = glbStats(glbPath);
      local.sourceGlb = 'public' + entry.url;
      local.sourceBytes = declared.bytes;

      await page.evaluate(async s => {
        window.__browserSmashPreview.setYaw(0);
        await window.__browserSmashPreview.show(s, s);
      }, slug);
      await frames();
      const state = await page.evaluate(() =>
        document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state || 'missing');
      local.state = state;
      if (state !== 'ready') throw new Error(`preview state "${state}" is not "ready" (fallback body?)`);

      const measured = await page.evaluate(() => {
        const debug = window.__fighterPreviewDebug;
        if (!debug?.root) return { error: 'no model root' };
        const stats = { meshes: 0, triangles: 0, materials: 0 };
        const materials = new Set();
        debug.root.traverse(node => {
          if (!node.isMesh) return;
          stats.meshes++;
          const geo = node.geometry;
          stats.triangles += geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3;
          for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
            if (material) materials.add(material.uuid);
          }
        });
        stats.triangles = Math.round(stats.triangles);
        stats.materials = materials.size;
        stats.rootVisible = debug.root.visible !== false;
        return stats;
      });
      local.triangles = measured.triangles;
      local.meshes = measured.meshes;
      local.materials = measured.materials;
      if (!measured.rootVisible) throw new Error('model root is not visible');
      if (Math.abs(measured.triangles - declared.triangles) > TRI_TOLERANCE) {
        throw new Error(`triangle mismatch: preview ${measured.triangles}, ${local.sourceGlb} has ${declared.triangles}`);
      }
      // One glTF mesh with several primitives becomes several SkinnedMesh nodes in three.js, so
      // the renderable-node count is compared with the primitive count, not the mesh count.
      if (measured.meshes !== declared.primitives) {
        throw new Error(`mesh mismatch: preview ${measured.meshes}, ${local.sourceGlb} has ${declared.primitives} primitives`);
      }
      local.declared = declared;

      local.views = [];
      for (const view of VIEWS) {
        const applied = await aim(view.framing, view.yaw);
        if (applied.error) throw new Error(applied.error);
        await frames();
        // Read the live values after a frame, so a re-applied yaw cannot slip into the file.
        const live = await page.evaluate(() => ({
          yaw: +window.__fighterPreviewDebug.root.rotation.y.toFixed(4),
          camera: window.__fighterPreviewDebug.camera.position.toArray().map(v => +v.toFixed(3))
        }));
        if (Math.abs(live.yaw - view.yaw) > 0.02) {
          throw new Error(`${view.view}: camera yaw ${live.yaw} != requested ${view.yaw}`);
        }
        const file = view.view + '.png';
        await shoot(resolve(dir, file));
        local.views.push({ view: view.view, file, yawRequested: view.yaw, yawApplied: live.yaw, camera: live.camera });
      }
      local.status = 'complete';
      local.pageErrors = [...new Set(pageErrors)];
      local.capturedAt = new Date().toISOString();
      local.resolution = { width: W, height: H, deviceScaleFactor: 2, screenshotScale: 1.25 };
      await writeFile(resolve(dir, 'metadata.json'), JSON.stringify(local, null, 2));
      console.log(`captured ${slug} (${state}, ${local.triangles} tri, ${local.views.length} views, ${local.pageErrors.length} page errors)`);
    } catch (error) {
      local.status = 'failed';
      local.error = String(error.message || error);
      local.pageErrors = [...new Set(pageErrors)];
      local.capturedAt = new Date().toISOString();
      await writeFile(resolve(dir, 'metadata.json'), JSON.stringify(local, null, 2));
      failed.push({ slug, error: local.error });
      console.error(`FAILED ${slug}: ${local.error}`);
    }
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
if (failed.length) {
  console.error(JSON.stringify({ failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ captured: options.slugs.length, output: options.output }));
