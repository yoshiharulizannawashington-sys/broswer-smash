// Live verification of the strike-action rebind repair, performed on the match fighter itself.
//
// A broken action is planted on a foreign Object3D mixer inside the real importedStrikeActions and
// bakedAuthoredActions collections, the repair is run, and the same collections are measured again.
// The action is then selected by a real KeyJ press through the combat state machine, and the clip is
// held at five phases (neutral, startup, contact, follow-through, recovery) with the simulation
// paused, producing transforms and a screenshot for each.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
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
await mkdir('artifacts/goku-jab', { recursive: true });

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
  const model = window.fighters?.[0]?.model;
  const hasBones = Boolean(model?.getObjectByName('Hips') && model?.getObjectByName('RightHand'));
  return Boolean(hasBones && u.importedStrikeSet && u.importedStrikeActions && u.animationActions && u.idleAction);
}, null, { timeout: 90000, polling: 250 });

const result = await page.evaluate(async () => {
  const f = window.fighters[0];
  const u = f.model.userData;
  const model = f.model;
  const Mixer = u.humanMixer.constructor;
  const Root = model.constructor;
  const coll = u.importedStrikeActions;
  const get = k => (coll instanceof Map ? coll.get(k) : coll[k]);
  const set = (k, v) => { if (coll instanceof Map) coll.set(k, v); else coll[k] = v; };
  const bindState = a => {
    const list = (a?._propertyBindings || []).map(pb => !!(pb?.binding ? pb.binding.node : pb?.node));
    return { bindings: list.length, resolved: list.filter(Boolean).length, unresolved: list.filter(v => !v).length };
  };

  const foreign = new Root();
  foreign.name = 'planted-foreign-root';
  const foreignMixer = new Mixer(foreign);
  const clip = get('light').getClip();
  const planted = foreignMixer.clipAction(clip);

  const before = {
    modelUuid: model.uuid,
    humanMixerRootUuid: u.humanMixer.getRoot()?.uuid,
    clipUuid: planted.getClip().uuid,
    actionRootUuid: planted._mixer.getRoot()?.uuid,
    rootIsModel: planted._mixer.getRoot() === model,
    clip: planted.getClip().name,
    tracks: planted.getClip().tracks.length
  };
  set('light', planted);
  set('light1', planted);
  if (u.bakedAuthoredActions) u.bakedAuthoredActions.light = foreignMixer.clipAction(clip);
  try { planted.reset().play(); foreignMixer.update(0.016); } catch (_error) {}
  Object.assign(before, bindState(planted));

  window.__browserSmashRepairMixer(f);
  const repaired = get('light');
  try { repaired.reset().play(); u.humanMixer.update(0.016); } catch (_error) {}
  const after = {
    modelUuid: model.uuid,
    humanMixerRootUuid: u.humanMixer.getRoot()?.uuid,
    actionRootUuid: repaired._mixer.getRoot()?.uuid,
    rootIsModel: repaired._mixer.getRoot() === model,
    mixerIsHumanMixer: repaired._mixer === u.humanMixer,
    clip: repaired.getClip().name,
    clipUuid: repaired.getClip().uuid,
    tracks: repaired.getClip().tracks.length,
    clipSameObject: repaired.getClip() === clip,
    bakedSameAsStrike: u.bakedAuthoredActions?.light === repaired,
    staleStillReferenced: {
      authoredStrike: u.authoredStrikeAction === planted,
      lastMove: u.lastMoveAction === planted,
      strikeCollection: Object.values(u.importedStrikeActions || {}).includes(planted),
      bakedCollection: Object.values(u.bakedAuthoredActions || {}).includes(planted),
      animationActions: Object.values(u.animationActions || {}).includes(planted),
      authoredStrikeIsRepaired: u.authoredStrikeAction === repaired
    }
  };
  Object.assign(after, bindState(repaired));

  const frame = () => new Promise(r => requestAnimationFrame(r));
  const foe = window.fighters[1];
  if (foe) { foe.position.set(f.position.x + (f.facing >= 0 ? 1.15 : -1.15), 0, f.position.z); foe.velocity?.set?.(0, 0, 0); }
  const beforeAt = u.lastAuthoredStrike?.at ?? -1;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', bubbles: true }));
  window.__browserSmashStep(1 / 60);
  await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', bubbles: true }));
  let selected = null;
  for (let i = 0; i < 34 && !selected; i += 1) {
    window.__browserSmashStep(1 / 60);
    await frame();
    const s = u.lastAuthoredStrike;
    if (s && s.at !== beforeAt) selected = { slot: s.slot, clip: s.clip, actionClip: u.authoredStrikeAction?.getClip?.().name || null };
  }
  const selectedAction = u.authoredStrikeAction;
  const selection = {
    selected,
    captured: Boolean(selected),
    failure: selected ? null : 'combat state machine never selected an authored strike within 34 steps',
    selectedIsRepairedAction: selectedAction === repaired,
    selectedIsPlantedAction: selectedAction === planted,
    weight: selectedAction ? +selectedAction.getEffectiveWeight().toFixed(2) : null,
    running: selectedAction ? selectedAction.isRunning() : null
  };

  return { before, after, selection };
});

const phases = [['neutral', 0], ['startup', 0.043], ['contact', 0.128], ['follow', 0.17], ['recovery', 0.34]];
const phaseData = {};
for (const [name, time] of phases) {
  phaseData[name] = await page.evaluate(t => {
    const f = window.fighters[0];
    const u = f.model.userData;
    const a = u.importedStrikeActions.light;
    window.smashCamera?.spectate?.({ fighter: f, framing: 'torso', yaw: (window.__frontYaw || 0) + 30, pitch: 4, distance: 2.7 });
    try { window.__browserSmashPause?.open?.(); } catch (_error) {}
    for (const el of document.querySelectorAll('#pause,#pauseMenu,[data-role="pause"]')) el.style.display = 'none';
    a.reset(); a.setEffectiveWeight(1); a.play(); a.time = t; a.paused = true;
    for (const act of Object.values(u.animationActions || {})) { if (act !== a && act?.setEffectiveWeight) act.setEffectiveWeight(0); }
    u.humanMixer.update(0);
    const hand = u.rightHand;
    const arm = u.rightArm || f.model.getObjectByName('RightArm');
    const wp = hand.getWorldPosition(hand.position.clone());
    const wq = hand.getWorldQuaternion(hand.quaternion.clone());
    return {
      time: +a.time.toFixed(3), paused: Boolean(window.__browserSmashPause?.paused),
      weight: +a.getEffectiveWeight().toFixed(2),
      handWorld: [+wp.x.toFixed(4), +wp.y.toFixed(4), +wp.z.toFixed(4)],
      handWorldQuat: wq.toArray().map(v => +v.toFixed(3)),
      handLocalPos: hand.position.toArray().map(v => +v.toFixed(4)),
      handLocalQuat: hand.quaternion.toArray().map(v => +v.toFixed(3)),
      armWorldQuat: (arm ? arm.getWorldQuaternion(arm.quaternion.clone()).toArray() : []).map(v => +v.toFixed(3))
    };
  }, time);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `artifacts/goku-jab/${name}.png` });
}

const summary = {
  before: result.before,
  after: result.after,
  selection: result.selection,
  phases: phaseData,
  displacementStartupToContact: Math.hypot(
    phaseData.contact.handWorld[0] - phaseData.startup.handWorld[0],
    phaseData.contact.handWorld[1] - phaseData.startup.handWorld[1],
    phaseData.contact.handWorld[2] - phaseData.startup.handWorld[2]
  ).toFixed(4),
  errors
};
console.log('VERIFY ' + JSON.stringify(summary));
await browser.close();
server.close();
process.exit(0);
