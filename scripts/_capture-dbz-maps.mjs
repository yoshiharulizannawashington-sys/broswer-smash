// Temporary DBZ map capture: baseline and after shots through the live game.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.BROWSER_SMASH_URL || 'http://127.0.0.1:3000';
const out = resolve(process.env.CAPTURE_DIR || 'artifacts/dbz-upgrade/current');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.setDefaultTimeout(180_000);
const errors = [];
page.on('pageerror', error => errors.push(error.stack || String(error)));
page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
  && window.fighters?.length === 2 && window.__browserSmashSelect, null, { timeout: 150_000, polling: 250 });
await page.waitForTimeout(500);
await page.evaluate(() => {
  window.__browserSmashSelect.select?.('p1', 'Goku');
  window.__browserSmashSelect.select?.('p2', 'Vegeta');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
  document.querySelector('#play')?.click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60_000 });
await page.waitForTimeout(1200);
const maps = process.env.CAPTURE_MAPS ? process.env.CAPTURE_MAPS.split(',') : ['dbz_west_city', 'dbz_capsule_corp', 'tournament', 'dbz_grand_prize'];
for (const key of maps) {
  await page.evaluate(k => window.__browserSmashSelect.chooseArena(k), key);
  await page.waitForFunction(k => window.__browserSmashMatch().arena === k, key, { timeout: 60_000 });
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => {
    window.__browserSmashSpawnFighters();
    const layout = window.__browserSmashLayout();
    window.fighters.forEach((f, i) => {
      const spawn = layout.spawns[i] || layout.spawns[0];
      f.position.set(spawn.x, spawn.y ?? layout.ground, spawn.z);
      f.velocity.set(0, 0, 0); f.hitstun = 0; f.percent = 0; f.isGrounded = true;
    });
    window.__browserSmashStep(0.2);
    const groups = [];
    window.__browserSmashScene?.traverse(o => { if (o.isMesh) groups.push(o.name); });
    return {
      label: layout.label,
      layout,
      match: window.__browserSmashMatch?.(),
      world: window.__browserSmashWorld,
      fighters: window.fighters.map(f => ({ x: f.position.x, y: f.position.y, z: f.position.z, ground: f.groundLevel })),
      meshCount: groups.length,
      arena: window.__browserSmashAssets?.authoredArena || null
    };
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(out, `${key}.png`) });
  console.log('SHOT', key, JSON.stringify(info));
}
console.log('ERRORS', errors.length, errors.slice(0, 5));
await browser.close();
