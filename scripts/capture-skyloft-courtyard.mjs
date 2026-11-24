// Visual before/after regression for the Skyloft courtyard cleanup.
//
// The untouched GLB keeps the authored plaza slab and its joint strips; the normal load path
// removes them so the island's own paved courtyard reads instead. Both frames use the same
// fixed, paused camera over the courtyard so the only difference is the cleanup.
//
//   npm run capture:skyloft-courtyard
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/environment/arenas/skyloft-courtyard');
await mkdir(out, { recursive: true });

// The reviewed cleanup result. The 1% changed-pixel budget absorbs the small SwiftShader /
// idle-pose jitter seen between identical runs; a real cleanup regression changes far more.
const baselineArtifact = 'docs/skyloft-courtyard/after-baseline.png';
const baselinePath = resolve(root, baselineArtifact);
const pixelDiffThreshold = { channelDelta: 16, maxChangedRatio: 0.01 };

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance', '.wasm': 'application/wasm'
};

const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('nf');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});

const viewport = { width: 1280, height: 720 };
const report = {
  arena: 'skyloft',
  viewport,
  camera: { position: [0, 23, 30], lookAt: [0, 0.4, 0], fov: 50 },
  variants: {},
  pageErrors: []
};

async function waitForStableFighterModels(page) {
  // The imported body can be swapped more than once while the procedural fallback is replaced.
  // A single "loaded" flag was true while that second swap was still in flight, so poll the model
  // identity itself until it has been unchanged for three samples.
  let previous = null;
  let stableSamples = 0;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const signature = await page.evaluate(() => (window.fighters || []).map(fighter => [
      fighter.characterModelLoaded ? 'loaded' : 'pending',
      fighter.model?.uuid || '',
      fighter.model?.children?.length || 0
    ].join(':')).join('|'));
    if (signature === previous) {
      stableSamples += 1;
      if (stableSamples >= 3) return { stable: true, signature };
    } else {
      previous = signature;
      stableSamples = 0;
    }
    await page.waitForTimeout(250);
  }
  return { stable: false, signature: previous };
}

async function capture(variant) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 300)));
  page.on('console', message => {
    if (message.type() === 'error') pageErrors.push('console: ' + message.text().slice(0, 240));
  });
  await page.addInitScript(cleanup => {
    window.__browserSmashSkyloftDeckCleanup = cleanup;
  }, variant !== 'before');

  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashMatch && window.__browserSmashStep
    && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  // The performance governor may downgrade the graphics preset while the assets stream in. A
  // lighting/shadow-preset change alters most of the frame, so pin quality for the comparison.
  await page.evaluate(() => {
    window.__graphicsManualChoice = true;
    window.__performanceGovernor?.setManual?.(true);
    window.setGraphicsPreset?.('high');
  });
  await page.click('#bbTitle [data-nav="versus"]');
  await page.evaluate(() => {
    window.__browserSmashSelect.select('p1', 'Goku');
    window.__browserSmashSelect.select('p2', 'Naruto Uzumaki');
    window.__browserSmashSelect.chooseArena('skyloft');
    document.querySelector('#play').click();
  });
  await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting',
    null, { timeout: 45_000, polling: 100 });
  await page.waitForFunction(() => window.__browserSmashAssets?.arenas?.skyloft?.status === 'loaded'
    && window.__browserSmashAuthoredGroup, null, { timeout: 180_000, polling: 250 });
  // The imported bodies replace the procedural placeholders asynchronously. Wait for that swap
  // before hiding them; otherwise a body that lands after the screenshot can repopulate the frame
  // and make the pixel baseline non-deterministic.
  const modelsReady = await page.waitForFunction(() => window.fighters?.length === 2
    && window.fighters.every(fighter => fighter.characterModelLoaded === true),
  null, { timeout: 10_000, polling: 100 }).then(() => true).catch(() => false);
  const modelsStable = await waitForStableFighterModels(page);

  const state = await page.evaluate(() => {
    const group = window.__browserSmashAuthoredGroup;
    const camera = window.__browserSmashCamera;
    const THREE = window.__browserSmashThree;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSpawnFighters();
    window.__browserSmashStep(1 / 60);
    window.__browserSmashSetPaused(true);
    // Character GLBs stream in asynchronously and their idle poses vary between runs. The courtyard
    // capture is evidence for the environment, so keep every fighter/imported-character node (and
    // its contact shadow) out of both frames; this is what makes the pixel baseline meaningful.
    window.__skyloftHideFighters = () => {
      window.__browserSmashClearClones?.();
      for (const fighter of window.fighters || []) {
        if (fighter.model) fighter.model.visible = false;
        if (fighter.contactShadow) fighter.contactShadow.visible = false;
      }
      window.__browserSmashScene?.traverse?.(node => {
        const data = node.userData || {};
        if (data.characterAssetUrl || data.assetUrl || data.characterAssetIdentity
          || data.importedCharacter || data.humanMixer) node.visible = false;
      });
    };
    window.__skyloftHideFighters();
    // The canvas is the evidence; hide the game's HUD, title and loading overlays.
    document.querySelectorAll('body > *:not(canvas)').forEach(element => { element.style.visibility = 'hidden'; });
    camera.position.set(0, 23, 30);
    camera.lookAt(new THREE.Vector3(0, 0.4, 0));
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    let joints = 0;
    group.traverse(node => { if (/^skyloft_joint_/.test(node.name || '')) joints += 1; });
    return {
      asset: window.__browserSmashAssets?.arenas?.skyloft || null,
      deck: window.__browserSmashSkyloftDeck || null,
      graphicsPreset: window.__graphicsPresetName || null,
      plazaPresent: Boolean(group.getObjectByName('skyloft_plaza')),
      jointCount: joints,
      camera: {
        position: camera.position.toArray().map(value => +value.toFixed(3)),
        fov: camera.fov
      },
      layout: {
        ground: window.__browserSmashLayout?.()?.ground ?? null,
        bounds: window.__browserSmashLayout?.()?.bounds ?? null
      },
      fighters: window.fighters.map(f => ({
        name: f.identity,
        position: f.position.toArray().map(value => +value.toFixed(3)),
        grounded: Boolean(f.isGrounded)
      }))
    };
  });

  // Keep the hide active while the capture settles: a late body swap must not repopulate the frame.
  await page.evaluate(() => {
    window.__skyloftHideTimer = setInterval(window.__skyloftHideFighters, 50);
  });
  await page.waitForTimeout(650);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    clearInterval(window.__skyloftHideTimer);
    window.__skyloftHideFighters();
  });
  const file = resolve(out, `${variant}.png`);
  await page.screenshot({ path: file });
  const result = { ...state, modelsReady, modelsStable: modelsStable.stable, file: `artifacts/environment/arenas/skyloft-courtyard/${variant}.png`, pageErrors };
  report.variants[variant] = result;
  report.pageErrors.push(...pageErrors.map(error => `${variant}: ${error}`));
  await page.close();
  return result;
}

async function compareCourtyardToBaseline(screenshotPath) {
  let current;
  let baseline;
  try {
    [current, baseline] = await Promise.all([readFile(screenshotPath), readFile(baselinePath)]);
  } catch (error) {
    return {
      baseline: baselineArtifact,
      threshold: pixelDiffThreshold,
      passed: false,
      error: `Could not read the courtyard baseline: ${error.message}`
    };
  }

  const page = await browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body></body></html>');
    return await page.evaluate(async ({ current, baseline, threshold }) => {
      const decode = source => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('PNG decode failed'));
        image.src = 'data:image/png;base64,' + source;
      });
      const [currentImage, baselineImage] = await Promise.all([decode(current), decode(baseline)]);
      if (currentImage.width !== baselineImage.width || currentImage.height !== baselineImage.height) {
        return {
          passed: false,
          error: `Screenshot size ${currentImage.width}x${currentImage.height} does not match baseline ${baselineImage.width}x${baselineImage.height}`
        };
      }

      const canvas = document.createElement('canvas');
      canvas.width = currentImage.width;
      canvas.height = currentImage.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const readPixels = image => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = readPixels(currentImage);
      const b = readPixels(baselineImage);
      let changedPixels = 0;
      let sumDelta = 0;
      let maxDelta = 0;
      for (let index = 0; index < a.length; index += 4) {
        const delta = Math.max(
          Math.abs(a[index] - b[index]),
          Math.abs(a[index + 1] - b[index + 1]),
          Math.abs(a[index + 2] - b[index + 2])
        );
        sumDelta += delta;
        maxDelta = Math.max(maxDelta, delta);
        if (delta > threshold.channelDelta) changedPixels += 1;
      }
      const pixelCount = canvas.width * canvas.height;
      const changedRatio = changedPixels / pixelCount;
      return {
        width: canvas.width,
        height: canvas.height,
        pixelCount,
        changedPixels,
        changedRatio: +changedRatio.toFixed(6),
        meanDelta: +(sumDelta / pixelCount).toFixed(3),
        maxDelta,
        passed: changedRatio <= threshold.maxChangedRatio
      };
    }, {
      current: current.toString('base64'),
      baseline: baseline.toString('base64'),
      threshold: pixelDiffThreshold
    });
  } finally {
    await page.close();
  }
}

try {
  const before = await capture('before');
  const after = await capture('after');
  const pixelDiff = await compareCourtyardToBaseline(after.file);
  pixelDiff.baseline = baselineArtifact;
  if (!pixelDiff.error) {
    pixelDiff.baselineSha256 = createHash('sha256').update(await readFile(baselinePath)).digest('hex');
  }
  pixelDiff.threshold = pixelDiffThreshold;
  report.pixelDiff = pixelDiff;

  const sameCamera = before.camera.position.every((value, index) => Math.abs(value - after.camera.position[index]) < 0.001)
    && before.camera.fov === after.camera.fov;
  const samePreset = before.graphicsPreset === after.graphicsPreset;
  const beforeHasSlab = before.plazaPresent && before.jointCount > 0;
  const afterHasNoSlab = !after.plazaPresent && after.jointCount === 0
    && after.deck?.plazaRemoved === true && after.deck?.jointsRemoved > 0;

  report.checks = {
    sameCamera,
    samePreset,
    beforeHasSlab,
    afterHasNoSlab,
    pixelDiff: pixelDiff.passed === true,
    noPageErrors: report.pageErrors.length === 0
  };
  report.passed = Object.values(report.checks).every(Boolean);
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(`before: slab=${before.plazaPresent} joints=${before.jointCount} camera=${before.camera.position.join(',')}`);
  console.log(`after:  slab=${after.plazaPresent} joints=${after.jointCount} removed=${JSON.stringify(after.deck)} camera=${after.camera.position.join(',')}`);
  if (pixelDiff.error) {
    console.error(`pixel diff unavailable: ${pixelDiff.error}`);
  } else {
    console.log(`pixel diff: ${pixelDiff.changedPixels}/${pixelDiff.pixelCount} pixels changed`
      + ` (${((pixelDiff.changedRatio || 0) * 100).toFixed(3)}%; budget ${(pixelDiffThreshold.maxChangedRatio * 100).toFixed(1)}%`
      + ` above channel delta ${pixelDiffThreshold.channelDelta})`);
  }
  if (pixelDiff.passed === false) console.error(`courtyard baseline mismatch: ${baselineArtifact}`);
  console.log(`captures: ${out}`);
  console.log(`checks: ${JSON.stringify(report.checks)}`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
