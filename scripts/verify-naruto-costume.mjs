// Naruto Phase 2.1: rig-bound costumes and Rasenshuriken readability.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-costume.mjs
//
// Real match, real key presses, real simulation. The costume checks are structural AND
// behavioural: each form has to report the bones it is bound to, a costume part has to move when
// the bone it is bound to is rotated, and every exit path (expiry, repeated transform, round
// reset) has to leave zero costume nodes behind.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { MOVESETS } from '../public/js/combat/movesets.js';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/naruto-phase2-1';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let rel = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => rel === dir || rel.startsWith(dir + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}${detail ? ` (${detail})` : ''}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack || String(error)));
  await page.route('https://unpkg.com/three@0.152.2/**', async route => {
    const url = new URL(route.request().url());
    const local = resolve(root, 'node_modules/three', url.pathname.replace('/three@0.152.2/', ''));
    try { await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: await readFile(local) }); }
    catch { await route.fulfill({ status: 404, body: 'missing' }); }
  });
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  const frames = n => page.evaluate(async total => {
    for (let i = 0; i < total; i++) await new Promise(done => requestAnimationFrame(done));
  }, n);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => {
  window.__browserSmashSkipCinematic?.();
  // A camera/AI proof must not be pre-empted by the opponent: freeze the CPU brain and make the
  // subject untouchable so a transform is never refused for being in hitstun.
  window.__browserSmashFreezeAI = true;
  if (window.fighters?.[0]) window.fighters[0].invulnerable = 9999;
});
  await step(.4);

  // Everything about the costume, measured inside the page where the scene graph lives.
  const inspect = () => page.evaluate(() => {
    const f = window.fighters[0];
    const report = window.__browserSmashFormCostume().p1;
    const model = f.model;
    let anchors = 0, parts = 0, bones = 0, modelParented = 0;
    const anchorParents = [];
    model.traverse(node => {
      if (String(node.name || '').startsWith('costume-anchor:')) {
        anchors++;
        const parent = node.parent;
        anchorParents.push({
          anchor: node.name.replace('costume-anchor:', ''),
          parent: String(parent?.name || parent?.type || 'none'),
          parentIsBone: Boolean(parent?.isBone),
          // The prefab body animates `joint_<identity>_<part>` groups, not THREE.Bone objects.
          parentIsJoint: Boolean(parent?.isBone) || /^joint_/i.test(String(parent?.name || '')),
          parentIsModel: parent === model
        });
      }
      if (String(node.name || '').startsWith('costume:')) {
        parts++;
        if (node.parent === model) modelParented++;
      }
    });
    const leftover = [];
    model.traverse(node => {
      const name = String(node.name || '');
      if (name.startsWith('form-costume-') || name.startsWith('costume:')) leftover.push(name);
    });
    return { report, anchors, parts, modelParented, anchorParents, leftover };
  });

  // ---- one pass per form: binding, silhouette parts, then normal expiry -------------------
  const forms = MOVESETS.naruto_uzumaki.forms;
  const seen = [];
  for (let stage = 0; stage < forms.length; stage++) {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
      f.power = 100; f.transformCooldown = 0; f.formLock = 0; f.hitstun = 0; f.guardBreak = 0; f.grabbedBy = null; f.abilityReadyAt = {};
      window.fighters[1].position.set(4.2, .6, 0);
      window.fighters[1].invulnerable = 0;
    });
    await page.keyboard.press('i');
    await step(.7);
    const state = await inspect();
    seen.push(state);
    const form = forms[stage];
    check(`${form.label}: costume is active`, state.report.active === true, JSON.stringify(state.report));
    check(`${form.label}: costume geometry is bound to the rig`, state.report.bound === true,
      JSON.stringify(state.report.anchors));
    check(`${form.label}: every part rides a bone-driven anchor`,
      state.anchors > 0 && state.parts > 0 && state.modelParented === 0,
      `${state.anchors} anchors / ${state.parts} parts / ${state.modelParented} model-parented`);
    check(`${form.label}: body anchor lives on a real rig joint`,
      state.anchorParents.some(entry => entry.anchor === 'body' && entry.parentIsJoint),
      JSON.stringify(state.anchorParents));

    // Behavioural proof: rotating the chest bone has to carry the cloak with it.
    const moved = await page.evaluate(() => {
      const THREE = window.__browserSmashThree;
      const f = window.fighters[0];
      const costume = f.formCostume;
      const bone = f.model.userData.torso || f.model.userData.spine;
      const part = costume?.parts?.find(mesh => mesh.name.includes(':coat:') || mesh.name.includes(':shell:') || mesh.name.includes(':mantle:')) || costume?.parts?.[0];
      if (!bone || !part) return { moved: 0, reason: 'missing' };
      const before = part.getWorldPosition(new THREE.Vector3()).clone();
      const rest = bone.rotation.x;
      bone.rotation.x = rest + .55;
      f.model.updateMatrixWorld(true);
      const after = part.getWorldPosition(new THREE.Vector3()).clone();
      bone.rotation.x = rest;
      f.model.updateMatrixWorld(true);
      return { moved: +before.distanceTo(after).toFixed(3), bone: String(bone.name || bone.type), part: part.name };
    });
    check(`${form.label}: chest rotation carries the costume`, moved.moved > .02, JSON.stringify(moved));

    // Expiry must remove every temporary node.
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
    await step(.15);
    const cleared = await inspect();
    check(`${form.label}: expiry removes all costume nodes`,
      cleared.report.active === false && cleared.anchors === 0 && cleared.parts === 0 && cleared.leftover.length === 0,
      JSON.stringify({ active: cleared.report.active, anchors: cleared.anchors, parts: cleared.parts, leftover: cleared.leftover }));
    await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
  }

  // ---- repeated transformations must not stack geometry ----------------------------------
  await page.evaluate(() => { const f = window.fighters[0]; f.formStage = 0; f.power = 100; f.transformCooldown = 0; f.formLock = 0; });
  const repeatCounts = [];
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => { const f = window.fighters[0]; f.formStage = 0; f.power = 100; f.transformCooldown = 0; f.formLock = 0; });
    await page.keyboard.press('i');
    await step(.7);
    const state = await inspect();
    repeatCounts.push({ parts: state.parts, anchors: state.anchors, tails: state.report.tails, id: state.report.id });
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
    await step(.15);
    await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
  }
  check('re-entering a form produces the same costume, not a stacked second one',
    repeatCounts[0].parts === repeatCounts[1].parts
    && repeatCounts[0].anchors === repeatCounts[1].anchors
    && repeatCounts[0].id === repeatCounts[1].id,
    JSON.stringify(repeatCounts));

  // ---- round reset / blowout must also clear it ------------------------------------------
  await page.keyboard.press('i');
  await step(.7);
  await page.evaluate(() => window.__browserSmashSpawnFighters());
  await step(.1);
  const afterReset = await inspect();
  check('round reset removes the costume and its anchors',
    afterReset.report.active === false && afterReset.anchors === 0 && afterReset.leftover.length === 0,
    JSON.stringify({ active: afterReset.report.active, anchors: afterReset.anchors, leftover: afterReset.leftover }));

  // ---- Rasenshuriken: fighter-relative size, four blades, four-part identity --------------
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.transform = null; f.formStage = 0; f.power = 0; f.specialCooldown = 0;
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0; f.hitstun = 0;
    window.fighters[1].position.set(9, .6, 0);
    window.fighters[1].invulnerable = 30;
    window.__browserSmashLastImpact = null;
  });
  await step(.05);
  await page.keyboard.press('k');
  await frames(1);
  const shot = await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const projectile = window.browserSmashProjectiles?.[0];
    const owner = window.fighters[0];
    if (!projectile) return { spawn: false, origin: window.__browserSmashLastShot || null };
    const disc = projectile.group.getObjectByName('rasenshuriken');
    const box = new THREE.Box3().setFromObject(disc || projectile.group);
    const size = box.getSize(new THREE.Vector3());
    const bodyBox = new THREE.Box3().setFromObject(owner.model);
    const body = bodyBox.getSize(new THREE.Vector3());
    return {
      spawn: true,
      moveType: projectile.moveType,
      radius: +(Math.max(size.x, size.y) / 2).toFixed(2),
      center: { x: +projectile.group.position.x.toFixed(2), y: +projectile.group.position.y.toFixed(2), z: +projectile.group.position.z.toFixed(2) },
      fighterHeight: +body.y.toFixed(2),
      fighterWidth: +body.x.toFixed(2),
      blades: disc ? disc.children.filter(node => node.name === 'shuriken-blade').length : 0,
      edges: disc ? disc.children.filter(node => node.name === 'shuriken-edge').length : 0,
      winds: disc ? disc.children.filter(node => node.name === 'shuriken-wind').length : 0,
      core: Boolean(disc?.getObjectByName('shuriken-core')),
      scale: disc?.scale.x ?? null,
      origin: window.__browserSmashLastShot || null
    };
  });
  check('the special launches a Rasenshuriken projectile', shot.spawn === true && shot.moveType === 'spinning', JSON.stringify(shot));
  check('the disc keeps four chakra blades, a core and wind rings',
    shot.blades === 4 && shot.edges === 4 && shot.winds === 3 && shot.core === true,
    JSON.stringify({ blades: shot.blades, edges: shot.edges, winds: shot.winds, core: shot.core }));
  check('the disc is substantially bigger than the fighter at gameplay distance',
    shot.radius > shot.fighterHeight * .55,
    `disc radius ${shot.radius} m vs fighter height ${shot.fighterHeight} m`);
  check('the disc is launched from the right hand, not the chest',
    shot.origin && shot.origin.policy === 'rightHand' && shot.origin.fallback === false,
    JSON.stringify(shot.origin));

  // Impact: put the target on the disc and confirm the same .95 m collision sphere still hits.
  await page.evaluate(() => {
    const projectile = window.browserSmashProjectiles?.[0];
    const target = window.fighters[1];
    target.invulnerable = 0;
    if (projectile) target.position.set(projectile.group.position.x, Math.max(0, projectile.group.position.y - 1.1), projectile.group.position.z);
  });
  await frames(2);
  const impact = await page.evaluate(() => window.__browserSmashLastImpact || null);
  check('the enlarged disc still connects with real damage',
    impact && impact.type === 'spinning' && impact.dealt > 0,
    JSON.stringify(impact));

  check('no page errors during the costume run', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  console.log(`\nNaruto costume verification passed (${checks} checks).`);
} finally {
  await browser?.close();
  server.close();
}
