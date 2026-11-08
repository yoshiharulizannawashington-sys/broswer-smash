// Trace the live Goku_Jab action end to end: which clip it holds, where that clip came from, and how
// every PropertyBinding resolved against the mounted skeleton. All data goes out as one JSON line
// prefixed TRACE so the caller parses it instead of reading prose logs.
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));

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
  return Boolean(u.importedStrikeSet && u.importedStrikeActions && u.idleAction);
}, null, { timeout: 90000, polling: 250 });

const trace = await page.evaluate(async () => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const rootModel = f.model;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const step = () => window.__browserSmashStep(1 / 60);
  const hand = u.rightHand || u.leftHand;
  const pos = () => { const v = hand.getWorldPosition(hand.position.clone()); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
  const pathOf = o => { const p = []; let n = o; while (n && n !== rootModel) { p.unshift(n.name || n.type); n = n.parent; } return p.join('/'); };

  const beforeAt = u.lastAuthoredStrike?.at ?? -1;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
  step(); await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));

  let action = null;
  for (let i = 0; i < 34; i += 1) {
    step(); await frame();
    const strike = u.lastAuthoredStrike;
    if (strike && strike.at !== beforeAt && u.authoredStrikeAction?.isRunning?.()) { action = u.authoredStrikeAction; break; }
  }
  if (!action) action = u.authoredStrikeAction;
  if (!action) return { error: 'no live jab action', last: u.lastAuthoredStrike || null, currentClip: u.currentClip || null };

  const clip = action.getClip();
  const bindings = action._propertyBindings || [];
  const tracks = clip.tracks.map((t, i) => {
    const mixerBinding = bindings[i] || null;
    const b = mixerBinding?.binding || mixerBinding || null;
    const node = b?.node || null;
    const parsed = b?.parsedPath || null;
    return {
      name: t.name,
      ctor: t.constructor?.name,
      times: t.times?.length,
      values: t.values?.length,
      parsed: parsed ? { nodeName: parsed.nodeName, objectName: parsed.objectName, propertyName: parsed.propertyName } : null,
      boundNode: node ? node.name : null,
      boundNodeUuid: node ? node.uuid : null,
      boundPath: node ? pathOf(node) : null,
      propertyExists: node && parsed ? parsed.propertyName in node : null
    };
  });

  const start = pos();
  let maxDelta = 0;
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    step(); await frame();
    const p = pos();
    maxDelta = Math.max(maxDelta, Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]));
    samples.push({ t: +action.time.toFixed(3), w: +action.getEffectiveWeight().toFixed(2), p });
  }

  const imported = u.importedStrikeActions?.light || null;
  const cacheAction = u.animationActions?.['goku_jab'] || null;
  return {
    clip: { name: clip.name, uuid: clip.uuid, duration: +clip.duration.toFixed(3), tracks: clip.tracks.length },
    action: { running: action.isRunning(), weight: +action.getEffectiveWeight().toFixed(2), time: +action.time.toFixed(3), loop: action.loop, clamp: action.clampWhenFinished, mixerIsHumanMixer: action._mixer === u.humanMixer },
    mixer: { rootName: action._mixer.getRoot()?.name, rootUuid: action._mixer.getRoot()?.uuid, modelUuid: rootModel.uuid, rootIsModel: action._mixer.getRoot() === rootModel },
    identity: {
      sameClipAsImportedStrike: Boolean(imported && imported.getClip() === clip),
      cacheActionClip: cacheAction ? cacheAction.getClip().name : null,
      cacheSameClip: Boolean(cacheAction && cacheAction.getClip() === clip),
      cacheKeys: Object.keys(u.animationActions || {}).filter(k => /jab|light/.test(k))
    },
    hand: { bone: hand?.name || null, start, maxDelta: +maxDelta.toFixed(4), samples },
    bound: tracks.filter(t => t.boundNode).length,
    nulls: tracks.filter(t => !t.boundNode).length,
    tracks,
    strike: u.lastAuthoredStrike ? { slot: u.lastAuthoredStrike.slot, clip: u.lastAuthoredStrike.clip, id: u.lastAuthoredStrike.id } : null
  };
});

console.log('TRACE ' + JSON.stringify({ trace, errors }));
await browser.close();
server.close();
process.exit(0);
