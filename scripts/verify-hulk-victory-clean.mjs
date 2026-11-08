// Real match-end acceptance: win with Hulk, let stageHulkPresentation run, then prove the victory
// silhouette is clean (no rendered gauntlet descendants, no stray equipment near the waist), the
// body is fully framed, and rematch/defeat keep their equipment behaviour.
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
await new Promise(d => server.listen(0, '127.0.0.1', d));
const origin = 'http://127.0.0.1:' + server.address().port;
const out = 'artifacts/hulk-victory-real';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); if (!ok) failed += 1; };
const hideUi = () => page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = 'hidden'; }));
const showUi = () => page.evaluate(() => document.querySelectorAll('body > *:not(canvas)').forEach(el => { el.style.visibility = ''; }));
const state = () => page.evaluate(() => {
  const h = window.fighters[0], u = h.model.userData, THREE = window.__browserSmashThree;
  const rendered = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const box = new THREE.Box3().setFromObject(h.model);
  const waist = u.hips ? u.hips.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
  const near = [];
  h.model.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh) || !rendered(o)) return;
    const d = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).distanceTo(waist);
    if (d <= 1.5) near.push({ name: o.name || o.type, d: +d.toFixed(2), mat: o.material?.color ? '#' + o.material.color.getHexString() : null });
  });
  const ref = o => o ? { name: o.name || null, visible: o.visible, rendered: rendered(o) } : null;
  const report = window.smashCamera?.report?.(h, window.fighters[1]) || null;
  return {
    status: window.__browserSmashMatch().status, winner: window.__browserSmashMatch().winner,
    result: (document.querySelector('#result')?.textContent || '').slice(0, 40),
    hold: window.__browserSmashVictoryState?.()?.hold ?? null,
    pose: h.victoryPose, handsFree: Boolean(u.presentationHandsFree), equipment: u.equipmentState?.state || null,
    clip: u.victoryAction?.getClip?.()?.name || null, defeatClip: u.defeatAction?.getClip?.()?.name || null,
    weight: u.victoryAction?.getEffectiveWeight ? +u.victoryAction.getEffectiveWeight().toFixed(2) : null,
    weapon: ref(u.equippedWeaponRight), near,
    bounds: report?.fighters?.[0]?.bounds || null, inside: report?.insideGeometry ?? null
  };
});
await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 120000, polling: 250 });
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect.select('p1', 'Hulk (Bruce Banner)');
  window.__browserSmashSelect.select('p2', 'Goku');
  document.querySelector('#play').click();
});
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting' && window.fighters[0].identityKey === 'hulk_bruce_banner', null, { timeout: 30000, polling: 100 });
await page.evaluate(() => { for (let i = 0; i < 60; i += 1) window.__browserSmashStep(1 / 60); });

// Combat reference: the gamma-knuckle is equipped and visible in normal play.
const combat = await state();
await hideUi(); await page.screenshot({ path: `${out}/combat.png` }); await showUi();
check('combat: gamma-knuckle equipped and rendered', combat.weapon?.rendered === true, JSON.stringify(combat.weapon));

// Win through the real match-end branch, then capture the posed celebration mid-hold.
await page.evaluate(() => {
  const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) { window.fighters[1].percent = 999; step(6); }
});
await page.waitForFunction(() => Boolean(window.fighters[0].model.userData.victoryAction?.getClip?.()), null, { timeout: 20000, polling: 100 });
await page.evaluate(() => { for (let i = 0; i < 75; i += 1) window.__browserSmashStep(1 / 60); });
const posed = await state();
await hideUi(); await page.screenshot({ path: `${out}/victory-pose.png` }); await showUi();
check('victory: skill04 clip drives the body at full weight', /skill04/i.test(posed.clip || '') && posed.weight >= 0.99, `${posed.clip} w=${posed.weight}`);
check('victory: gauntlet group is hidden', posed.weapon?.visible === false && posed.weapon?.rendered === false, JSON.stringify(posed.weapon));
check('victory: no rendered equipment remains near the waist',
  posed.near.every(item => !/knuckle|cuff|guard|weapon|gamma/i.test(item.name)), JSON.stringify(posed.near));

// Let the staged hold expire, then read the real panel and the finished frame.
await page.evaluate(() => {
  for (let i = 0; i < 900; i += 1) {
    const v = window.__browserSmashVictoryState?.();
    if (v && v.hold === 0 && document.querySelector('#result')?.textContent.trim()) break;
    window.__browserSmashStep(1 / 60);
  }
});
await page.waitForTimeout(500);
const finished = await state();
const rect = await page.evaluate(() => {
  const h = window.fighters[0], THREE = window.__browserSmashThree, cam = window.smashCamera.camera;
  const box = new THREE.Box3().setFromObject(h.model);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i += 1) {
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const onScreen = x0 >= 0 && y0 >= 0 && x1 <= innerWidth && y1 <= innerHeight;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), onScreen, heightFraction: +((y1 - y0) / innerHeight).toFixed(2) };
});
await hideUi();
await page.screenshot({ path: `${out}/victory-full.png` });
const clipBox = { x: Math.max(0, rect.x - 20), y: Math.max(0, rect.y + rect.h * 0.35), width: Math.min(1280, rect.w + 40), height: Math.min(720, rect.h * 0.6) };
if (clipBox.width > 20 && clipBox.height > 20) await page.screenshot({ path: `${out}/victory-waist.png`, clip: clipBox });
await page.evaluate(() => {
  window.__browserSmashSetPaused(true);
  const weapon = window.fighters[0].model.userData.equippedWeaponRight;
  if (weapon) weapon.visible = true;
});
if (clipBox.width > 20 && clipBox.height > 20) await page.screenshot({ path: `${out}/victory-waist-before.png`, clip: clipBox });
await page.evaluate(() => {
  const weapon = window.fighters[0].model.userData.equippedWeaponRight;
  if (weapon) weapon.visible = false;
  window.__browserSmashSetPaused(false);
});
await showUi();
check('victory: result panel reports the win', /^VICTORY/.test(finished.result), finished.result);
check('victory: gauntlet still hidden when the panel appears', finished.weapon?.rendered === false, JSON.stringify(finished.weapon));
check('victory: full body on screen and readable',
  rect.onScreen === true && rect.heightFraction >= 0.5 && finished.inside === false,
  JSON.stringify({ rect, inside: finished.inside }));

// Rematch through the real result action restores the weapon.
await page.evaluate(() => document.querySelector('[data-result="rematch"]')?.click());
await page.waitForFunction(() => window.__browserSmashMatch().status === 'fighting', null, { timeout: 20000, polling: 100 });
await page.evaluate(() => { for (let i = 0; i < 45; i += 1) window.__browserSmashStep(1 / 60); });
const rematch = await state();
await hideUi(); await page.screenshot({ path: `${out}/rematch.png` }); await showUi();
check('rematch: gauntlet re-equipped and rendered', rematch.weapon?.rendered === true && rematch.handsFree === false && rematch.pose === 0, JSON.stringify(rematch));

// Defeat path through the same real branch.
await page.evaluate(() => {
  const step = n => { for (let i = 0; i < n; i += 1) window.__browserSmashStep(1 / 60); };
  for (let i = 0; i < 40 && window.__browserSmashMatch().status !== 'match-over'; i += 1) { window.fighters[0].percent = 999; step(6); }
});
await page.waitForFunction(() => Boolean(window.fighters[0].model.userData.defeatAction?.getClip?.()), null, { timeout: 20000, polling: 100 });
await page.evaluate(() => { for (let i = 0; i < 75; i += 1) window.__browserSmashStep(1 / 60); });
const defeat = await state();
await hideUi(); await page.screenshot({ path: `${out}/defeat-pose.png` }); await showUi();
check('defeat: authored defeat clip owns the body', /defeat|die/i.test(defeat.defeatClip || ''), defeat.defeatClip);
check('defeat: equipment behaviour unchanged (gauntlet rendered)', defeat.weapon?.rendered === true, JSON.stringify(defeat.weapon));
check('defeat: body is framed by the closer lens',
  defeat.bounds?.onScreen === true && defeat.inside === false, JSON.stringify({ bounds: defeat.bounds, inside: defeat.inside }));
await page.evaluate(() => {
  for (let i = 0; i < 900; i += 1) {
    const v = window.__browserSmashVictoryState?.();
    if (v && v.hold === 0 && document.querySelector('#result')?.textContent.trim()) break;
    window.__browserSmashStep(1 / 60);
  }
});
await page.waitForTimeout(400);
const defeatFinal = await state();
check('defeat: result panel still reports the loss', /^DEFEAT/.test(defeatFinal.result), defeatFinal.result);
check('no page errors across the result paths', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(failed ? `\n${failed} victory-clean check(s) failed.` : '\nHulk victory presentation verified (12 checks).');
process.exitCode = failed ? 1 : 0;
