import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
// Wait for the authored 46-clip GLB to land on the mounted body. Pressing J while the body is
// still remounting loses the input and samples the generic 1-action idle mixer.
await page.waitForFunction(() => {
  const u = (window.fighters || []).find(x => /goku/i.test(x.identity || x.type || ''))?.model?.userData || {};
  return Object.keys(u.animationActions || {}).length > 20
    || Object.values(u.animationActions || {}).some(a => /jab/i.test(a?.getClip?.()?.name || ''));
}, null, { timeout: 60000, polling: 200 });
await page.waitForTimeout(300);
const snap = (steps = 0) => page.evaluate((advance) => {
  for (let i = 0; i < advance; i += 1) window.__browserSmashStep(1 / 60);
  const f = (window.fighters || []).find(x => /goku/i.test(x.identity || x.type || '')) || window.fighters[0];
  const u = f?.model?.userData || {};
  const mixers = [];
  for (const k of Object.keys(u)) {
    const v = u[k];
    if (v && typeof v === 'object' && v._actions && v.getRoot) mixers.push({ key: k, rootUuid: v.getRoot()?.uuid, rootName: v.getRoot()?.name, time: +v.time.toFixed(3), actions: v._actions.length });
  }
  const m = mixers.length ? u[mixers[0].key] : null;
  const rootObj = m?.getRoot?.() || null;
  let ancestor = false;
  for (let p = f?.model; p; p = p.parent) if (p === rootObj) ancestor = true;
  const act = u.authoredStrikeAction || u.lastMoveAction || null;
  let binds = null;
  if (act?._propertyBindings) {
    binds = { total: act._propertyBindings.length, nullNodes: 0, foreign: 0, sampleFailed: [] };
    for (const pb of act._propertyBindings) {
      const n = pb.node;
      if (!n) { binds.nullNodes++; if (binds.sampleFailed.length < 4) binds.sampleFailed.push((pb.parsedPath?.path || '?') + ' [null]'); continue; }
      let inModel = false;
      for (let p = n; p; p = p.parent) if (p === f.model) { inModel = true; break; }
      if (!inModel) { binds.foreign++; if (binds.sampleFailed.length < 4) binds.sampleFailed.push((pb.parsedPath?.path || '?') + ' [foreign ' + (n.name || n.type) + ']'); }
    }
  }
  const clipTracks=((u.authoredStrikeAction||u.lastMoveAction)?.getClip?.()?.tracks||[]).slice(0,8).map(t=>t.name);
  const bonesSample=[];f.model.traverse(o=>{if(o.isBone&&bonesSample.length<8)bonesSample.push(o.name)});
  const bones = {};
  for (const role of ['spine', 'rightArm', 'rightFore', 'rightHand', 'leftArm', 'leftFore', 'leftHand']) {
    const b = u[role];
    if (!b) continue;
    const w = b.getWorldPosition(b.position.clone());
    bones[role] = { local: [+b.quaternion.x.toFixed(4), +b.quaternion.y.toFixed(4), +b.quaternion.z.toFixed(4), +b.quaternion.w.toFixed(4)], worldPos: [+w.x.toFixed(4), +w.y.toFixed(4), +w.z.toFixed(4)] };
  }
  return {
    modelUuid: f?.model?.uuid, modelName: f?.model?.name, modelChildren: f?.model?.children?.length,
    mixerCount: mixers.length, mixers, ancestorOfModel: ancestor, mixerRootIsModel: rootObj === f?.model,
    userDataKeys: Object.keys(u).filter(k => /mix|action|clip|strike/i.test(k)),
    action: act ? { clip: act.getClip?.().name, weight: +act.getEffectiveWeight().toFixed(3), running: act.isRunning(), time: +act.time.toFixed(3) } : null,
    trackSample: act?.getClip?.()?.tracks?.slice(0,6).map(t=>t.name), binds, bones, mixerTime: m ? +m.time.toFixed(3) : null, clipTracks, bonesSample, currentClip: u.currentClip,
    strike: u.lastAuthoredStrike || null, strikeTime: +(u.authoredStrikeTime || 0).toFixed(3), queue: (f.attackQueue || []).length
  };
}, steps);
// Drive the attack on fixed simulation ticks. Real-time waits sample before SwiftShader renders a
// frame, so the old probe never advanced past idle and then compared idle to itself.
const out = { idle: await snap(0) };
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true })));
out.jabStart = await snap(2);
out.jabContact = await snap(4);
out.follow = await snap(8);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true })));
out.recovery = await snap(20);
out.errors = errors;
const d = (a, b) => { const x = a.bones?.rightHand?.worldPos, y = b.bones?.rightHand?.worldPos, q = a.bones?.rightHand?.local, r = b.bones?.rightHand?.local; return x && y ? { handDelta: +Math.hypot(y[0]-x[0], y[1]-x[1], y[2]-x[2]).toFixed(4), quatDelta: +Math.hypot(r[0]-q[0], r[1]-q[1], r[2]-q[2], r[3]-q[3]).toFixed(4) } : null; };
out.deltas = { idleToContact: d(out.idle, out.jabContact), startToContact: d(out.jabStart, out.jabContact), contactToFollow: d(out.jabContact, out.follow) };
console.log(JSON.stringify(out));
await browser.close(); server.close();
