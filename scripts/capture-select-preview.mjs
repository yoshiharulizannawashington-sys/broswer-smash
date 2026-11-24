// Real in-game evidence for the new character-select 3D preview, plus a runtime check that the
// eight new baked clips are reachable by the game's own mixer.
//
//   bash scripts/run-browser-test.sh scripts/capture-select-preview.mjs
//
// It serves the built game the way vite does, opens the actual menu, selects fighters through the
// selection screen's own API, waits for the preview canvas to report `ready`, and screenshots the
// preview element. It also walks the live scene for the fighter mixer's action map, which is the
// only proof that a clip in the GLB is a clip the game can play.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/select-preview');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const FIGHTERS = [
  ['goku', 'Goku'],
  ['vegeta', 'Vegeta'],
  ['iron_man_tony_stark', 'Iron Man (Tony Stark)'],
  ['iron_spider', 'Iron Spider']
];
const REQUIRED_CLIPS = ['hit_heavy', 'hover', 'air_attack', 'throw', 'parry', 'strafe', 'victory', 'defeat'];

const errors = [];
const results = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(180_000);
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  page.on('console', message => {
    if (message.type() === 'error') errors.push('console: ' + message.text().slice(0, 160));
  });

  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashSelect), null, { timeout: 120_000 });
  await page.waitForSelector('#selectScreen [data-role="previewcanvas"]', { timeout: 60_000 });

  for (const [slug, name] of FIGHTERS) {
    await page.evaluate(candidate => window.__browserSmashSelect.select('p1', candidate), name);
    // The canvas only reports ready once the GLB parsed and the idle action started.
    await page.waitForFunction(() => {
      const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
      return status && ['ready', 'fallback', 'unavailable'].includes(status.dataset.state);
    }, null, { timeout: 120_000 });
    await page.waitForTimeout(900);
    const status = await page.evaluate(() => {
      const node = document.querySelector('#selectScreen [data-role="previewstatus"]');
      const canvas = document.querySelector('#selectScreen [data-role="previewcanvas"]');
      return {
        state: node?.dataset.state || 'missing',
        text: node?.textContent || '',
        width: canvas?.clientWidth || 0,
        height: canvas?.clientHeight || 0
      };
    });
    const file = resolve(outDir, `${slug}.png`);
    await page.locator('#selectScreen [data-role="preview"]').screenshot({ path: file });
    results.push({ slug, name, ...status, file });
  }

  const full = resolve(outDir, 'select-screen.png');
  await page.screenshot({ path: full });
  // The debug object holds live scene nodes, whose parent/children links are circular. Serialising it
  // raw crashed this capture script with "Converting circular structure to JSON"; summarise instead.
  const previewDebug = await page.evaluate(() => {
    const raw = window.__fighterPreviewDebug || null;
    if (!raw) return null;
    const seen = new WeakSet();
    try {
      return JSON.parse(JSON.stringify(raw, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[circular]';
          seen.add(value);
        }
        return value;
      }));
    } catch (error) {
      return { unserialisable: String(error && error.message || error) };
    }
  });
  console.log('PREVIEW_DEBUG ' + JSON.stringify(previewDebug));

  // The eight new clips, as the live fighter mixer knows them. The roster bodies ship baked
  // clips, so human_fighter.js registers them in userData.animationActions; a clip that is in the
  // GLB but missing here is a clip the game cannot select.
  const clipProbe = await page.evaluate(() => {
    const found = {};
    window.__browserSmashScene?.traverse?.(node => {
      const actions = node.userData?.animationActions;
      if (!actions) return;
      const names = Object.keys(actions);
      if (names.length > (found.names || []).length) {
        found.names = names;
        found.identity = node.userData.identity || node.name || '';
        // Which of the eight states the animator actually bound to a gameplay field.
        found.bound = ['hover', 'airAttack', 'throw', 'parry', 'strafe', 'victory', 'defeat']
          .filter(key => Boolean(node.userData[key + 'Action']))
          .concat(node.userData.flyAction ? ['fly'] : [])
          .concat(node.userData.hitAction ? ['hit'] : []);
      }
    });
    return found;
  });
  const runtimeClips = clipProbe.names || [];
  const missingRuntime = REQUIRED_CLIPS.filter(name => !runtimeClips.some(clip => clip === name));
  // A clip in the GLB is not a clip the animator can pick. These are the bindings the baked-clip
  // animator resolved for this body; a state missing here exists but is unreachable in gameplay.
  const boundActions = clipProbe.bound || [];
  const unboundStates = ['hover', 'airAttack', 'throw', 'parry', 'strafe', 'victory', 'defeat']
    .filter(key => !boundActions.includes(key));

  console.log(JSON.stringify({
    origin,
    previews: results,
    fullScreenshot: full,
    runtimeClipCount: runtimeClips.length,
    runtimeClips,
    missingRuntime,
    boundActions,
    unboundStates,
    pageErrors: [...new Set(errors)].slice(0, 10)
  }, null, 2));

  const broken = results.filter(row => row.state !== 'ready');
  if (broken.length) {
    console.error('FAILED: preview not ready for ' + broken.map(row => row.slug).join(', '));
    process.exit(1);
  }
  if (missingRuntime.length) {
    console.error('FAILED: clips missing from the live mixer: ' + missingRuntime.join(', '));
    process.exit(1);
  }
  if (unboundStates.length) {
    console.error('FAILED: states present in the GLB but not bound by the animator: ' + unboundStates.join(', '));
    process.exit(1);
  }
  console.log(`OK: ${results.length} previews rendered from the shipped GLBs; ` +
    `${REQUIRED_CLIPS.length} new clips reachable at runtime`);
} finally {
  await browser?.close();
  server.close();
}
