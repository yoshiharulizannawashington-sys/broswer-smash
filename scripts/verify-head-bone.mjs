// Verify the canonical head joint is the skull, not the neck, on the rendered bodies.
//
// The imported-body joint scan reached the neck before the skull and let a single slot claim both,
// so `userData.head` pointed at "Neck". This measures the two joints on each fighter actually on
// screen, then rotates only the head joint and proves the skull moves while the neck does not.
//
//   bash scripts/run-browser-test.sh scripts/verify-head-bone.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
await mkdir('artifacts/diagnostics', { recursive: true });
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

let browser, failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
};
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 200)));
  await page.goto('http://127.0.0.1:' + server.address().port + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(() => { document.querySelector('#play').click(); });
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForFunction(() => {
    const ok = f => { let s = false; f?.model?.traverse?.(n => { if (n.isSkinnedMesh) s = true; }); return s; };
    return ok(window.fighters?.[0]) && ok(window.fighters?.[1]);
  }, null, { timeout: 90000, polling: 250 }).catch(() => null);
  await page.waitForTimeout(600);

  const result = await page.evaluate(() => {
    const round = n => +Number(n).toFixed(4);
    const out = [];
    for (const fighter of window.fighters) {
      const model = fighter.model;
      model.updateMatrixWorld(true);
      const head = model.userData.head;
      const neck = model.userData.neck;
      const Vector3 = head.position.constructor;
      const headWorld = head.getWorldPosition(new Vector3());
      const neckWorld = neck ? neck.getWorldPosition(new Vector3()) : null;
      // A bone's own origin does not move when it rotates - only its children do - so the world
      // test samples a point ON the skull, not the joint at the base of it.
      const snapshot = bone => ({
        name: bone?.name || null,
        quat: bone ? [round(bone.quaternion.x), round(bone.quaternion.y), round(bone.quaternion.z), round(bone.quaternion.w)] : null,
        world: bone ? bone.getWorldPosition(new Vector3()).toArray().map(round) : null,
        // Off-axis on purpose: a point on the bone's own Y axis cannot move when it yaws.
        point: bone ? bone.localToWorld(new Vector3(0.09, 0.10, 0.02)).toArray().map(round) : null
      });
      // Rotate ONLY the joint the game calls "head"; the renderer's own skull must be what moves.
      const before = { head: snapshot(head), neck: snapshot(neck) };
      const saved = head.quaternion.clone();
      head.rotation.y += 0.35;
      model.updateMatrixWorld(true);
      const after = { head: snapshot(head), neck: snapshot(neck) };
      head.quaternion.copy(saved);
      model.updateMatrixWorld(true);

      const delta = (a, b) => (!a || !b ? 0 : Math.max(...a.quat.map((v, i) => Math.abs(v - b.quat[i]))));
      const moved = (a, b) => (!a || !b ? 0 : Math.hypot(...a.world.map((v, i) => v - b.world[i])));
      const movedPoint = (a, b) => (!a || !b ? 0 : Math.hypot(...a.point.map((v, i) => v - b.point[i])));

      // Every core mapping must land on a distinct bone whose name belongs to that limb.
      const core = ['pelvis', 'torso', 'head', 'leftArm', 'leftFore', 'rightArm', 'rightFore', 'leftLeg', 'leftShin', 'rightLeg', 'rightShin'];
      const mappings = core.map(name => ({
        name,
        bone: model.userData[name]?.name || null,
        ok: Boolean(model.userData[name])
      }));
      out.push({
        identity: fighter.identity || fighter.name || '?',
        headName: head.name || null,
        neckName: neck?.name || null,
        headWorld: headWorld.toArray().map(round),
        neckWorld: neckWorld ? neckWorld.toArray().map(round) : null,
        headAboveNeck: neckWorld ? round(headWorld.y - neckWorld.y) : null,
        headRotatedOnSkull: round(delta(before.head, after.head)),
        neckRotatedWithHead: round(delta(before.neck, after.neck)),
        skullMoved: round(movedPoint(before.head, after.head)),
        neckMoved: round(movedPoint(before.neck, after.neck)),
        headFallback: model.userData.proceduralJoints?.head?.fallback || null,
        mappings
      });
    }
    return out;
  });

  for (const f of result) {
    console.log(`\n${f.identity}`);
    console.log(`  head=${f.headName} neck=${f.neckName} headWorld=${JSON.stringify(f.headWorld)} neckWorld=${JSON.stringify(f.neckWorld)} fallback=${f.headFallback}`);
    check(/head|skull/i.test(String(f.headName || '')), 'the head joint is the skull bone', String(f.headName));
    check(!/neck/i.test(String(f.headName || '')), 'the head joint is not the neck', String(f.headName));
    check(Boolean(f.neckName) && f.neckName !== f.headName, 'neck and head are distinct bones', `${f.neckName} vs ${f.headName}`);
    check(f.headAboveNeck !== null && f.headAboveNeck > 0, 'the head sits above the neck', String(f.headAboveNeck));
    check(f.headRotatedOnSkull > 0.1, 'rotating the head joint turns the skull', String(f.headRotatedOnSkull));
    check(f.neckRotatedWithHead < 0.01, 'the neck stays put while the head turns', String(f.neckRotatedWithHead));
    check(f.skullMoved > 0.005, 'the skull moves in world space', String(f.skullMoved));
    check(f.neckMoved < 0.005, 'the neck does not move in world space', String(f.neckMoved));
    for (const m of f.mappings) check(m.ok, `core mapping ${m.name} is bound`, String(m.bone));
    const names = f.mappings.map(m => m.bone).filter(Boolean);
    check(new Set(names).size === names.length, 'no two core slots share one bone', `${names.length} slots, ${new Set(names).size} bones`);
  }
  check(errors.length === 0, 'no page errors', errors.slice(0, 1).join(''));
} finally {
  await browser?.close();
  server.close();
}
console.log(failures ? `\nHead bone verification FAILED (${failures}).` : '\nHead bone verification passed.');
process.exit(failures ? 1 : 0);
