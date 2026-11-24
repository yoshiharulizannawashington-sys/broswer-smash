// Before/after evidence for the five source rigs whose select-preview idles keep a wide A/T arm
// stance, and for Thor/Infantry in a live match.
//
//   PLAYWRIGHT_BROWSERS_PATH=.tools/playwright/browsers node scripts/capture-idle-settle.mjs --tag=before
//
// It drives the real select screen and the real match path. No test-only pose is applied: the
// measured arm heights are whatever the preview/mixer produced on that frame.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const TAG = flag('tag', 'before');
const MODE = flag('mode', 'all');
const out = resolve(root, 'artifacts/idle-settle', TAG);
await mkdir(out, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) {
      rel = 'public' + sep + rel;
    }
    const file = resolve(root, rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const PREVIEW = [
  ['aang', 'Aang'], ['thor', 'Thor'], ['sasuke_uchiha', 'Sasuke Uchiha'],
  ['madara_uchiha', 'Madara Uchiha'], ['infantry', 'Infantry']
];
// The verified fixes this settle must not disturb.
const PRESERVE = [
  ['naruto_uzumaki', 'Naruto Uzumaki'], ['wonder_woman', 'Wonder Woman'],
  ['wolverine_logan', 'Wolverine (Logan)'], ['aquaman', 'Aquaman']
];
const previews = flag('set') === 'preserve' ? PRESERVE : PREVIEW;
const LIVE = [['thor', 'Thor'], ['infantry', 'Infantry']];

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 820 } });
page.setDefaultTimeout(120_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 240)));
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push('console: ' + message.text().slice(0, 200));
});

await page.goto(origin + '/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__browserSmashSelect && window.characterRosters?.launch?.length),
  null, { timeout: 120_000, polling: 100 });
// Enter through the real title button so the setup panel is actually laid out; calling show()
// alone leaves #menu in its title class on this build and the preview element has no box.
await page.click('#bbTitle [data-nav="versus"]').catch(() => {});
await page.waitForTimeout(500);
await page.evaluate(() => window.__browserSmashSelect.show());

const measure = () => page.evaluate(() => {
  const debug = window.__fighterPreviewDebug;
  const rig = debug?.rig;
  const joints = rig?.joints;
  if (!debug?.root || !joints?.leftArm || !joints?.rightArm || !joints?.leftFore || !joints?.rightFore) {
    return { error: 'no preview rig', bones: debug?.bones || 0, idle: debug?.idle || null };
  }
  const f = window.fighters?.[0];
  const model = window.__idleSettleLive ? f?.model : debug.root;
  model.updateMatrixWorld(true);
  const wp = node => node.getWorldPosition(new window.__browserSmashThree.Vector3());
  const L = joints.leftArm, R = joints.rightArm, LF = joints.leftFore, RF = joints.rightFore;
  const LH = joints.leftHand, RH = joints.rightHand;
  const shoulder = wp(L).y;
  const row = {
    idle: debug.idle || null,
    bones: debug.bones,
    handles: [debug.root.userData?.leftArm?.name || null, debug.root.userData?.leftFore?.name || null],
    rigHandles: [L.name, LF.name],
    sameHandles: [debug.root.userData?.leftArm === L, debug.root.userData?.leftFore === LF],
    shoulderY: +shoulder.toFixed(3),
    elbow: [LF, RF].map(n => +(wp(n).y - shoulder).toFixed(3)),
    hand: [LH, RH].map(n => +(wp(n).y - shoulder).toFixed(3))
  };
  return row;
});

const previewRows = [];
if (MODE === 'all' || MODE === 'preview') {
  for (const [slug, name] of previews) {
    await page.evaluate(() => window.__browserSmashSelect.show());
    await page.evaluate(candidate => window.__browserSmashSelect.select('p1', candidate), name);
    await page.waitForFunction(({ name }) => {
      const status = document.querySelector('[data-role="previewstatus"]');
      return window.__browserSmashSelect?.state?.p1 === name
        && status?.dataset?.state && !['loading', 'missing'].includes(status.dataset.state);
    }, { name }, { timeout: 90_000, polling: 100 });
    await page.waitForTimeout(900);
    // Measure after a real animation frame: the preview's settle runs in the frame loop, and a
    // probe that evaluates between frames can read the unrelaxed pose even though the next paint
    // is settled.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const row = await measure();
    const file = resolve(out, `preview-${slug}.png`);
    const box = await page.evaluate(() => {
      const n = document.querySelector('#selectScreen [data-role="preview"]');
      const c = document.querySelector('#selectScreen [data-role="previewcanvas"]');
      return { display: n ? getComputedStyle(n).display : null, hidden: n?.hidden ?? null,
        rect: n ? n.getBoundingClientRect().toJSON() : null, canvas: c ? c.getBoundingClientRect().toJSON() : null };
    });
    console.log('PREVIEWBOX ' + JSON.stringify({ slug, ...box }));
    await page.screenshot({ path: file });
    previewRows.push({ slug, name, ...row, file });
    console.log('PREVIEW ' + JSON.stringify({ slug, name, ...row }));
  }
}

const liveRows = [];
if (MODE === 'all' || MODE === 'live') {
  for (const [slug, name] of LIVE) {
    await page.evaluate(() => {
      window.__browserSmashSelect.show();
      window.__browserSmashSelect.select('p1', 'Goku');
      window.__browserSmashSelect.select('p2', 'Vegeta');
      window.__browserSmashSelect.chooseArena?.('tournament');
    });
    await page.evaluate(candidate => window.__browserSmashSelect.select('p1', candidate), name);
    await page.evaluate(() => document.querySelector('#play')?.click());
    await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'),
      null, { timeout: 60_000, polling: 100 });
    await page.evaluate(() => window.__browserSmashSkipCinematic?.());
    await page.waitForFunction(({ name }) => {
      const f = window.fighters?.[0];
      const u = f?.model?.userData;
      return f?.identity === name && u?.idleAction
        && (u.idleAction.getClip()?.name || '').length > 0;
    }, { name }, { timeout: 120_000, polling: 150 });
    await page.evaluate(() => {
      window.__browserSmashTrainingDummy = true;
      window.__browserSmashFreezeAI = true;
      window.__browserSmashStep(1.2);
      const f = window.fighters[0];
      f.position.set(0, 0, 0);
      f.velocity.set(0, 0, 0);
      if (f.model.userData?.humanMixer) f.model.userData.currentClip = null;
      window.smashCamera.spectate({ fighter: f, framing: 'full', yaw: 0, pitch: 4 });
    });
    await page.waitForTimeout(900);
    const row = await page.evaluate(() => {
      window.__idleSettleLive = true;
      const f = window.fighters[0];
      const u = f.model.userData;
      const find = name => f.model.getObjectByName(name);
      const joints = { leftArm: find('LeftArm'), rightArm: find('RightArm'), leftFore: find('LeftForeArm'),
        rightFore: find('RightForeArm'), leftHand: find('LeftHand'), rightHand: find('RightHand') };
      const wp = node => node.getWorldPosition(new window.__browserSmashThree.Vector3());
      const running = (u.humanMixer?._actions || []).filter(a => a.isRunning() && a.getEffectiveWeight() > 0.05)
        .map(a => a.getClip().name);
      if (!joints.leftArm || !joints.leftFore) return { error: 'no live arm bones', clip: running, idle: u.idleAction?.getClip?.()?.name };
      const shoulder = wp(joints.leftArm).y;
      const weapon = (() => {
        const w = u.equippedWeaponRight;
        if (!w) return null;
        w.updateWorldMatrix(true, true);
        const box = new window.__browserSmashThree.Box3().setFromObject(w);
        const size = box.getSize(new window.__browserSmashThree.Vector3());
        const center = box.getCenter(new window.__browserSmashThree.Vector3());
        return {
          name: w.name, parent: w.parent?.name || null,
          size: size.toArray().map(v => +v.toFixed(3)),
          center: center.toArray().map(v => +v.toFixed(3)),
          min: box.min.toArray().map(v => +v.toFixed(3)),
          max: box.max.toArray().map(v => +v.toFixed(3))
        };
      })();
      return {
        clip: running,
        idle: u.idleAction?.getClip?.()?.name || null,
        shoulderY: +shoulder.toFixed(3),
        handRightY: +wp(joints.rightHand).y.toFixed(3),
        headY: u.head ? +wp(u.head).y.toFixed(3) : null,
        weapon,
        elbow: [joints.leftFore, joints.rightFore].map(n => +(wp(n).y - shoulder).toFixed(3)),
        hand: [joints.leftHand, joints.rightHand].map(n => +(wp(n).y - shoulder).toFixed(3)),
        grounded: !!f.isGrounded,
        y: +f.position.y.toFixed(2)
      };
    });
    const file = resolve(out, `live-${slug}.png`);
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await page.waitForTimeout(300);
    await page.screenshot({ path: file });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    liveRows.push({ slug, name, ...row, file });
    console.log('LIVE ' + JSON.stringify({ slug, name, ...row }));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  tag: TAG,
  mode: MODE,
  renderer: 'SwiftShader',
  preview: previewRows,
  live: liveRows,
  pageErrors: [...new Set(pageErrors)]
};
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('SUMMARY ' + JSON.stringify({ preview: previewRows.length, live: liveRows.length, errors: report.pageErrors.length }));
await browser.close();
server.close();
