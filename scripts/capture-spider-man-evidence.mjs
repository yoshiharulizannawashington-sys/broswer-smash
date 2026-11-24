// Spider-Man evidence capture. The gameplay camera is deliberately not touched: this probe
// freezes the live frame at the contact/pose it wants to show, records the current camera, takes a
// wide full-body side view, then restores the camera before resuming. The normal follow-camera
// evidence remains in artifacts/spider-man-gameplay/ from verify-spider-man-gameplay.mjs.
//
//   bash scripts/run-browser-test.sh scripts/capture-spider-man-evidence.mjs
//
// The side view is selected because the follow camera sits behind Spider-Man: a forward kick or
// web line can be almost edge-on there. Every fighter, limb, projectile and impact is kept in frame.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/spider-man-evidence';
await mkdir(out, { recursive: true });
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/api/models/sources') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sources: [], roster: { launch: [], manifestKeys: [] } }));
      return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const errors = [];
const rows = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(180000);
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 220)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 180)); });

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForSelector('#selectScreen [data-fighter="Spider-Man"]', { timeout: 30000 });
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Spider-Man"]').click());
await page.evaluate(() => document.querySelector('#selectScreen [data-side="p1"]').click());
await page.waitForFunction(() => ['ready', 'loaded'].includes(document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state), null, { timeout: 90000, polling: 300 }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/00-select-screen.png` });
await page.locator('#selectScreen [data-role="preview"]').screenshot({ path: `${out}/00-select-preview.png` });

await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForFunction(() => window.__browserSmashAssets?.characterModels?.spider_man?.status === 'loaded', null, { timeout: 120000, polling: 300 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  const p2 = window.fighters[1];
  if (!p2.__spiderEvidenceSim) {
    p2.__spiderEvidenceSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__spiderEvidenceSim(dt, { getInputs: () => ({ ...idle }) });
  }
  // Remove only the HTML overlays from these evidence frames. The canvas, fighters, arena, VFX and
  // real game state stay exactly as played; this is not a production camera or HUD change.
  for (const node of document.body.children) {
    if (node.tagName === 'CANVAS' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;
    node.style.display = 'none';
  }
});
// Try an evidence-only important rule as well in case the overlay is stylesheet-driven. The canvas,
// scene and simulation are untouched. A HUD that is composited outside these elements stays visible;
// these frames are deliberately not presented as chrome-free.
await page.addStyleTag({ content: '#hud,#vignette,#energyHUD,#comboNotice,#menu,#cameraSettings,#exploreHint,#loading,#fatalError,#browserSmashCinematic{display:none!important;visibility:hidden!important}' });
await page.evaluate(() => window.__browserSmashStep(0.5));

async function reset(distance = 1.8) {
  await page.evaluate(distance => {
    const [p1, p2] = window.fighters;
    window.combatPowers?.clear?.('evidence');
    window.__browserSmashTraining?.resetPositions?.();
    window.__browserSmashLastImpact = null;
    window.__browserSmashLastShot = null;
    window.__browserSmashGrabTrace = [];
    p1.position.set(-distance / 2, 0, 0);
    p2.position.set(distance / 2, 0, 0);
    for (const f of [p1, p2]) {
      f.velocity.set(0, 0, 0); f.isGrounded = true; f.hitstun = 0; f.guardBreak = 0;
      f.guardHeld = false; f.attackQueue.length = 0; f.attackPose = 0; f.hitboxes.length = 0;
      f.dodgeTimer = 0; f.transform = null; f.formLock = 0; f.transformCooldown = 0;
      f.casting = null; f.ko = false; f.webSwinging = false; f.flightMode = false;
      f.attackBuffer = 0; f.comboStep = 0; f.activeMoveId = null;
      window.endWebSwing?.(f, false);
    }
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p2.invulnerable = 0; p2.shield = 100; p2.percent = 0; p2.hitstun = 0; p2.guardHeld = false;
    p1.percent = 0; p1.meter = 100; p1.power = 100; p1.specialCooldown = 0; p1.abilityReadyAt = {};
    const c = p1.animationController;
    if (c) { c._lock = null; c._downState = false; c._getUpTimer = 0; c._landTimer = 0; c._airTime = 0; }
  }, distance);
  await page.evaluate(() => window.__browserSmashStep(0.22));
}

async function step(seconds) {
  await page.evaluate(seconds => window.__browserSmashStep(seconds), seconds);
}

function readState() {
  return page.evaluate(() => {
    const [p1, p2] = window.fighters;
    return {
      active: p1.animationController?._active || null,
      state: p1.animationController?._select?.()?.id || null,
      grounded: !!p1.isGrounded, webSwinging: !!p1.webSwinging,
      transform: p1.transform?.id || null, casting: p1.casting || null,
      attack: p1.attackQueue?.[p1.attackQueue.length - 1]?.id || p1.activeMoveId || null,
      p1pos: p1.position.toArray().map(v => +v.toFixed(2)),
      p2pos: p2.position.toArray().map(v => +v.toFixed(2)),
      p2percent: +p2.percent.toFixed(1), p2hitstun: +(p2.hitstun || 0).toFixed(2),
      lastShot: window.__browserSmashLastShot || null,
      lastImpact: window.__browserSmashLastImpact || null,
      grab: (window.__browserSmashGrabTrace || []).slice(-3),
      weaponKind: p1.model?.userData?.weaponKind || null,
      equippedWeapons: ['equippedWeaponRight', 'equippedWeaponLeft'].filter(k => p1.model?.userData?.[k])
    };
  });
}

async function stepUntilHit(maxSeconds = 2) {
  return page.evaluate(maxSeconds => {
    const [p1, p2] = window.fighters;
    const before = p2.percent;
    let active = null;
    const steps = Math.max(1, Math.round(maxSeconds * 60));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(1 / 60);
      active = p1.animationController?._active || null;
      if (p2.percent > before + 1e-6) break;
    }
    // Freeze in the same tick as the damage event. A screenshot cannot drift into recovery.
    window.__browserSmashSetPaused(true);
    return {
      before: +before.toFixed(1), after: +p2.percent.toFixed(1), active,
      grounded: !!p1.isGrounded, p1pos: p1.position.toArray().map(v => +v.toFixed(2)),
      p2pos: p2.position.toArray().map(v => +v.toFixed(2))
    };
  }, maxSeconds);
}

async function stepUntilGrab(index, maxSeconds = 6) {
  return page.evaluate(({ index, maxSeconds }) => {
    const start = performance.now();
    let active = null;
    while (performance.now() - start < maxSeconds * 1000) {
      window.__browserSmashStep(1 / 60);
      active = window.fighters[0]?.animationController?._active || null;
      if ((window.__browserSmashGrabTrace || []).some(e => e.index === index)) break;
    }
    window.__browserSmashSetPaused(true);
    return {
      active,
      grab: (window.__browserSmashGrabTrace || []).slice(-3),
      p1pos: window.fighters[0].position.toArray().map(v => +v.toFixed(2)),
      p2pos: window.fighters[1].position.toArray().map(v => +v.toFixed(2)),
      p2percent: +window.fighters[1].percent.toFixed(1)
    };
  }, { index, maxSeconds });
}

async function stepUntilUltimateEnds(maxSeconds = 8) {
  return page.evaluate(maxSeconds => {
    const start = performance.now();
    while (performance.now() - start < maxSeconds * 1000) {
      window.__browserSmashStep(1 / 60);
      const p1 = window.fighters[0];
      if (!p1.casting && p1.animationController?._active !== 'spider_web_ultimate') break;
    }
    window.__browserSmashSetPaused(true);
    return { casting: window.fighters[0].casting || null, active: window.fighters[0].animationController?._active || null };
  }, maxSeconds);
}

async function capture(name, { focus = 'pair' } = {}) {
  // `stepUntilHit`/`stepUntilGrab` already paused at the exact contact frame. Calling pause again
  // is harmless; it guarantees a deterministic still if this is a locomotion/pose capture.
  await page.evaluate(() => window.__browserSmashSetPaused(true));
  await page.waitForTimeout(70);
  const frame = await page.evaluate(focus => {
    const [p1, p2] = window.fighters || [];
    const THREE = window.__browserSmashThree;
    const camera = window.smashCamera?.camera;
    if (!p1?.position || !p2?.position || !THREE || !camera) return null;
    window.__spiderEvidenceCamera = {
      position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov
    };
    let target;
    let distance;
    if (focus === 'p1') {
      target = new THREE.Vector3(p1.position.x, Math.max(1.0, p1.position.y + 1.0), p1.position.z);
      distance = 4.8;
    } else {
      const center = p1.position.clone().add(p2.position).multiplyScalar(0.5);
      const span = Math.max(2.0, p1.position.distanceTo(p2.position));
      target = new THREE.Vector3(center.x, Math.max(1.0, center.y + 1.0), center.z);
      distance = Math.max(5.2, span * 1.45 + 2.4);
    }
    // Pure side view: the fight runs along X, so a camera on +Z shows a forward kick's extension
    // instead of looking down Spider-Man's back. Slight height keeps the feet and head in frame.
    camera.position.set(target.x, target.y + distance * 0.17, target.z + distance);
    camera.fov = 42;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    return { focus, target: target.toArray().map(v => +v.toFixed(2)), distance: +distance.toFixed(2) };
  }, focus);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${name}.png` });
  const state = await readState();
  await page.evaluate(() => {
    const saved = window.__spiderEvidenceCamera;
    const camera = window.smashCamera?.camera;
    if (saved && camera) {
      camera.position.fromArray(saved.position);
      camera.quaternion.fromArray(saved.quaternion);
      camera.fov = saved.fov;
      camera.updateProjectionMatrix();
    }
    delete window.__spiderEvidenceCamera;
    window.__browserSmashSetPaused(false);
  });
  rows.push({ name, frame, ...state });
  console.log(name, JSON.stringify({ active: state.active, p2percent: state.p2percent, p1pos: state.p1pos, p2pos: state.p2pos }));
  return state;
}

// Full-body select preview and locomotion use the character as the subject; interaction shots keep
// both fighters in frame.
await reset();
await page.evaluate(() => window.__browserSmashSetPaused(true));
await page.evaluate(() => window.__browserSmashStep(0.35));
await capture('01-idle-side', { focus: 'p1' });
await page.keyboard.down('d');
await page.evaluate(() => window.__browserSmashStep(0.45));
await capture('02-walk-side', { focus: 'p1' });
await page.keyboard.up('d');
await reset();
await page.keyboard.down('Shift'); await page.keyboard.down('d');
// Shift is also the dodge edge. Advance through that startup until the actual sprint clip is
// active, otherwise the evidence frame is a dodge rather than locomotion.
await page.evaluate(() => {
  const p1 = window.fighters[0];
  for (let i = 0; i < 120; i += 1) {
    window.__browserSmashStep(1 / 60);
    if (p1.animationController?._active === 'sprint') break;
  }
});
await capture('03-run-side', { focus: 'p1' });
await page.keyboard.up('d'); await page.keyboard.up('Shift');

await reset(1.15);
await page.keyboard.press('j');
await stepUntilHit(1.2);
await capture('04-jab-contact');
await page.keyboard.press('j');
await stepUntilHit(1.2);
await capture('05-combo-contact');
await reset(1.4);
await page.keyboard.down('Shift'); await page.keyboard.press('j');
await stepUntilHit(1.4);
await capture('06-heavy-contact');
await page.keyboard.up('Shift');

await reset(1.35);
await page.keyboard.press('Space');
await page.evaluate(() => window.__browserSmashStep(0.20));
await page.keyboard.press('j');
await stepUntilHit(1.2);
await capture('07-aerial-contact');
// Second replay for the authored extension: keep the contact capture above as the exact hit tick,
// then freeze the same strike later in its clip so the leg extension can be judged separately.
await reset(1.35);
await page.keyboard.press('Space');
await page.evaluate(() => window.__browserSmashStep(0.20));
await page.keyboard.press('j');
await page.evaluate(() => window.__browserSmashStep(0.16));
await capture('07a-aerial-peak');

await reset(2.2);
await page.keyboard.press('k');
await stepUntilHit(1.2);
await capture('08-web-zip-contact');
await reset(2.4);
await page.keyboard.press('l');
await page.waitForFunction(() => (window.fighters?.[1]?.percent || 0) > 0
  || (window.__browserSmashLastImpact?.dealt || 0) > 0, null, { timeout: 7000 }).catch(() => {});
await capture('09-web-shot-impact');
await reset(3.6);
await page.keyboard.press('h');
await stepUntilHit(1.4);
await capture('10-web-pull-contact');
await reset(2.0);
await page.keyboard.press('t');
await stepUntilHit(1.2);
await capture('11-web-swing-strike');
await reset(5.0);
await page.keyboard.down('g');
await page.evaluate(() => window.__browserSmashStep(0.38));
await capture('12-web-swing-side', { focus: 'pair' });
await page.keyboard.up('g');

await reset();
await page.evaluate(() => { const p = window.fighters[0]; p.power = 100; p.meter = 100; });
await page.keyboard.press('i');
await page.evaluate(() => window.__browserSmashStep(0.22));
await capture('13-transform-side', { focus: 'p1' });

await reset(2.5);
await page.evaluate(() => { const p = window.fighters[0]; p.power = 100; p.meter = 100; });
await page.keyboard.press('o');
await page.evaluate(() => window.__browserSmashStep(0.22));
await capture('14-ultimate-startup');
await page.evaluate(() => window.__browserSmashStep(0.35));
await capture('15-ultimate-reel');
await stepUntilGrab(1);
await capture('16-ultimate-grapple');
await stepUntilGrab(2);
await capture('17-ultimate-slam');
await stepUntilUltimateEnds();
await capture('18-ultimate-finish');

const expected = ['04-jab-contact', '05-combo-contact', '06-heavy-contact', '07-aerial-contact',
  '08-web-zip-contact', '09-web-shot-impact', '10-web-pull-contact', '11-web-swing-strike',
  '16-ultimate-grapple', '17-ultimate-slam'];
const missing = expected.filter(name => {
  const row = rows.find(r => r.name === name);
  return !row || !(row.p2percent > 0);
});
await writeFile(`${out}/report.json`, JSON.stringify({ rows, expected, missing, errors }, null, 2));
console.log(`\nCAPTURE ${rows.length} frames; ${expected.length} damage states checked; missing=${JSON.stringify(missing)}`);
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
server.close();
process.exit(missing.length || errors.length ? 1 : 0);
