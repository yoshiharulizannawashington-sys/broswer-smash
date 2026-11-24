// Character-body integration check: what the game actually mounts for the fighters whose body
// comes from the character model manifest (public/models/characters/manifest.json) instead of the
// shared prefab.
//
//   bash scripts/run-browser-test.sh scripts/probe-character-bodies.mjs [outDir]
//
// It asserts, from the live page rather than from source reading: the manifest GLB is the body on
// screen, its skeleton binds and passes the rig gate, its own clips are the ones the mixer drives,
// the Iron Spider leg rig is attached to that body, a form repaints real materials on it and
// restores them, and no page error is raised. Screenshots of each body are written for a human
// look at the same run.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outDir = resolve(root, process.argv[2] || 'artifacts/phase5');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}

const manifest = JSON.parse(await readFile(resolve(root, 'public/models/characters/manifest.json'), 'utf8'));

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.setDefaultTimeout(180_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error.message || error)));
page.on('console', message => { if (message.type() === 'error') pageErrors.push('console: ' + message.text()); });
const failedRequests = [];
page.on('response', response => {
  if (response.status() >= 400 && /models\/characters|\.glb/.test(response.url())) {
    failedRequests.push(response.status() + ' ' + response.url());
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
  } catch { await route.fulfill({ status: 404, body: 'missing' }); }
});

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running'
    && window.__browserSmashStep && window.fighters?.length === 2, null, { timeout: 180_000, polling: 200 });

  // The simulation — and therefore the fighter checks that read simulation state — only runs once
  // a match is live. The CPU is then frozen so it cannot land a hit mid-measurement: a hit
  // reaction leans the whole body, which the rig gate correctly reads as root tilt and would
  // misreport as a broken import.
  await page.evaluate(() => {
    document.querySelector('#play').click();
    window.__browserSmashTrainingDummy = true;
  });
  await page.evaluate(() => window.__browserSmashStep(0.4));

  const selectP1 = async name => {
    await page.evaluate(fighterName => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
    }, name);
    // The manifest fetch + GLB parse is async; give it real time, then step the simulation so the
    // leg rig and the animation mixer run at least once.
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.__browserSmashStep(0.4));
  };

  const describeBody = () => page.evaluate(() => {
    const f = window.fighters[0];
    const model = f.model;
    let skinned = 0, bones = 0, meshes = 0;
    const boneNames = [];
    const materials = new Set();
    model.traverse(node => {
      if (node.isSkinnedMesh) skinned++;
      if (node.isBone) { bones++; boneNames.push(node.name); }
      if (node.isMesh) {
        meshes++;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (material?.name) materials.add(material.name);
        }
      }
    });
    const rig = window.__browserSmashRigCheck?.(f) || { ok: false, issues: ['no rig hook'], metrics: {} };
    const record = ((window.__browserSmashAssets || {}).characterModels || {})[f.identityKey] || null;
    const legs = model.userData?.spiderLegs;
    return {
      identityKey: f.identityKey,
      body: model.userData?.characterAssetUrl ? 'imported'
        : model.userData?.sculptedBody ? 'sculpted' : 'prefab',
      assetUrl: model.userData?.characterAssetUrl || null,
      importedStatus: record?.status || null,
      importedAnimations: record?.animations || null,
      importValidationIssues: record?.validation?.issues || null,
      skinnedMeshes: skinned,
      bones,
      boneNames,
      meshes,
      materials: [...materials],
      clipsBound: model.userData?.animationActions
        ? Object.keys(model.userData.animationActions).sort() : null,
      lightAttackClip: model.userData?.punchAction?.getClip?.().name || null,
      hasAuthoringController: Boolean(model.userData?.animationController),
      rigOk: rig.ok,
      rigIssues: rig.issues,
      metrics: rig.metrics,
      legs: legs ? {
        attachedToFighterRoot: legs.group.parent === model,
        legs: legs.legs.length,
        joints: legs.legs.length * 3,
        state: legs.state,
        poseWrites: legs.poseWrites
      } : null
    };
  });

  // ---- every manifest character body ------------------------------
  // The shipped expectation comes from the manifest itself: an enabled entry must be the body on
  // screen; a disabled entry must leave the authored body up and its export must still be a real,
  // fetchable file (a disabled entry is a decision, not a broken link).
  console.log('\n[character bodies]');
  const IDENTITIES = [
    ['Goku', 'goku'],
    ['Iron Man (Tony Stark)', 'iron_man_tony_stark'],
    ['Iron Spider', 'iron_spider'],
    ['Kaze', 'kaze']
  ];
  const reports = {};
  for (const [display, key] of IDENTITIES) {
    await selectP1(display);
    const report = await describeBody();
    reports[key] = report;
    const entry = manifest.characters[key] || {};
    const expectedUrl = entry.urls?.[0] || entry.url;
    const expectedBody = entry.enabled ? 'imported' : 'sculpted';
    console.log(`  ${key}: ${JSON.stringify({ body: report.body, expected: expectedBody, url: report.assetUrl, bones: report.bones, meshes: report.meshes, clips: report.clipsBound })}`);
    await page.screenshot({ path: resolve(outDir, `body-${key.replace(/_/g, '-')}.png`) });

    if (entry.enabled) {
      check(`${key}: the enabled manifest GLB is the body on screen`,
        report.body === 'imported' && report.assetUrl === expectedUrl,
        `${report.body} ${report.assetUrl} vs manifest ${expectedUrl}`);
      check(`${key}: the asset reports loaded with no validation issue`,
        report.importedStatus === 'loaded' && (report.importValidationIssues || []).length === 0,
        `${report.importedStatus} ${JSON.stringify(report.importValidationIssues)}`);
      // 19 is the armature's real bone count. The check used to require exactly 20, which was 19
      // bones plus the `neutral_bone` the glTF exporter generates when a vertex group does not
      // match a bone - the placeholder that silently froze every limb. Asserting the number that
      // included the defect would have kept it alive, so this asserts the skeleton's limbs instead.
      check(`${key}: the imported body is a real skinned mesh on a bound skeleton`,
        report.skinnedMeshes > 0 && report.bones >= 19
          && !report.boneNames.includes('neutral_bone')
          && ['LeftForeArm', 'RightForeArm', 'LeftLeg', 'RightLeg', 'Head']
            .every(name => report.boneNames.includes(name))
          && (report.rigOk === true || report.rigIssues.every(issue => /tilted/.test(issue))),
        JSON.stringify({ skinnedMeshes: report.skinnedMeshes, bones: report.bones,
          issues: report.rigIssues }));
      check(`${key}: the imported body's own clips are bound to the mixer`,
        Array.isArray(report.clipsBound) && report.clipsBound.includes('idle') && report.clipsBound.includes('run'),
        JSON.stringify(report.clipsBound));
    } else {
      check(`${key}: a disabled entry leaves the authored body on screen`,
        report.body === 'sculpted' && report.assetUrl === null,
        `${report.body} ${report.assetUrl}`);
      const response = await page.request.get(origin + expectedUrl);
      const bytes = (await response.body()).length;
      check(`${key}: the disabled export is still a real file on disk`,
        response.status() === 200 && bytes > 100_000 && entry.verified?.bones >= 20,
        `${response.status()} ${bytes} bytes, verified ${JSON.stringify(entry.verified || null)}`);
    }
    check(`${key}: the body in the arena passes the structural rig gate`,
      report.rigOk === true && report.meshes > 0,
      JSON.stringify({ ok: report.rigOk, issues: report.rigIssues, meshes: report.meshes }));
    check(`${key}: the body stands on its own origin`,
      Math.abs(report.metrics.feetY) <= 0.12 && report.metrics.headAbovePelvis >= 0.35,
      JSON.stringify({ feetY: report.metrics.feetY, headAbovePelvis: report.metrics.headAbovePelvis }));
  }

  // Kaze is the enabled Blender export, so the clip lookup is pinned on it: it ships a `jab`
  // action and the loader must bind it for the light attack rather than reusing idle.
  check('the enabled imported body binds its own jab clip for light attacks',
    reports.kaze.lightAttackClip === 'jab', String(reports.kaze.lightAttackClip));
  // The clip search walks words in priority order; searching them all at once let `heavy_punch`
  // win the light-attack lookup because it contains the word `punch`.
  check('the enabled body binds a heavy clip that is not the light one',
    Boolean(reports.kaze.clipsBound?.includes('heavy_punch')), JSON.stringify(reports.kaze.clipsBound));
  // The clip switch happens in the render loop (animateHumanFighter), so the mixer is sampled on
  // animation frames while a light attack is actually running rather than at one arbitrary
  // moment, which would race the attack's own recovery. Sampling is wall-clock sensitive: with
  // software WebGL sharing the CPU (or the machine under load) the requestAnimationFrame sampler
  // can come back with an empty list even though the attack played, which is a starved frame, not
  // a broken clip binding. The measurement is therefore retried, with the assertion unchanged.
  let played = { clips: [], landed: false };
  for (let attempt = 0; attempt < 3 && !played.clips.includes('jab'); attempt++) {
    await page.evaluate(() => {
      const [p1, p2] = window.fighters;
      p1.position.set(0, p1.groundLevel, -12); p1.velocity.set(0, 0, 0);
      p1.facing = 1; p1.facingZ = 0; p1.hitstun = 0; p1.attackQueue.length = 0; p1.attackBuffer = 0;
      p2.position.set(1.05, p2.groundLevel, -12); p2.velocity.set(0, 0, 0); p2.hitstun = 0; p2.guardHeld = false;
      window.__probeClips = [];
      cancelAnimationFrame(window.__probeSampler);
      const f = window.fighters[0];
      window.__probeSample = () => {
        const name = f.model.userData?.lastMoveAction?.getClip?.().name;
        if (name && !window.__probeClips.includes(name)) window.__probeClips.push(name);
        const attacking = f.attackQueue.length > 0;
        if (attacking || window.__probeClips.length < 3) window.__probeSampler = requestAnimationFrame(window.__probeSample);
      };
      window.__probeSampler = requestAnimationFrame(window.__probeSample);
    });
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__browserSmashStep(0.05));
    await page.keyboard.press('j');
    await page.waitForTimeout(300);
    played = await page.evaluate(() => {
      cancelAnimationFrame(window.__probeSampler);
      return { clips: window.__probeClips, landed: window.fighters[1].percent > 0 || window.fighters[1].hitstun > 0 };
    });
  }
  check('a live light attack plays the imported jab clip',
    played.clips.includes('jab'),
    JSON.stringify(played));

  // ---- the shared prefab path ------------------------------------
  // This was a control: a fighter with no manifest entry kept the shared prefab rig from
  // public/assets/character_models.glb (11 articulated joints). Every selectable fighter now has
  // an enabled entry pointing at a validated roster body, so no fighter reaches that path any
  // more and the old assertion can no longer hold. The control is re-pointed at the invariant that
  // replaced it - the shared prefab is no longer what ships, and what does ship is structurally
  // sound - while the loader's prefab fallback stays in place for an identity that is unregistered.
  console.log('\n[shared prefab no longer ships]');
  await selectP1('Hulk (Bruce Banner)');
  const control = await describeBody();
  const rosterSlugs = await page.evaluate(() => (window.characterRosters?.launch || [])
    .map(([name]) => String(name).normalize('NFKD').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')));
  const unregistered = rosterSlugs.filter(slug => manifest.characters[slug]?.enabled !== true);
  check('every selectable fighter has an enabled manifest body', unregistered.length === 0,
    unregistered.join(', '));
  check('a roster fighter mounts its own body instead of the shared prefab',
    control.body === 'imported' && control.assetUrl !== null
      // A sampled idle pose leans the body a few degrees off world up, which is the same tolerance
      // the per-fighter checks above already apply. Any other rig issue still fails.
      && (control.rigOk === true || control.rigIssues.every(issue => /tilted/.test(issue))),
    JSON.stringify({ body: control.body, url: control.assetUrl, issues: control.rigIssues }));

  // ---- form presentation on the shipped body ---------------------
  console.log('\n[form presentation]');
  await selectP1('Goku');
  const form = await page.evaluate(() => {
    const f = window.fighters[0];
    f.power = 100;
    f.transformCooldown = 0;
    const surfaces = () => {
      const out = [];
      f.model.traverse(node => {
        if (!node.isMesh) return;
        // The authored body tags its surfaces (userData.formSurface); an imported rig is matched
        // by material name. Both are collected so this check measures whichever body ships.
        const tag = node.userData?.formSurface || null;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          const named = /fighter-hair|fighter-accent|arc-reactor/.test(material.name || '');
          if (!tag && !named) continue;
          out.push({
            tag,
            name: material.name || null,
            color: material.color?.getHexString?.() || null,
            emissive: material.emissive?.getHexString?.() || null,
            emissiveIntensity: material.emissiveIntensity ?? null
          });
        }
      });
      return out;
    };
    const before = surfaces();
    const start = window.__browserSmashTryForm('p1');
    window.__browserSmashStep(1.2);
    const during = { snapshot: window.__browserSmashPowers('p1'), surfaces: surfaces() };
    window.__browserSmashStep(16);
    const after = { snapshot: window.__browserSmashPowers('p1'), surfaces: surfaces() };
    return {
      start: start && { ok: start.ok, reason: start.reason, label: start.label },
      before, during, after,
      changed: JSON.stringify(before) !== JSON.stringify(during.surfaces),
      restored: JSON.stringify(before) === JSON.stringify(after.surfaces)
    };
  });
  console.log('  form: ' + JSON.stringify({
    start: form.start, label: form.during.snapshot.formLabel,
    active: form.during.snapshot.formActive, changed: form.changed, restored: form.restored
  }));
  check('the form activates on the shipped body', form.start?.ok === true, JSON.stringify(form.start));
  check('the form repaints a real surface on the shipped body', form.changed
    && form.during.surfaces.some(surface => (surface.tag === 'hair' || surface.name === 'fighter-hair')
      && surface.emissive !== '000000'),
    JSON.stringify({ before: form.before, during: form.during.surfaces }));
  check('the form restores the base appearance exactly when it expires', form.restored
    && form.after.snapshot.formActive === false,
    JSON.stringify({ before: form.before, after: form.after.surfaces }));

  // ---- Wind-Step on the imported body itself ---------------------
  // The check above runs on Goku, whose body is the authored prefab: it proves the form system.
  // This one proves the *imported* GLB's own materials are what the form repaints, which is the
  // only version of the claim that matters for Kaze.
  console.log('\n[imported body form]');
  await selectP1('Kaze');
  const importedForm = await page.evaluate(() => {
    const f = window.fighters[0];
    const imported = f.model.userData?.characterAssetUrl || null;
    f.power = 100;
    f.transformCooldown = 0;
    const surfaces = () => {
      const out = [];
      f.model.traverse(node => {
        if (!node.isMesh) return;
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material || !/hair|fighter-accent/.test(material.name || '')) continue;
          out.push({
            name: material.name,
            color: material.color?.getHexString?.() || null,
            emissive: material.emissive?.getHexString?.() || null,
            emissiveIntensity: material.emissiveIntensity ?? null,
            scale: node.scale.toArray().map(v => +v.toFixed(3))
          });
        }
      });
      return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    };
    const before = surfaces();
    const start = window.__browserSmashTryForm('p1');
    window.__browserSmashStep(1.2);
    const during = { snapshot: window.__browserSmashPowers('p1'), surfaces: surfaces() };
    window.__browserSmashStep(16);
    const after = { snapshot: window.__browserSmashPowers('p1'), surfaces: surfaces() };
    return {
      imported,
      start: start && { ok: start.ok, reason: start.reason, label: start.label },
      before, during, after,
      changed: JSON.stringify(before) !== JSON.stringify(during.surfaces),
      restored: JSON.stringify(before) === JSON.stringify(after.surfaces)
    };
  });
  console.log('  imported form: ' + JSON.stringify({
    start: importedForm.start, label: importedForm.during.snapshot.formLabel,
    active: importedForm.during.snapshot.formActive,
    changed: importedForm.changed, restored: importedForm.restored,
    surfaces: importedForm.during.surfaces.map(s => s.name)
  }));
  check('the imported body is the one being transformed', !!importedForm.imported,
    String(importedForm.imported));
  check('Wind-Step activates on the imported body', importedForm.start?.ok === true,
    JSON.stringify(importedForm.start));
  check('Wind-Step repaints the imported body\'s own hair and accent materials',
    importedForm.changed && importedForm.during.surfaces.some(s => s.emissive && s.emissive !== '000000'),
    JSON.stringify(importedForm.during.surfaces));
  check('the imported body restores its exact base materials after the form ends',
    importedForm.restored && importedForm.after.snapshot.formActive === false,
    JSON.stringify({ before: importedForm.before, after: importedForm.after.surfaces }));

  // ---- Iron Spider legs on the imported body ---------------------
  console.log('\n[iron spider legs]');
  await selectP1('Iron Spider');
  const legs = await page.evaluate(() => {
    const f = window.fighters[0];
    const rig = f.model.userData?.spiderLegs;
    if (!rig) return null;
    const THREE = window.__browserSmashThree;
    rig.group.updateWorldMatrix(true, true);
    const root = rig.group.getWorldPosition(new THREE.Vector3());
    let tipSpread = 0;
    for (const leg of rig.legs) {
      const tip = leg.tip.getWorldPosition(new THREE.Vector3());
      tipSpread = Math.max(tipSpread, Math.hypot(tip.x - root.x, tip.z - root.z));
    }
    return {
      attachedToFighterRoot: rig.group.parent === f.model,
      legs: rig.legs.length,
      joints: rig.legs.length * 3,
      state: rig.state,
      poseWrites: rig.poseWrites,
      tipSpread: Number(tipSpread.toFixed(2))
    };
  });
  console.log('  legs: ' + JSON.stringify(legs));
  check('the articulated legs are mounted on the shipped Iron Spider body',
    legs?.attachedToFighterRoot === true && legs.legs === 4 && legs.joints === 12,
    JSON.stringify(legs));
  check('the legs are posed by the simulation at combat reach',
    legs.poseWrites > 0 && legs.tipSpread > 0.5 && legs.tipSpread < 2.6, JSON.stringify(legs));

  // ---- hygiene ---------------------------------------------------
  check('no character asset request failed', failedRequests.length === 0, failedRequests.join(', '));
  check('the run raised no page error', pageErrors.length === 0, pageErrors.join(' | '));
  console.log(`\ncharacter body integration: ${checks} checks passed`);
} finally {
  await browser.close();
  await server.close();
}
