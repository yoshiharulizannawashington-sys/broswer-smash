import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
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
const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => { window.__browserSmashSelect?.select?.('p1', 'Goku'); window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki'); window.__browserSmashTrainingDummy = true; window.__browserSmashFreezeAI = true; });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
try {
  await page.waitForFunction(() => { const f = (window.fighters || []).find(x => /goku/i.test(x.identity || '')); const u = f?.model?.userData; return !!(u && Object.keys(u.animationActions || {}).length); }, null, { timeout: 60000, polling: 250 });
} catch { console.log('WAIT_TIMEOUT'); }

const data = await page.evaluate(() => {
  const f = (window.fighters || []).find(x => /goku/i.test(x.identity || '') && x.model?.userData?.animationActions) || (window.fighters || []).find(x => /goku/i.test(x.identity || '')) || window.fighters[0];
  const u = f.model.userData;
  const actions = u.animationActions || {};
  const clipOf = a => { try { const c = a.getClip(); return { name: c.name, duration: c.duration, tracks: c.tracks.map(t => ({ name: t.name, type: t.constructor.name, times: t.times.length, values: t.values.length })) }; } catch { return null; } };
  const jab = actions['goku_jab'] ? clipOf(actions['goku_jab']) : null;
  const inventory = {};
  for (const [k, a] of Object.entries(actions)) { const c = clipOf(a); inventory[k] = c ? { clip: c.name, tracks: c.tracks.length } : null; }
  const bones = [];
  f.model.traverse(o => { if (o.isBone) bones.push({ name: o.name, parent: o.parent?.name || null, children: (o.children || []).filter(c => c.isBone).map(c => c.name) }); });
  const wrappers = [];
  f.model.traverse(o => { if (!o.isBone && o.name) wrappers.push({ name: o.name, type: o.type, parent: o.parent?.name || null }); });
  const skinned = [];
  f.model.traverse(o => { if (o.isSkinnedMesh) skinned.push({ name: o.name, bones: o.skeleton?.bones?.map(b => b.name), rootBone: o.skeleton?.bones?.[0]?.name }); });
  const probes = {};
  for (const key of ['importedStrikeActions', 'bakedAuthoredActions', 'importedStrikeSet', 'importedSpecialAction', 'authoredStrikeAction']) {
    const v = u[key]; if (!v) continue;
    let list;
    if (v instanceof Map) list = [...v.entries()];
    else if (Array.isArray(v)) list = v.map((a, i) => [String(i), a]);
    else if (v.isAnimationAction) list = [['action', v]];
    else list = Object.entries(v);
    probes[key] = list.slice(0, 8).map(([k, a]) => {
      const mr = a?._mixer?.getRoot?.() || null;
      let nulls = 0, total = 0;
      for (const pb of (a?._propertyBindings || [])) { total++; if (!pb.node) nulls++; }
      return { k, clip: a?.getClip?.()?.name, total: (a?.getClip?.()?.tracks || []).length,
        mixerRootUuid: mr?.uuid || null, mixerRootName: mr?.name || null, mixerIsModel: mr === f.model,
        bindings: total, nullBindings: nulls, tracks: (a?.getClip?.()?.tracks || []).map(t => t.name) };
    });
  }
  return {
    identity: f.identity, modelName: f.model.name, modelUuid: f.model.uuid,
    mixerRoot: u.humanMixer?.getRoot?.()?.uuid, mixerIsModel: u.humanMixer?.getRoot?.() === f.model,
    actionKeys: Object.keys(actions), inventory, jab, bones, wrappers, skinned,
    probes, authoredStrike: !!u.authoredStrikeAction, currentClip: u.currentClip
  };
});

data.bindTest = await page.evaluate(async () => {
  const f = (window.fighters || []).find(x => /goku/i.test(x.identity || ''));
  const u = f?.model?.userData;
  if (!u) return { error: 'no goku userData' };
  const collect = v => v instanceof Map ? [...v.values()] : (v && typeof v === 'object' ? Object.values(v) : []);
  const findJab = () => {
    for (const pool of [u.importedStrikeActions, u.bakedAuthoredActions, u.animationActions, u.authoredStrikeAction]) {
      for (const v of collect(pool)) {
        const act = v?.getClip ? v : v?.action;
        if (act?.getClip?.().name === 'Goku_Jab') return act;
      }
    }
    return null;
  };
  let a = findJab();
  for (let i = 0; i < 200 && !a; i++) { await new Promise(r => setTimeout(r, 100)); a = findJab(); }
  if (!a) return { error: 'no jab action', pools: { strike: typeof u.importedStrikeActions, baked: typeof u.bakedAuthoredActions, cache: Object.keys(u.animationActions || {}).length, keys: Object.keys(u).filter(k => /strike|action/i.test(k)) } };
  const nodeOf = pb => !!(pb?.binding ? pb.binding.node : pb?.node);
  const before = (a._propertyBindings || []).map(nodeOf);
  a.reset().setEffectiveWeight(1).play();
  const mixer = a._mixer;
  const hand = u.rightHand || u.leftHand || null;
  const pos = () => { const v = hand.getWorldPosition(hand.position.clone()); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
  const samples = [];
  for (let i = 0; i < 12; i++) { mixer.update(0.033); samples.push({ t: +a.time.toFixed(3), pos: pos() }); }
  const after = (a._propertyBindings || []).map(nodeOf);
  const d = Math.hypot(samples[0].pos[0] - samples[11].pos[0], samples[0].pos[1] - samples[11].pos[1], samples[0].pos[2] - samples[11].pos[2]);
  const p0 = (a._propertyBindings || [])[0] || null;
  const b0 = p0?.binding || p0;
  const diag = {
    track0: a.getClip().tracks[0]?.name,
    parsed: b0?.parsedPath ? { nodeName: b0.parsedPath.nodeName, objectName: b0.parsedPath.objectName, propertyName: b0.parsedPath.propertyName } : null,
    bindingPath: b0?.path ?? null,
    boundNode: b0?.node?.name ?? null,
    foundHips: !!f.model.getObjectByName('Hips'),
    foundSpine: !!f.model.getObjectByName('Spine'),
    rootName: a._mixer.getRoot()?.name,
    rootIsModel: a._mixer.getRoot() === f.model,
    humanMixerIsActionMixer: a._mixer === u.humanMixer
  };
  return { clip: a.getClip().name, hand: hand?.name, total: before.length, beforeOk: before.filter(Boolean).length,
    afterOk: after.filter(Boolean).length, nulls: after.filter(v => !v).length, handDelta: +d.toFixed(4), start: samples[0], end: samples[11], diag };
});

data.errors = errors;
await writeFile('artifacts/goku-retarget/source-track-inventory.json', JSON.stringify(data, null, 2));
console.log('IDENTITY', data.identity, 'MIXER_IS_MODEL', data.mixerIsModel, 'AUTHORED', data.authoredStrike);
console.log('PROBES', JSON.stringify(data.probes));
console.log('BINDTEST', JSON.stringify(data.bindTest && { clip: data.bindTest.clip, hand: data.bindTest.hand, total: data.bindTest.total, beforeOk: data.bindTest.beforeOk, afterOk: data.bindTest.afterOk, nulls: data.bindTest.nulls, handDelta: data.bindTest.handDelta, error: data.bindTest.error, pools: data.bindTest.pools, diag: data.bindTest.diag }));
console.log('SAMPLES', JSON.stringify((data.bindTest?.samples || []).slice(0, 4)));
console.log('JAB_TRACKS', JSON.stringify((data.jab?.tracks || []).map(t => t.name)));
console.log('ACTION_KEYS', JSON.stringify(data.actionKeys));
console.log('BONES', data.bones.length, JSON.stringify(data.bones.slice(0, 12)));
console.log('SKINNED', JSON.stringify(data.skinned));
console.log('ERRORS', JSON.stringify(errors));
await browser.close(); server.close(); process.exit(0);
