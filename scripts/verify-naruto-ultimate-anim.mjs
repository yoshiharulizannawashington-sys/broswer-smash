// End-to-end check that a real O press dispatches the ultimate AND animates the body.
//
// The runner (combat/ultimate.js) sets `casting:'ultimate'` for the move's lifetime and clears it in
// endRecord. The prefab body now hangs the authored `ultimate` clip on that same lifetime, so this
// probe records: the gate at an empty meter, the dispatch at a full one, the clip actually running,
// bone movement on real rig bones, damage dealt, and the return to idle afterwards.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/naruto-ultimate-anim';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__browserSmashFreezeAI = true;
  const a = window.fighters[0], b = window.fighters[1];
  a.position.set(0, 0, 0); b.position.set(3.2, 0, 0);
  a.velocity?.set?.(0, 0, 0); b.velocity?.set?.(0, 0, 0);
  const THREE = window.__browserSmashThree;
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
  window.__ultDraw = async (frames, opts = {}) => {
    const f = window.fighters[0], u = f.model.userData, b = window.fighters[1];
    const bones = [];
    f.model.traverse(o => {
      if (o.isBone && /spine|chest|arm|forearm|hand|leg|shin|head|pelvis|hip|shoulder|neck/i.test(o.name || '') && !/weapon/i.test(o.name || '')) bones.push(o);
    });
    const rows = [];
    let shot = null, shotProg = null;
    for (let i = 0; i < frames; i++) {
      if (opts.camera) window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: window.__frontYaw + 30, pitch: 4, distance: 3.0 });
      await new Promise(r => requestAnimationFrame(r));
      const q = {};
      for (const bone of bones) q[bone.name] = bone.quaternion.toArray();
      const action = u.authoredUltimateAction;
      const prog = action ? action.time / Math.max(1e-4, action.getClip().duration) : 0;
      rows.push({
        casting: f.casting || null,
        clip: u.currentClip || null,
        ultClip: action && action.isRunning() ? action.getClip().name : null,
        ultWeight: action ? +action.getEffectiveWeight().toFixed(2) : 0,
        last: u.lastUltimateAnimation || null,
        equip: u.equipmentState?.state || null,
        thorPercent: b.percent ?? null,
        q
      });
      if (!shot && action && action.isRunning() && action.getEffectiveWeight() > 0.3 && prog > 0.2) {
        shot = document.querySelector('canvas').toDataURL('image/png');
        shotProg = +prog.toFixed(2);
      }
    }
    return { rows, bones: bones.map(x => x.name), shot, shotProg };
  };
});
await page.locator('canvas').first().click({ position: { x: 340, y: 230 }, force: true });

const angle = (a, b) => {
  if (!a || !b) return 0;
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += a[i] * b[i];
  return +(2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI).toFixed(1);
};

const gate = await page.evaluate(async () => {
  const m = await import('/js/combat/ultimate.js');
  const f = window.fighters[0];
  f.casting = null; f.hitstun = 0; f.attackQueue.length = 0; f.meter = 0;
  const atZero = m.canUltimate(f);
  return { max: m.ULTIMATE.max, atZero, refusal: m.ULTIMATE_REFUSAL['not-ready'] };
});

// Empty meter: a real press must refuse and animate nothing.
await page.keyboard.press('o');
const emptyPress = await page.evaluate(() => window.__ultDraw(4, {}));

// Full meter: a real press must dispatch and animate the authored ultimate.
const before = await page.evaluate(() => ({ percent: window.fighters[1].percent ?? 0, meter: window.fighters[0].meter }));
await page.evaluate(() => { const f = window.fighters[0]; f.meter = 100; f.casting = null; f.attackQueue.length = 0; f.hitstun = 0; });
await page.keyboard.press('o');
const dispatch = await page.evaluate(() => window.__ultDraw(12, { camera: true }));
const after = await page.evaluate(() => ({ percent: window.fighters[1].percent ?? 0, meter: window.fighters[0].meter, casting: window.fighters[0].casting || null }));
// Recovery is the record's own lifetime, which outlasts a short sample at this frame delta: poll
// until `casting` clears (bounded) so the return to idle is observed rather than assumed.
const recoveryPoll = await page.evaluate(async () => {
  const f = window.fighters[0], u = f.model.userData;
  const rows = [];
  for (let i = 0; i < 30; i++) {
    await new Promise(r => requestAnimationFrame(r));
    rows.push({ casting: f.casting || null, clip: u.currentClip || null, ult: u.authoredUltimateAction ? u.authoredUltimateAction.getClip().name : null });
    if (!f.casting && i > 1) break;
  }
  return rows;
});
const recovery = { rows: recoveryPoll };

const rest = dispatch.rows[0]?.q || {};
let top = { bone: null, deg: 0 };
for (const boneName of dispatch.bones) {
  let max = 0;
  for (const row of dispatch.rows) max = Math.max(max, angle(rest[boneName], row.q?.[boneName]));
  if (max > top.deg) top = { bone: boneName, deg: max };
}
let file = null;
if (dispatch.shot && dispatch.shot.length > 5000) {
  file = `${out}/ultimate-pose.png`;
  await writeFile(file, Buffer.from(dispatch.shot.split(',')[1], 'base64'));
}
const report = {
  gate,
  emptyPress: {
    casting: emptyPress.rows.map(r => r.casting).filter(Boolean),
    clips: emptyPress.rows.map(r => r.ultClip).filter(Boolean)
  },
  dispatch: {
    casting: dispatch.rows.map(r => r.casting).filter(Boolean),
    currentClips: [...new Set(dispatch.rows.map(r => r.clip).filter(Boolean))],
    ultClips: [...new Set(dispatch.rows.map(r => r.ultClip).filter(Boolean))],
    maxWeight: Math.max(0, ...dispatch.rows.map(r => r.ultWeight)),
    last: dispatch.rows.map(r => r.last).filter(Boolean).pop() || null,
    topBone: top,
    bonesSampled: dispatch.bones.length,
    thorPercentDelta: +((after.percent || 0) - (before.percent || 0)).toFixed(1),
    meterAfter: after.meter,
    equip: [...new Set(dispatch.rows.map(r => r.equip).filter(Boolean))],
    poseAt: dispatch.shotProg ?? null,
    file
  },
  recovery: {
    frames: recovery.rows.length,
    casting: [...new Set(recovery.rows.map(r => r.casting).filter(Boolean))],
    finalClip: recovery.rows.map(r => r.clip).filter(Boolean).pop() || null,
    finalUlt: recovery.rows.map(r => r.ult).filter(Boolean).pop() || null
  },
  errors
};
await writeFile(`${out}/naruto-ultimate-anim.json`, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
console.log('ULTANIM', JSON.stringify(report));
await browser.close(); server.close();
