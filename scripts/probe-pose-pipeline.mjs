// Frame-level pose probe: where does an authored attack pose actually go?
//
// Records the SAME real skinned-bone quaternions at each point of a live combat frame:
//   A  before the mixer update             (wrapped around humanMixer.update)
//   B  immediately after the mixer update  (same wrapper)
//   C  immediately after applyAttackMotion (via __browserSmashAttackTick)
//   D  the pose the renderer is handed      (the skinned mesh's own onBeforeRender)
//
// It also answers what a joint-name lookup cannot: is `model.userData.rightArm` a bone in the
// rendered skeleton, or an alias nothing draws?
//
//   bash scripts/run-browser-test.sh scripts/probe-pose-pipeline.mjs
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/diagnostics';
await mkdir(out, { recursive: true });
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
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => {
    window.__browserSmashTrainingDummy = true;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.chooseArena('valley');
    window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
    window.__browserSmashSelect?.select('p2', 'Thor');
    document.querySelector('#play').click();
  });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    window.fighters[1].position.set(3.4, .6, 0);
  });
  await new Promise(r => setTimeout(r, 800));

  // The mounted body may still be the procedural fallback here, which has no SkinnedMesh and cannot
  // be driven by the mixer. Measuring it would report a meaningless zero; wait for the skinned rig.
  await page.waitForFunction(() => {
    let skinned = false;
    window.fighters?.[0]?.model?.traverse?.(n => { if (n.isSkinnedMesh) skinned = true; });
    return skinned;
  }, null, { timeout: 90000, polling: 250 }).catch(() => null);

  const wiring = await page.evaluate(() => {
    const f = window.fighters[0];
    let skinned = null;
    f.model.traverse(n => { if (n.isSkinnedMesh && !skinned) skinned = n; });
    if (!skinned) return { ok: false, reason: 'no SkinnedMesh on the mounted body' };
    f.__sm = skinned;
    const bones = skinned.skeleton.bones;
    // Quaternion AND position per bone: a pose can rotate a bone or only translate a joint, and a
    // quaternion-only comparison would miss the second case.
    const snap = () => bones.map(b => ({
      q: [+b.quaternion.x.toFixed(5), +b.quaternion.y.toFixed(5), +b.quaternion.z.toFixed(5), +b.quaternion.w.toFixed(5)],
      p: [+b.position.x.toFixed(5), +b.position.y.toFixed(5), +b.position.z.toFixed(5)]
    }));
    // The bones the brief names, resolved from the rendered skeleton itself.
    window.__named = ['RightArm', 'RightForeArm', 'LeftArm', 'Spine', 'Hips', 'RightUpLeg', 'LeftUpLeg']
      .map(name => ({ name, index: bones.findIndex(b => b.name === name) }));
    window.__bones = bones.map(b => b.name);
    window.__snap = snap;
    window.__stages = {};
    const mixer = f.model.userData.humanMixer;
    if (mixer) {
      const original = mixer.update.bind(mixer);
      mixer.update = dt => {
        window.__stages.A = snap();
        original(dt);
        window.__stages.B = snap();
      };
    }
    skinned.onBeforeRender = () => { window.__stages.D = snap(); };
    const named = ['torso', 'pelvis', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg'];
    const mapping = {};
    for (const key of named) {
      const node = f.model.userData[key];
      mapping[key] = node ? { inSkeleton: bones.includes(node), name: node.name || null } : null;
    }
    return {
      ok: true,
      bones: bones.length,
      boneNames: window.__bones.slice(0, 26),
      hasMixer: Boolean(mixer),
      hasController: Boolean(f.model.userData.animationController),
      mapping
    };
  });
  console.log('WIRING', JSON.stringify(wiring, null, 1));

  const moves = [
    ['light1', 'melee'], ['light3', 'melee'], ['heavy', 'heavy'],
    ['heavyLauncher', 'heavy'], ['heavySlam', 'slam']
  ];
  const results = [];
  for (const [id, kind] of moves) {
    await page.evaluate(({ id, kind }) => {
      const f = window.fighters[0];
      window.__stages = {};
      f.attackQueue.length = 0;
      f.comboStep = Number(String(id).replace('light', '')) || 1;
      f.attackQueue.push({ id, kind, t: .14, total: .4, damage: 10, hit: false, active: 0 });
      // Everything below happens in one evaluation, so the two snapshots bracket only the authored
      // layer - no frame can slip between them.
      const before = window.__snap();
      const applied = window.__browserSmashAttackTick();
      const after = window.__snap();
      const reports = window.__browserSmashAttackMotion();
      window.__stages.C = after;
      window.__stages.tick = {
        applied,
        queue: f.attackQueue.length,
        first: f.attackQueue[0] ? { id: f.attackQueue[0].id, kind: f.attackQueue[0].kind, t: f.attackQueue[0].t, total: f.attackQueue[0].total } : null,
        p1: reports?.p1 || null,
        p2: reports?.p2 || null,
        changed: (() => {
          let worst = 0, bone = null;
          for (let i = 0; i < before.length; i++) {
            const d = Math.max(
              ...before[i].q.map((v, k) => Math.abs(v - after[i].q[k])),
              ...before[i].p.map((v, k) => Math.abs(v - after[i].p[k]))
            );
            if (d > worst) { worst = d; bone = window.__bones[i]; }
          }
          return { max: +worst.toFixed(4), bone };
        })()
      };
    }, { id, kind });
    await page.evaluate(async () => { for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r)); });
    const stages = await page.evaluate(() => {
      const s = window.__stages;
      const bones = window.__bones;
      const diff = (x, y) => {
        if (!x || !y) return null;
        let worst = 0, bone = null, axis = null;
        const named = {};
        for (let i = 0; i < x.length; i++) {
          const dq = Math.max(...x[i].q.map((v, k) => Math.abs(v - y[i].q[k])));
          const dp = Math.max(...x[i].p.map((v, k) => Math.abs(v - y[i].p[k])));
          if (dq > worst) { worst = dq; bone = bones[i]; axis = 'quat'; }
          if (dp > worst) { worst = dp; bone = bones[i]; axis = 'pos'; }
        }
        for (const entry of window.__named) {
          if (entry.index < 0) continue;
          const dq = Math.max(...x[entry.index].q.map((v, k) => Math.abs(v - y[entry.index].q[k])));
          const dp = Math.max(...x[entry.index].p.map((v, k) => Math.abs(v - y[entry.index].p[k])));
          named[entry.name] = { quat: +dq.toFixed(4), pos: +dp.toFixed(4) };
        }
        return { max: +worst.toFixed(4), bone, axis, named };
      };
      return {
        tick: s.tick || null,
        A_B: diff(s.A, s.B), B_C: diff(s.B, s.C), C_D: diff(s.C, s.D), A_D: diff(s.A, s.D),
        C_named: (s.B && s.C) ? diff(s.B, s.C).named : null
      };
    });
    results.push({ move: id, kind, ...stages });
    console.log(id.padEnd(13), JSON.stringify({
      applied: stages.tick?.applied, changed: stages.tick?.changed, atRest: stages.tick?.p1?.pose === null,
      A_B: stages.A_B, B_C: stages.B_C, C_D: stages.C_D, namedAfterLayer: stages.C_named
    }));
  }

  await page.evaluate(() => { window.fighters[0].attackQueue.length = 0; window.__browserSmashAttackTick(); });
  await page.evaluate(async () => { for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r)); });
  const rest = await page.evaluate(() => {
    const s = window.__stages;
    if (!s.A || !s.D) return null;
    let worst = 0;
    for (let i = 0; i < s.A.length; i++) {
      worst = Math.max(worst,
        ...s.A[i].q.map((v, k) => Math.abs(v - s.D[i].q[k])),
        ...s.A[i].p.map((v, k) => Math.abs(v - s.D[i].p[k])));
    }
    return +worst.toFixed(4);
  });
  console.log('REST A-D', JSON.stringify(rest));

  await page.screenshot({ path: `${out}/pose-probe.png` });
  await writeFile(`${out}/pose-pipeline.json`, JSON.stringify({ wiring, results, rest, errors, generatedAt: new Date().toISOString() }, null, 2));
  console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
  console.log('wrote', `${out}/pose-pipeline.json`);
} finally {
  await browser?.close();
  server.close();
}
