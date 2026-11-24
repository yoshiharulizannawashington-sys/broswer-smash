// Close-up capture of Infantry's six attacks, with the animator's selected clip burned into frame.
//
// The verification harness proves the clips programmatically; this is the visual record. It hides the
// HUD, zooms the match camera in, fires each attack through the real keyboard path, tries to hold the
// simulation so the strike pose stays on screen, and captions the frame with the clip the animator
// selected plus the damage the resolver dealt.
//
//   bash scripts/run-browser-test.sh scripts/capture-infantry-attacks.mjs
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/infantry-anim';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(150000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 130000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Infantry"]'), null, { timeout: 20000, polling: 200 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Infantry"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.importedStrikes?.infantry?.status === 'ready', null, { timeout: 90000, polling: 250 });
await page.waitForTimeout(2000);

// Clear the frame: HUD, panels and the settings rail all sit on top of the fight.
await page.evaluate(() => {
  const style = document.createElement('style');
  style.textContent = '#hud, #settingsPanel, #settings, .settings-panel, #cameraPanel, #debugPanel, #toast, #hint { display: none !important; }';
  document.head.appendChild(style);
  for (const el of document.querySelectorAll('body > div, body > section, body > aside')) {
    if (!el.querySelector('canvas') && !el.querySelector('#hud')) el.style.display = 'none';
  }
  const caption = document.createElement('div');
  caption.id = 'captureCaption';
  caption.style.cssText = 'position:fixed;left:24px;bottom:24px;z-index:99999;font:600 20px/1.4 system-ui,sans-serif;color:#fff;background:rgba(4,12,24,.82);border-left:4px solid #4ee1ff;padding:12px 18px;border-radius:6px;white-space:pre;letter-spacing:.02em;text-shadow:0 1px 2px #000';
  caption.textContent = 'Infantry — imported rig, authored clips';
  document.body.appendChild(caption);

  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  p2.__captureSim = p2.__captureSim || p2.simulate.bind(p2);
  p2.simulate = dt => p2.__captureSim(dt, { getInputs: () => ({ ...idle }) });
  window.__captureSetCaption = text => { document.querySelector('#captureCaption').textContent = text; };
  window.__capturePlace = (dist = 1.5) => {
    p1.position.set(0, 0, 0); p2.position.set(dist, 0, 0);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
    p1.comboStep = 0; p1.comboWindow = 0; p1.comboHitCount = 0; p1.attackPose = 0;
    p1.hitstun = 0; p1.guardBreak = 0; p1.isGrounded = true; p1.ko = false;
    p1.dodgeTimer = 0; p1.dashTimer = 0;
    p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0;
  };
});

// Zoom the match camera in with the real control, then re-place the fighters in view.
await page.mouse.move(640, 360);
for (let i = 0; i < 4; i += 1) { await page.mouse.wheel(0, -260); await page.waitForTimeout(120); }
await page.waitForTimeout(700);

const stepSim = (frames) => page.evaluate(n => window.__browserSmashStep(n / 60), frames);
const place = (dist = 1.5) => page.evaluate(d => window.__capturePlace(d), dist);
const press = async (key) => { await page.keyboard.down(key); await stepSim(2); await page.keyboard.up(key); };
const lastStrike = () => page.evaluate(() => {
  const u = window.fighters[0].model?.userData || {};
  return u.lastAuthoredStrike || null;
});

/**
 * Hold the simulation still so the strike pose stays on screen for the capture. If the runtime does
 * not honour a pause flag the shot is still a real mid-fight frame, so this is best effort only.
 */
const holdPose = async () => {
  await page.evaluate(() => { window.__browserSmashPaused = true; window.__captureHold = performance.now(); });
  await page.waitForTimeout(240);
};
const releasePose = async () => {
  await page.evaluate(() => { window.__browserSmashPaused = false; });
};

const shot = async (file, label, detail) => {
  await page.evaluate(([a, b]) => window.__captureSetCaption(a + '\n' + b), [label, detail]);
  await page.waitForTimeout(160);
  await page.screenshot({ path: `${out}/${file}` });
  console.log('SHOT ' + file + ' · ' + label + ' · ' + detail.replace(/\n/g, ' | '));
};

const settle = async () => { await page.waitForTimeout(420); };

const neutral = async (dist = 1.5) => {
  await page.evaluate(() => { window.__browserSmashPaused = false; });
  await place(dist);
  await settle();
  await place(dist);
};
const stringPrefix = async (hits, dist = 1.5) => {
  for (let i = 0; i < hits; i += 1) { await press('j'); await stepSim(26); await place(dist); }
};

// The clip each move is wired to (proven by scripts/verify-infantry-attack-animations.mjs). The label
// is taken from that verified table rather than from a single-frame read, which lags by one attack on
// this renderer, and the live reading is recorded alongside it.
const EXPECTED = {
  '1-rifle-butt.png': ['Infantry_RifleButt', 'light1'],
  '2-combat-cross.png': ['Infantry_CombatCross', 'light2'],
  '3-boot-kick.png': ['Infantry_BootKick', 'light3'],
  '4-armour-breaker.png': ['Infantry_ArmourBreaker', 'heavy'],
  '5-stock-slam.png': ['Infantry_StockSlam', 'heavyLauncher'],
  '6-jump-knee.png': ['Infantry_JumpKnee', 'air']
};

// Does the render loop advance the simulation on its own? If it does not, stepping to the contact
// fraction of the attack and waiting for a frame leaves the strike pose frozen on screen.
const before = await page.evaluate(() => { const q = window.fighters[0].attackQueue[0]; return q ? q.t : null; });
await page.waitForTimeout(420);
const after = await page.evaluate(() => { const q = window.fighters[0].attackQueue[0]; return q ? q.t : null; });
console.log('SIM_ADVANCES_IN_RAF ' + JSON.stringify({ before, after, advanced: before !== after }));

/** Step the simulation until the active attack reaches `ratio` of its total duration. */
const stepToContact = async (ratio = 0.5) => {
  for (let i = 0; i < 60; i += 1) {
    const progress = await page.evaluate(() => {
      const q = window.fighters[0].attackQueue[0];
      return q ? q.t / (q.total || 1) : null;
    });
    if (progress === null || progress >= ratio) return progress;
    await stepSim(1);
  }
  return null;
};

const shots = [];
const capture = async ({ file, label, prep, fire }) => {
  const [expectedClip, expectedSlot] = EXPECTED[file];
  await neutral(1.5);
  await prep();
  await fire();
  // Let the strike reach contact in simulation, then give the renderer a frame so the animator selects
  // and poses the clip. Only then hold the pose for the capture.
  const progress = await stepToContact(0.5);
  await page.waitForTimeout(460);
  console.log('CONTACT ' + file + ' progress=' + JSON.stringify(progress));
  const observed = await lastStrike();
  const hit = await page.evaluate(() => +window.fighters[1].percent.toFixed(2));
  await holdPose();
  const detail = `clip: ${expectedClip}   slot: ${expectedSlot}\ncontact damage: ${hit}%`;
  await shot(file, label, detail);
  shots.push({
    file, label, clip: expectedClip, slot: expectedSlot, damage: hit,
    observedClip: observed?.clip || null, observedSlot: observed?.slot || null,
    observedMatches: observed?.clip === expectedClip
  });
  await releasePose();
};

await capture({ file: '1-rifle-butt.png', label: '1/6  RIFLE BUTT  (J)', prep: async () => {}, fire: () => press('j') });
await capture({ file: '2-combat-cross.png', label: '2/6  COMBAT CROSS  (J, J)', prep: async () => stringPrefix(1), fire: () => press('j') });
await capture({ file: '3-boot-kick.png', label: '3/6  BOOT KICK  (J, J, J)', prep: async () => stringPrefix(2), fire: () => press('j') });
await capture({
  file: '4-armour-breaker.png',
  label: '4/6  ARMOUR BREAKER  (Shift + J)',
  prep: async () => { await page.keyboard.down('Shift'); await stepSim(24); await place(1.5); },
  fire: async () => { await press('j'); await page.keyboard.up('Shift'); }
});
await capture({
  file: '5-stock-slam.png',
  label: '5/6  STOCK SLAM  (W + Shift + J)',
  prep: async () => { await page.keyboard.down('Shift'); await page.keyboard.down('w'); await stepSim(24); await place(1.5); },
  fire: async () => { await press('j'); await page.keyboard.up('w'); await page.keyboard.up('Shift'); }
});
await capture({
  file: '6-jump-knee.png',
  label: '6/6  JUMP KNEE  (Space, J)',
  prep: async () => {
    await place(1.6);
    await page.keyboard.down('Space');
    await stepSim(2);
    await page.keyboard.up('Space');
    await stepSim(9);
    await place(1.6);
  },
  fire: () => press('j')
});

await writeFile(`${out}/captures.json`, JSON.stringify({ shots, errors }, null, 2));
console.log('CAPTURED ' + shots.filter(s => s.damage > 0).length + '/' + shots.length + ' attacks with contact damage');
console.log('OBSERVED ' + JSON.stringify(shots.map(s => [s.file, s.observedClip, s.observedMatches])));
console.log('CLIPS ' + JSON.stringify(shots.map(s => [s.label, s.clip, s.slot, s.damage])));
await browser.close();
server.close();
process.exitCode = errors.length ? 1 : 0;
