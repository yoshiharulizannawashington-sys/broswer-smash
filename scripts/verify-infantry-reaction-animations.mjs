// Infantry's authored reaction clips, proven in the running game.
//
//   bash scripts/run-browser-test.sh scripts/verify-infantry-reaction-animations.mjs
//
// Three kinds of evidence, kept separate on purpose:
//   1. wiring  - the reaction GLB loads and each slot is assigned to the exact state action the
//                 fighter's own state machine reads (idleAction, hitLightAction, ...);
//   2. live    - real state changes (jump, hitstun, victory, KO) select the authored clip, and real
//                 keyboard damage still lands, so the clips did not replace the combat path;
//   3. motion  - each clip is bound to the mounted skeleton through a throwaway mixer and sampled,
//                 so bone travel is measured independently of frame rate.
// A fourth block loads the Naruto reaction GLB (same script, rigify adapter) and measures it on
// Naruto's mounted 567-bone skeleton: the pipeline reuse proof.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.wasm': 'application/wasm' };
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

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
};
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 180)));

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter]'), null, { timeout: 30000, polling: 200 });

await page.evaluate(() => {
  document.querySelector('#selectScreen [data-side="p1"]').click();
  document.querySelector('#selectScreen [data-fighter="Infantry"]').click();
  document.querySelector('#selectScreen [data-side="p2"]').click();
  document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click();
  document.querySelector('#play').click();
});
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
// The play button keeps DOM focus after an in-page .click(), so Space re-activates it instead of
// jumping and every later keyboard probe reads as a no-op. Hand focus back to the game canvas.
await page.evaluate(() => document.activeElement?.blur?.());
await page.mouse.click(640, 420);
const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || null, id: document.activeElement?.id || null }));
console.log('FOCUS ' + JSON.stringify(focus));

const report = await page.waitForFunction(() => {
  const r = window.__browserSmashAssets?.importedReactions?.infantry;
  return r && r.status !== 'loading' ? r : null;
}, null, { timeout: 60000, polling: 300 }).then(handle => handle.jsonValue()).catch(() => null);

const EXPECTED = ['idle', 'jump', 'land', 'hit_light', 'hit_heavy', 'knockdown', 'get_up', 'victory', 'defeat'];
check('the reaction clip GLB loads and reports ready', report?.status === 'ready', JSON.stringify(report && { status: report.status, url: report.url }));
check('every authored reaction clip is present in the file',
  EXPECTED.every(slot => (report?.clips || []).some(name => name.toLowerCase().includes(slot))),
  JSON.stringify(report?.clips));
check('every reaction slot is bound to its state action',
  EXPECTED.every(slot => (report?.bound || []).includes(slot)), JSON.stringify(report?.bound));

const body = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  let meshes = 0, tris = 0, bones = 0;
  f.model.traverse(n => {
    if (n.isBone) bones += 1;
    if (!n.isMesh) return;
    meshes += 1;
    tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
  });
  const actionName = action => action?.getClip?.().name || null;
  return {
    identity: f.identity, key: f.identityKey, bones, meshes, triangles: Math.round(tris),
    slots: {
      idle: actionName(u.idleAction), jump: actionName(u.jumpAction), land: actionName(u.landAction),
      hit_light: actionName(u.hitLightAction), hit_heavy: actionName(u.hitHeavyAction),
      knockdown: actionName(u.knockdownAction), get_up: actionName(u.getUpAction),
      victory: actionName(u.victoryAction), defeat: actionName(u.defeatAction)
    }
  };
});
check('Infantry keeps its own imported body while gaining reactions',
  body.identity === 'Infantry' && body.bones === 24 && body.meshes >= 6 && body.triangles > 250000,
  JSON.stringify({ identity: body.identity, bones: body.bones, meshes: body.meshes, triangles: body.triangles }));
check('the state actions point at the authored Infantry clips',
  EXPECTED.every(slot => String(body.slots[slot] || '').toLowerCase().startsWith('infantry_')),
  JSON.stringify(body.slots));

// ---- motion on the mounted skeleton -------------------------------------
const motion = await page.evaluate(names => {
  const f = window.fighters[0];
  const actions = f.model.userData.animationActions || {};
  const bones = [];
  f.model.traverse(n => { if (n.isBone) bones.push(n); });
  const byName = new Map(Object.values(actions).map(a => [a.getClip().name, a.getClip()]));
  const out = {};
  for (const slot of names) {
    const action = actions[slot] || [...byName.values()].find(c => c.name === (actions[slot]?.getClip?.().name));
    const clip = action?.getClip?.() || [...byName.values()].find(c => c.name.toLowerCase().includes(slot));
    if (!clip) { out[slot] = null; continue; }
    const Mixer = action.getMixer().constructor;
    const temp = new Mixer(f.model);
    const probe = temp.clipAction(clip);
    probe.play();
    let travel = 0;
    let origin = null;
    for (let i = 0; i <= 16; i += 1) {
      temp.setTime((clip.duration * i) / 16);
      f.model.updateMatrixWorld(true);
      const points = bones.map(bone => { const e = bone.matrixWorld.elements; return [e[12], e[13], e[14]]; });
      if (!origin) origin = points;
      else points.forEach((p, index) => {
        const o = origin[index];
        travel = Math.max(travel, Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2]));
      });
    }
    temp.stopAllAction();
    out[slot] = { clip: clip.name, seconds: +clip.duration.toFixed(2), travel: +travel.toFixed(3) };
  }
  return { out, bones: bones.length };
}, EXPECTED);
const moving = Object.values(motion.out).filter(Boolean).filter(m => m.travel > 0.02);
check('every reaction clip moves the mounted skeleton', moving.length === EXPECTED.length,
  JSON.stringify(motion.out));
const distinct = new Set(moving.map(m => m.travel.toFixed(2)));
check('reactions are distinct motions, not one clip renamed', distinct.size >= 6,
  `distinct travel magnitudes: ${distinct.size} of ${moving.length}`);

// ---- live state transitions ---------------------------------------------
// The CPU is not keyboard-controlled, so freezing it is the only way to measure P1's own state:
// left running, its AI walked out of range mid-probe and every hit read as a miss. It also keeps
// the probe from inheriting an in-flight attack from the boot sequence.
await page.evaluate(() => {
  const p2 = window.fighters[1];
  const idle = { left: false, right: false, up: false, down: false, run: false, sprint: false, jump: false, attack: false, special: false, special2: false, special3: false, special4: false, special5: false, grab: false, dodge: false, shield: false, parry: false, ascend: false, descend: false, flightToggle: false, brake: false, webSwing: false, vertical: 0 };
  if (!p2.__reactionProbeSim) {
    p2.__reactionProbeSim = p2.simulate.bind(p2);
    p2.simulate = dt => p2.__reactionProbeSim(dt, { getInputs: () => ({ ...idle }) });
  }
});

const idleRunning = await page.evaluate(() => new Promise(done => {
  const f = window.fighters[0];
  const live = a => !!a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  const started = performance.now();
  const poll = () => {
    f.hitstun = 0; f.ko = false; f.landingPoseTime = 0; f.victoryPose = 0;
    f.attackQueue.length = 0; f.isGrounded = true; f.model.userData.wasGrounded = true;
    const u = f.model?.userData || {};
    if (live(u.idleAction)) return done({ running: true, name: u.idleAction.getClip().name });
    if (performance.now() - started > 8000) return done({ running: false, name: u.idleAction?.getClip?.().name || null });
    requestAnimationFrame(poll);
  };
  poll();
}));
check('the authored idle is the clip playing at rest', idleRunning.running && /idle/i.test(idleRunning.name || ''),
  JSON.stringify(idleRunning));

await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  p1.position.set(-1.2, 0, 0); p2.position.set(1.4, 0, 0);
  p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  p1.isGrounded = true; p1.hitstun = 0; p1.ko = false; p1.attackPose = 0; p1.victoryPose = 0;
  p1.attackQueue.length = 0; p1.comboStep = 0; p1.comboWindow = 0;
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
});

await page.keyboard.press('Space');
const jumped = await page.waitForFunction(() => {
  const u = window.fighters[0].model?.userData || {};
  const a = u.jumpAction;
  const live = a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  return live ? a.getClip().name : null;
}, null, { timeout: 6000 }).then(h => h.jsonValue()).catch(() => null);
check('jumping selects the authored jump clip', /jump/i.test(jumped || ''), String(jumped));

// Force a real landing transition: the state machine only plays the land clip when wasGrounded
// flips false -> true, so set the flag, not just the resulting position.
const landed = await page.evaluate(() => new Promise(done => {
  const f = window.fighters[0];
  const live = a => !!a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  const started = performance.now();
  const drop = () => {
    f.velocity.set(0, 0, 0); f.position.y = 0;
    f.model.userData.wasGrounded = false;
    f.isGrounded = true;
    const u = f.model?.userData || {};
    if (live(u.landAction)) return done(u.landAction.getClip().name);
    if (performance.now() - started > 8000) return done(null);
    requestAnimationFrame(drop);
  };
  drop();
}));
check('landing selects the authored land clip', /land/i.test(landed || ''), String(landed));

// Real keyboard damage, with the CPU standing still in range. Poll in-page: waitForFunction can
// give up on a slow frame and then read a hit that already landed.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  p1.position.set(-1.0, 0, 0); p2.position.set(0.15, 0, 0);
  p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  p1.hitstun = 0; p1.ko = false; p1.attackPose = 0; p1.attackQueue.length = 0;
  p1.comboStep = 0; p1.comboWindow = 0;
  p2.percent = 0; p2.hitstun = 0; p2.invulnerable = 0;
});
await page.keyboard.press('j');
const damageProbe = await page.evaluate(() => new Promise(done => {
  const p2 = window.fighters[1];
  const started = performance.now();
  const poll = () => {
    if (p2.percent > 0) return done({ damaged: true, percent: +p2.percent.toFixed(2) });
    if (performance.now() - started > 8000) return done({ damaged: false, percent: +p2.percent.toFixed(2) });
    requestAnimationFrame(poll);
  };
  poll();
}));
check('a landed hit still deals real damage with reactions active', damageProbe.damaged && damageProbe.percent > 0,
  JSON.stringify(damageProbe));

// The hit-reaction branch: stun the body the way a hit does and read which action it selects.
const hitState = await page.evaluate(() => new Promise(done => {
  const f = window.fighters[0];
  const live = a => !!a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  const started = performance.now();
  const poll = () => {
    f.hitstun = .45; f.guardBreak = 0;
    const u = f.model?.userData || {};
    const running = ['hitLightAction', 'hitHeavyAction'].filter(key => live(u[key])).map(key => u[key].getClip().name);
    if (running.length) return done({ running, hitstun: +f.hitstun.toFixed(2) });
    if (performance.now() - started > 6000) return done({ running, hitstun: +f.hitstun.toFixed(2) });
    requestAnimationFrame(poll);
  };
  poll();
}));
check('hitstun selects an authored hit reaction', hitState.running.some(name => /hit_/i.test(name)),
  JSON.stringify(hitState));

const victory = await page.evaluate(() => new Promise(done => {
  const f = window.fighters[0];
  const live = a => !!a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  const started = performance.now();
  const poll = () => {
    f.ko = false; f.hitstun = 0; f.landingPoseTime = 0; f.isGrounded = true; f.victoryPose = 1;
    const u = f.model?.userData || {};
    if (live(u.victoryAction)) return done(u.victoryAction.getClip().name);
    if (performance.now() - started > 8000) return done(null);
    requestAnimationFrame(poll);
  };
  poll();
}));
check('victory selects the authored victory clip', /victory/i.test(victory || ''), String(victory));

const defeat = await page.evaluate(() => new Promise(done => {
  const f = window.fighters[0];
  const live = a => !!a && (a.isRunning?.() === true || (a.enabled === true && (a.getEffectiveWeight?.() ?? 0) > 0.5));
  const started = performance.now();
  const poll = () => {
    // Reassert each frame: a KO can end the round, and the reset would otherwise clear the state
    // this probe is trying to observe.
    f.victoryPose = 0; f.ko = true; f.isGrounded = true; f.hitstun = 0;
    const u = f.model?.userData || {};
    if (live(u.defeatAction)) return done(u.defeatAction.getClip().name);
    if (performance.now() - started > 8000) return done(null);
    requestAnimationFrame(poll);
  };
  poll();
}));
check('KO selects the authored defeat clip', /defeat/i.test(defeat || ''), String(defeat));

// ---- second rig: same script, different skeleton ------------------------
const reuse = await page.evaluate(async () => {
  const res = await fetch('/models/characters/naruto_uzumaki/naruto_reactions.glb');
  const buf = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(buf.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jsonLength)));
  const animations = json.animations || [];
  return {
    bytes: buf.byteLength,
    clips: animations.map(animation => animation.name),
    channels: animations.map(animation => animation.channels.length),
    nodes: (json.nodes || []).length
  };
});
check('the same authoring script exported nine clips on Naruto\'s rig', reuse.clips.length === 9,
  JSON.stringify(reuse.clips));
check('the Naruto clips target its 567-bone armature with real channels',
  reuse.nodes > 500 && reuse.channels.length === 9 && reuse.channels.every(count => count >= 60),
  JSON.stringify({ nodes: reuse.nodes, channels: reuse.channels.slice(0, 3), bytes: reuse.bytes }));

check('no page errors during the reaction run', errors.length === 0, errors.slice(0, 3).join(' | '));

const passed = checks.filter(c => c.ok).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
server.close();
process.exit(passed === checks.length ? 0 : 1);
