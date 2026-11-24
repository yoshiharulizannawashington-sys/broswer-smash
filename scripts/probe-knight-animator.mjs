// Which animator owns the imported body, and what clip does it think it is playing?
//   bash scripts/run-browser-test.sh scripts/probe-knight-animator.mjs <Character>
import { chromium } from 'playwright';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';
const name = process.argv[2] || 'Kaze';
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl',
  '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
const rows = [];
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 120000, polling: 200 });
  await page.evaluate(n => {
    const s = document.querySelector('#p1Character');
    const o = s && [...s.options].find(o => o.value === n);
    if (o) { s.value = n; s.dispatchEvent(new Event('change', { bubbles: true })); }
    document.querySelector('#play')?.click();
  }, name);
  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(f => f.model), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => { window.__browserSmashFreezeAI = true; window.__browserSmashStep?.(0.4); });
  const read = () => page.evaluate(() => {
    const f = window.fighters[0];
    const u = f.model?.userData || {};
    const c = u.animationController || null;
    return {
      speed: +Math.hypot(f.velocity?.x || 0, f.velocity?.z || 0).toFixed(2),
      humanMixer: !!u.humanMixer,
      hasAnimationClips: !!u.hasAnimationClips,
      controller: !!c,
      controllerActive: c ? c.describe().active : null,
      controllerClips: c ? c.describe().clips : null,
      controllerRig: c ? c.describe().rig : null,
      controllerBound: c ? c.describe().boundBones : null,
      currentClip: u.currentClip || null,
      lastMoveClip: u.lastMoveAction?.getClip?.()?.name || null
    };
  });
  for (const [state, keys] of [['idle', []], ['walk', ['d']], ['run', ['d', 'Shift']], ['attack', ['j']], ['grab', ['u']]]) {
    for (const k of keys) await page.keyboard.down(k);
    for (let i = 0; i < 6; i++) await page.evaluate(() => window.__browserSmashStep?.(0.05));
    rows.push({ state, ...(await read()) });
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    await page.evaluate(() => window.__browserSmashStep?.(0.3));
  }
  console.log('ANIM:' + JSON.stringify({ rows, errors }));
} finally { await browser.close(); }
