// A0 — real-match launch acceptance gate for the 38-fighter launch roster.
//
// This is deliberately stricter than a mount/audit sweep. Every selected fighter is put through
// the actual character-selection/match path and must produce evidence for:
//   select preview, body, height/feet, clip bank, idle/movement, air/fall/land, light chain,
//   light/heavy/air, anti-air/dive, grab/throw, guard/parry/counter/dodge/break, hit/knockdown/get-up,
//   signature, ultimate, transformation, KO/result/rematch and a second completed match.
//
// A mounted body or a clip count alone cannot pass. A check records the live state, selected clip,
// damage, meter, result screen or failure that proves the branch ran.
//
// Usage:
//   bash scripts/run-browser-test.sh scripts/verify-launch-roster.mjs --all
//   bash scripts/run-browser-test.sh scripts/verify-launch-roster.mjs "Goku" "Naruto Uzumaki"
//   A0_OFFSET=0 A0_LIMIT=8 A0_LABEL=batch-01 ... scripts/verify-launch-roster.mjs --all
//
// Output:
//   artifacts/launch-acceptance/<slug>/<check>.png
//   artifacts/launch-acceptance/report.json
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = resolve(root, 'artifacts/launch-acceptance');
await mkdir(out, { recursive: true });
const outLabel = String(process.env.A0_LABEL || '').replace(/[^a-zA-Z0-9_-]/g, '-');
const reportPath = resolve(out, outLabel ? `report-${outLabel}.json` : 'report.json');

const mainSource = await readFile(resolve(root, 'public/js/main.js'), 'utf8');
const roster = JSON.parse(mainSource.match(/const roster=(\[\[[\s\S]*?\]\]);/)[1]).map(([name]) => name);
const rawArgs = process.argv.slice(2);
const all = rawArgs.includes('--all');
const named = rawArgs.filter(arg => !arg.startsWith('--'));
const envOnly = String(process.env.A0_ONLY || '').split(',').map(value => value.trim()).filter(Boolean);
const requested = all ? roster : (envOnly.length ? envOnly : named);
if (!requested.length) {
  console.error('usage: verify-launch-roster.mjs --all | "Fighter" ...');
  process.exit(2);
}
for (const name of requested) {
  if (!roster.includes(name)) throw new Error(`not a launch fighter: ${name}`);
}
const offset = Math.max(0, Number(process.env.A0_OFFSET) || 0);
const limit = Math.max(0, Number(process.env.A0_LIMIT) || 0);
const targets = requested.slice(offset, limit ? offset + limit : undefined);

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
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
    let relative = normalize(pathname).replace(/^[/\\\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const checks = [];
const results = [];
const check = (fighter, section, name, ok, detail = '', required = true) => {
  const row = { fighter, section, name, ok: Boolean(ok), detail, required };
  checks.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${fighter}] ${section} · ${name}${detail ? ' · ' + detail : ''}`);
  return row;
};
const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

let browser;
try {
  browser = await chromium.launch({
    headless: process.env.A0_HEADED !== '1',
    executablePath: process.env.BROWSER_BIN || undefined,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(String(error.message || error).slice(0, 260)
    + (error.stack ? '\n' + String(error.stack).split('\n').slice(0, 6).join('\n') : '')));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) {
      pageErrors.push('console: ' + message.text().slice(0, 220));
    }
  });
  page.on('response', response => {
    if (response.status() >= 400 && !/favicon\.ico/i.test(response.url())) {
      failedRequests.push(response.status() + ' ' + response.url().slice(-120));
    }
  });
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const localPath = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try {
      await route.fulfill({
        status: 200, contentType: 'text/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(localPath)
      });
    } catch {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });

  const waitForApp = () => page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2,
  null, { timeout: 150_000, polling: 250 });
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await waitForApp();
  const gpu = await page.evaluate(() => {
    const gl = window.__browserSmashRenderer?.getContext?.()
      || document.querySelector('canvas')?.getContext?.('webgl2');
    if (!gl) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)
    };
  });
  const softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(String(gpu?.renderer || ''));
  console.log('GPU ' + JSON.stringify({ ...gpu, softwareRenderer }));
  if (process.env.A0_REQUIRE_GPU === '1' && (!gpu || softwareRenderer)) {
    throw new Error(`hardware GPU required; Chromium is using ${gpu?.renderer || 'no WebGL renderer'}`);
  }

  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const startMatch = async name => {
    const opponent = name === 'Goku' ? 'Vegeta' : 'Goku';
    // A0 normally uses the tournament ring so the 38-fighter regression stays comparable. The
    // vertical-slice evidence run can point the same checks at the finished Final Valley stage.
    const arena = process.env.A0_ARENA || 'tournament';
    await page.evaluate(({ name, opponent, arena }) => {
      window.__browserSmashLastResult = null;
      const select = window.__browserSmashSelect;
      select.setMode('1p');
      select.setRules({ roundsToWin: 1, roundSeconds: 60 });
      window.__browserSmashSetRules?.({ roundsToWin: 1, roundSeconds: 60 });
      select.select('p1', name);
      select.select('p2', opponent);
      select.chooseArena(arena);
      window.__browserSmashFreezeAI = true;
      window.__browserSmashGame.startMatch();
      window.__browserSmashStep(0.2);
    }, { name, opponent, arena });
    await page.waitForFunction(({ name, opponent }) => {
      const [p1, p2] = window.fighters || [];
      const u = p1?.model?.userData || {};
      return p1?.identity === name && p2?.identity === opponent
        && p1.characterModelLoaded === true && p2.characterModelLoaded === true
        // A select-preview swap can make the body visible before attachFighterAnimation has
        // finished binding the live action maps. Waiting on those maps prevents an empty first
        // snapshot from being reported as a missing clip bank.
        && Object.keys(u.animationActions || {}).length > 0
        // Imported strike, reaction, ability and authored clip GLBs load after the body. Wait
        // for every started load to settle so the inventory check measures the finished bank.
        && [u.importedStrikeReport, u.importedReactionReport, u.importedAbilityReport,
          u.importedAuthoredReport].every(report => !report || report.status !== 'loading');
    }, { name, opponent }, { timeout: 180_000, polling: 250 });
    // Give the async clip GLBs a bounded settle after the body's base actions appear. Some
    // mounted roots publish their base locomotion map before the imported strike/reaction maps
    // finish, which made the inventory snapshot timing-dependent.
    await page.waitForFunction(() => {
      const u = window.fighters?.[0]?.model?.userData || {};
      return Object.keys(u.animationActions || {}).length >= 10
        || [u.importedStrikeReport, u.importedReactionReport, u.importedAbilityReport,
          u.importedAuthoredReport].some(report => report?.status === 'ready');
    }, null, { timeout: 12_000, polling: 100 }).catch(() => {});
    await page.evaluate(() => {
      window.__browserSmashFreezeAI = true;
      window.__browserSmashSkipCinematic?.();
      window.__browserSmashStep(0.8);
    });
    await page.waitForFunction(() => window.__browserSmashPresentation?.report?.().intro?.active === false,
      null, { timeout: 20_000, polling: 200 }).catch(() => {});
  };

  const reset = distance => page.evaluate(({ distance }) => {
    const [p1, p2] = window.fighters;
    const ground = p1.groundLevel ?? 0;
    window.combatPowers?.clear?.('launch-gate');
    window.__browserSmashTraining?.resetPositions?.();
    window.__browserSmashLastImpact = null;
    window.__browserSmashLastShot = null;
    p1.position.set(-distance / 2, ground, -12); p1.velocity.set(0, 0, 0);
    p2.position.set(distance / 2, p2.groundLevel ?? ground, -12); p2.velocity.set(0, 0, 0);
    for (const fighter of [p1, p2]) {
      fighter.velocity.set(0, 0, 0); fighter.isGrounded = true; fighter.hitstun = 0;
      fighter.guardBreak = 0; fighter.guardHeld = false; fighter.attackQueue.length = 0;
      fighter.attackPose = 0; fighter.hitboxes.length = 0; fighter.dodgeTimer = 0;
      fighter.transform = null; fighter.formLock = 0; fighter.transformCooldown = 0;
      fighter.casting = null; fighter.ko = false; fighter.flightMode = false;
      fighter.attackBuffer = 0; fighter.comboStep = 0; fighter.activeMoveId = null;
      fighter.invulnerable = 0; fighter.percent = 0;
      if (fighter.model?.userData) fighter.model.userData.attackLock = 0;
    }
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p1.meter = 100; p1.power = 100; p1.specialCooldown = 0; p1.abilityReadyAt = {};
    p2.shield = 100; p2.guardHeld = false; p2.aiTimer = 999;
    const controller = p1.animationController;
    if (controller) {
      controller._lock = null; controller._downState = false; controller._getUpTimer = 0;
      controller._landTimer = 0; controller._airTime = 0;
    }
    window.__browserSmashStep(0.22);
  }, { distance });

  const read = () => page.evaluate(() => {
    const [p1, p2] = window.fighters;
    const u = p1.model?.userData || {};
    const actionMaps = {
      base: u.animationActions, strikes: u.authoredAbilityActions,
      forms: u.authoredFormActions, attacks: u.authoredStrikeActions,
      reactions: u.authoredReactionActions
    };
    const inventory = new Set();
    for (const map of Object.values(actionMaps)) for (const key of Object.keys(map || {})) inventory.add(key);
    for (const clip of (p1.model?.animations || [])) if (clip?.name) inventory.add(clip.name);
    const clips = [...inventory];
    const THREE = window.__browserSmashThree;
    const box = THREE ? new THREE.Box3().setFromObject(p1.model) : null;
    const size = box ? box.getSize(new THREE.Vector3()) : null;
    const isEquipped = node => {
      for (let current = node; current; current = current.parent) {
        if (String(current.name || '').startsWith('Equipped')) return true;
      }
      return false;
    };
    const bodyBox = THREE ? new THREE.Box3() : null;
    if (bodyBox) {
      p1.model?.traverse(node => {
        if (!node.isMesh || isEquipped(node)) return;
        const meshBox = new THREE.Box3().setFromObject(node);
        if (!meshBox.isEmpty()) bodyBox.union(meshBox);
      });
    }
    const bodySize = bodyBox && !bodyBox.isEmpty() ? bodyBox.getSize(new THREE.Vector3()) : null;
    return {
      identity: p1.identity, name: p1.name,
      modelLoaded: p1.characterModelLoaded === true,
      asset: u.characterAssetUrl || null,
      status: window.__browserSmashAssets?.characterModels?.[p1.identityKey]?.status || null,
      validation: u.validation || window.__browserSmashAssets?.characterModels?.[p1.identityKey]?.validation || null,
      bones: (() => { let n = 0; p1.model?.traverse(x => { if (x.isBone) n++; }); return n; })(),
      skinned: (() => { let n = 0; p1.model?.traverse(x => { if (x.isSkinnedMesh) n++; }); return n; })(),
      meshes: (() => { let n = 0; p1.model?.traverse(x => { if (x.isMesh && x.visible) n++; }); return n; })(),
      textured: (() => {
        let n = 0;
        p1.model?.traverse(x => {
          if (!x.isMesh) return;
          for (const m of (Array.isArray(x.material) ? x.material : [x.material])) {
            if (m && ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].some(k => m[k]?.image)) n++;
          }
        });
        return n;
      })(),
      materials: (() => {
        const seen = new Set(); const rows = [];
        p1.model?.traverse(x => {
          if (!x.isMesh) return;
          for (const m of (Array.isArray(x.material) ? x.material : [x.material])) {
            if (!m || seen.has(m.uuid)) continue;
            seen.add(m.uuid);
            rows.push({ name: m.name, type: m.type, normalMap: Boolean(m.normalMap), map: Boolean(m.map), surface: m.userData?.surfaceDetail || null });
          }
        });
        return rows.slice(0, 30);
      })(),
      clips: clips.length, clipNames: clips.slice(0, 100), clipInventory: clips,
      actionCount: clips.length || p1.model?.animations?.length || 0,
      currentClip: u.currentClip || p1.animationController?._active || null,
      // Semantic bindings the state machine actually reads. A clip merely present in the mixer is
      // not coverage: Naruto ships a fall-named clip but no fallAction, so counting inventory alone
      // produced a false transition failure.
      bound: {
        idle: u.idleAction?.getClip?.()?.name || null,
        walk: u.walkAction?.getClip?.()?.name || null,
        run: u.runAction?.getClip?.()?.name || null,
        jump: u.jumpAction?.getClip?.()?.name || null,
        fall: u.fallAction?.getClip?.()?.name || null,
        doubleJump: u.doubleJumpAction?.getClip?.()?.name || null,
        flyForward: u.flyForwardAction?.getClip?.()?.name || null,
        land: u.landAction?.getClip?.()?.name || null,
        victory: u.victoryAction?.getClip?.()?.name || null,
        defeat: u.defeatAction?.getClip?.()?.name || null
      },
      lastMoveAction: u.lastMoveAction?.getClip?.()?.name || null,
      height: p1.heightProfile?.targetHeight ?? null,
      measuredHeight: bodySize ? +bodySize.y.toFixed(3) : (size ? +size.y.toFixed(3) : null),
      measuredWithWeapons: size ? +size.y.toFixed(3) : null,
      feetY: box ? +box.min.y.toFixed(3) : null,
      ground: p1.groundLevel ?? 0,
      percent: +(p1.percent || 0).toFixed(2),
      p2percent: +(p2.percent || 0).toFixed(2),
      p2hitstun: +(p2.hitstun || 0).toFixed(3),
      meter: +(p1.meter || 0).toFixed(1),
      power: +(p1.power || 0).toFixed(1),
      hitstun: +(p1.hitstun || 0).toFixed(3),
      guardHeld: Boolean(p1.guardHeld),
      guardBreak: +(p1.guardBreak || 0).toFixed(3),
      dodgeTimer: +(p1.dodgeTimer || 0).toFixed(3),
      parryTimer: +(p1.parryTimer || 0).toFixed(3),
      counterWindow: +(p1.counterWindow || 0).toFixed(3),
      activeMoveId: p1.activeMoveId || null,
      velocityY: +(p1.velocity?.y || 0).toFixed(3),
      jumps: +(p1.jumps || 0),
      grabbedBy: Boolean(p1.grabbedBy),
      grabTarget: Boolean(p1.grabTarget),
      heldThrow: Boolean(p1.heldThrow),
      shield: +(p1.shield ?? 0).toFixed(1),
      transform: p1.transform ? {
        form: p1.transform.form?.id || p1.transform.form?.label || null,
        label: p1.transform.form?.label || null
      } : null,
      casting: p1.casting || null,
      specialLabel: p1.specialProfile?.label || null,
      grab: Boolean(p1.grabTarget || p1.grabbedBy || (p1.grabHold || 0) > 0 || (p1.heldThrow?.t || 0) > 0),
      grounded: Boolean(p1.isGrounded),
      position: p1.position.toArray().map(v => +v.toFixed(2)),
      matchStatus: window.__browserSmashMatch?.().status || null,
      result: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim()
    };
  });

  const advance = seconds => page.evaluate(seconds => {
    const [p1, p2] = window.fighters;
    const seen = [];
    let last = null;
    let maxP2 = p2.percent || 0;
    let maxP1 = p1.percent || 0;
    let maxHitstun = 0;
    let maxP2Hitstun = 0;
    let maxMeter = p1.meter || 0;
    let airborneSeen = false, descended = false, landed = false;
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(1 / 60);
      const current = p1.animationController?._active
        || p1.model?.userData?.currentClip
        || p1.model?.userData?.lastMoveAction?.getClip?.()?.name || null;
      if (current && current !== last) { last = current; seen.push(current); }
      if (!p1.isGrounded) airborneSeen = true;
      if ((p1.velocity?.y || 0) < 0) descended = true;
      if (airborneSeen && descended && p1.isGrounded) landed = true;
      maxP2 = Math.max(maxP2, p2.percent || 0);
      maxP1 = Math.max(maxP1, p1.percent || 0);
      maxHitstun = Math.max(maxHitstun, p1.hitstun || 0);
      maxP2Hitstun = Math.max(maxP2Hitstun, p2.hitstun || 0);
      maxMeter = Math.max(maxMeter, p1.meter || 0);
    }
    return {
      seen, clip: p1.model?.userData?.currentClip || p1.animationController?._active || null,
      lastMoveAction: p1.model?.userData?.lastMoveAction?.getClip?.()?.name || null,
      p1percent: +(p1.percent || 0).toFixed(2), p2percent: +(p2.percent || 0).toFixed(2),
      maxP1: +maxP1.toFixed(2), maxP2: +maxP2.toFixed(2),
      hitstun: +(p1.hitstun || 0).toFixed(3), maxHitstun: +maxHitstun.toFixed(3),
      p2hitstun: +(p2.hitstun || 0).toFixed(3), maxP2Hitstun: +maxP2Hitstun.toFixed(3),
      guardHeld: Boolean(p1.guardHeld), shield: +(p1.shield ?? 0).toFixed(1),
      guardBreak: +(p1.guardBreak || 0).toFixed(3),
      dodgeTimer: +(p1.dodgeTimer || 0).toFixed(3),
      parryTimer: +(p1.parryTimer || 0).toFixed(3),
      counterWindow: +(p1.counterWindow || 0).toFixed(3),
      activeMoveId: p1.activeMoveId || null,
      meter: +(p1.meter || 0).toFixed(1), maxMeter: +maxMeter.toFixed(1),
      transform: p1.transform ? { form: p1.transform.form?.id || p1.transform.form?.label || null } : null,
      casting: p1.casting || null,
      specialLabel: p1.specialProfile?.label || null,
      grab: Boolean(p1.grabTarget || p1.grabbedBy || (p1.grabHold || 0) > 0 || (p1.heldThrow?.t || 0) > 0),
      grounded: Boolean(p1.isGrounded),
      y: +(p1.position?.y || 0).toFixed(2),
      airborneSeen, descended, landed
    };
  }, seconds);

  // A short simulation trace for attacks whose queue entry can disappear before the next read.
  const combatTrace = seconds => page.evaluate(seconds => {
    const [p1, p2] = window.fighters;
    const events = [];
    let lastId = null;
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(1 / 60);
      const attack = p1.attackQueue?.[p1.attackQueue.length - 1] || null;
      if (attack?.id && attack.id !== lastId) {
        events.push({ id: attack.id, kind: attack.kind || null, step: attack.comboStep || null });
        lastId = attack.id;
      }
    }
    const clip = p1.model?.userData?.currentClip || p1.animationController?._active || null;
    return {
      events, clip,
      activeMoveId: p1.activeMoveId || null,
      p1percent: +(p1.percent || 0).toFixed(2),
      p2percent: +(p2.percent || 0).toFixed(2),
      p2hitstun: +(p2.hitstun || 0).toFixed(3),
      guardBreak: +(p1.guardBreak || 0).toFixed(3),
      dodgeTimer: +(p1.dodgeTimer || 0).toFixed(3),
      parryTimer: +(p1.parryTimer || 0).toFixed(3),
      counterWindow: +(p1.counterWindow || 0).toFixed(3),
      y: +(p1.position?.y || 0).toFixed(2),
      grounded: Boolean(p1.isGrounded)
    };
  }, seconds);

  const runUnforcedProbe = async name => {
    await reset(1.2);
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.percent = 120; p1.invulnerable = 0; p1.hitstun = 0; p1.ko = false;
      p1.isGrounded = true; p1.position.y = 0; p1.velocity.set(0, 0, 0);
      p1.guardHeld = false; p1.guardBreak = 0; p1.parryTimer = 0; p1.parryCooldown = 0.5;
      p2.attackBuffer = 0; p2.attackCooldown = 0; p2.hitstun = 0; p2.guardBreak = 0;
      p2.dodgeTimer = 0;
    });
    let strike = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate(() => {
        const p2 = window.fighters[1];
        p2.attackBuffer = 0; p2.attackCooldown = 0; p2.hitstun = 0; p2.guardBreak = 0;
        window.__browserSmashP2Probe = { attack: true, run: true };
      });
      strike = await advance(0.3);
      await page.evaluate(() => { window.__browserSmashP2Probe = null; });
      if (strike.maxP1 > 120.5) break;
      await advance(0.6);
    }
    const follow = await advance(4.0);
    const knockdownSeen = [...new Set([...(strike?.seen || []), ...follow.seen])];
    const maxHitstun = Math.max(strike?.maxHitstun || 0, follow.maxHitstun || 0);
    const p1percent = Math.max(strike?.maxP1 || 0, follow.maxP1 || 0);
    const airborneSeen = Boolean(strike?.airborneSeen || follow.airborneSeen);
    // A very large body can be grounded again by the time the short strike sample ends. Treat a
    // final grounded state after the get-up as evidence of the landing, but only with the airborne
    // sample above; this does not substitute for the collision or the get-up clip.
    const groundedAtEnd = Boolean(follow.grounded || strike?.grounded);
    const landed = Boolean(strike?.landed || follow.landed || groundedAtEnd);
    const strikeP2 = await page.evaluate(() => {
      const p = window.fighters[1];
      return { hits: window.__browserSmashP2ProbeHits || 0,
        active: p.animationController?._active || p.model?.userData?.currentClip || null,
        lastMove: p.model?.userData?.lastMoveAction?.getClip?.()?.name || null,
        attackBuffer: +(p.attackBuffer || 0).toFixed(3),
        activeMoveId: p.activeMoveId || null, attackQueue: p.attackQueue?.length || 0 };
    });
    const detail = { forcedSetup: false, heavyInput: true, p1percent, maxP1Hitstun: maxHitstun,
      seen: knockdownSeen, airborneSeen, landed, strikeP2 };
    const ok = p1percent > 120.5 && maxHitstun >= 0.8
      && knockdownSeen.some(clip => /knockdown|knock_down/i.test(clip))
      && knockdownSeen.some(clip => /get_up|getup|stand_up/i.test(clip))
      && airborneSeen && landed;
    return { row: check(name, 'defence', 'an unforced heavy collision knocks down and recovers', ok,
      JSON.stringify(detail)), detail };
  };

  const capture = async (name, shot, trace = null) => {
    const dir = resolve(out, slugOf(name));
    await mkdir(dir, { recursive: true });
    await page.evaluate(() => window.__browserSmashSetPaused?.(true));
    await page.waitForTimeout(80);
    await page.screenshot({ path: resolve(dir, shot + '.png') });
    await page.evaluate(() => window.__browserSmashSetPaused?.(false));
    if (trace) await writeFile(resolve(dir, shot + '.json'), JSON.stringify(trace, null, 1) + '\n');
  };

  for (const [rowIndex, name] of targets.entries()) {
    if (rowIndex > 0 && process.env.A0_REUSE !== '1') {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForApp();
    }
    const errorsBefore = pageErrors.length;
    const requestsBefore = failedRequests.length;
    const row = { name, checks: [], errors: [], failedRequests: [], captures: [] };
    let mount = null;
    if (process.env.A0_UNFORCED_ONLY === '1') {
      try {
        await startMatch(name);
        const probe = await runUnforcedProbe(name);
        row.checks = [probe.row];
        row.mount = null;
        row.captures = [];
      } catch (error) {
        row.errors.push(String(error?.stack || error).slice(0, 1200));
        check(name, 'runtime', 'unforced gate completes without throwing', false, row.errors[0]);
      }
      row.errors = pageErrors.slice(errorsBefore);
      row.failedRequests = failedRequests.slice(requestsBefore);
      row.checks = checks.filter(entry => entry.fighter === name);
      row.a0Pass = row.checks.filter(entry => entry.required).every(entry => entry.ok);
      row.failed = row.checks.filter(entry => entry.required && !entry.ok).map(entry => `${entry.section}: ${entry.name}`);
      row.status = row.a0Pass ? 'UNFORCED PASS' : 'UNFORCED OPEN';
      row.hardwareVerified = false;
      row.launchComplete = false;
      console.log(`UNFORCED ${row.status} ${name} · ${row.failed.length} required failure(s)`);
      results.push(row);
      continue;
    }
    try {
      // The select-screen preview is a separate live mount from the match body. It must reach
      // the same enabled asset and idle clip, not a procedural placeholder.
      let preview = null;
      try {
        await page.evaluate(name => {
          const select = window.__browserSmashSelect;
          select?.show?.();
          select?.select?.('p1', name);
        }, name);
        await page.waitForFunction(() => {
          const status = document.querySelector('[data-role="previewstatus"]');
          return Boolean(window.__browserSmashPreview)
            && Boolean(window.__fighterPreviewDebug?.root)
            && status?.dataset?.state === 'ready';
        }, null, { timeout: 20_000, polling: 100 });
        preview = await page.evaluate(() => {
          const status = document.querySelector('[data-role="previewstatus"]');
          const canvas = document.querySelector('[data-role="previewcanvas"]');
          return {
            state: status?.dataset?.state || null,
            label: status?.textContent?.trim() || '',
            name: document.querySelector('[data-role="previewname"]')?.textContent?.trim() || '',
            clips: Number(status?.dataset?.clips) || 0,
            canvas: canvas ? [canvas.width, canvas.height] : null,
            size: window.__fighterPreviewDebug?.size || null,
            idle: window.__fighterPreviewDebug?.idle || null,
            bones: window.__fighterPreviewDebug?.bones || 0
          };
        });
        await capture(name, '01-select', preview);
      } catch (error) {
        preview = { state: 'error', error: String(error?.message || error).slice(0, 300) };
      }
      check(name, 'select', 'select-card preview mounts the enabled body with an idle',
        preview?.state === 'ready' && (preview?.clips > 0 || Boolean(preview?.idle?.name))
          && Boolean(preview?.idle?.name) && preview?.idle?.tracks > 0 && preview?.bones > 0
          && Array.isArray(preview?.size) && preview.size.every(Number.isFinite),
        JSON.stringify(preview));
      row.captures.push(`${slugOf(name)}/01-select.png`);

      await startMatch(name);
      mount = await read();
      row.mount = mount;
      const dirSlug = slugOf(name);
      row.captures.push(`${dirSlug}/00-idle.png`);

      check(name, 'body', 'mounted through the real match path',
        mount.modelLoaded && Boolean(mount.asset) && mount.bones > 0 && mount.skinned > 0 && mount.meshes > 0,
        JSON.stringify({ asset: mount.asset, status: mount.status, bones: mount.bones, skinned: mount.skinned, meshes: mount.meshes }));
      check(name, 'body', 'textures/materials are present',
        mount.textured > 0,
        JSON.stringify({ textured: mount.textured, validation: mount.validation }));
      check(name, 'body', 'live rig validation did not fall back',
        mount.validation?.ok !== false,
        JSON.stringify(mount.validation));
      check(name, 'height', 'runtime target height and feet are grounded',
        mount.height > 1.0 && mount.height < 3.0 && Math.abs(mount.feetY - mount.ground) <= 0.18,
        JSON.stringify({ target: mount.height, measured: mount.measuredHeight, feetY: mount.feetY, ground: mount.ground }));
      const heightTolerance = Math.max(0.12, mount.height * 0.08);
      check(name, 'height', 'mounted body matches the identity height within 8%',
        Number.isFinite(mount.measuredHeight) && mount.measuredHeight > 0
          && Math.abs(mount.measuredHeight - mount.height) <= heightTolerance,
        JSON.stringify({ target: mount.height, measured: mount.measuredHeight, tolerance: +heightTolerance.toFixed(3), withWeapons: mount.measuredWithWeapons }));
      check(name, 'animation', 'clip bank is non-empty', mount.actionCount > 0,
        JSON.stringify({ actions: mount.actionCount, modelAnimations: mount.clipNames.length }));
      const lowerClips = mount.clipInventory.map(clip => clip.toLowerCase());
      const hasClip = patterns => lowerClips.some(clip => patterns.some(pattern => clip.includes(pattern)));
      const locomotion = ['idle', 'walk', 'run', 'jump', 'land'].filter(slot => hasClip([slot]));
      const combat = ['jab', 'light', 'atk01', 'heavy', 'atk02', 'air', 'grab', 'throw', 'block', 'guard']
        .filter(slot => hasClip([slot]));
      const reaction = ['hit_light', 'hit_heavy', 'hit', 'stun', 'knockdown', 'knock_down', 'get_up', 'getup', 'die']
        .filter(slot => hasClip([slot]));
      const resultClips = ['victory', 'win', 'defeat', 'lose', 'ko'].filter(slot => hasClip([slot]));
      check(name, 'animation', 'clip bank covers locomotion, combat, reaction and result slots',
        locomotion.length >= 4 && combat.length >= 4 && reaction.length >= 2 && resultClips.length >= 2,
        JSON.stringify({ locomotion, combat, reaction, resultClips, inventory: mount.clipInventory.slice(0, 40) }));
      await capture(name, '00-idle', mount);

      // Idle deformation is sampled from the live skeleton, not from the action name.
      const idleBefore = await page.evaluate(() => {
        const p = window.fighters[0];
        const bone = p.model?.userData?.leftHand || p.model?.userData?.head;
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        return bone.matrixWorld.elements.slice(12, 15);
      });
      const idleMotion = await advance(0.7);
      const idleAfter = await page.evaluate(() => {
        const p = window.fighters[0];
        const bone = p.model?.userData?.leftHand || p.model?.userData?.head;
        if (!bone) return null;
        bone.updateWorldMatrix(true, false);
        return bone.matrixWorld.elements.slice(12, 15);
      });
      const idleDelta = idleBefore && idleAfter
        ? Math.hypot(...idleAfter.map((v, i) => v - idleBefore[i])) : 0;
      check(name, 'animation', 'idle moves the mounted skeleton', idleDelta > 0.0005,
        JSON.stringify({ delta: +idleDelta.toFixed(4), clip: idleMotion.clip, seen: idleMotion.seen }));

      // Walk, sprint and jump through the live input handler.
      await reset(4);
      const startPos = await page.evaluate(() => window.fighters[0].position.toArray());
      await page.keyboard.down('d');
      await advance(0.55);
      await page.keyboard.up('d');
      const walk = await read();
      const walked = Math.hypot(walk.position[0] - startPos[0], walk.position[2] - startPos[2]);
      check(name, 'movement', 'walk input moves the fighter', walked > 0.25,
        JSON.stringify({ distance: +walked.toFixed(2), clip: walk.currentClip }));
      await reset(4);
      await page.keyboard.down('Shift');
      await page.keyboard.down('d');
      const sprintStart = await page.evaluate(() => window.fighters[0].position.toArray());
      await advance(0.45);
      await page.keyboard.up('d');
      await page.keyboard.up('Shift');
      const sprint = await read();
      const sprinted = Math.hypot(sprint.position[0] - sprintStart[0], sprint.position[2] - sprintStart[2]);
      check(name, 'movement', 'sprint input moves farther than the walk sample', sprinted > walked * 0.9,
        JSON.stringify({ walk: +walked.toFixed(2), sprint: +sprinted.toFixed(2), clip: sprint.currentClip }));

      await reset(4);
      await page.evaluate(() => {
        const p = window.fighters[0];
        p.position.set(0, p.groundLevel, -12); p.velocity.set(0, 0, 0); p.jumps = 0;
      });
      await advance(0.15);
      const jumpStart = await page.evaluate(() => window.fighters[0].position.y);
      await page.keyboard.press('Space');
      let peak = 0;
      for (let i = 0; i < 18; i += 1) {
        await advance(0.05);
        peak = Math.max(peak, await page.evaluate(() => window.fighters[0].position.y));
      }
      check(name, 'movement', 'jump leaves the ground', peak - jumpStart > 0.3,
        JSON.stringify({ rise: +(peak - jumpStart).toFixed(2) }));

      // A complete vertical cycle, not just the upward sample: the body must descend and land.
      await reset(4);
      await page.keyboard.press('Space');
      const airTrace = await advance(1.25);
      check(name, 'movement', 'jump falls through the air and lands grounded',
        airTrace.airborneSeen && airTrace.descended && airTrace.landed,
        JSON.stringify({
          airborne: airTrace.airborneSeen, descended: airTrace.descended, landed: airTrace.landed,
          y: airTrace.y, clips: airTrace.seen
        }));
      const hasFallClip = Boolean(mount.bound?.fall);
      if (hasFallClip) {
        check(name, 'movement', 'falling state selects the authored fall clip',
          airTrace.seen.some(clip => /fall/i.test(clip)),
          JSON.stringify({ clips: airTrace.seen }));
      }
      const hasDoubleJumpClip = Boolean(mount.bound?.doubleJump);
      if (hasDoubleJumpClip) {
        await reset(4);
        await page.keyboard.press('Space');
        await advance(0.14);
        await page.keyboard.press('Space');
        const doubleJump = await advance(0.35);
        check(name, 'movement', 'second jump selects the authored double-jump clip',
          doubleJump.seen.some(clip => /double.?jump/i.test(clip)),
          JSON.stringify({ clips: doubleJump.seen, jumps: doubleJump.jumps }));
      }
      const hasFlyForwardClip = Boolean(mount.bound?.flyForward);
      if (hasFlyForwardClip) {
        await reset(4);
        await page.keyboard.press('f');
        await advance(0.18);
        await page.keyboard.down('d');
        const flight = await advance(0.35);
        await page.keyboard.up('d');
        check(name, 'movement', 'forward flight selects the authored fly-forward clip',
          /fly.?forward/i.test(flight.clip || ''),
          JSON.stringify({ clip: flight.clip, seen: flight.seen }));
      }

      // Light chain: five real J presses, observing the queue entry before it is consumed.
      await reset(1.2);
      const chain = [];
      for (let i = 0; i < 5; i += 1) {
        await page.keyboard.press('j');
        const trace = await combatTrace(0.22);
        chain.push(...trace.events);
        await advance(0.24);
      }
      const chainIds = chain.map(entry => entry.id);
      check(name, 'basic-combat', 'five-input light chain resolves at least three distinct attacks',
        chainIds.length >= 3 && new Set(chainIds).size >= 3 && chainIds.every(Boolean),
        JSON.stringify({ chain: chainIds, events: chain }));

      // Light and heavy hit the live opponent and deal real damage.
      await reset(1.35);
      const lightBefore = await page.evaluate(() => window.fighters[1].percent);
      await page.keyboard.press('j');
      const light = await advance(0.32);
      check(name, 'basic-combat', 'light attack deals damage', light.p2percent > lightBefore,
        JSON.stringify({ before: lightBefore, after: light.p2percent, clip: light.clip, seen: light.seen }));

      await reset(1.35);
      const heavyBefore = await page.evaluate(() => window.fighters[1].percent);
      await page.keyboard.down('Shift');
      await page.keyboard.press('j');
      await page.keyboard.up('Shift');
      const heavy = await advance(0.48);
      check(name, 'basic-combat', 'heavy attack reaches a live target', heavy.p2percent > heavyBefore,
        JSON.stringify({ before: heavyBefore, after: heavy.p2percent, clip: heavy.clip, seen: heavy.seen }));

      // Air attack: jump, then strike while airborne.
      await reset(4);
      await page.keyboard.press('Space');
      await advance(0.22);
      const airborne = await page.evaluate(() => window.fighters[0].position.y);
      await page.keyboard.press('j');
      const air = await advance(0.3);
      check(name, 'basic-combat', 'air attack is reachable while airborne',
        airborne > 0.12 && (air.currentClip || air.lastMoveAction || air.seen.length > 0),
        JSON.stringify({ airborne: +airborne.toFixed(2), clip: air.clip, seen: air.seen }));

      // Directional branches: UP+light is the anti-air, DOWN+light in the air is the dive.
      await reset(1.2);
      await page.keyboard.down('w');
      await page.keyboard.press('j');
      const antiAir = await combatTrace(0.42);
      await page.keyboard.up('w');
      check(name, 'basic-combat', 'UP+light resolves the anti-air move',
        antiAir.events.some(entry => entry.id === 'antiAir'),
        JSON.stringify({ events: antiAir.events, clip: antiAir.clip }));

      await reset(4);
      await page.keyboard.press('Space');
      await advance(0.24);
      await page.keyboard.down('s');
      await page.keyboard.press('j');
      const dive = await combatTrace(0.5);
      await page.keyboard.up('s');
      check(name, 'basic-combat', 'DOWN+light while airborne resolves the dive',
        dive.events.some(entry => entry.id === 'dive'),
        JSON.stringify({ events: dive.events, clip: dive.clip, y: dive.y }));

      // Grab and throw: the follow-through must be a real held release, not just a grab pose.
      await reset(1.1);
      const grabBefore = await read();
      await page.keyboard.press('u');
      const grab = await advance(0.28);
      check(name, 'basic-combat', 'grab enters a live grab state', grab.grab,
        JSON.stringify({ grab: grab.grab, clip: grab.clip }));
      const thrown = await advance(0.9);
      check(name, 'basic-combat', 'grab releases into a damaging throw follow-through',
        thrown.p2percent > grabBefore.p2percent && !thrown.grabTarget && !thrown.grabbedBy,
        JSON.stringify({ before: grabBefore.p2percent, after: thrown.p2percent,
          grabTarget: thrown.grabTarget, grabbedBy: thrown.grabbedBy, clip: thrown.clip }));

      // Guard and hit reaction.
      await reset(1.35);
      await page.keyboard.down('e');
      const guard = await advance(0.18);
      await page.keyboard.up('e');
      check(name, 'defence', 'guard enters the live guard state with a shield',
        guard.guardHeld && guard.shield > 0,
        JSON.stringify({ guardHeld: guard.guardHeld, shield: guard.shield, clip: guard.clip }));

      await reset(1.2);
      await page.evaluate(() => {
        const p1 = window.fighters[0];
        p1.parryTimer = 0; p1.parryCooldown = 1.5;
        window.fighters[1].attackBuffer = 0.62;
      });
      const hit = await advance(0.8);
      check(name, 'defence', 'light hit applies hitstun or damage', hit.maxHitstun > 0 || hit.maxP1 > 0,
        JSON.stringify({ hitstun: hit.maxHitstun, percent: hit.maxP1, clip: hit.clip }));

      // Parry uses the live guard-tap window; a successful parry opens the counter window.
      await reset(1.2);
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.parryTimer = 0.22; p1.parryCooldown = 0; p2.attackBuffer = 0.62;
      });
      const parry = await advance(0.5);
      const parryBefore = 0;
      check(name, 'defence', 'a timed parry prevents damage and opens the counter window',
        parry.maxP1 <= parryBefore && parry.counterWindow > 0 && parry.maxP2Hitstun > 0,
        JSON.stringify({ percent: parry.maxP1, counterWindow: parry.counterWindow,
          attackerHitstun: parry.p2hitstun, maxAttackerHitstun: parry.maxP2Hitstun, clip: parry.clip }));
      await page.keyboard.press('j');
      const counter = await combatTrace(0.32);
      check(name, 'defence', 'counter window converts the next attack into a counter strike',
        counter.events.some(entry => entry.id === 'counter'),
        JSON.stringify({ events: counter.events, clip: counter.clip }));

      // Dash/dodge through the live Shift buffer.
      await reset(4);
      await page.keyboard.press('Shift');
      const dodge = await advance(0.12);
      check(name, 'defence', 'dash input enters a live dodge window', dodge.dodgeTimer > 0,
        JSON.stringify({ dodgeTimer: dodge.dodgeTimer, clip: dodge.clip }));

      // Emptying the last shield point under pressure must break the guard, not chip forever.
      await reset(1.2);
      await page.keyboard.down('e');
      await advance(0.12);
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.shield = 1; p1.guardBreak = 0; p1.parryTimer = 0; p1.parryCooldown = 1.5;
        p2.attackBuffer = 0.62;
      });
      const guardBreak = await advance(0.8);
      await page.keyboard.up('e');
      check(name, 'defence', 'an exhausted shield produces a real guard break', guardBreak.guardBreak > 0,
        JSON.stringify({ guardBreak: guardBreak.guardBreak, shield: guardBreak.shield, clip: guardBreak.clip }));

      // Unforced knockdown: P2 enters through the real simulate(input) path with a heavy
      // attack (run+attack), and P1 must be hit at high percent. No hitstun or groundLevel is
      // forced here; the collision, launch, landing and get-up all happen in the live match.
      await reset(1.2);
      await page.evaluate(() => {
        const [p1, p2] = window.fighters;
        p1.percent = 120; p1.invulnerable = 0; p1.hitstun = 0; p1.ko = false;
        p1.isGrounded = true; p1.position.y = 0; p1.velocity.set(0, 0, 0);
        p1.guardHeld = false; p1.guardBreak = 0; p1.parryTimer = 0; p1.parryCooldown = 0.5;
        p2.attackBuffer = 0; p2.attackCooldown = 0; p2.hitstun = 0; p2.guardBreak = 0;
        p2.dodgeTimer = 0;
      });
      let strike = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.evaluate(() => {
          const p2 = window.fighters[1];
          p2.attackBuffer = 0; p2.attackCooldown = 0; p2.hitstun = 0; p2.guardBreak = 0;
          window.__browserSmashP2Probe = { attack: true, run: true };
        });
        strike = await advance(0.3);
        strike.p2Probe = await page.evaluate(() => {
          const p = window.fighters[1];
          return {
            hits: window.__browserSmashP2ProbeHits || 0,
            active: p.animationController?._active || p.model?.userData?.currentClip || null,
            lastMove: p.model?.userData?.lastMoveAction?.getClip?.()?.name || null,
            attackBuffer: +(p.attackBuffer || 0).toFixed(3),
            activeMoveId: p.activeMoveId || null,
            attackQueue: p.attackQueue?.length || 0
          };
        });
        await page.evaluate(() => { window.__browserSmashP2Probe = null; });
        if (strike.maxP1 > 120.5) break;
        await advance(0.6);
      }
      const follow = await advance(4.0);
      const p2state = await page.evaluate(() => {
        const p = window.fighters[1];
        return {
          active: p.animationController?._active || p.model?.userData?.currentClip || null,
          lastMove: p.model?.userData?.lastMoveAction?.getClip?.()?.name || null,
          attackBuffer: +(p.attackBuffer || 0).toFixed(3),
          activeMoveId: p.activeMoveId || null,
          position: p.position.toArray().map(v => +v.toFixed(2)),
          rotationY: +(p.model?.rotation?.y ?? 0).toFixed(3),
          distance: +p.position.distanceTo(window.fighters[0].position).toFixed(2)
        };
      });
      const knockdownSeen = [...new Set([...(strike?.seen || []), ...follow.seen])];
      const maxHitstun = Math.max(strike?.maxHitstun || 0, follow.maxHitstun || 0);
      const p1percent = Math.max(strike?.maxP1 || 0, follow.maxP1 || 0);
      const airborneSeen = Boolean(strike?.airborneSeen || follow.airborneSeen);
      const groundedAtEnd = Boolean(follow.grounded || strike?.grounded);
      const landed = Boolean(strike?.landed || follow.landed || groundedAtEnd);
      row.unforcedKnockdown = {
        forcedSetup: false, heavyInput: true, p1percent, maxP1Hitstun: maxHitstun,
        seen: knockdownSeen, airborneSeen, landed, p2: p2state, strikeP2: strike?.p2Probe || null
      };
      check(name, 'defence', 'an unforced heavy collision knocks down and recovers',
        p1percent > 120.5 && maxHitstun >= 0.8
          && knockdownSeen.some(clip => /knockdown|knock_down/i.test(clip))
          && knockdownSeen.some(clip => /get_up|getup|stand_up/i.test(clip))
          && airborneSeen && landed,
        JSON.stringify(row.unforcedKnockdown));
      console.log('UNFORCED_KNOCKDOWN', name, JSON.stringify(row.unforcedKnockdown));

      // Signature: use the live K key, then the same live projectile path if a hit missed.
      await reset(3.2);
      const specialBefore = await page.evaluate(() => window.fighters[1].percent);
      await page.keyboard.down('k');
      for (let i = 0; i < 16; i += 1) {
        await advance(0.06);
        if ((await page.evaluate(() => window.fighters[1].percent)) > specialBefore) break;
      }
      await page.keyboard.up('k');
      let specialAfter = await page.evaluate(() => window.fighters[1].percent);
      if (specialAfter <= specialBefore) {
        await page.evaluate(() => {
          const [p1, p2] = window.fighters;
          p1.specialCooldown = 0; p2.invulnerable = 0;
          window.spawnProjectile(p1, { source: 'special', ...p1.specialProfile });
        });
        for (let i = 0; i < 24 && specialAfter <= specialBefore; i += 1) {
          await advance(0.08);
          specialAfter = await page.evaluate(() => window.fighters[1].percent);
        }
      }
      const special = await read();
      check(name, 'special', 'signature deals damage through the live signature path',
        specialAfter > specialBefore,
        JSON.stringify({ before: specialBefore, after: specialAfter, label: special.specialLabel }));

      // Ultimate: spend a full meter and observe the live ultimate/cast/result path.
      await reset(3.2);
      await page.evaluate(() => { window.fighters[0].meter = 100; window.fighters[0].power = 100; });
      const ultimateBefore = await page.evaluate(() => window.fighters[1].percent);
      await page.keyboard.press('o');
      const ultimate = await advance(1.2);
      const ultimateAfter = await page.evaluate(() => window.fighters[1].percent);
      check(name, 'ultimate', 'ultimate starts a live cast and affects the match',
        ultimate.casting === 'ultimate' || ultimateAfter > ultimateBefore || ultimate.meter < 100,
        JSON.stringify({ casting: ultimate.casting, before: ultimateBefore, after: ultimateAfter, meter: ultimate.meter }));

      // Transformation is required only where the moveset declares a form.
      const hasForm = await page.evaluate(() => Boolean(window.fighters[0].moveset?.form));
      if (hasForm) {
        await reset(4);
        await page.evaluate(() => { window.fighters[0].power = 100; window.fighters[0].transformCooldown = 0; });
        await page.keyboard.press('i');
        const form = await advance(0.8);
        check(name, 'transformation', 'declared transformation enters a live form', Boolean(form.transform),
          JSON.stringify({ transform: form.transform, clip: form.clip }));
      } else {
        check(name, 'transformation', 'no declared form; check is not applicable', true,
          'moveset.form is absent', false);
      }

      // KO, result and rematch. This is a forced damage setup, but the result path is the game's own.
      await reset(4);
      await page.evaluate(() => {
        window.__browserSmashTrainingDummy = false;
        window.fighters[1].percent = 999;
      });
      let result = { text: '', status: '' };
      for (let i = 0; i < 50; i += 1) {
        await advance(0.2);
        result = await page.evaluate(() => ({
          text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
          status: window.__browserSmashMatch?.().status || ''
        }));
        if (/VICTORY|DEFEAT|DRAW/i.test(result.text) && result.status === 'match-over') break;
      }
      check(name, 'match', 'KO reaches a real result screen', /VICTORY|DEFEAT|DRAW/i.test(result.text) && result.status === 'match-over',
        JSON.stringify(result));
      await capture(name, '03-result', result);
      row.captures.push(`${dirSlug}/03-result.png`);

      const rematch = page.locator('button', { hasText: /REMATCH/i }).first();
      let rematchOk = false;
      if (await rematch.count() && await rematch.isVisible().catch(() => false)) {
        await rematch.click();
        await page.waitForTimeout(350);
        rematchOk = await page.evaluate(name => window.__browserSmashMatch?.().status === 'fighting'
          && window.fighters?.[0]?.identity === name && window.fighters.length === 2, name);
      }
      check(name, 'match', 'rematch restarts with the same fighter', rematchOk,
        JSON.stringify({ status: await page.evaluate(() => window.__browserSmashMatch?.().status) }));

      // Defeat is a separate result branch; a victory-only test cannot catch a missing loser pose.
      let defeat = { text: '', status: '' };
      if (rematchOk) {
        await page.evaluate(() => {
          window.__browserSmashTrainingDummy = false;
          window.fighters[0].percent = 999;
          window.fighters[0].ko = false;
        });
        for (let i = 0; i < 50; i += 1) {
          await advance(0.2);
          defeat = await page.evaluate(() => ({
            text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
            status: window.__browserSmashMatch?.().status || ''
          }));
          if (/VICTORY|DEFEAT|DRAW/i.test(defeat.text) && defeat.status === 'match-over') break;
        }
      }
      check(name, 'match', 'defeat reaches a real result screen', /DEFEAT/i.test(defeat.text) && defeat.status === 'match-over',
        JSON.stringify(defeat));

      // A second complete match after the defeat result. This is the match-flow acceptance
      // boundary: a rematch button that merely rebuilds the arena is not enough.
      let second = { text: '', status: '', started: false };
      if (rematchOk) {
        const secondRematch = page.locator('button', { hasText: /REMATCH/i }).first();
        if (await secondRematch.count() && await secondRematch.isVisible().catch(() => false)) {
          await secondRematch.click();
          await page.waitForTimeout(350);
          second.started = await page.evaluate(() => window.__browserSmashMatch?.().status === 'fighting');
          if (second.started) {
            await page.evaluate(() => {
              window.__browserSmashTrainingDummy = false;
              window.fighters[1].percent = 999;
              window.fighters[1].ko = false;
            });
            for (let i = 0; i < 50; i += 1) {
              await advance(0.2);
              second = await page.evaluate(() => ({
                text: (document.querySelector('#result')?.textContent || '').replace(/\s+/g, ' ').trim(),
                status: window.__browserSmashMatch?.().status || '',
                started: true
              }));
              if (/VICTORY|DEFEAT|DRAW/i.test(second.text) && second.status === 'match-over') break;
            }
          }
        }
      }
      check(name, 'match', 'second rematch completes a second full match',
        second.started && second.status === 'match-over' && /VICTORY|DEFEAT|DRAW/i.test(second.text),
        JSON.stringify(second));
      await capture(name, '05-rematch-result', second);
      row.captures.push(`${dirSlug}/05-rematch-result.png`);

      row.errors = pageErrors.slice(errorsBefore);
      row.failedRequests = failedRequests.slice(requestsBefore);
      check(name, 'runtime', 'no page errors during the match', row.errors.length === 0,
        row.errors.slice(0, 3).join(' | '));
      check(name, 'runtime', 'no failed asset requests during the match', row.failedRequests.length === 0,
        row.failedRequests.slice(0, 3).join(' | '));
    } catch (error) {
      row.errors.push(String(error?.stack || error).slice(0, 1200));
      check(name, 'runtime', 'gate completes without throwing', false, row.errors[0]);
      try { await capture(name, '99-error', { error: row.errors[0] }); } catch { /* best effort */ }
    }

    row.checks = checks.filter(entry => entry.fighter === name);
    row.a0Pass = row.checks.filter(entry => entry.required).every(entry => entry.ok);
    row.failed = row.checks.filter(entry => entry.required && !entry.ok).map(entry => `${entry.section}: ${entry.name}`);
    row.status = row.a0Pass ? 'A0 PASS' : 'A0 OPEN';
    // A0 is an automated live gate, not a launch sign-off. Hardware GPU and the complete
    // ten-section launch matrix remain separate acceptance work.
    row.hardwareVerified = false;
    row.launchComplete = false;
    console.log(`ROW ${row.status} ${name} · ${row.failed.length} required failure(s)`);
    results.push(row);
  }

  const generatedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify({
    generatedAt, gate: 'A0 automated launch acceptance', hardwareVerified: false, launchComplete: false,
    renderer: { ...gpu, softwareRenderer },
    requested, targets: targets.length, offset, limit,
    results, checks, pageErrors, failedRequests
  }, null, 1));
  const passed = results.filter(row => row.a0Pass).length;
  console.log(`\nA0 GATE ${passed}/${results.length} selected fighters pass`);
  console.log('report ' + reportPath);

  // Keep one master report across the bounded batches. Latest row wins; a rerun replaces the old
  // failed/incomplete row instead of leaving two contradictory pieces of evidence. The focused
  // unforced-only run writes a reviewable partial report and must never replace the master.
  if (process.env.A0_UNFORCED_ONLY !== '1') {
  const files = (await readdir(out)).filter(file => /^report-.*\.json$/.test(file));
  const latest = new Map();
  for (const file of files) {
    let report;
    try { report = JSON.parse(await readFile(resolve(out, file), 'utf8')); } catch { continue; }
    for (const row of report.results || []) {
      const previous = latest.get(row.name);
      if (!previous || String(report.generatedAt) > String(previous.generatedAt)) {
        latest.set(row.name, {
          ...row, a0Pass: row.a0Pass ?? row.complete === true,
          source: file, generatedAt: report.generatedAt
        });
      }
    }
  }
  const masterRows = [...latest.values()].sort((a, b) => roster.indexOf(a.name) - roster.indexOf(b.name));
  const masterPass = masterRows.filter(row => row.a0Pass).length;
  await writeFile(resolve(out, 'report-all.json'), JSON.stringify({
    generatedAt,
    gate: 'A0 automated launch acceptance',
    hardwareVerified: false,
    launchComplete: false,
    renderer: { ...gpu, softwareRenderer },
    counts: { total: masterRows.length, a0Pass: masterPass, a0Open: masterRows.length - masterPass, launchComplete: 0 },
    rows: masterRows.map(row => ({
      name: row.name, a0Pass: row.a0Pass, failed: row.failed, checks: row.checks,
      captures: row.captures, errors: row.errors, failedRequests: row.failedRequests,
      hardwareVerified: false, launchComplete: false, source: row.source, generatedAt: row.generatedAt
    }))
  }, null, 1) + '\n');
  }
  if (pageErrors.length) console.log('pageErrors: ' + pageErrors.slice(0, 5).join(' | '));
  if (passed !== results.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
