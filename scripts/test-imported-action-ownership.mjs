// Regression test for imported strike-action ownership.
//
// Plants a real Goku_Jab action on a foreign Object3D mixer inside importedStrikeActions, then runs
// the mounted-model repair. Asserts the state machine ends up with an action owned by the mounted
// model's mixer, all 20 tracks bound, no _cacheIndex errors, and repeated repairs reusing one action.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    let rel = normalize(decodeURIComponent(new URL(req.url || '/', 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
    if (!(rel === 'public' || rel.startsWith('public' + sep))) rel = 'public' + sep + rel;
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(resolve(root, rel)));
  } catch { if (!res.headersSent) res.writeHead(404); res.end('nf'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e)));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  if (!ok) failures += 1;
};

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashFreezeAI = true;
});
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 30000, polling: 200 });
await page.waitForFunction(() => {
  const u = window.fighters?.[0]?.model?.userData || {};
  return Boolean(u.importedReactionSet && u.importedStrikeSet && u.idleAction && u.importedStrikeActions);
}, null, { timeout: 90000, polling: 250 });

const setup = await page.evaluate(() => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const Mixer = u.humanMixer.constructor;
  const Root = f.model.constructor;
  const badRoot = new Root();
  badRoot.name = 'stale-template-root';
  const badMixer = new Mixer(badRoot);
  const coll = u.importedStrikeActions;
  const read = k => (coll instanceof Map ? coll.get(k) : coll[k]);
  const write = (k, v) => { if (coll instanceof Map) coll.set(k, v); else coll[k] = v; };
  const clip = read('light').getClip();
  const stale = badMixer.clipAction(clip);
  write('light', stale);
  const baked = u.bakedAuthoredActions || null;
  let staleBaked = null;
  if (baked) {
    const bClip = baked.light?.getClip?.() || clip;
    staleBaked = badMixer.clipAction(bClip);
    baked.light = staleBaked;
  }
  return {
    clip: clip.name, tracks: clip.tracks.length, collectionIsMap: coll instanceof Map,
    staleIsForeign: stale._mixer.getRoot() === badRoot,
    staleUuid: stale._mixer.getRoot().uuid, modelUuid: f.model.uuid,
    bakedPlanted: Boolean(staleBaked)
  };
});
check('the planted jab action belongs to a foreign root', setup.staleIsForeign, JSON.stringify(setup));

const before = await page.evaluate(() => {
  const u = window.fighters[0].model.userData;
  const coll = u.importedStrikeActions;
  const a = coll instanceof Map ? coll.get('light') : coll.light;
  try { a.reset().play(); a._mixer.update(0.016); } catch (e) { return { threw: String(e.message || e) }; }
  const nodes = (a._propertyBindings || []).map(pb => !!(pb.binding ? pb.binding.node : pb.node));
  return { threw: null, bindings: nodes.length, bound: nodes.filter(Boolean).length, nulls: nodes.filter(v => !v).length };
});
check('the planted action cannot resolve the mounted bones', before.threw !== null || before.nulls > 0, JSON.stringify(before));

const after = await page.evaluate(async () => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const read = () => {
    const c = u.importedStrikeActions;
    return { coll: c, get: k => (c instanceof Map ? c.get(k) : c[k]) };
  };
  const stale = read().get('light');
  window.__browserSmashRepairMixer(f);
  const first = read().get('light');
  window.__browserSmashRepairMixer(f);
  const second = read().get('light');
  if (!second?.reset) return { brokenEntry: String(second), typeofEntry: typeof second };
  second.reset().play();
  u.humanMixer.update(0.016);
  const nodes = (second._propertyBindings || []).map(pb => !!(pb.binding ? pb.binding.node : pb.node));
  const baked = u.bakedAuthoredActions?.light || null;
  return {
    replaced: first !== stale && second !== stale,
    stableAcrossRepairs: first === second,
    clip: second.getClip().name,
    tracks: second.getClip().tracks.length,
    rootIsModel: second._mixer.getRoot() === f.model,
    usesHumanMixer: second._mixer === u.humanMixer,
    mixerRootUuid: second._mixer.getRoot().uuid,
    modelUuid: f.model.uuid,
    bindings: nodes.length,
    bound: nodes.filter(Boolean).length,
    nulls: nodes.filter(v => !v).length,
    bakedRehomed: baked ? baked._mixer === u.humanMixer : null,
    actionCount: u.humanMixer._actions?.length ?? null
  };
});
if (after.brokenEntry) {
  check('the replacement is an animation action', false, JSON.stringify(after));
} else {
  check('the stale action is no longer used', after.replaced, JSON.stringify({ replaced: after.replaced }));
  check('the replacement belongs to the mounted model mixer', after.rootIsModel && after.usesHumanMixer && after.mixerRootUuid === after.modelUuid, JSON.stringify({ root: after.mixerRootUuid, model: after.modelUuid }));
  check('the clip survives the repair', after.clip === setup.clip && after.tracks === setup.tracks, JSON.stringify({ clip: after.clip, tracks: after.tracks }));
  check('every jab track binds on the mounted skeleton', after.bindings === 20 && after.bound === 20 && after.nulls === 0, JSON.stringify({ bindings: after.bindings, bound: after.bound, nulls: after.nulls }));
  check('repeated repairs reuse one action instead of leaking mixers', after.stableAcrossRepairs, JSON.stringify({ stable: after.stableAcrossRepairs }));
  check('the baked authored collection is rehomed too', after.bakedRehomed !== false, JSON.stringify({ bakedRehomed: after.bakedRehomed, planted: setup.bakedPlanted }));
}
const cacheErrors = errors.filter(e => /_cacheIndex/.test(e));
check('no _cacheIndex errors after the repair', cacheErrors.length === 0, JSON.stringify(cacheErrors.slice(0, 2)));

await browser.close();
server.close();
console.log('SUMMARY', JSON.stringify({ failures, errors: errors.length, setup, before, after }));
process.exit(failures ? 1 : 0);
