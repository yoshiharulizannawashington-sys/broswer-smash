// Naruto's three signature moves and all five forms, driven by real key presses.
//
// The earlier combat pass proved the J chain and the three heavies. This proves the moves that make
// him Naruto: Rasenshuriken on the signature key, Shadow Clone Jutsu and Rasengan on the two kit
// keys, and every one of his five forms transforming and then firing *its own* signature.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-signatures.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
await mkdir('artifacts/compare/naruto-signatures', { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const forms = MOVESETS.naruto_uzumaki.forms;
check('Naruto is authored with five forms', forms.length === 5, forms.map(f => f.id).join(', '));
check('every form carries its own signature move', new Set(forms.map(f => f.special?.label)).size === 5,
  forms.map(f => f.special?.label).join(' | '));

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 240)));

  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const f = window.fighters[0], c = window.fighters[1];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    c.position.set(2.4, .6, 0);
  });
  await page.locator('canvas').first().click({ position: { x: 220, y: 170 }, force: true });
  await page.waitForTimeout(400);

  const step = async (seconds = 0.35) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 0.05) {
      await page.evaluate(dt => window.__browserSmashStep?.(dt), 0.05);
    }
  };
  const reset = () => page.evaluate(() => {
    const f = window.fighters[0];
    f.power = 100; f.transformCooldown = 0; f.abilityReadyAt = {}; f.specialCooldown = 0;
    f.comboStep = 0; f.comboWindow = 0; f.attackQueue.length = 0; f.hitstun = 0; f.guardBreak = 0;
    // The opponent must survive the run. Four signature casts KO'd Thor and the round ended before
    // the fifth form could transform, which looked like a missing form and was a harness defect.
    const target = window.fighters[1];
    target.invulnerable = 999;
    target.percent = 0;
    target.hitstun = 0;
    target.ko = false;
  });
  const callout = () => page.evaluate(() => String(document.body.innerText || ''));

  // ---- signature key: Rasenshuriken
  await reset();
  await page.keyboard.press('k');
  await step(0.6);
  const afterSpecial = await page.evaluate(() => {
    const f = window.fighters[0];
    return { pose: window.__browserSmashAttackMotion?.()?.p1?.pose || null, cooldown: +(f.specialCooldown || 0).toFixed(2), label: f.specialProfile?.label || null };
  });
  const specialText = await callout();
  check('signature key fires Rasenshuriken', /RASENSHURIKEN/.test(specialText) || afterSpecial.cooldown > 0,
    JSON.stringify({ ...afterSpecial, announced: /RASENSHURIKEN/.test(specialText) }));

  // ---- kit key 1: Shadow Clone Jutsu (a real entity spawn, not a projectile)
  await reset();
  await page.keyboard.press('l');
  await step(0.6);
  const cloneCast = await page.evaluate(() => {
    const f = window.fighters[0];
    return { cast: f.abilityLastCast || null, clones: Array.isArray(window.shadowClones) ? window.shadowClones.length : (window.__browserSmashCloneCount?.() ?? null) };
  });
  check('kit key 1 casts Shadow Clone Jutsu', cloneCast.cast?.type === 'clones' && (cloneCast.cast?.spawned || 0) > 0, JSON.stringify(cloneCast));

  // ---- kit key 2: Rasengan
  await reset();
  await page.keyboard.press('h');
  await step(0.6);
  const rasenganCast = await page.evaluate(() => ({ cast: window.fighters[0].abilityLastCast || null }));
  check('kit key 2 casts Rasengan', String(rasenganCast.cast?.label || '').toUpperCase().includes('RASENGAN'), JSON.stringify(rasenganCast));

  // ---- all five forms transform and each fires its own signature
  const seen = [];
  for (let stage = 0; stage < forms.length; stage++) {
    await reset();
    await page.keyboard.press('i');
    await step(0.5);
    const state = await page.evaluate(() => {
      const f = window.fighters[0];
      return { active: Boolean(f.transform), label: f.transform?.label || f.transform?.form?.label || null, id: f.transform?.form?.id || null };
    });
    await page.evaluate(() => {
      window.__browserSmashCalloutHistory = String(document.body.innerText || '');
      const node = document.querySelector('#callout, .callout, [data-callout]');
      if (node) node.textContent = '';
    });
    await page.keyboard.press('k');
    await step(0.6);
    const text = await callout();
    const form = forms[stage];
    const label = String(form.special?.label || '').toUpperCase();
    // Strict: the *form's own* move must appear. Accepting the previous form's callout (or the
    // generic RASENSHURIKEN) is how form 5 passed while announcing nothing.
    const announced = Boolean(label) && text.toUpperCase().includes(label);
    seen.push({ stage: stage + 1, form: form.label, expected: label, active: state.active, announced, text: text.slice(-120) });
    check(`form ${stage + 1} ${form.label}: transforms`, state.active === true, JSON.stringify(state));
    check(`form ${stage + 1} ${form.label}: fires ${label || 'its own signature'}`, announced, `announced=${announced}`);
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
    await step(0.3);
  }
  console.log('FORMS', JSON.stringify(seen));
  check('no page errors during the signature run', errors.length === 0, errors.slice(0, 2).join(' | '));
  console.log(failures === 0 ? '\nNaruto signature verification passed.' : `\nNaruto signature verification FAILED (${failures}).`);
} finally {
  await browser?.close();
  server.close();
}
process.exitCode = failures === 0 ? 0 : 1;
