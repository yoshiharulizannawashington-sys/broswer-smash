// Drive the replaced character through real input states and record the clip the animator chose.
//
//   bash scripts/run-browser-test.sh scripts/probe-replaced-states.mjs <CharacterName> <outDir>
//
// Keys are the game's own P1 bindings. Each state is written only when the game reports it; the
// screenshot is taken while the match is still live (the sim is stepped, never disposed).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const characterName = process.argv[2] || 'Kaze';
const outDir = resolve(process.cwd(), process.argv[3] || 'artifacts/dev/phase28416/views/states');
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
await mkdir(outDir, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(120_000);
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));

const results = [];
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120_000, polling: 200 });
  await page.evaluate(name => {
    const select = document.querySelector('#p1Character');
    if (select) {
      const option = [...select.options].find(item => item.value === name);
      if (option) { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    document.querySelector('#play')?.click();
  }, characterName);
  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(f => f.model), null, { timeout: 120_000, polling: 200 });
  await page.evaluate(() => { document.body.click(); window.__browserSmashFreezeAI = true; window.__browserSmashStep?.(0.4); });

  const read = () => page.evaluate(() => {
    const fighter = window.fighters.find(f => String(f.name || f.identity || '').toLowerCase().includes('kaze')) || window.fighters[0];
    const clip = fighter?.model?.userData?.currentClip || null;
    return {
      clip,
      grounded: !!fighter?.isGrounded,
      speed: +(fighter?.speed ?? Math.hypot(fighter?.velocity?.x || 0, fighter?.velocity?.z || 0)).toFixed(2),
      y: +(fighter?.position?.y || 0).toFixed(2),
      grabCooldown: +(fighter?.grabCooldown || 0).toFixed(2),
      hitstun: +(fighter?.hitstun || 0).toFixed(2)
    };
  });

  const shot = async (label, keys, seconds) => {
    for (const key of keys) await page.keyboard.down(key);
    await page.evaluate(step => window.__browserSmashStep?.(step), seconds);
    await page.waitForTimeout(80);
    const observed = await read();
    for (const key of [...keys].reverse()) await page.keyboard.up(key);
    await page.evaluate(() => window.smashCamera.spectate({ yaw: 25, pitch: 0 }));
    await page.waitForTimeout(80);
    await page.screenshot({ path: resolve(outDir, `${label}.png`) });
    await page.evaluate(() => window.smashCamera.endSpectate());
    results.push({ state: label, keys, observed });
    await page.evaluate(() => window.__browserSmashStep?.(0.25));
  };

  await shot('idle', [], 0.4);
  await shot('walk', ['d'], 0.5);
  await shot('run', ['d', 'Shift'], 0.6);
  await shot('jump', [' '], 0.28);
  await shot('attack', ['j'], 0.18);
  await shot('grab', ['u'], 0.2);

  const clipList = await page.evaluate(() => {
    const f = window.fighters.find(x => String(x.name || x.identity || '').toLowerCase().includes('kaze')) || window.fighters[0];
    const roots = [f.model, f.root, f.mesh].filter(Boolean);
    const found = [];
    for (const root of roots) root?.traverse?.(n => { if (n.isSkinnedMesh && !found.length) found.push(...(n.geometry?.userData?.clips || [])); });
    return { userDataKeys: Object.keys(f.model?.userData || {}), clips: f.model?.userData?.clips?.map?.(c => c.name) || [] };
  });

  console.log('STATES:' + JSON.stringify({ character: characterName, results, modelClipMeta: clipList, errors }));
} finally {
  await browser.close();
}
