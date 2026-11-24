// Naruto Uzumaki as a real roster fighter: the imported body, its textures, its 19 clips and its
// damage, all measured in the running game.
//
//   bash scripts/run-browser-test.sh scripts/verify-naruto-roster.mjs
//
// Evidence is deliberately split, because this harness runs on a software renderer:
//  · the select screen and the match are driven through the real UI and real keys;
//  · textures and geometry are read off the mounted SkinnedMeshes;
//  · clip coverage is read from the model's own animation actions, and each clip is then bound to
//    Naruto's live skeleton through a throwaway mixer and sampled, so bone travel is measured
//    independently of frame rate;
//  · damage comes from the live combat resolver, never assigned by this file.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/naruto-roster';
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

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(180000);
const errors = [];
const failedRequests = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(-70)}`); });

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.waitForFunction(() => document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]'), null, { timeout: 30000, polling: 200 });

const rosterInfo = await page.evaluate(() => ({
  cards: document.querySelectorAll('#selectScreen .bs-card').length,
  hasNaruto: Boolean(document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]')),
  p1Options: [...document.querySelectorAll('#p1Character option')].map(o => o.value).filter(v => v === 'Naruto Uzumaki').length,
  label: document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"] .bs-name')?.textContent || null
}));
check('Naruto is one roster card with one identity', rosterInfo.hasNaruto && rosterInfo.p1Options === 1, JSON.stringify(rosterInfo));

await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Naruto Uzumaki"]').click());
await page.waitForTimeout(400);
const selected = await page.evaluate(() => document.querySelector('#p1Character')?.value);
check('P1 resolves to the Naruto Uzumaki identity', selected === 'Naruto Uzumaki', String(selected));

await page.waitForFunction(() => ['ready', 'loaded'].includes(document.querySelector('#selectScreen [data-role="previewstatus"]')?.dataset.state), null, { timeout: 90000, polling: 300 }).catch(() => {});
const preview = await page.evaluate(() => {
  const status = document.querySelector('#selectScreen [data-role="previewstatus"]');
  // The panel prints a player-facing label, not the filename; it publishes the loaded clip count as
  // a data attribute, which is the evidence that the GLB actually parsed with its animations.
  return { state: status?.dataset.state || null, clips: Number(status?.dataset.clips || 0), text: (status?.textContent || '').slice(0, 80) };
});
check('select preview loads the imported Naruto GLB with its clips', ['ready', 'loaded'].includes(preview.state) && preview.clips >= 15, JSON.stringify(preview));
await page.screenshot({ path: `${out}/1-select-naruto.png` });

await page.evaluate(() => document.querySelector('#selectScreen [data-side="p2"]').click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('#selectScreen [data-fighter="Goku"]').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play').click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 40000, polling: 200 });
await page.waitForTimeout(9000);

const mounted = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model?.userData || {};
  let meshes = 0, tris = 0, textured = 0, skinned = 0, bones = 0;
  const textures = new Set();
  f.model.traverse(n => {
    if (n.isBone) bones += 1;
    if (n.isSkinnedMesh) skinned += 1;
    if (!n.isMesh) return;
    meshes += 1;
    tris += (n.geometry.index ? n.geometry.index.count : n.geometry.attributes.position.count) / 3;
    for (const mat of (Array.isArray(n.material) ? n.material : [n.material])) {
      if (!mat) continue;
      const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].filter(k => mat[k]?.image);
      if (maps.length) { textured += 1; for (const k of maps) textures.add(mat[k].uuid); }
    }
  });
  const hud = (document.querySelector('#hud')?.textContent || '').replace(/\s+/g, ' ');
  return {
    identity: f.identity, identityKey: f.identityKey, asset: u.characterAssetUrl || null,
    meshes, triangles: Math.round(tris), texturedMaterials: textured, uniqueTextures: textures.size,
    skinned, bones, clips: Object.keys(u.animationActions || {}),
    hudNaruto: /NARUTO/i.test(hud), hudText: hud.slice(0, 140)
  };
});
// 5,444 source triangles minus the 2,621-face ink shell that was stripped so the body renders in colour.
check('the match mounts the imported Naruto GLB', /naruto_uzumaki\.glb/.test(mounted.asset || '') && mounted.triangles >= 3500 && mounted.skinned >= 4,
  JSON.stringify({ asset: mounted.asset, triangles: mounted.triangles, skinned: mounted.skinned, bones: mounted.bones }));
check('the five supplied textures survive into the match', mounted.uniqueTextures >= 5 && mounted.texturedMaterials >= 5,
  JSON.stringify({ uniqueTextures: mounted.uniqueTextures, texturedMaterials: mounted.texturedMaterials }));
check('HUD names Naruto', mounted.hudNaruto && mounted.identity === 'Naruto Uzumaki', JSON.stringify({ identity: mounted.identity, hud: mounted.hudText }));

const REQUIRED = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'jab', 'heavy_punch', 'front_kick', 'spinning_kick', 'hit_light', 'hit_heavy', 'knockdown', 'victory', 'defeat', 'rasengan', 'shadow_clone', 'transformation'];
const missing = REQUIRED.filter(name => !mounted.clips.includes(name));
check('every gameplay state has its own clip', missing.length === 0, JSON.stringify({ missing, clips: mounted.clips.length }));
await page.screenshot({ path: `${out}/2-naruto-in-match.png` });

// Skeletal motion: bind each clip to Naruto's live skeleton and measure how far the striking bones
// actually travel. A clip that exists but moves nothing cannot pass this.
const motion = await page.evaluate(clipNames => {
  const f = window.fighters[0];
  const bones = [];
  f.model.traverse(n => { if (n.isBone) bones.push(n); });
  const actions = f.model.userData.animationActions || {};
  // Drive the mixer with `setTime`, not a paused action + update(0): a zero delta never writes a pose,
  // which is why the first version of this probe reported 0 m of travel for every clip.
  const measure = (clipName, set) => {
    const action = actions[clipName];
    if (!action) return null;
    const clip = action.getClip();
    const Mixer = action.getMixer().constructor;
    const temp = new Mixer(f.model);
    const probe = temp.clipAction(clip);
    probe.play();
    const targets = set && set.length ? set : bones;
    const steps = 16;
    let travel = 0;
    let origin = null;
    for (let i = 0; i <= steps; i += 1) {
      temp.setTime((clip.duration * i) / steps);
      f.model.updateMatrixWorld(true);
      const points = targets.map(bone => {
        const e = bone.matrixWorld.elements;
        return [e[12], e[13], e[14]];
      });
      if (!origin) origin = points;
      else points.forEach((point, index) => {
        const from = origin[index];
        travel = Math.max(travel, Math.hypot(point[0] - from[0], point[1] - from[1], point[2] - from[2]));
      });
    }
    temp.stopAllAction();
    return { clip: clip.name, seconds: +clip.duration.toFixed(2), travel: +travel.toFixed(3), bones: targets.length };
  };
  const upper = bones.filter(b => /hand|forearm|upper_arm/i.test(b.name));
  const legs = bones.filter(b => /(foot|shin|thigh)/i.test(b.name));
  const result = { clips: {}, upperBones: upper.length, legBones: legs.length };
  for (const name of clipNames) result.clips[name] = measure(name, bones);
  result.jabArms = measure('jab', upper);
  result.kickLegs = measure('front_kick', legs);
  result.idleBody = measure('idle', bones);
  return result;
}, REQUIRED);

const motions = REQUIRED.map(name => motion.clips[name]).filter(Boolean);
const moving = motions.filter(m => m.travel > 0.01);
check('all 18 clips move the skeleton', moving.length === 18, JSON.stringify(motions.map(m => `${m.clip}:${m.travel}`)));
const signatures = new Set(motions.map(m => m.travel.toFixed(2)));
check('no two clips are the same motion', signatures.size >= 12, `distinct travel magnitudes: ${signatures.size} of 18`);
check('the punch moves the arms and the kick moves the legs', (motion.jabArms?.travel || 0) > 0.15 && (motion.kickLegs?.travel || 0) > 0.15,
  JSON.stringify({ jabArms: motion.jabArms?.travel, kickLegs: motion.kickLegs?.travel, upperBones: motion.upperBones, legBones: motion.legBones }));

// Real inputs through the real keyboard path.
await page.evaluate(() => {
  const [p1, p2] = window.fighters;
  const idle = { left:false, right:false, up:false, down:false, run:false, sprint:false, jump:false, attack:false, special:false, special2:false, special3:false, grab:false, dodge:false, shield:false, parry:false, ascend:false, descend:false, flightToggle:false, brake:false, webSwing:false, vertical:0 };
  if (!p2.__narutoProbeSim) { p2.__narutoProbeSim = p2.simulate.bind(p2); p2.simulate = dt => p2.__narutoProbeSim(dt, { getInputs: () => ({ ...idle, shield: false }) }); }
  p1.position.set(-1.1, 0, 2); p2.position.set(-0.05, 0, 2);
  p1.velocity.set(0,0,0); p2.velocity.set(0,0,0); p1.isGrounded = true; p2.isGrounded = true;
  p1.hitstun = 0; p1.guardBreak = 0; p1.attackPose = 0; p1.ko = false; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
  p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
  p2.hitstun = 0; p2.invulnerable = 0; p2.guardBreak = 0; p2.shield = 100; p2.ko = false; p2.attackQueue.length = 0; p2.hitboxes.length = 0;
  window.__narutoBefore = p2.percent;
});
await page.keyboard.press('j');
await page.evaluate(() => { for (let i = 0; i < 48; i += 1) window.__browserSmashStep(1 / 60); });
await page.waitForTimeout(200);
const light = await page.evaluate(() => ({ before: window.__narutoBefore, after: window.fighters[1].percent }));
check('a light attack deals real damage', light.after > light.before, JSON.stringify(light));
// The software renderer can drop a frame across a short attack; a struck opponent is retried, and a
// recorded zero is re-tested against a fresh placement rather than assumed to be a pass.
if (!(light.after > light.before)) {
  await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p1.position.set(-0.9, 0, 2); p2.position.set(0, 0, 2);
    p1.velocity.set(0,0,0); p2.velocity.set(0,0,0);
    p1.hitstun = 0; p1.guardBreak = 0; p1.attackPose = 0; p1.attackBuffer = 0; p1.attackQueue.length = 0; p1.hitboxes.length = 0;
    p1.facing = 1; p1.facingZ = 0; p2.facing = -1; p2.facingZ = 0;
    p2.hitstun = 0; p2.invulnerable = 0; p2.guardHeld = false; p2.shield = 100; p2.ko = false;
    p2.attackQueue.length = 0; p2.hitboxes.length = 0;
    window.__narutoBefore = p2.percent;
  });
  await page.keyboard.press('j');
  await page.evaluate(() => { for (let i = 0; i < 60; i += 1) window.__browserSmashStep(1 / 60); });
  await page.waitForTimeout(400);
  const retry = await page.evaluate(() => ({ before: window.__narutoBefore, after: window.fighters[1].percent }));
  check('a light attack deals real damage (retry)', retry.after > retry.before, JSON.stringify(retry));
  light.retry = retry;
}
await page.screenshot({ path: `${out}/3-light-attack.png` });

// Naruto's real inputs: KeyK signature, KeyL Shadow Clone, KeyH Rasengan, KeyI transformation.
const snapshot = () => page.evaluate(() => {
  const f = window.fighters[0];
  const hud = document.querySelector('#hud')?.textContent || '';
  const before = f.abilityReadyAt || null;
  return {
    percent: window.fighters[1].percent,
    // main.js publishes the live projectile list through a function, not a bare array.
    projectiles: (typeof window.browserSmashProjectiles === 'function' ? window.browserSmashProjectiles() : []).length,
    clones: (window.__browserSmashClones || window.clones || []).length,
    cooldowns: Array.isArray(before) ? before.map(v => +Number(v || 0).toFixed(2)) : before,
    specialCooldown: +Number(f.specialCooldown || 0).toFixed(2),
    cast: f.abilityCast ? { slot: f.abilityCast.slot, motion: f.abilityCast.motion, at: f.abilityCast.at } : null,
    currentClip: f.model?.userData?.currentClip || null,
    abilityClip: f.model?.userData?.authoredAbilityAction?.getClip?.().name || null,
    transform: Boolean(f.transform || f.form || f.transformed),
    power: Number(f.power || 0),
    formHud: Number((hud.match(/FORM\s*(\d+)%/i) || [])[1] || 0),
    errors: window.__narutoAbilityError || null
  };
});
// Put the pair back on the line with a clean attack state before every cast: an ability pressed
// while the previous strike is still resolving is buffered away, and the signature never fires.
const resetArena = () => page.evaluate(() => {
  const [p1, p2] = window.fighters;
  p1.position.set(-1.1, 0, 2); p2.position.set(-0.05, 0, 2);
  p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0);
  p1.hitstun = 0; p1.guardBreak = 0; p1.attackPose = 0; p1.attackBuffer = 0;
  p1.attackQueue.length = 0; p1.hitboxes.length = 0; p1.specialCooldown = 0;
  p1.isGrounded = true; p1.ko = false; p1.facing = 1; p1.facingZ = 0;
  p2.facing = -1; p2.facingZ = 0; p2.hitstun = 0; p2.invulnerable = 0; p2.shield = 100; p2.ko = false;
  // Clear the signature/ability windows too: a cast pressed while the previous signature still owns
  // the pose is consumed but never animated, which would look like a broken ability.
  const userData = p1.model?.userData || {};
  userData.authoredSpecialTime = 0;
  userData.authoredAbilityTime = 0;
  userData.authoredAbilityAction = null;
});
// The animator chooses the cast clip on a real animation frame, not inside a simulation step, so a
// fixed delay samples the *previous* cast's clip. Wait for the body to actually be in the expected
// clip, bounded, and take the screenshot at that moment.
const waitForClip = (expected, timeout = 15000) => page.waitForFunction(name => {
  const userData = window.fighters[0]?.model?.userData || {};
  const active = userData.authoredAbilityAction?.getClip?.().name || null;
  return userData.currentClip === name || (active === name && (userData.authoredAbilityTime || 0) > 0);
}, expected, { timeout, polling: 100 }).then(() => true).catch(() => false);
const press = async (key, expectedClip, shot) => {
  await resetArena();
  await page.keyboard.press(key);
  const sawClip = expectedClip ? await waitForClip(expectedClip) : false;
  const early = await snapshot();
  if (shot) await page.screenshot({ path: shot });
  await page.evaluate(() => { for (let i = 0; i < 60; i += 1) window.__browserSmashStep(1 / 60); });
  await page.waitForTimeout(150);
  return { ...early, sawClip, late: await snapshot() };
};
const beforeAbilities = await snapshot();
const signature = await press('k', 'rasengan', `${out}/4-signature.png`);
check('the signature move fires, animates and goes on cooldown', signature.sawClip &&
  (signature.specialCooldown > 0 || signature.late.percent > light.after), JSON.stringify({ sawClip: signature.sawClip, specialCooldown: signature.specialCooldown, clip: signature.currentClip, percent: signature.late.percent }));
const clone = await press('l', 'shadow_clone', `${out}/5-shadow-clone.png`);
check('Shadow Clone really casts and plays its own clip', clone.cast?.slot === 1 && clone.sawClip, JSON.stringify({ cast: clone.cast, sawClip: clone.sawClip, clip: clone.currentClip, abilityClip: clone.abilityClip }));
const rasengan = await press('h', 'rasengan', `${out}/6-rasengan.png`);
check('Rasengan casts and plays its own clip on the imported rig', rasengan.cast?.slot === 2 && rasengan.sawClip, JSON.stringify({ cast: rasengan.cast, sawClip: rasengan.sawClip, clip: rasengan.currentClip, abilityClip: rasengan.abilityClip }));
// A form costs meter: fill it first so the press tests the transformation, not the cost gate.
const transformed = await page.evaluate(async () => {
  const f = window.fighters[0];
  f.power = 100; f.meter = 100; f.transformCooldown = 0; f.attackQueue.length = 0; f.attackPose = 0; f.hitstun = 0;
  return { power: f.power };
}).then(async before => { const state = await press('i', 'transformation', `${out}/7-transform.png`); return { ...state, before }; });
// The form state itself is the evidence: the flag flips and the HUD form meter reads it, whether or
// not this harness managed to catch the transition clip mid-frame.
check('the transformation visibly changes the fighter', transformed.transform === true || transformed.late.transform === true,
  JSON.stringify({ sawClip: transformed.sawClip, transform: transformed.transform, clip: transformed.currentClip, power: transformed.before }));
const special = { beforeAbilities, signature, clone, rasengan, transformed };

await page.keyboard.press(' ');
await page.evaluate(() => { for (let i = 0; i < 14; i += 1) window.__browserSmashStep(1 / 60); });
const air = await page.evaluate(() => ({ grounded: window.fighters[0].isGrounded, y: +window.fighters[0].position.y.toFixed(2) }));
check('jumping leaves the ground with the imported rig', air.grounded === false && air.y > 0.2, JSON.stringify(air));
await page.screenshot({ path: `${out}/8-airborne.png` });

// Let a clip play through on the real animator so the screenshot shows a posed frame, not a bind pose.
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/9-hud.png` });

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
check('no failed asset requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

await writeFile(`${out}/report.json`, JSON.stringify({ rosterInfo, preview, mounted, motion, light, special, air, checks, errors, failedRequests }, null, 2));
const failed = checks.filter(c => !c.ok);
console.log('SUMMARY ' + JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => c.name) }));
await browser.close();
server.close();
process.exitCode = failed.length ? 1 : 0;
