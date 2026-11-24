// Capture a REPLACED character in a real match: front, three-quarter and side inspection shots plus
// one gameplay frame from the duel camera.
//
//   bash scripts/run-browser-test.sh scripts/capture-replacement-views.mjs <CharacterName> <outDir>
//
// Arguments whose value matched the manifest is loaded by the page itself, so the shots show the file
// the game actually resolved - not a viewer pointed at a path. The simulation is stepped, never
// disposed, so the frame is still renderable when the screenshot is taken.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const characterName = process.argv[2] || 'Kaze';
const outDir = resolve(process.cwd(), process.argv[3] || 'artifacts/dev/phase28416/views');
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
await mkdir(outDir, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.setDefaultTimeout(180_000);
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));

try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 180_000, polling: 200 });

  await page.evaluate(name => {
    const select = document.querySelector('#p1Character');
    if (select) {
      const option = [...select.options].find(item => item.value === name);
      if (option) { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    document.querySelector('#play')?.click();
  }, characterName);

  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(f => f.model), null, { timeout: 180_000, polling: 200 });
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashStep?.(0.7); });

  const info = await page.evaluate(name => {
    const fighter = window.fighters.find(f => String(f.name || f.identity || '').toLowerCase().includes(name.toLowerCase())) || window.fighters[0];
    // The fighter object wraps its body: scan every root it owns, not just `model`.
    const roots = [fighter.model, fighter.root, fighter.mesh, window.__browserSmashScene].filter(Boolean);
    const skinned = [];
    const seen = new Set();
    for (const root of roots) root?.traverse?.(node => {
      if (seen.has(node)) return;
      seen.add(node);
      if (node.isSkinnedMesh) skinned.push(node);
    });
    const assets = window.__browserSmashAssets || {};
    const entry = Object.entries(assets).find(([key, value]) => /kaze/i.test(key) && value?.animations) || [];
    const clips = entry[1]?.animations || fighter.moveset?.clips || [];
    const shot = window.smashCamera.spectate({ fighter, framing: 'full', yaw: 0, pitch: 2 });
    return {
      fighter: fighter.name || fighter.identity || null,
      identity: fighter.identity || null,
      bones: skinned[0]?.skeleton?.bones?.length || 0,
      skinnedMeshes: skinned.length,
      clips,
      camera: shot?.camera || null
    };
  }, characterName);

  const shots = [];
  for (const [label, yaw] of [['front', 0], ['three-quarter', 40], ['side', 90]]) {
    await page.evaluate(value => { window.smashCamera.spectate({ yaw: value, pitch: 2 }); }, yaw);
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(outDir, `replaced-${label}.png`) });
    shots.push({ label, yaw, path: `replaced-${label}.png` });
  }

  await page.evaluate(() => { window.smashCamera.endSpectate(); });
  // The duel camera re-frames over a few frames; step before shooting or the frame is scenery.
  for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__browserSmashStep?.(0.4)); await page.waitForTimeout(120); }
  await page.screenshot({ path: resolve(outDir, 'replaced-gameplay.png') });
  shots.push({ label: 'gameplay', yaw: null, path: 'replaced-gameplay.png' });

  // State poses, driven by the game's own P1 keys and framed by the inspection camera so the limb
  // positions are actually visible. Each key is released before the next state.
  const stateShots = [];
  const states = [
    ['idle', [], 0.4], ['walk', ['d'], 0.5], ['run', ['d', 'Shift'], 0.6],
    ['jump', [' '], 0.3], ['attack', ['j'], 0.2], ['grab', ['u'], 0.2]
  ];
  for (const [label, keys, seconds] of states) {
    for (const key of keys) await page.keyboard.down(key);
    await page.evaluate(step => window.__browserSmashStep?.(step), seconds);
    await page.evaluate(() => window.smashCamera.spectate({ yaw: 35, pitch: 0 }));
    await page.waitForTimeout(140);
    await page.screenshot({ path: resolve(outDir, `state-${label}.png`) });
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    await page.evaluate(() => window.smashCamera.endSpectate());
    stateShots.push({ label, keys });
    await page.evaluate(() => window.__browserSmashStep?.(0.2));
  }

  console.log('VIEWS:' + JSON.stringify({ ...info, shots, stateShots, errors }));
} finally {
  await browser.close();
}
