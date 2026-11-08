import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { CLIP_SPECS } from '../public/js/anim/clip_library.js';
import { CANONICAL_BONES, CORE_BONES } from '../public/js/anim/rig_map.js';

// Expected animation coverage, taken from the library itself so it cannot drift.
const expectedLibrarySize = Object.keys(CLIP_SPECS).length;
// Bone binding is a property of the rig, not a constant. CORE_BONES is the eleven joints every rig
// must have for the library to drive it; EXTENSION_BONES adds spine, clavicles, neck, hands and
// feet on rigs that expose them. A hardcoded 11 therefore failed any body that bound all nineteen
// canonical joints - a better binding reported as a regression. The gate now asserts the invariant
// that matters instead: every canonical joint is either bound or declared missing, and no rig is
// allowed to lose a core joint.

// Use the exact Three.js release already referenced by the project, but serve it locally
// during CI so a transient unpkg network/TLS issue cannot hide real game failures.
async function serveThreeLocally(page) {
  await page.route('https://unpkg.com/three@0.152.2/**', async requestRoute => {
    const requestUrl = new URL(requestRoute.request().url());
    const relative = requestUrl.pathname.replace('/three@0.152.2/', '');
    const localPath = resolve(root, 'node_modules/three', relative);
    try {
      const body = await readFile(localPath);
      await requestRoute.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body
      });
    } catch (error) {
      await requestRoute.fulfill({
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        body: 'Missing local Three.js dependency: ' + relative + ' (' + String(error?.message || error) + ')'
      });
    }
  });
}

const root = process.cwd();
const failedRequests = [];
const cdnRequestFailures = [];
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    // The optional model-import API exists only behind the Vite plugin. A static host answers 404,
    // which Chromium logs as a console error for a URL the game is designed to run without.
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    // Match Vite's public/ behavior: /js, /assets, /models and /data are served from public/.
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const bytes = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(bytes);
  } catch (error) {
    const pathname = req.url || '/';
    if (!pathname.includes('favicon.ico')) failedRequests.push({ url: pathname, error: String(error?.message || error) });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
const origin = 'http://127.0.0.1:' + address.port;
let browser;

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'
    ]
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  context.setDefaultTimeout(180_000);

  // Exercise both supported entrypoints: repository root and the public deployment page.
  for (const route of ['/index.html', '/public/index.html']) {
    const page = await context.newPage();
    const pageErrors = [];
    const glbResponses = [];
    const assetResponses = [];
    const consoleMessages = [];
    const requestFailures = [];
    page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
    page.on('console', message => { if (message.type() === 'error') consoleMessages.push(message.text()); });
    page.on('requestfailed', request => requestFailures.push({url:request.url(),failure:request.failure()?.errorText||'failed'}));
    page.on('response', response => {
      if (/\.glb(?:\?|$)/i.test(response.url())) {
        glbResponses.push({ url: response.url(), status: response.status() });
      }
      if (/\.js(?:\?|$)|\.glb(?:\?|$)/i.test(response.url())) assetResponses.push({url:response.url(),status:response.status()});
    });

    try {
      await serveThreeLocally(page);
      const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      assert.ok(response && response.status() === 200, route + ' did not return HTTP 200');

      await page.waitForFunction(() => {
        const state = window.__browserSmashAssets || {};
        const fighters = window.fighters || [];
        return state.app?.status === 'running'
          && state.app.frames >= 5
          && state.characters?.status === 'loaded'
          && state.characters.count >= 57
          && state.weapons?.status === 'loaded'
          && state.weapons.count >= 68
          && state.finalValley?.status === 'loaded'
          && state.finalValley.meshCount > 0
          && fighters.length === 2
          // Three fighters ship a hand-authored body instead of a prefab; they must still be
          // fully articulated, so the same gate checks their joints rather than a node name.
          && fighters.every(f => f.characterModelLoaded
            ? !!f.model?.userData?.humanMixer
            : f.model?.userData?.sculptedBody
              ? !!f.model?.userData?.rightArm && !!f.model?.userData?.rightFore && !!f.model?.userData?.leftLeg
              : f.model?.name?.startsWith('Blender fighter ') && !!f.model?.userData?.equippedWeaponRight)
          && state.lastCharacter?.upright === true;
      }, null, { timeout: 60_000, polling: 250 });

      const result = await page.evaluate(() => ({
        route: location.pathname,
        title: document.title,
        assets: window.__browserSmashAssets,
        characterOrientation: window.__browserSmashAssets?.lastCharacter,
        fighters: (window.fighters || []).map(f => ({
          identity: f.identity,
          model: f.model?.name,
          weapon: f.model?.userData?.weaponLabel,
          weaponKind: f.model?.userData?.weaponKind,
          rigVersion: f.model?.userData?.blenderRigVersion
        })),
        canvasSize: {
          width: document.querySelector('#gl')?.width,
          height: document.querySelector('#gl')?.height
        }
      }));

      // The animation pipeline must actually drive the rig, not just bind to it. Two systems can
      // own a fighter: the shared 39-clip library over a prefab body's eleven canonical bones, or
      // the clips a character's own exported GLB ships, driven by its named-action mixer. The gate
      // names which one owns each fighter and then requires that fighter to be moving.
      const animation = await page.evaluate(async () => {
        const state = f => {
          const controller = f.animationController?.describe?.() ?? null;
          const actions = f.model?.userData?.animationActions;
          return {
            system: controller ? 'clip-library' : actions ? 'baked-clips' : 'none',
            clips: controller ? controller.clips : actions ? Object.keys(actions).length : 0,
            boundBones: controller ? controller.boundBones : null,
            missingBones: controller ? (controller.missingBones || []).length : null,
            active: controller ? controller.active : !!f.model?.userData?.idleAction,
            // Whatever owns the animation, the mounted body has to expose the canonical limb
            // joints: the weapon mount, the rig gate and the audit all read them by name.
            joints: !!(f.model?.userData?.leftArm && f.model?.userData?.leftLeg)
          };
        };
        const pose = () => (window.fighters || []).map(f => ({
          arm: f.model?.userData?.leftArm?.rotation.x ?? null,
          leg: f.model?.userData?.leftLeg?.rotation.x ?? null,
          time: f.animationController?.currentTime ?? f.model?.userData?.humanMixer?.time ?? null
        }));
        const before = pose();
        const states = (window.fighters || []).map(state);
        // Software WebGL can need more than a second per frame, so wait for the loop to actually
        // advance instead of assuming a fixed wall-clock window contains any frames at all. The
        // assertions stay strict: the mixer and the joints still have to move.
        const startFrames = window.__browserSmashAssets?.app?.frames ?? 0;
        const deadline = performance.now() + 15000;
        while (performance.now() < deadline) {
          await new Promise(done => setTimeout(done, 200));
          if ((window.__browserSmashAssets?.app?.frames ?? 0) > startFrames + 2) break;
        }
        const after = pose();
        return { before, after, states };
      });
      assert.ok(animation.states.every(state => state.system !== 'none'),
        route + ': a fighter has no animation system: ' + JSON.stringify(animation.states));
      // Compare against the live library size rather than the number that happened to be current
      // when this was written: Phase 11 added the victory and defeat clips, so the fighter was
      // correctly bound to all 41 while the assertion still demanded 39.
      assert.ok(animation.states.every(state => state.system !== 'clip-library'
        || (state.clips >= expectedLibrarySize
          && state.boundBones >= CORE_BONES.length
          && state.boundBones + state.missingBones === CANONICAL_BONES.length)),
      route + `: the clip-library fighter owns fewer than the shared ${expectedLibrarySize} clips or does not account for all ${CANONICAL_BONES.length} canonical bones (${CORE_BONES.length} core required): ` + JSON.stringify(animation.states));
      assert.ok(animation.states.every(state => state.system !== 'baked-clips' || state.clips >= 8),
        route + ': a fighter that ships its own clips is missing them: ' + JSON.stringify(animation.states));
      assert.ok(animation.states.every(state => state.joints),
        route + ': the mounted body does not expose the canonical limb joints: ' + JSON.stringify(animation.states));
      assert.ok(animation.states.some(state => state.active),
        route + ': no clip is playing');
      assert.ok(animation.after.some((entry, index) =>
        entry.time !== null && animation.before[index].time !== null
        && entry.time !== animation.before[index].time),
      route + ': the animation mixer never advanced');
      assert.ok(animation.after.some((entry, index) =>
        entry.arm !== null && animation.before[index].arm !== null
        && Math.abs(entry.arm - animation.before[index].arm) > 1e-4),
      route + ': joint rotations did not change while a clip was playing');
      assert.deepEqual(pageErrors, [], route + ': browser runtime errors: ' + pageErrors.join('\n'));

      assert.equal(result.fighters.length, 2, route + ': expected P1 and CPU fighter instances');
      assert.ok(result.canvasSize.width > 0 && result.canvasSize.height > 0, route + ': render canvas has no dimensions');
      assert.ok(glbResponses.some(item => item.url.includes('character_models.glb') && item.status === 200), route + ': character GLB was not requested successfully');
      assert.ok(glbResponses.some(item => item.url.includes('character_weapons.glb') && item.status === 200), route + ': weapon GLB was not requested successfully');
      assert.ok(glbResponses.some(item => item.url.includes('final_valley.glb') && item.status === 200), route + ': Final Valley GLB was not requested successfully');
      assert.deepEqual(pageErrors, [], route + ': browser runtime errors: ' + pageErrors.join('\n'));
      console.log(JSON.stringify({ smoke: 'pass', ...result }, null, 2));
    } catch (error) {
      try {
        console.error('Asset state at failure:', JSON.stringify(await page.evaluate(() => window.__browserSmashAssets || {}), null, 2));
        const screenshotName = '/tmp/browser-smash-failure-' + route.replace(/[^a-z0-9]+/gi, '-') + '.png';
        await page.screenshot({ path: screenshotName, fullPage: true });
      } catch {}
      console.error('GLB responses:', JSON.stringify(glbResponses, null, 2));
      console.error('Page errors:', JSON.stringify(pageErrors, null, 2));
      console.error('Console errors:', JSON.stringify(consoleMessages, null, 2));
      console.error('Failed requests:', JSON.stringify(requestFailures, null, 2));
      console.error('Script/GLB responses:', JSON.stringify(assetResponses, null, 2));
      throw error;
    } finally {
      await page.close();
    }
  }

  // Selecting a map that ships an authored Blender arena must stream that arena in rather
  // than silently falling back to the procedural build - that fallback is how five shipped
  // environment assets went unused in the first place.
  {
    const page = await context.newPage();
    const arenaErrors = [];
    page.on('pageerror', error => arenaErrors.push(error.stack || String(error)));
    await serveThreeLocally(page);
    try {
      await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => window.fighters?.length === 2, null, { timeout: 120_000, polling: 250 });
      await page.evaluate(() => {
        const select = document.querySelector('#mapSelect');
        select.value = 'hogwarts';
        select.dispatchEvent(new Event('change'));
      });
      // The loader publishes a 'loading' marker before the GLB resolves: wait for a settled
      // state instead of the first marker, otherwise a slow (software-rendered) run asserts
      // on the marker itself. setCinematicArena never rejects - a failed GLB falls back to
      // the procedural arena - so this settles for every outcome and the assertions below
      // report which one happened.
      await page.waitForFunction(
        () => {
          const state = window.__browserSmashAssets?.authoredArena;
          const hogwarts = window.__browserSmashAssets?.arenas?.hogwarts;
          // authoredArena is also written for the initial (procedural) map, so the marker
          // only means "hogwarts settled" once it names hogwarts or the GLB itself failed.
          return Boolean(state) && ((state.key === 'hogwarts' && state.status !== 'loading')
            || ['error', 'fallback'].includes(hogwarts?.status));
        },
        null,
        { timeout: 240_000, polling: 500 }
      );
      const arena = await page.evaluate(() => ({
        state: window.__browserSmashAssets?.authoredArena,
        hogwarts: window.__browserSmashAssets?.arenas?.hogwarts
      }));
      assert.equal(arena.state?.status, 'loaded', 'Authored Hogwarts arena did not load: ' + JSON.stringify(arena.hogwarts));
      assert.ok(arena.hogwarts?.meshCount >= 80, 'Authored Hogwarts arena has too few meshes: ' + JSON.stringify(arena.hogwarts));
      assert.deepEqual(arenaErrors, [], 'Authored arena page raised runtime errors: ' + arenaErrors.join('\n'));
      console.log('Authored arena loaded: hogwarts.glb, ' + arena.hogwarts.meshCount + ' meshes.');
    } finally {
      await page.close();
    }
  }

  assert.deepEqual(failedRequests, [], 'Static asset requests failed: ' + JSON.stringify(failedRequests));
  await context.close();
  console.log('Browser Smash runtime smoke test passed for both root and public entrypoints.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
