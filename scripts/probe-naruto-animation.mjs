// Naruto animation runtime probe: is every authored sequence actually BOUND and PLAYED?
//
//   bash scripts/run-browser-test.sh scripts/probe-naruto-animation.mjs
//
// The table test (test-naruto-animation.mjs) proves the mapping. This proves the mapping reaches the
// mounted Rigify rig: the binder compiles tracks, the state machine selects each move's own slot,
// every transformation plays its own sequence and the ultimate plays its retimed clip while real
// clones exist. Bone positions come from the rendered skeleton, so a clip that is selected but not
// drawn cannot pass.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-animation';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    let rel = normalize(p).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models', 'data'].some(d => rel === d || rel.startsWith(d + sep))) rel = 'public' + sep + rel;
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
  console.log(`  ok  ${name}`);
}

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 400)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150_000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
  await step(.6);

  // The binder runs on the first animation frame that has a real identity, so wait for it rather
  // than sampling a fixed delay: the reaction and kunai GLBs load in parallel. Read the state off
  // Naruto's OWN body - `__browserSmashAssets.authoredClips` is a single slot the second fighter's
  // bind overwrites, so it can never be used to prove what Naruto bound.
  let ready = false;
  for (let attempt = 0; attempt < 80 && !ready; attempt++) {
    ready = await page.evaluate(() => {
      const f = window.fighters?.[0];
      const diag = f?.model?.userData?.authoredBindDiag;
      const forms = f?.model?.userData?.authoredFormActions;
      return !!diag && diag.bound > 0 && !!forms && Object.keys(forms).length === 5;
    });
    if (!ready && attempt === 30) {
      const snapshot = await page.evaluate(() => {
        const f = window.fighters?.[0];
        return {
          identity: f?.identityKey || null,
          modelUrl: f?.model?.userData?.assetUrl || null,
          diag: f?.model?.userData?.authoredBindDiag || null,
          forms: Object.keys(f?.model?.userData?.authoredFormActions || {}),
          shared: window.__browserSmashAssets?.authoredClips || null
        };
      });
      console.log('BIND SNAPSHOT', JSON.stringify(snapshot).slice(0, 2500));
    }
    if (!ready) await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready, 'authored motion bound to the mounted Naruto body');

  // The reaction pack and the kunai clip are separate GLBs that load after the binder's first pass.
  // Poll their own reports: a snapshot taken the instant the strikes bind would read "loading" and
  // say nothing about whether the reaction pack bound.
  let reactionState = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    reactionState = await page.evaluate(() => {
      const f = window.fighters?.[0];
      return f?.model?.userData?.importedReactionReport || null;
    });
    if (reactionState && reactionState.status !== 'loading') break;
    await new Promise(r => setTimeout(r, 250));
  }
  console.log('REACTIONS', JSON.stringify(reactionState));

  // The baked authored GLB loads alongside the reaction pack and replaces the compiled actions in
  // place, so wait for its own report rather than assuming it won the race.
  let bakedState = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    bakedState = await page.evaluate(() => window.fighters?.[0]?.model?.userData?.importedAuthoredReport || null);
    if (bakedState && bakedState.status !== 'loading') break;
    await new Promise(r => setTimeout(r, 250));
  }
  console.log('BAKED', JSON.stringify(bakedState));

  const diag = await page.evaluate(() => {
    const f = window.fighters[0];
    const assets = window.__browserSmashAssets || {};
    return {
      identity: f.identityKey,
      modelUrl: f.model?.userData?.assetUrl || null,
      diag: f.model?.userData?.authoredBindDiag || null,
      // Read the binder's own reports. The global registry is keyed by identity but only written on
      // success, so a failed load would otherwise look identical to a load that never happened.
      reactions: f.model?.userData?.importedReactionReport || assets.importedReactions?.naruto_uzumaki || null,
      abilities: f.model?.userData?.importedAbilityReport || assets.importedAbilities?.naruto_uzumaki || null,
      baked: f.model?.userData?.importedAuthoredReport || assets.authoredBaked?.naruto_uzumaki || null,
      forms: Object.keys(f.model?.userData?.authoredFormActions || {})
    };
  });
  console.log('BIND', JSON.stringify(diag.diag));
  check('the mounted body is Naruto\'s imported model', /naruto_uzumaki\.glb/.test(String(diag.modelUrl)), String(diag.modelUrl));
  check('authored motion compiled onto the mounted rig', diag.diag?.bound >= 12, `${diag.diag?.bound} slots`);
  // `special` is an alias that compiles to the `rasenshuriken` motion slot, so the compiled set is
  // keyed by motion slot, not by every manifest key.
  check('the compiled set includes every strike, ability, grab, throw and the ultimate',
    ['light1', 'light2', 'light3', 'light4', 'light5', 'heavy', 'heavyLauncher', 'heavySlam',
      'rasenshuriken', 'rasengan', 'giantRasengan', 'shadowClone', 'grab', 'throw', 'ultimate']
      .every(slot => diag.diag?.compiled?.includes(slot)),
    JSON.stringify(diag.diag?.compiled));
  check('no authored slot had to fall back to a baked clip', (diag.diag?.fallback || []).length === 0,
    JSON.stringify(diag.diag?.fallback));
  check('all five forms have a compiled sequence', diag.forms.length === 5, JSON.stringify(diag.forms));
  check('the Blender-baked GLB bound every combat slot', diag.baked?.status === 'ready' && (diag.baked?.bound || []).length === 15,
    JSON.stringify({ status: diag.baked?.status, bound: diag.baked?.bound, missing: diag.baked?.missing }));
  check('the Blender-baked GLB bound all five form sequences', (diag.baked?.forms || []).length === 5,
    JSON.stringify(diag.baked?.forms));
  check('the baked clip names are the authored slots, not a renamed set',
    (diag.baked?.clips || []).includes('authored_ultimate') && (diag.baked?.clips || []).includes('authored_form_formSage'),
    JSON.stringify(diag.baked?.clips));
  check('the reaction pack bound every state', diag.reactions?.status === 'ready' && (diag.reactions?.missing || []).length === 0,
    JSON.stringify(diag.reactions));
  check('the kunai clip bound', diag.abilities?.status === 'ready' && (diag.abilities?.bound || []).includes('kunai'),
    JSON.stringify(diag.abilities));

  // ------------------------------------------------------------------ real bone poses per move
  const pose = async () => page.evaluate(() => {
    // Measure the rig the clips are bound to. rig_map publishes every canonical joint on userData
    // after resolving the imported skeleton, so this is the same bone object a track writes. The
    // first SkinnedMesh is NOT a safe substitute: Naruto's meshes are separate and their bones do
    // not use the generic names a generated body has.
    const model = window.fighters[0].model;
    model.updateMatrixWorld(true);
    const world = name => {
      const bone = model.userData?.[name];
      if (!bone) return null;
      const m = bone.matrixWorld.elements;
      return [+m[12].toFixed(4), +m[13].toFixed(4), +m[14].toFixed(4)];
    };
    const resolved = ['head', 'leftHand', 'rightHand', 'leftFoot', 'pelvis', 'rightFore', 'leftFore']
      .filter(name => !!model.userData?.[name]);
    return {
      url: model.userData?.assetUrl || null,
      head: world('head'),
      leftHand: world('leftHand') || world('leftFore'),
      rightHand: world('rightHand') || world('rightFore'),
      leftFoot: world('leftFoot'), hips: world('pelvis'),
      resolved,
      clip: model.userData?.currentClip || null,
      strike: model.userData?.lastAuthoredStrike || null,
      attacking: model.userData?.wasAttacking || false
    };
  });
  const dist = (a, b) => {
    let worst = 0;
    let compared = 0;
    for (const key of ['head', 'leftHand', 'rightHand', 'leftFoot', 'hips']) {
      if (!a[key] || !b[key]) continue;
      compared++;
      worst = Math.max(worst, Math.hypot(a[key][0] - b[key][0], a[key][1] - b[key][1], a[key][2] - b[key][2]));
    }
    // A comparison with nothing to compare is not zero movement: it is a broken measurement, and
    // must not be able to pass as one.
    return compared ? +worst.toFixed(4) : -1;
  };

  const rest = await pose();
  const moves = ['light1', 'light2', 'light3', 'light4', 'finisher', 'heavy', 'heavyLauncher', 'heavySlam'];
  const measured = [];
  // The strike is selected on the idle -> attack edge only, so settle to locomotion between moves
  // instead of pushing a new entry while the previous one is still in the queue.
  const settle = async () => {
    await page.evaluate(() => { window.fighters[0].attackQueue.length = 0; });
    await page.evaluate(() => window.__browserSmashStep(0.3));
  };
  for (const id of moves) {
    const kind = id.startsWith('heavy') ? 'heavy' : 'melee';
    await settle();
    await page.evaluate(({ id, kind, combo }) => {
      const f = window.fighters[0];
      f.comboStep = combo;
      f.attackQueue.push({ id, kind, t: 1.4, total: 4, damage: 8, hit: false, active: 0 });
    }, { id, kind, combo: id === 'finisher' ? 5 : Number(String(id).replace('light', '')) || 1 });
    // SwiftShader draws a frame every few hundred milliseconds, so a wall-clock sleep cannot mean
    // "the animation played". Step the simulation deterministically to the middle of the strike.
    await page.evaluate(() => window.__browserSmashStep(0.18));
    const shot = await pose();
    measured.push({ id, ...shot, delta: dist(shot, rest) });
    console.log('MOVE', id, JSON.stringify({ clip: shot.clip, selected: shot.strike?.slot, delta: dist(shot, rest) }));
  }
  check('the probe measures the imported body and at least three resolved rig joints',
    measured.every(row => /naruto_uzumaki\.glb/.test(String(row.url)) && row.resolved.length >= 3),
    JSON.stringify({ url: measured[0]?.url, resolved: measured[0]?.resolved }));
  for (const row of measured) {
    check(`move ${row.id} plays a clip that moves the mounted skeleton`, row.delta > 0.05 && !!row.clip, `${row.delta} m, clip ${row.clip}, joints ${row.resolved.join(',')}`);
  }
  const clips = new Set(measured.map(row => row.clip));
  check('the eight strikes do not collapse onto a handful of clips', clips.size >= 6, JSON.stringify([...clips]));

  // ------------------------------------------------------------------ ability casts
  const ability = async (key, name) => {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.attackQueue.length = 0;
      f.attackQueue.length = 0;
      f.abilityReadyAt = {};
      f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
      window.fighters[1].position.set(5, .6, 0);
    });
    await page.keyboard.press(key);
    await page.evaluate(() => window.__browserSmashStep(0.2));
    const state = await page.evaluate(() => {
      const f = window.fighters[0];
      return {
        cast: f.abilityCast ? { motion: f.abilityCast.motion, label: f.abilityCast.label } : null,
        playing: f.model?.userData?.authoredAbilityAction?.getClip?.().name || null,
        clip: f.model?.userData?.currentClip || null
      };
    });
    console.log('ABILITY', name, JSON.stringify(state));
    return state;
  };
  // P1 kit keys are in kit order: L = SHADOW CLONE, H = RASENGAN, T = GIANT RASENGAN, Y = KUNAI.
  const clone = await ability('l', 'SHADOW CLONE');
  check('the Shadow Clone cast plays its own summoning clip', clone.cast?.motion === 'shadowClone' && /shadowClone/i.test(String(clone.clip)),
    JSON.stringify(clone));
  const rasengan = await ability('h', 'RASENGAN');
  check('the Rasengan cast plays its own authored clip', /rasengan/i.test(String(rasengan.clip)) && rasengan.cast?.motion === 'rasengan',
    JSON.stringify(rasengan));
  const giant = await ability('t', 'GIANT RASENGAN');
  check('the Giant Rasengan cast plays the giantRasengan clip, not the Rasengan',
    /giantRasengan/i.test(String(giant.clip)) && giant.cast?.motion === 'giantRasengan', JSON.stringify(giant));
  const kunai = await ability('y', 'KUNAI THROW');
  check('the kunai throw plays the imported Naruto_Kunai clip',
    /Naruto_kunai/i.test(String(kunai.clip)) && kunai.cast?.motion === 'kunai', JSON.stringify(kunai));

  // ------------------------------------------------------------------ five transformations
  const forms = [];
  for (let stage = 0; stage < 5; stage++) {
    await page.evaluate(() => {
      const f = window.fighters[0];
      f.power = 100; f.transformCooldown = 0; f.formLock = 0; f.hitstun = 0; f.guardBreak = 0;
      f.attackQueue.length = 0;
      f.position.set(0, .6, 0); window.fighters[1].position.set(4, .6, 0);
    });
    const before = await pose();
    await page.keyboard.press('i');
    await page.evaluate(() => window.__browserSmashStep(0.36));
    const mid = await pose();
    const form = await page.evaluate(() => {
      const f = window.fighters[0];
      return {
        id: f.transform?.form?.id || null,
        label: f.transform?.form?.label || null,
        animation: f.model?.userData?.lastFormAnimation || null,
        clip: f.model?.userData?.currentClip || null,
        formLock: +(f.formLock || 0).toFixed(2)
      };
    });
    await page.screenshot({ path: `${out}/form-${stage + 1}-${form.id || 'none'}.png` });
    forms.push({ ...form, delta: dist(mid, before) });
    console.log('FORM', stage + 1, JSON.stringify({ id: form.id, clip: form.clip, delta: dist(mid, before) }));
    await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
    await step(.1);
    await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
  }
  const formIds = ['sage-mode', 'nine-tails-chakra', 'kurama-link', 'six-paths-sage', 'baryon-mode'];
  check('the five activations enter the five forms in order', forms.every((row, i) => row.id === formIds[i]), JSON.stringify(forms.map(f => f.id)));
  check('every form has a distinct recorded sequence', new Set(forms.map(f => `${f.animation?.form}:${f.animation?.clip}`)).size === 5,
    JSON.stringify(forms.map(f => f.animation)));
  check('every form sequence moves the mounted body during activation', forms.every(f => f.delta > 0.05), JSON.stringify(forms.map(f => f.delta)));
  check('the form lock releases so gameplay resumes', forms.every(f => f.formLock < 0.6), JSON.stringify(forms.map(f => f.formLock)));

  // ------------------------------------------------------------------ ultimate
  await page.evaluate(() => {
    window.__browserSmashClearClones?.();
    const f = window.fighters[0];
    f.transform = null; f.formStage = 0; f.transformCooldown = 0; f.formLock = 0;
    f.meter = 100; f.power = 0; f.hitstun = 0; f.guardBreak = 0;
    f.attackQueue.length = 0;
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(4, .6, 0);
    window.fighters[1].percent = 0;
  });
  await page.keyboard.press('o');
  await page.evaluate(() => window.__browserSmashStep(0.9));
  const ultimate = await page.evaluate(() => {
    const f = window.fighters[0];
    return {
      casting: f.casting || null,
      animation: f.model?.userData?.lastUltimateAnimation || null,
      clip: f.model?.userData?.currentClip || null,
      clipDuration: f.model?.userData?.authoredUltimateAction?.getClip?.().duration || null,
      clones: window.__browserSmashCloneCount?.() ?? null,
      powerMeter: f.meter
    };
  });
  await page.screenshot({ path: `${out}/ultimate-barrage.png` });
  console.log('ULTIMATE', JSON.stringify(ultimate));
  check('the ultimate plays its own authored sequence', /ultimate/i.test(String(ultimate.clip)) && !!ultimate.animation,
    JSON.stringify(ultimate));
  check('the ultimate clip is retimed to the whole move, not one second',
    (ultimate.clipDuration || 0) > 1.6, `${ultimate.clipDuration}s`);
  check('the ultimate puts real shadow clones on the field', (ultimate.clones || 0) >= 1, String(ultimate.clones));
  const hurt = await page.evaluate(() => {
    // The barrage resolves on its own active window; step until it connects rather than sampling
    // whichever frame the screenshot happened to land on.
    for (let i = 0; i < 10 && window.fighters[1].percent <= 0; i++) window.__browserSmashStep(0.2);
    return window.fighters[1].percent;
  });
  check('the ultimate damages the opponent', hurt > 0, `${hurt}%`);

  await page.evaluate(() => window.__browserSmashClearClones?.());
  const recovered = await page.evaluate(() => {
    const f = window.fighters[0];
    for (let i = 0; i < 40 && f.casting === 'ultimate'; i++) window.__browserSmashStep(0.2);
    return { casting: f.casting || null, grounded: f.isGrounded, clip: f.model?.userData?.currentClip || null };
  });
  check('control returns after the ultimate', recovered.casting !== 'ultimate', JSON.stringify(recovered));

  check('no page errors during the probe', errors.length === 0, errors.slice(0, 2).join(' | '));
  await writeFile(`${out}/probe.json`, JSON.stringify({ diag, measured, forms, ultimate, errors }, null, 2));
  console.log(`\nNaruto animation probe passed (${checks} checks). Output: ${out}`);
} finally {
  await browser?.close();
  server.close();
}
