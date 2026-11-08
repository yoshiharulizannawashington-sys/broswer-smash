// Acceptance for an imported fighter body.
//
// Loads the game with ?showcaseCharacter=<manifest key> (the existing review path that swaps only the
// PLAYER body), then captures an inspection pass and a real match, and measures the body itself:
// triangles, textures, joints, clips, height and ground contact. A body is not "HD" because it
// mounts; the numbers and the captures have to agree.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const key = process.argv[2] || 'hd_soldier_cc0';
const out = `artifacts/hd-fighter/${key}`;
await mkdir(out, { recursive: true });
const root = process.cwd();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm' };
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
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/?showcaseCharacter=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
  });
  // Start through the same button the UI uses; the title overlay hides it, so click the handler.
  await page.evaluate(() => document.querySelector('#play')?.click());
  await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
  await page.waitForTimeout(2500);

  const body = await page.evaluate(() => {
    const fighter = window.fighters[0];
    const model = fighter.model;
    let meshes = 0; let vertices = 0; let triangles = 0; let texturedMaterials = 0; let materials = 0; let skinned = 0;
    const textures = new Set();
    const clips = new Set();
    model?.traverse(node => {
      if (node.isSkinnedMesh) skinned += 1;
      if (node.isMesh) {
        meshes += 1;
        const g = node.geometry;
        const count = g?.getAttribute?.('position')?.count || 0;
        vertices += count;
        if (g?.index) triangles += g.index.count / 3;
        else triangles += count / 3;
        const list = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of list) {
          if (!m) continue;
          materials += 1;
          const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];
          if (maps.some(k => m[k]?.image)) texturedMaterials += 1;
          for (const k of maps) if (m[k]?.image) textures.add(m[k].uuid);
        }
      }
    });
    const mixer = model?.userData?.humanMixer;
    if (mixer) for (const action of mixer._actions || []) clips.add(action._clip?.name || action.getClip?.().name);
    const joints = ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin'];
    return {
      identity: fighter.identity,
      asset: model?.userData?.characterAssetUrl || null,
      bodyKind: model?.userData?.bodyKind || null,
      meshes, vertices, triangles: Math.round(triangles), materials, texturedMaterials, uniqueTextures: textures.size, skinned,
      boundJoints: joints.filter(j => model?.userData?.[j]).length,
      mixerPresent: Boolean(mixer),
      clips: [...clips],
      clipsFromModel: Object.keys(model?.userData?.animationActions || {}),
      height: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.height?.toFixed?.(3); } catch { return null; } })(),
      feetY: (() => { try { return +window.__browserSmashRigCheck?.(fighter)?.metrics?.feetY?.toFixed?.(3); } catch { return null; } })()
    };
  });
  report.body = body;
  console.log('BODY', JSON.stringify(body));

  // Inspection pass: spectate owns the camera and hides the HUD for clean captures.
  const shot = async (name, framing, yaw, pitch) => {
    await page.evaluate(([f, y, p]) => window.smashCamera.spectate({ fighter: window.fighters[0], framing: f, yaw: y, pitch: p }), [framing, yaw, pitch]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log('SHOT', name);
  };
  await shot('1-full-body', 'full', 180, 4);
  await shot('2-face-closeup', 'head', 180, 2);
  await shot('3-torso-materials', 'torso', 160, 0);

  // Pose and locomotion through the real input path, stepping the simulation ourselves so the
  // captures are deterministic on a software renderer.
  await page.evaluate(() => window.smashCamera.endSpectate());
  const stepWith = async (keyName, frames, name) => {
    const run = async () => {
      await page.keyboard.down(keyName);
      await page.evaluate(n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); }, frames);
      await page.keyboard.up(keyName);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${out}/${name}.png` });
    };
    await run();
    console.log('SHOT', name);
  };
  await page.waitForTimeout(800);
  await stepWith('w', 40, '4-walk');
  await stepWith('Shift', 20, '5-dash');
  await page.keyboard.press(' ');
  await page.evaluate(() => { for (let i = 0; i < 18; i += 1) window.__browserSmashStep(1 / 60); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/6-jump.png` });
  console.log('SHOT 6-jump');
  await stepWith('j', 20, '7-attack');

  // CLIP-PROBE: which clip each game state actually selects, from real key input only. Nothing is
  // started by hand, so a missing state shows as "no clip" instead of a substituted animation.
  const stateProbe = async (label, keys, frames) => {
    for (const k of keys) await page.keyboard.down(k);
    const read = await page.evaluate(n => {
      const f = window.fighters[0];
      for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60);
      const u = f.model.userData;
      const active = (u.humanMixer?._actions || [])
        .filter(a => a.isRunning() && a.getEffectiveWeight() > 0.01)
        .map(a => ({ clip: a.getClip().name, w: +a.getEffectiveWeight().toFixed(2) }));
      const joint = u.leftLeg || u.rightLeg || null;
      return {
        speed: +Math.hypot(f.velocity.x, f.velocity.z).toFixed(2),
        grounded: !!f.isGrounded,
        action: active.map(a => a.clip).join('+') || null,
        clips: active,
        bones: joint ? +joint.quaternion.x.toFixed(4) : null,
        wired: { idle: !!u.idleAction, walk: !!u.walkAction, run: !!u.runAction, jump: !!u.jumpAction, punch: !!u.punchAction, hit: !!u.hitAction, ko: !!u.knockdownAction }
      };
    }, frames);
    for (const k of keys) await page.keyboard.up(k);
    console.log('CLIP', label, JSON.stringify(read));
    return read;
  };
  await stateProbe('idle', [], 60);
  const walkState = await stateProbe('walk', ['d'], 40);
  const runState = await stateProbe('run', ['d', 'Shift'], 40);
  const jumpState = await stateProbe('jump', [' '], 10);
  const attackState = await stateProbe('attack', ['j'], 20);
  report.clipStates = { walkState, runState, jumpState, attackState };

  // Gameplay framing with both fighters, then a real landed hit for the reaction capture.
  await page.evaluate(() => {
    const layout = window.__browserSmashLayout();
    const [p1, p2] = window.fighters;
    p1.position.set(-1.2, layout.ground ?? 0, 2);
    p2.position.set(1.6, layout.ground ?? 0, 2);
    p1.velocity.set(0, 0, 0); p2.velocity.set(0, 0, 0); p2.percent = 0; p1.percent = 0;
    p2.hitstun = 0;
    window.__browserSmashStep(0.4);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/8-gameplay-distance.png` });
  // A real attack through the input path. The first version only repositioned and stepped, so no
  // punch was ever thrown and the check reported "no damage" for a body that had nothing to do.
  await page.keyboard.down('j');
  const combat = await page.evaluate(() => {
    const [p1, p2] = window.fighters;
    p2.position.set(1.0, p2.position.y, 2);
    p1.facing = 1; p1.facingZ = 0;
    const before = p2.percent;
    for (let i = 0; i < 50; i += 1) window.__browserSmashStep(1 / 60);
    return { before, after: p2.percent };
  });
  await page.keyboard.up('j');
  console.log('SHOT 8-gameplay-distance', JSON.stringify(combat));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/9-hit-reaction.png` });
  console.log('SHOT 9-hit-reaction');

  // KO state: the imported body has no KO clip, so this records how the game's knockout handling poses it.
  const ko = await page.evaluate(() => {
    const p1 = window.fighters[0];
    p1.percent = 180;
    for (let i = 0; i < 24; i += 1) window.__browserSmashStep(1 / 60);
    return { percent: p1.percent };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/10-ko.png` });
  console.log('SHOT 10-ko', JSON.stringify(ko));

  const after = await page.evaluate(() => ({ percent: window.fighters[1].percent, title: window.__browserSmashTitleCamera?.() || null }));
  check('imported body is mounted on the live fighter', Boolean(body.asset) && body.meshes > 0, JSON.stringify({ asset: body.asset, meshes: body.meshes }));
  check('body is skinned and bound to the canonical joints', body.skinned > 0 && body.boundJoints >= 11, JSON.stringify({ skinned: body.skinned, boundJoints: body.boundJoints }));
  check('body carries real texture images', body.texturedMaterials > 0 && body.uniqueTextures > 0, JSON.stringify({ texturedMaterials: body.texturedMaterials, uniqueTextures: body.uniqueTextures }));
  check('body has animation clips wired', (body.clips.length + body.clipsFromModel.length) > 0, JSON.stringify({ clips: body.clips.slice(0, 6), model: body.clipsFromModel.slice(0, 6) }));
  check('body stands on its own origin', body.feetY == null || Math.abs(body.feetY) < 0.2, JSON.stringify({ feetY: body.feetY, height: body.height }));
  check('a hit lands on the imported body in a real match', after.percent > combat.before, JSON.stringify(after));
  check('walk state plays the imported walk clip', walkState.action === 'walk', JSON.stringify(walkState.clips));
  check('run state plays the imported run clip', runState.action === 'run', JSON.stringify(runState.clips));
  check('no page errors', errors.length === 0, errors.join(' | '));

  const failed = checks.filter(c => !c.ok);
  report.checks = checks;
  report.errors = errors;
  await writeFile(`${out}/verify.json`, JSON.stringify(report, null, 2));
  console.log('SUMMARY', JSON.stringify({ key, passed: checks.length - failed.length, total: checks.length, failures: failed.map(c => `${c.name}: ${c.detail}`), errors: errors.length }));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
  server.close();
}
