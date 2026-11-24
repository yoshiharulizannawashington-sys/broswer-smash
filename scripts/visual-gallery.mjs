// Visual regression gallery + effect measurement.
//
//   bash scripts/run-browser-test.sh scripts/visual-gallery.mjs --label=before --only=Goku
//   bash scripts/run-browser-test.sh scripts/visual-gallery.mjs --label=after
//
// Two jobs:
//   1. Capture the real game through its own gameplay camera for the fighters the visual pass
//      cares about, at the moment each animation is actually playing (a neutral pose is not
//      evidence that an attack animates).
//   2. Measure, in the same frame, how large the live impact effects are *relative to the
//      fighter they are covering*. That ratio is the whole question behind "the white puff hides
//      the fighters": an effect whose projected radius exceeds the fighter's projected height is
//      hiding them, no matter how the particles look in isolation.
//
// Every capture uses the same viewport, the same arena, the same camera zoom and the real camera,
// so two runs are directly comparable. Results are written to <out>/measurements-<label>.json.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const args = new Map(process.argv.slice(2).map(raw => {
  const [key, ...rest] = raw.replace(/^--/, '').split('=');
  return [key, rest.join('=') || 'true'];
}));
const label = args.get('label') || 'run';
const only = (args.get('only') || 'Goku,Iron Spider,Iron Man (Tony Stark),Hulk (Bruce Banner),The Flash (Barry Allen),Kaze')
  .split(',').map(name => name.trim()).filter(Boolean);
const outDir = resolve(root, args.get('out') || `artifacts/gallery/${label}`);
// Big world stages raise the camera's minimum reach, so the gallery can be pointed at one to
// check that specials stay framed there as well as on a small ring.
const ARENA = args.get('arena') || 'tournament';
const OPPONENT = args.get('opponent') || 'Vegeta';
// A subset of captures can be requested (`--shots=idle,special`) for a quick pass on one fighter.
const SHOTS = (args.get('shots') || 'idle,light,special,sprint,form,ultimate,exchange,impacts').split(',').map(s => s.trim());
const wants = name => SHOTS.includes(name);
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
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', error => { pageErrors.push(String(error.message || error)); console.log('PAGEERROR', error.message); });
await page.route('https://unpkg.com/three@0.152.2/**', async route => {
  const url = new URL(route.request().url());
  const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
  try {
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath) });
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
const report = [];

/**
 * Measure the live effects around both fighters, in pixels, against the fighters themselves.
 * `ratio` above ~1 means an effect is at least as tall on screen as the fighter it sits on.
 */
async function measure(shot, fighter) {
  const data = await page.evaluate(({ shot: shotName, fighter: fighterName }) => {
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera.camera;
    camera.updateMatrixWorld();
    const viewportHeight = window.innerHeight;
    const pixelRadius = (center, radius) => {
      const distance = Math.max(.001, center.distanceTo(camera.position));
      return radius * (viewportHeight / 2) / (distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    };
    const chest = f => f.position.clone().add(new THREE.Vector3(0, 1, 0));
    const fighters = window.fighters || [];
    // The fighter this shot is about, falling back to P1.
    const subject = fighters.find(f => f.name === fighterName) || fighters[0];
    let biggest = { px: 0, name: '', near: Infinity, radius: 0 };
    let meshes = 0;
    const consider = (object, kind) => {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      meshes++;
      const px = pixelRadius(sphere.center, sphere.radius);
      const near = Math.min(...fighters.map(f => sphere.center.distanceTo(chest(f))));
      if (near < 3.2 && px > biggest.px) {
        biggest = { px: +px.toFixed(1), name: kind, near: +near.toFixed(2), radius: +sphere.radius.toFixed(2) };
      }
    };
    // main.js keeps its effects as { group, t, life } records, so unwrap them before walking.
    for (const entry of window.__browserSmashEffects?.() || []) {
      const group = entry?.group || entry;
      if (!group?.children) continue;
      for (const child of group.children) consider(child, group.children.length + 'x burst');
    }
    for (const effect of window.combatVFX?.activeEffects || []) {
      effect.group.traverse(node => { if (node.isMesh) consider(node, effect.heavy ? 'heavy impact' : 'impact'); });
    }
    const subjectDistance = Math.max(.001, chest(subject).distanceTo(camera.position));
    const fighterPx = 2.0 * (viewportHeight / 2) / (subjectDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    return {
      shot: shotName,
      fighter: subject.name,
      percent: [Math.round(fighters[0]?.percent || 0), Math.round(fighters[1]?.percent || 0)],
      form: subject.transform?.label || null,
      camera: {
        distance: +Math.max(.1, window.smashCamera.framing.distance || 0).toFixed(2),
        fov: +camera.fov.toFixed(1),
        height: +camera.position.y.toFixed(2),
        gap: +(fighters[0].position.distanceTo(fighters[1].position)).toFixed(2)
      },
      effects: {
        meshes,
        biggestPx: biggest.px,
        biggest: biggest.name,
        biggestRadius: biggest.radius,
        nearFighter: biggest.near,
        fighterPx: +fighterPx.toFixed(1),
        ratio: +(fighterPx > 0 ? biggest.px / fighterPx : 0).toFixed(2),
        activeCombatEffects: window.combatVFX?.activeCount ?? null
      }
    };
  }, { shot, fighter });
  report.push(data);
  await page.screenshot({ path: resolve(outDir, `${data.fighter.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${shot}.png`) });
  console.log(`${data.fighter.padEnd(22)} ${shot.padEnd(9)} camera d=${String(data.camera.distance).padStart(5)} fov=${String(data.camera.fov).padStart(4)} gap=${String(data.camera.gap).padStart(5)} | effects n=${String(data.effects.meshes).padStart(3)} biggest=${String(data.effects.biggestPx).padStart(6)}px (fighter ${data.effects.fighterPx}px) ratio=${data.effects.ratio}${data.form ? ' form=' + data.form : ''}`);
  return data;
}

async function setupMatch(fighterName) {
  await page.evaluate(() => {
    // Back to the setup screen without a reload, so every fighter starts from identical state.
    window.__browserSmashPause?.close?.();
    document.querySelector('#menu').classList.remove('hidden');
    window.__browserSmashSelect?.show?.();
    window.__browserSmashSelect?.setMode?.('1p');
  });
  await step(0.05);
  await page.click(`#selectScreen .bs-card[data-fighter="${fighterName}"]`);
  await page.click(`#selectScreen .bs-card[data-fighter="${OPPONENT}"]`);
  await page.click('#selectScreen [data-nav="next"]');
  await page.click(`#selectScreen .bs-arena[data-arena="${ARENA}"]`);
  await page.click('#play');
  await step(0.35);
  await page.waitForFunction(() => {
    const model = window.fighters?.[0]?.model;
    return Boolean(model?.userData?.characterAssetUrl) || Boolean(model?.userData?.sculptedBody);
  }, null, { timeout: 60_000, polling: 100 }).catch(() => console.log('note: still on the procedural body for', fighterName));
  // The model can be present while the arena title card is still fading. Let the real renderer
  // finish that transition before the first fixed-camera capture.
  await page.waitForTimeout(1400);
  // Fixed camera conditions for every capture: same zoom, same orbit, same square-off.
  await page.evaluate(() => {
    window.smashCamera.setZoom(1.2);
    window.smashCamera.resetOrbit?.();
    const [p1, p2] = window.fighters;
    p1.position.set(-1.6, p1.groundLevel ?? 0, -12); p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
    p2.position.set(1.6, p2.groundLevel ?? 0, -12); p2.velocity.set(0, 0, 0);
    p1.percent = 0; p2.percent = 0;
  });
  await step(0.4);
}

async function shootFighter(fighterName) {
  await setupMatch(fighterName);
  if (wants('idle')) await measure('idle', fighterName);

  // Light attack, captured inside the active window rather than after it.
  if (wants('light')) {
    await page.keyboard.press('j');
    await step(0.11);
    await measure('light', fighterName);
    await step(0.5);
  }

  // Signature special.
  if (wants('special')) {
    await page.evaluate(() => { const f = window.fighters[0]; f.specialCooldown = 0; });
    await page.keyboard.press('k');
    await step(0.4);
    await measure('special', fighterName);
    await step(0.9);
  }

  // Locomotion through the real camera: hold forward with sprint and capture mid-stride, so the
  // frame lands while the run/sprint clip is playing rather than on a neutral pose. This is the
  // shot that shows a speedster's forward lean and footwork (The Flash).
  if (wants('sprint')) {
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ShiftLeft');
    await step(0.4);
    await measure('sprint', fighterName);
    await step(0.3);
    await measure('sprint-late', fighterName);
    await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('KeyD');
    await step(0.45);
    // Back to the fixed square-off, so every later capture in this run is comparable.
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(-1.6, p1.groundLevel ?? 0, -12); p1.velocity.set(0, 0, 0); p1.facing = 1; p1.facingZ = 0;
      p2.position.set(1.6, p2.groundLevel ?? 0, -12); p2.velocity.set(0, 0, 0);
    });
    await step(0.3);
  }

  // Transformation through the real camera.
  if (wants('form')) {
    await page.evaluate(() => { const f = window.fighters[0]; f.power = 100; });
    await page.keyboard.press('i');
    await step(0.7);
    await measure('form', fighterName);
    await step(0.5);
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) { f.transform.time = 0; } });
    await step(0.3);
  }

  // Ultimate: the heaviest effect in the game. Captured at startup and through its impact, since
  // the startup frame alone lands before anything exists to cover a fighter.
  if (wants('ultimate')) {
    await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; });
    await page.keyboard.press('o');
    await step(0.3);
    await measure('ultimate-start', fighterName);
    await step(0.5);
    await measure('ultimate-impact', fighterName);
    await step(0.5);
    await measure('ultimate-late', fighterName);
    await step(0.8);
  }

  // A normal exchange: both fighters trading hits with the effects live.
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-1.1, p1.groundLevel ?? 0, -12); p1.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p1.attackQueue.length = 0;
    p2.position.set(1.1, p2.groundLevel ?? 0, -12); p2.velocity.set(0, 0, 0);
  });
  if (wants('exchange')) {
    await page.keyboard.press('j');
    await step(0.13);
    await measure('exchange', fighterName);
    await step(0.7);
  }

  // Direct probe of the impact effect at the three intensities the game actually uses: a melee
  // connect (8), a heavy special (15) and a grenade / ultimate-class explosion (23). Fired on the
  // opponent on purpose - that is the case that used to bury a fighter under a white puff.
  for (const intensity of (wants('impacts') ? [8, 15, 23] : [])) {
    await page.evaluate(value => {
      const target = window.fighters[1];
      window.spawnImpact(target.position.clone().add(new window.__browserSmashThree.Vector3(0, 1.1, 0)), value, 0xffd18a, 'unarmed');
    }, intensity);
    await step(0.06);
    await measure(`impact-${intensity}`, fighterName);
    await step(0.7);
  }
}

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180_000, polling: 200 });
  const hooks = await page.evaluate(() => ({
    effects: typeof window.__browserSmashEffects === 'function',
    combatVfx: Boolean(window.combatVFX?.activeEffects || window.combatVFX?.activeCount !== undefined)
  }));
  console.log('measurement hooks', JSON.stringify(hooks));
  // The gallery starts on the title card; open versus once before the first fighter card exists.
  await page.evaluate(() => document.querySelector('#bbTitle [data-nav=\"versus\"]')?.click());
  for (const fighterName of only) {
    console.log('--- ' + fighterName + ' ---');
    await shootFighter(fighterName);
  }
  await writeFile(resolve(outDir, `measurements-${label}.json`), JSON.stringify({
    label, at: new Date().toISOString(), arena: ARENA, opponent: OPPONENT,
    viewport: '1280x800', zoom: 1.2, pageErrors, shots: report
  }, null, 2));
  const worst = report.reduce((a, b) => (b.effects.ratio > a.effects.ratio ? b : a), report[0]);
  console.log(`\n${report.length} captures in ${outDir}`);
  console.log(`worst effect/fighter ratio: ${worst.effects.ratio} (${worst.fighter} · ${worst.shot} · ${worst.effects.biggestPx}px vs ${worst.effects.fighterPx}px)`);
  console.log(`page errors: ${pageErrors.length}`);
} finally {
  await browser.close();
  await server.close();
}
