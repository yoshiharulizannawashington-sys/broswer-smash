// Verify authored attack motion reaches the rendered skeleton on BOTH animation owners.
//
// A successful resolver call is not evidence. For each fighter on screen this records the actual
// bone quaternions before and after the attack is evaluated, names the bones that moved, and then
// clears the attack and confirms the body returns. A controller-owned body is driven through its
// own controller (the clips compiled for that rig); a mixer-owned body through the per-joint layer.
//
//   bash scripts/run-browser-test.sh scripts/verify-controller-attacks.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
await mkdir('artifacts/compare/animation-phase1', { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));

const MOVES = ['light1', 'light3', 'heavy', 'heavyLauncher', 'heavySlam'];
const NAMED = ['Head', 'Neck', 'Spine', 'Hips', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];

let browser, failures = 0;
const check = (ok, label, detail = '') => { if (!ok) failures++; console.log(`  ${ok ? 'ok ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); };
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 240)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  });
  await page.evaluate(() => document.querySelector('#play').click());
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => {
    const ok = f => { let s = false; f?.model?.traverse?.(n => { if (n.isSkinnedMesh) s = true; }); return s; };
    return ok(window.fighters?.[0]) && ok(window.fighters?.[1]);
  }, null, { timeout: 90000, polling: 250 }).catch(() => null);
  await page.waitForTimeout(500);

  const result = await page.evaluate(({ MOVES, NAMED }) => {
    const round = n => +Number(n).toFixed(4);
    const out = [];
    for (const fighter of window.fighters) {
      const model = fighter.model;
      const controller = model.userData.animationController || null;
      const bones = [];
      model.updateMatrixWorld(true);
      NAMED.forEach(name => {
        let found = null;
        model.traverse(n => { if (!found && n.isBone && n.name === name) found = n; });
        if (found) bones.push({ name, bone: found });
      });
      const snap = () => bones.map(({ bone }) => [round(bone.quaternion.x), round(bone.quaternion.y), round(bone.quaternion.z), round(bone.quaternion.w)]);

      // Start from whatever the body is doing; the delta is attack-vs-baseline, not vs rest.
      if (controller) controller.update(0.016);
      const baseline = snap();
      const report = {
        identity: fighter.identity || fighter.name || '?',
        path: controller ? 'controller' : (model.userData.humanMixer ? 'mixer' : 'procedural'),
        controllerClips: controller ? controller.clips.size : null,
        authoredClips: controller ? (controller.authoredAttackClips || []).slice() : null,
        clipReport: controller ? controller.attackClipReport : null,
        bones: bones.map(b => b.name),
        moves: []
      };

      for (const id of MOVES) {
        fighter.attackQueue.length = 0;
        fighter.attackQueue.push({ id, kind: id.startsWith('light') ? 'melee' : (id === 'heavySlam' ? 'slam' : 'heavy'), t: 0.14, total: 0.4, start: 0.04, end: 0.22, duration: 0.4 });
        if (controller) {
          controller.update(0.02);
          controller.update(0.02);
        } else {
          window.__browserSmashAttackTick?.();
        }
        const after = snap();
        let worst = 0, worstBone = null;
        const changed = [];
        for (let i = 0; i < bones.length; i++) {
          const d = Math.max(...baseline[i].map((v, k) => Math.abs(v - after[i][k])));
          if (d > 0.02) changed.push(bones[i].name);
          if (d > worst) { worst = d; worstBone = bones[i].name; }
        }
        report.moves.push({
          id,
          maxDelta: round(worst),
          worstBone,
          changedBones: changed,
          activeClip: controller ? controller.describe().active : (window.__browserSmashAttackMotion?.()?.p1?.pose || null)
        });
      }

      // Return to the underlying animation: the attack must not leave a locked pose behind.
      fighter.attackQueue.length = 0;
      if (controller) { for (let i = 0; i < 12; i++) controller.update(0.05); } else { window.__browserSmashAttackTick?.(); }
      const after = snap();
      let residue = 0;
      for (let i = 0; i < bones.length; i++) residue = Math.max(residue, Math.max(...baseline[i].map((v, k) => Math.abs(v - after[i][k]))));
      report.recoveryResidue = round(residue);
      // A mixer body keeps idling, so its bones legitimately differ from the pre-attack sample. What
      // must be true is that the attack pose itself was released, not that the body froze.
      const motion = window.__browserSmashAttackMotion?.() || null;
      const key = fighter === window.fighters[0] ? 'p1' : 'p2';
      report.poseCleared = motion?.[key]?.pose === null || motion?.[key]?.pose === undefined;
      out.push(report);
    }
    return out;
  }, { MOVES, NAMED });

  const forced = await page.evaluate(async () => {
    const f = window.fighters[0];
    const model = f.model;
    f.attackQueue.length = 0;
    model.userData.humanMixer?.stopAllAction?.();
    model.userData.humanMixer = null;
    model.userData.hasAnimationClips = false;
    const mod = await import('/js/anim/animation_controller.js');
    const controller = mod.attachAnimation(model, f);
    return controller
      ? { ok: true, clips: controller.clips.size, authored: controller.authoredAttackClips || [], report: controller.attackClipReport || null }
      : { ok: false };
  });
  console.log('\nFORCED CONTROLLER', JSON.stringify(forced));

  const forcedMoves = forced.ok ? await page.evaluate(({ MOVES, NAMED }) => {
    const f = window.fighters[0];
    const model = f.model;
    const controller = model.userData.animationController;
    const round = n => +Number(n).toFixed(4);
    const bones = [];
    NAMED.forEach(name => { let found = null; model.traverse(n => { if (!found && n.isBone && n.name === name) found = n; }); if (found) bones.push({ name, bone: found }); });
    const snap = () => bones.map(({ bone }) => [round(bone.quaternion.x), round(bone.quaternion.y), round(bone.quaternion.z), round(bone.quaternion.w)]);
    // Let the controller settle on its locomotion clip first; a baseline taken in bind pose would
    // report ordinary idle motion as attack residue.
    for (let i = 0; i < 12; i++) controller.update(0.05);
    const baseline = snap();
    const moves = [];
    for (const id of MOVES) {
      f.attackQueue.length = 0;
      f.attackQueue.push({ id, kind: id.startsWith('light') ? 'melee' : (id === 'heavySlam' ? 'slam' : 'heavy'), t: 0.14, total: 0.4, start: 0.04, end: 0.22, duration: 0.4 });
      // Evaluate where the game does: controller time while the attack is live.
      controller.update(0.02);
      controller.update(0.02);
      const after = snap();
      let worst = 0, worstBone = null;
      const changed = [];
      for (let i = 0; i < bones.length; i++) {
        const d = Math.max(...baseline[i].map((v, k) => Math.abs(v - after[i][k])));
        if (d > 0.02) changed.push(bones[i].name);
        if (d > worst) { worst = d; worstBone = bones[i].name; }
      }
      moves.push({ id, maxDelta: round(worst), worstBone, changed: changed.length, clip: controller.describe().active });
    }
    f.attackQueue.length = 0;
    for (let i = 0; i < 12; i++) controller.update(0.05);
    const after = snap();
    let residue = 0;
    for (let i = 0; i < bones.length; i++) residue = Math.max(residue, Math.max(...baseline[i].map((v, k) => Math.abs(v - after[i][k]))));
    const settled = controller.describe().active;
    return { moves, residue: round(residue), settled, authored: controller.authoredAttackClips || [], clips: controller.clips.size };
  }, { MOVES, NAMED }) : null;

  for (const f of result) {
    console.log(`\n${f.identity} — ${f.path} owner${f.controllerClips !== null ? `, ${f.controllerClips} clips` : ''}`);
    if (f.authoredClips) console.log(`  authored attack clips: ${JSON.stringify(f.authoredClips)}${f.clipReport?.missing?.length ? ` missing ${JSON.stringify(f.clipReport.missing)}` : ''}`);
    console.log(`  measured bones: ${f.bones.join(', ')}`);
    for (const m of f.moves) {
      console.log(`  ${m.id.padEnd(14)} Δ${String(m.maxDelta).padEnd(7)} on ${String(m.worstBone || '-').padEnd(14)} bones=${m.changedBones.length} clip=${m.activeClip}`);
    }
    check(f.moves.every(m => m.maxDelta > 0.05), `${f.path} owner: every move moves the rendered skeleton`, f.moves.map(m => m.maxDelta).join(', '));
    check(f.moves.every(m => m.changedBones.length >= 2), `${f.path} owner: each move moves more than one named bone`);
    check(new Set(f.moves.map(m => `${m.worstBone}:${m.maxDelta}`)).size >= 4, `${f.path} owner: the moves are not one pose repeated`);
    if (f.path === 'mixer') check(f.poseCleared === true, 'mixer owner: the attack pose is released and idle resumes', String(f.poseCleared));
    else check(f.recoveryResidue < 0.12, `${f.path} owner: the body returns after the attack`, String(f.recoveryResidue));
    if (f.path === 'controller') check((f.authoredClips || []).length > 0, 'controller compiled authored attack clips', JSON.stringify(f.authoredClips));
  }
  if (forcedMoves) {
    console.log(`\n${result[0].identity} — controller owner (forced), ${forcedMoves.clips} clips, authored ${JSON.stringify(forcedMoves.authored)}`);
    for (const m of forcedMoves.moves) console.log(`  ${m.id.padEnd(14)} Δ${String(m.maxDelta).padEnd(7)} on ${String(m.worstBone || '-').padEnd(14)} bones=${m.changed} clip=${m.clip}`);
    check(forcedMoves.authored.length >= 5, 'controller compiled the authored attack clips', JSON.stringify(forcedMoves.authored));
    check(forcedMoves.moves.every(m => m.maxDelta > 0.05), 'controller owner: every move moves the rendered skeleton', forcedMoves.moves.map(m => m.maxDelta).join(', '));
    check(forcedMoves.moves.every(m => m.changed >= 2), 'controller owner: each move moves more than one named bone');
    check(new Set(forcedMoves.moves.map(m => `${m.worstBone}:${m.maxDelta}`)).size >= 4, 'controller owner: the moves are not one pose repeated');
    check(!String(forcedMoves.settled || '').startsWith('authored_'), 'controller owner: the body returns to its own clip after the attack', String(forcedMoves.settled));
  } else {
    check(false, 'controller owner: a controller could be attached for measurement', JSON.stringify(forced));
  }

  // Visual evidence on the controller-owned body: hold each strike near its peak and capture it.
  for (const id of ['light1', 'heavyLauncher', 'heavySlam']) {
    await page.evaluate(id => {
      const f = window.fighters[0];
      const c = f.model.userData.animationController;
      if (!c) return;
      f.attackQueue.length = 0;
      f.attackQueue.push({ id, kind: 'heavy', t: 0.14, total: 0.4, start: 0.04, end: 0.22, duration: 0.4 });
      c.update(0.02);
      c.update(0.08);
      window.smashCamera?.spectate?.({ fighter: f, framing: 'full', yaw: 24, pitch: 6 });
    }, id);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/compare/animation-phase1/controller-${id}.png` });
    console.log('SHOT', `artifacts/compare/animation-phase1/controller-${id}.png`);
  }

  check(errors.length === 0, 'no page errors', errors.slice(0, 1).join(''));
} finally {
  await browser?.close();
  server.close();
}
console.log(failures ? `\nController attack verification FAILED (${failures}).` : '\nController attack verification passed.');
process.exit(failures ? 1 : 0);
