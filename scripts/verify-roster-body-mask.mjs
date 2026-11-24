// Roster-wide live proof that a walking fighter's lower body keeps locomotion while guard or a
// punch owns the upper body. This is the multi-character companion to
// verify-body-mask-layering.mjs: it runs every fighter the real character select exposes, records
// the live owner and both masked actions, and writes one frame per state for an evidence sheet.
//
//   BODY_MASK_ROSTER_COUNT=3 bash scripts/run-browser-test.sh scripts/verify-roster-body-mask.mjs --no-sheet
//   bash scripts/run-browser-test.sh scripts/verify-roster-body-mask.mjs
//   bash scripts/run-browser-test.sh scripts/verify-roster-body-mask.mjs --sheet-only
//
// Writes artifacts/body-mask/roster/<slug>/{guard,attack}.png, report.json, sheet.png and sheet.html.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize, sep, extname, dirname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, 'artifacts/body-mask/roster');
const reportPath = resolve(outDir, 'report.json');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
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
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = (name, fallback = null) => {
  const hit = argv.find(arg => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const slugOf = name => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const unique = values => [...new Set(values)];

const errors = [];
const failedRequests = [];

function checkGuard(state) {
  const failures = [];
  const overlayName = String(state.layers?.overlay || '').replace(/__upper$/, '');
  if (!state.layers) failures.push('no live mask');
  if (state.layers?.baseRegion !== 'lower') failures.push('base is not lower');
  if (state.layers?.overlayRegion !== 'upper') failures.push('overlay is not upper');
  // A guard in which the upper lane falls back to the locomotion clip keeps both masks alive but
  // does not actually show a guard. Many imported bodies have no blockAction, and the legacy plan
  // then overlays `run__upper`; report that honestly instead of counting the masks as a guard proof.
  if (!/block|guard/i.test(overlayName)) failures.push(`guard overlay is ${overlayName || 'missing'}, not block`);
  if (!state.guardHeld) failures.push('guard not held');
  if (state.speed <= 0.75) failures.push('fighter is not walking');
  if (state.baseMask !== 'lower') failures.push('guard base is not lower-masked');
  if (state.overlayMask !== 'upper') failures.push('guard overlay is not upper-masked');
  if (!state.baseRunning) failures.push('guard base action is not running');
  if (!state.overlayRunning) failures.push('guard overlay action is not running');
  if (state.baseWeight < 0.5) failures.push('guard base weight below 0.5');
  if (state.overlayWeight < 0.5) failures.push('guard overlay weight below 0.5');
  if (state.baseBones.some(bone => state.overlayBones.includes(bone))) failures.push('guard masks share bones');
  if (!state.baseBones.length || !state.overlayBones.length) failures.push('guard mask has no bones');
  return failures;
}

function checkAttack(state) {
  const failures = [];
  const baseRegion = state.layers?.baseRegion;
  const overlayRegion = state.layers?.overlayRegion;
  if (!state.attack) failures.push('no attack queued');
  if (!state.layers) failures.push('no live mask');
  // A punch keeps the lower lane moving and the upper lane attacks; a kick can legitimately swap
  // those lanes. Both are valid split-body attacks as long as the regions are opposite and the
  // live clips carry the matching masks.
  if (!(baseRegion === 'lower' && overlayRegion === 'upper')
    && !(baseRegion === 'upper' && overlayRegion === 'lower')) {
    failures.push('attack lanes are not split lower/upper');
  }
  if (state.speed <= 0.75) failures.push('fighter is not walking');
  if (state.baseMask !== baseRegion) failures.push('attack base mask does not match its lane');
  if (state.overlayMask !== overlayRegion) failures.push('attack overlay mask does not match its lane');
  if (!state.baseRunning) failures.push('attack base action is not running');
  if (!state.overlayRunning) failures.push('attack overlay action is not running');
  if (state.baseWeight < 0.5) failures.push('attack base weight below 0.5');
  if (state.overlayWeight < 0.5) failures.push('attack overlay weight below 0.5');
  if (state.baseBones.some(bone => state.overlayBones.includes(bone))) failures.push('attack masks share bones');
  if (!state.baseBones.length || !state.overlayBones.length) failures.push('attack mask has no bones');
  return failures;
}

function summaryOf(rows) {
  return {
    fighters: rows.length,
    passed: rows.filter(row => row.pass).length,
    failed: rows.filter(row => !row.pass).length,
    guardPassed: rows.filter(row => row.guardPass).length,
    attackPassed: rows.filter(row => row.attackPass).length,
    controller: rows.filter(row => row.owner === 'controller').length,
    legacy: rows.filter(row => row.owner === 'legacy').length,
    unscoped: rows.filter(row => !row.owner || row.owner === 'none').length
  };
}

function rowFor(name) {
  return {
    name, slug: slugOf(name), owner: null, asset: null, skinned: null, bakedClips: null,
    guard: null, attack: null, guardFailures: ['not tested'], attackFailures: ['not tested'],
    guardPass: false, attackPass: false, pass: false, images: {}
  };
}

async function composeSheet(report, browser) {
  const rowsByName = new Map(report.rows.map(row => [row.name, row]));
  const roster = report.roster || report.rows.map(row => row.name);
  const summary = report.summary || summaryOf(report.rows);
  const cards = roster.map((name, index) => {
    const row = rowsByName.get(name) || rowFor(name);
    const shot = state => {
      const relative = row.images?.[state] || `${row.slug}/${state}.png`;
      return existsSync(resolve(outDir, relative))
        ? `<figure class="shot"><img src="${relative}" alt="${escapeHtml(name)} ${state}"><figcaption>${state.toUpperCase()} · ${escapeHtml(state === 'guard' ? row.guard?.overlayClip || '—' : row.attack?.overlayClip || '—')}</figcaption></figure>`
        : `<figure class="shot missing"><div>NO ${state.toUpperCase()} FRAME</div></figure>`;
    };
    const owner = row.owner || 'unmounted';
    const failures = unique([...(row.guardFailures || []), ...(row.attackFailures || [])]);
    return `<section class="card ${row.pass ? 'pass' : 'fail'}">
      <header><div><span class="num">${String(index + 1).padStart(2, '0')}</span><b>${escapeHtml(name)}</b></div><span class="owner ${escapeHtml(owner)}">${escapeHtml(owner.toUpperCase())}</span></header>
      <div class="shots">${shot('guard')}${shot('attack')}</div>
      <footer><b>${row.pass ? 'PASS' : 'FAIL'}</b><span>${escapeHtml(failures.length ? failures.join(' · ') : `${row.guard?.baseClip || '?'} + ${row.guard?.overlayClip || '?'} / ${row.attack?.overlayClip || '?'}`)}</span></footer>
    </section>`;
  }).join('');

  const markup = `<style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}body{margin:0;background:#04101a;color:#e6f7ff;font:600 12px/1.4 system-ui,sans-serif}
    header.page{padding:18px 20px 8px;border-bottom:1px solid #1c4b60}
    h1{margin:0;font:1000 25px/1.1 system-ui,sans-serif;letter-spacing:-.02em}
    h1 span{color:#58e6ff}
    .sub{margin-top:6px;color:#8fc1d6}
    .summary{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .pill{padding:5px 9px;border:1px solid #27566a;background:#082232;color:#bfeaff;font:900 10px/1 system-ui;letter-spacing:.08em}
    .pill.good{border-color:#2b8b6d;color:#9dffcf}.pill.bad{border-color:#a64b4b;color:#ffb5a8}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;padding:12px 20px 20px}
    .card{background:#071c2a;border:1px solid #1d4356;padding:8px}
    .card.fail{border-color:#a64b4b;background:#1b1015}
    .card>header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}
    .card>header>div{display:flex;align-items:center;gap:7px;min-width:0}
    .card b{font:900 13px/1.2 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .num{color:#5d94aa;font:900 10px/1 system-ui;letter-spacing:.1em}
    .owner{font:900 9px/1 system-ui;letter-spacing:.1em;padding:4px 6px;border:1px solid #31657a;color:#8cecff}
    .owner.legacy{border-color:#7b6030;color:#ffd38a}.owner.none,.owner.unmounted{border-color:#a64b4b;color:#ffb5a8}
    .shots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:6px}
    .shot{margin:0;background:#030d15;border:1px solid #16384a;position:relative;overflow:hidden}
    .shot img{display:block;width:100%;height:210px;object-fit:contain}
    .shot figcaption{position:absolute;left:0;right:0;bottom:0;padding:3px 5px;background:#020b12e8;color:#b9e9f7;font:800 9px/1.2 system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .shot.missing{height:210px;display:flex;align-items:center;justify-content:center;color:#ff9b88;background:#180d10;border-color:#6d3030}
    .card footer{display:flex;gap:8px;align-items:baseline;margin-top:5px;font:800 9px/1.3 system-ui;color:#86b7ca;min-height:24px}
    .card footer b{font:900 10px/1 system-ui;letter-spacing:.08em;color:#8affc2}
    .card.fail footer b{color:#ff9b88}.card footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .note{padding:0 20px 18px;color:#7fa9bc;font:700 10px/1.5 system-ui}
  </style>
  <header class="page"><h1>GUARD + ATTACK LAYERING · <span>SELECTABLE ROSTER</span></h1>
    <div class="sub">38 selectable launch identities. The 22 archive/DLC identities are not exposed by character select and are out of scope.</div>
    <div class="sub">Real match states: walk + guard (0.8 s) and walk + punch (0.16 s), captured paused through the game renderer.</div>
    <div class="summary">
      <span class="pill ${summary.failed ? 'bad' : 'good'}">${summary.passed}/${summary.fighters} PASS</span>
      <span class="pill">GUARD ${summary.guardPassed}/${summary.fighters}</span>
      <span class="pill">ATTACK ${summary.attackPassed}/${summary.fighters}</span>
      <span class="pill">CONTROLLER ${summary.controller}</span>
      <span class="pill">LEGACY ${summary.legacy}</span>
    </div>
  </header>
  <main class="grid">${cards}</main>
  <div class="note">Every image is an actual 1000×700 frame at the same camera. Held weapons are hidden only for the capture so they cannot cover the mask. Failures show the measured reason, not a skipped character. Scope is all 38 selectable fighters; 22 archive/DLC identities are not selectable.</div>`;

  const sheetPath = resolve(outDir, 'sheet.png');
  const sheetHtmlPath = resolve(outDir, 'sheet.html');
  await writeFile(sheetHtmlPath, `<!doctype html><meta charset="utf-8"><title>Body-mask roster evidence</title><base href="./">${markup}`);
  const sheet = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
  try {
    await sheet.setContent(`<base href="${origin}/artifacts/body-mask/roster/">${markup}`, { waitUntil: 'load' });
    await sheet.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0),
      null, { timeout: 60_000 });
    await sheet.waitForTimeout(400);
    await sheet.screenshot({ path: sheetPath, fullPage: true });
  } finally {
    await sheet.close();
  }
  console.log(`sheet: ${sheetPath}`);
}

const sheetOnly = flag('--sheet-only');
const noSheet = flag('--no-sheet');
const append = flag('--append');
let report;
if (sheetOnly) {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!noSheet) {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    });
    try { await composeSheet(report, browser); }
    finally { await browser.close(); server.close(); }
  } else {
    server.close();
  }
} else {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    page.setDefaultTimeout(120_000);
    page.on('pageerror', error => errors.push(String(error.stack || error).slice(0, 300)));
    page.on('requestfailed', request => failedRequests.push(request.url()));

    await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
      && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      document.querySelector('#play')?.click();
    });
    await page.evaluate(() => window.__browserSmashSkipCinematic?.());
    await page.waitForFunction(() => window.__browserSmashControlMode?.().started === true,
      null, { timeout: 120_000, polling: 250 });
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
      null, { timeout: 15_000, polling: 100 }).catch(() => {});
    await page.waitForFunction(() => window.__bbLoading?.describe?.().visible === false,
      null, { timeout: 15_000, polling: 100 }).catch(() => {});
    await page.addStyleTag({ content: '#bbHudLayer, #bbHudLayer *, #combatCallout, #hud, #energyHUD, #comboNotice, #roundScore, #cameraSettings, #executeHint { display: none !important; }' });
    // Pause the real loop and drive every capture with the deterministic step hook. This keeps the
    // match timer and the AI from advancing while a new body loads, and gives each shot one state.
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await page.waitForTimeout(500);

    const allNames = await page.evaluate(() => (window.characterRosters?.launch || []).map(([name]) => name));
    const only = value('slugs', '').split(',').map(item => item.trim()).filter(Boolean);
    const fromIndex = Math.max(0, Number(value('from', 0)) || 0);
    const count = Math.max(1, Number(value('count', allNames.length - fromIndex)) || allNames.length - fromIndex);
    const names = allNames.slice(fromIndex, fromIndex + count).filter(name => !only.length || only.includes(slugOf(name)));
    const previous = append && existsSync(reportPath) ? JSON.parse(await readFile(reportPath, 'utf8')) : null;
    report = {
      ...(previous || {}),
      generatedAt: new Date().toISOString(),
      scope: 'window.characterRosters.launch — the identities exposed by character select',
      roster: allNames,
      tested: previous?.tested || [],
      rows: previous?.rows || [],
      summary: summaryOf(previous?.rows || []),
      complete: false,
      capture: { viewport: '1000x700', guardSeconds: 0.8, attackSeconds: 0.16, equipment: 'hidden for capture only' },
      pageErrors: unique([...(previous?.pageErrors || []), ...errors]),
      failedRequests: unique([...(previous?.failedRequests || []), ...failedRequests])
    };
    console.log(`ROSTER ${allNames.length}; testing ${names.length}${only.length ? ' (' + only.join(', ') + ')' : ''}`);

    const step = seconds => page.evaluate(seconds => {
      // simulationStep() returns immediately while the match is paused. Unpause only for the
      // deterministic ticks, then pause again before yielding so the captured frame cannot drift.
      window.__browserSmashSetPaused?.(false);
      const frames = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < frames; i++) window.__browserSmashStep(1 / 60);
      window.__browserSmashSetPaused?.(true);
    }, seconds);

    const read = () => page.evaluate(() => {
      const fighter = window.fighters?.[0];
      const controller = fighter?.animationController || null;
      const userData = fighter?.model?.userData || {};
      const describe = controller?.describe?.() || null;
      const layers = controller ? (describe?.layers || null) : (userData.bodyMaskLayers || null);
      const baseAction = controller?._baseAction || (controller ? null : userData.lastMoveAction);
      const overlayAction = controller?._overlayAction || (controller ? null : userData.maskOverlayAction);
      const baseClip = layers ? baseAction?.getClip?.() || null : null;
      const overlayClip = layers ? overlayAction?.getClip?.() || null : null;
      const bones = clip => Array.isArray(clip?.userData?.bones) ? clip.userData.bones.slice() : [];
      return {
        identity: fighter?.identity || fighter?.name || null,
        asset: userData.characterAssetUrl || null,
        skinned: (() => { let found = false; fighter?.model?.traverse(node => { if (node.isSkinnedMesh) found = true; }); return found; })(),
        owner: controller ? 'controller' : (userData.humanMixer ? 'legacy' : 'none'),
        controller: Boolean(controller), legacyMixer: Boolean(userData.humanMixer),
        bakedClips: Boolean(userData.hasAnimationClips),
        rig: describe?.rig || null, boundBones: describe?.boundBones ?? null,
        missingBones: describe?.missingBones || [],
        layers,
        speed: +Math.hypot(fighter?.velocity?.x || 0, fighter?.velocity?.z || 0).toFixed(3),
        grounded: fighter?.isGrounded !== false,
        guardHeld: Boolean(fighter?.guardHeld),
        attack: fighter?.attackQueue?.[fighter.attackQueue.length - 1]?.id
          || fighter?.attackQueue?.[fighter.attackQueue.length - 1]?.kind || null,
        active: controller ? (describe?.active || null) : (userData.currentClip || null),
        baseClip: baseClip?.name || null, overlayClip: overlayClip?.name || null,
        baseMask: baseClip?.userData?.mask || null, overlayMask: overlayClip?.userData?.mask || null,
        baseBones: bones(baseClip), overlayBones: bones(overlayClip),
        baseRunning: Boolean(baseAction?.isRunning?.()),
        overlayRunning: Boolean(overlayAction?.isRunning?.()),
        baseWeight: +(baseAction?.getEffectiveWeight?.() || 0).toFixed(3),
        overlayWeight: +(overlayAction?.getEffectiveWeight?.() || 0).toFixed(3)
      };
    });

    const capture = async (row, state) => {
      const dir = resolve(outDir, row.slug);
      await mkdir(dir, { recursive: true });
      await page.evaluate(() => {
        window.__browserSmashSetPaused?.(true);
        const userData = window.fighters[0].model?.userData || {};
        for (const key of ['equippedWeaponRight', 'equippedWeaponLeft', 'pickupBlade']) {
          if (userData[key]) userData[key].visible = false;
        }
        const camera = window.smashCamera || window.__browserSmashCamera;
        camera?.spectate?.({ fighter: window.fighters[0], framing: 'full', yaw: 32, pitch: 6,
          distance: 4.3, transition: 0 });
      });
      await page.waitForTimeout(260);
      await page.screenshot({ path: resolve(dir, `${state}.png`) });
    };

    for (const name of names) {
      const row = rowFor(name);
      const rowStarted = Date.now();
      console.log(`ROW ${name}`);
      try {
        await page.evaluate(name => window.__browserSmashSelect?.select('p1', name), name);
        const mounted = await page.waitForFunction(name => {
          const fighter = window.fighters?.[0];
          const userData = fighter?.model?.userData || {};
          return Boolean(fighter?.identity === name && userData.characterAssetUrl
            && fighter.animationBindModel === fighter.model);
        }, name, { timeout: 20_000, polling: 100 }).then(() => true).catch(() => false);
        console.log(`  mount ${mounted ? 'ok' : 'timeout'} in ${Date.now() - rowStarted}ms`);
        await page.waitForTimeout(150);
        row.guardFailures = mounted ? [] : ['body did not mount'];

        const boot = await read();
        row.owner = boot.owner;
        row.asset = boot.asset;
        row.skinned = boot.skinned;
        row.bakedClips = boot.bakedClips;
        row.rig = boot.rig;
        row.boundBones = boot.boundBones;
        row.missingBones = boot.missingBones;

        await page.evaluate(() => {
          const [p1, p2] = window.fighters;
          p1.position.set(-2, p1.groundLevel ?? 0, 0);
          p2.position.set(14, p2.groundLevel ?? 0, 0);
          p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
          for (const fighter of [p1, p2]) {
            fighter.velocity.set(0, 0, 0);
            fighter.hitstun = 0;
            fighter.attackQueue.length = 0;
            fighter.guardHeld = false;
            fighter.isGrounded = true;
            fighter.ko = false;
          }
          p1.percent = 0;
          p2.model.visible = false;
          p1.model.visible = true;
        });
        await page.keyboard.up('d').catch(() => {});
        await page.keyboard.up('e').catch(() => {});
        await step(0.2);

        await page.keyboard.down('d');
        await page.keyboard.down('e');
        await step(0.8);
        row.guard = await read();
        row.guardFailures = unique([...row.guardFailures, ...checkGuard(row.guard)]);
        row.guardPass = row.guardFailures.length === 0;
        // Capture the guard pose before releasing the guard input.
        const guardCaptureStarted = Date.now();
        await capture(row, 'guard');
        console.log(`  guard frame in ${Date.now() - guardCaptureStarted}ms`);
        await page.keyboard.up('e');
        await page.keyboard.press('j');
        await step(0.16);

        row.attack = await read();
        row.attackFailures = unique([...(mounted ? [] : ['body did not mount']), ...checkAttack(row.attack)]);
        row.attackPass = row.attackFailures.length === 0;
        const attackCaptureStarted = Date.now();
        await capture(row, 'attack');
        console.log(`  attack frame in ${Date.now() - attackCaptureStarted}ms`);
        await page.keyboard.up('d');
        await step(0.25);
        row.pass = row.guardPass && row.attackPass;
      } catch (error) {
        row.pass = false;
        row.guardFailures = unique([...(row.guardFailures || []), `runner: ${String(error?.message || error).slice(0, 220)}`]);
        row.attackFailures = unique([...(row.attackFailures || []), `runner: ${String(error?.message || error).slice(0, 220)}`]);
        await page.keyboard.up('d').catch(() => {});
        await page.keyboard.up('e').catch(() => {});
      }
      row.images = {
        guard: `${row.slug}/guard.png`,
        attack: `${row.slug}/attack.png`
      };
      report.rows = report.rows.filter(item => item.slug !== row.slug).concat(row);
      report.tested = report.rows.map(item => item.slug);
      report.complete = report.rows.length === allNames.length;
      report.summary = summaryOf(report.rows);
      report.pageErrors = unique([...(previous?.pageErrors || []), ...errors]);
      report.failedRequests = unique([...(previous?.failedRequests || []), ...failedRequests]);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`  ${row.pass ? 'PASS' : 'FAIL'} owner=${row.owner} guard=${row.guardPass} attack=${row.attackPass} in ${Date.now() - rowStarted}ms`
        + (row.pass ? '' : ` · ${unique([...row.guardFailures, ...row.attackFailures]).join(' | ')}`));
    }

    await writeFile(reportPath, JSON.stringify(report, null, 2));
    if (!noSheet) await composeSheet(report, browser);
    console.log(JSON.stringify({ summary: report.summary, complete: report.complete,
      pageErrors: report.pageErrors.length, failedRequests: report.failedRequests.length,
      sheet: noSheet ? null : resolve(outDir, 'sheet.png') }, null, 2));
    // A sliced run is an intentional sample, not a roster failure. A completed roster must fail
    // loudly if any fighter could not demonstrate the two disjoint layers.
    if (report.complete && report.summary.failed) process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}
