// Transformation activation verification.
//
//   bash scripts/run-browser-test.sh scripts/verify-transformation.mjs
//
// A form is not a key that swaps a colour. The press has to gather first: the fighter plants, the
// aura swells, and the body's own surfaces and costume stay untouched until the burst lands.
// This runs a real match, presses the real key, and walks Goku's ladder to Super Saiyan Blue and
// Ultra Instinct, checking the HUD prices the tier the next press actually buys.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/transformation';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.fighters?.length === 2 && window.__browserSmashAssets?.app?.status === 'running', null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Goku');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play')?.click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 60000, polling: 200 });
await page.waitForTimeout(1200);
await page.evaluate(() => window.__browserSmashSkipCinematic?.());

// Installed once in the page: a gather sample and the steps that produced it have to be read in
// one evaluated turn, because the live render loop keeps advancing between Playwright calls.
await page.evaluate(() => {
  window.__transformationSnapshot = () => {
    const fighter = window.fighters?.[0];
    let hair = null;
    fighter?.model?.traverse(node => {
      const material = node.material;
      if (material && !Array.isArray(material) && material.name === 'fighter-hair') {
        hair = {
          color: '#' + (material.color?.getHexString?.() || ''),
          emissive: '#' + (material.emissive?.getHexString?.() || ''),
          intensity: +(material.emissiveIntensity ?? 0).toFixed(2),
          scale: +(node.scale?.x ?? 1).toFixed(2)
        };
      }
    });
    const row = document.querySelector('.fighter:not(.right) #p1power [data-row="form"]');
    return {
      stage: fighter?.formStage || 0,
      power: +(fighter?.power || 0).toFixed(2),
      x: +(fighter?.position?.x || 0).toFixed(3),
      incoming: +(fighter?.incomingDamage ?? 1).toFixed(2),
      id: fighter?.transform?.form?.id || null,
      label: fighter?.transform?.label || null,
      landed: fighter?.transform?.landed ?? null,
      charge: +(fighter?.transform?.charge ?? 0).toFixed(3),
      time: +(fighter?.transform?.time ?? 0).toFixed(2),
      lock: +(fighter?.formLock ?? 0).toFixed(2),
      hair,
      aura: fighter?.aura ? {
        children: fighter.aura.children.length,
        scale: +fighter.aura.scale.x.toFixed(2),
        visible: fighter.aura.visible
      } : null,
      callout: document.querySelector('#combatCallout')?.textContent || '',
      hud: {
        val: row?.querySelector('.val')?.textContent || '',
        width: row?.querySelector('i')?.style.width || '',
        title: row?.getAttribute('title') || '',
        charging: row?.classList.contains('charging') || false
      }
    };
  };
});
const snapshot = () => page.evaluate(() => window.__transformationSnapshot());

const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
const pressTransform = () => page.evaluate(() => {
  const press = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  press('keydown', 'KeyI');
  press('keyup', 'KeyI');
});

// A clean, grounded, full-power Goku with a passive opponent: the probe reads the player's own
// body, so the dummy must not turn the exchange into something else.
const reset = async ({ stage = 0, power = 100 } = {}) => {
  await page.evaluate(({ stage, power }) => {
    const f = window.fighters[0];
    const p2 = window.fighters[1];
    f.transform = null;
    if (f.aura) { f.aura.parent?.remove(f.aura); f.aura = null; }
    f.formStage = stage;
    f.power = power;
    f.transformCooldown = 0;
    f.formLock = 0;
    f.hitstun = 0;
    f.guardBreak = 0;
    f.attackQueue.length = 0;
    f.attackBuffer = 0;
    f.attackPose = 0;
    f.position.set(-1.4, 0, 0);
    f.velocity.set(0, 0, 0);
    f.facing = 1;
    f.facingZ = 0;
    p2.position.set(5, 0, 0);
    p2.invulnerable = 999;
    const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false, attack: false, special: false, special2: false, special3: false, special4: false, special5: false, grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false, webSwing: false, vertical: 0, transform: false, ultimate: false };
    if (!p2.__transformationIdle) {
      p2.__transformationIdle = p2.simulate.bind(p2);
      p2.simulate = dt => p2.__transformationIdle(dt, { getInputs: () => ({ ...idle }) });
    }
  }, { stage, power });
  await step(.25);
};

await reset();
const before = await snapshot();
check('Goku starts untransformed with his authored hair',
  before.id === null && before.hair?.color === '#341a1c', JSON.stringify(before.hair));
check('the form bar is ready at full power', before.hud.val === 'READY', before.hud.val);

// ---- gather: the press must not change the body ------------------------------------------
const gather = await page.evaluate(() => {
  const press = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  press('keydown', 'KeyD');
  press('keydown', 'KeyI');
  press('keyup', 'KeyI');
  window.__browserSmashStep(.05);
  const first = window.__transformationSnapshot();
  window.__browserSmashStep(.1);
  const second = window.__transformationSnapshot();
  press('keyup', 'KeyD');
  return { first, second };
});
const charging = gather.first;

check('the key press starts Super Saiyan', charging.id === 'goku-super-saiyan', String(charging.id));
check('the form is gathering, not landed', charging.landed === false && charging.charge > 0,
  JSON.stringify({ landed: charging.landed, charge: charging.charge }));
check('the charge plants the fighter', Math.abs(charging.x - before.x) < .05,
  `${before.x} -> ${charging.x}`);
check('the activation lock is real', charging.lock > 0, String(charging.lock));
check('the base hair is untouched during the gather', charging.hair?.color === '#341a1c', charging.hair?.color);
check('the base hair silhouette is untouched during the gather', charging.hair?.scale === 1, String(charging.hair?.scale));
check('the aura gathers at partial size', charging.aura && charging.aura.children > 0 && charging.aura.scale < .6,
  JSON.stringify(charging.aura));
check('the form timer has not started', charging.time === 10, String(charging.time));
check('the form bar shows the gather', charging.hud.val === 'CHARGE' && charging.hud.charging === true,
  JSON.stringify(charging.hud));
await page.screenshot({ path: `${out}/charge.png` });

const stillGathering = gather.second;
check('the gather holds for at least a tenth of a second',
  stillGathering.landed === false && stillGathering.hair?.color === '#341a1c',
  JSON.stringify({ landed: stillGathering.landed, charge: stillGathering.charge, hair: stillGathering.hair?.color }));

// ---- burst: the form arrives at the end of the gather -------------------------------------
await step(.5);
const burst = await snapshot();
check('the form lands after its charge', burst.landed === true && burst.charge === 0,
  JSON.stringify({ landed: burst.landed, charge: burst.charge }));
check('Super Saiyan turns the hair gold', burst.hair?.color === '#f7d452', burst.hair?.color);
check('Super Saiyan brightens and enlarges the hair',
  burst.hair?.intensity === 1.6 && burst.hair?.scale === 1.14, JSON.stringify(burst.hair));
check('the aura reaches its full size on the burst', burst.aura?.scale === 1 && burst.aura?.visible === true,
  JSON.stringify(burst.aura));
check('the form announces itself', burst.callout === 'SUPER SAIYAN' && burst.hud.val.endsWith('s'),
  JSON.stringify({ callout: burst.callout, hud: burst.hud.val }));
check('the duration only drains after the burst', burst.time > 8 && burst.time <= 10, String(burst.time));
await page.screenshot({ path: `${out}/burst.png` });

// ---- expiry restores the authored body and advances the ladder ----------------------------
await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
await step(.2);
const ended = await snapshot();
check('expiry restores the base hair', ended.id === null && ended.hair?.color === '#341a1c', ended.hair?.color);
check('expiry removes the aura', ended.aura === null);
check('the ladder advances only after a landed form', ended.stage === 1, String(ended.stage));

// ---- the HUD prices the next tier, not the base entry -------------------------------------
await page.evaluate(() => { const f = window.fighters[0]; f.formStage = 1; f.power = 45; f.transformCooldown = 0; f.formLock = 0; });
await step(.1);
const priced = await snapshot();
check('the form bar prices Super Saiyan Blue at 52 power',
  priced.hud.val === '86%' && Math.abs(parseFloat(priced.hud.width) - 86.5) < 1,
  JSON.stringify(priced.hud));
check('the tooltip names the next tier and its price',
  /SUPER SAIYAN BLUE/.test(priced.hud.title) && /52 power/.test(priced.hud.title), priced.hud.title);

await pressTransform();
await step(.1);
const refused = await snapshot();
check('below the next tier price the press is refused, with a reason',
  refused.id === null && refused.callout === 'FORM NOT READY',
  JSON.stringify({ id: refused.id, callout: refused.callout, power: refused.power }));
check('a refused press spends no power', refused.power === 45, String(refused.power));

await page.evaluate(() => { window.fighters[0].power = 55; });
await step(.1);
const ready = await snapshot();
check('the next tier reads ready at its own price', ready.hud.val === 'READY', ready.hud.val);

await pressTransform();
await step(.5);
const blue = await snapshot();
check('the next activation enters Super Saiyan Blue', blue.id === 'goku-super-saiyan-blue', String(blue.id));
check('Super Saiyan Blue turns the hair blue', blue.hair?.color === '#9fe4ff', blue.hair?.color);
check('the ladder price is paid once', blue.power > 0 && blue.power < 4, String(blue.power));
check('the active form runs its own duration', blue.time > 8 && blue.time <= 9, String(blue.time));

// ---- third tier ---------------------------------------------------------------------------
await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
await step(.2);
await page.evaluate(() => {
  const f = window.fighters[0];
  f.formStage = 2;
  f.power = 100;
  f.transformCooldown = 0;
  f.formLock = 0;
});
await pressTransform();
await step(.5);
const ultra = await snapshot();
check('the third activation enters Ultra Instinct', ultra.id === 'goku-ultra-instinct', String(ultra.id));
check('Ultra Instinct turns the hair silver', ultra.hair?.color === '#f4f8ff', ultra.hair?.color);
check('Ultra Instinct applies its evasive defence', ultra.incoming === .82, String(ultra.incoming));

check('no page errors during the run', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
server.close();

const failed = checks.filter(entry => !entry.ok);
console.log(`\nTransformation verification: ${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) {
  console.error('Failed: ' + failed.map(entry => entry.name).join(' | '));
  process.exit(1);
}
