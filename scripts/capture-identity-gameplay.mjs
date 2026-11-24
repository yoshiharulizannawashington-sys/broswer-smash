// Gameplay-distance evidence for the two identities, driven by real input only.
//
// Jack: standing front and three-quarter, one real attack, the signature, and the transform - the
// hat is never posed by hand. Clearance is measured vertically between the hat's lowest point and the
// shoulder line on every captured frame, because brim-into-shoulder is the failure mode.
// Voldemort: front, three-quarter and true profile close-ups plus a gameplay-distance frame.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/identity-gameplay';
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
const report = [];

for (const [label, slug] of [['Captain Jack Sparrow', 'jack'], ['Lord Voldemort', 'voldemort']]) {
  const page = await browser.newPage({ viewport: { width: 700, height: 760 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
  await page.evaluate(name => {
    window.__browserSmashSelect?.chooseArena('asgard');
    window.__browserSmashSelect?.select('p1', name);
    window.__browserSmashSelect?.select('p2', 'Superman');
    document.querySelector('#play').click();
  }, label);
  await page.evaluate(() => window.__browserSmashSkipCinematic?.());
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    window.__browserSmashFreezeAI = true;
    const a = window.fighters[0], b = window.fighters[1];
    a.position.set(0, 0, 0); a.velocity?.set?.(0, 0, 0);
    b.position.set(3.4, 0, 0); b.velocity?.set?.(0, 0, 0);
    const THREE = window.__browserSmashThree;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(a.model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    window.__frontYaw = (Math.atan2(fwd.x, fwd.z) - Math.atan2(a.facingZ || 0, a.facing || 1)) * 180 / Math.PI;
  });
  await page.locator('canvas').first().click({ position: { x: 330, y: 240 }, force: true });

  const look = (yawOffset, framing, distance, pitch = 3) => page.evaluate(({ yawOffset, framing, distance, pitch }) => {
    window.smashCamera.spectate({ fighter: window.fighters[0], framing, yaw: window.__frontYaw + yawOffset, pitch, distance });
  }, { yawOffset, framing, distance, pitch });

  const clearance = () => page.evaluate(() => {
    const f = window.fighters[0];
    const THREE = window.__browserSmashThree;
    let hat = null, shoulderY = -Infinity, names = [];
    f.model.updateWorldMatrix(true, true);
    f.model.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(m => /hat/i.test(m?.name || ''))) hat = o;
      if (o.isBone && /clavicle|shoulder/i.test(o.name || '')) {
        const y = o.getWorldPosition(new THREE.Vector3()).y;
        if (y > shoulderY) shoulderY = y;
        names.push(o.name);
      }
    });
    if (!hat) return { hat: false, shoulder: null };
    hat.geometry.computeBoundingBox();
    const box = hat.geometry.boundingBox.clone().applyMatrix4(hat.matrixWorld);
    return {
      hat: true,
      hatBottomY: +box.min.y.toFixed(4),
      shoulderY: shoulderY === -Infinity ? null : +shoulderY.toFixed(4),
      gapM: shoulderY === -Infinity ? null : +(box.min.y - shoulderY).toFixed(4),
      bones: names
    };
  });

  const shots = [];
  const shoot = async (name) => {
    const file = `${out}/${slug}-${name}.png`;
    await page.screenshot({ path: file });
    const gap = slug === 'jack' ? await clearance() : null;
    shots.push({ name, file, ...(gap ? { clearance: gap } : {}) });
    return gap;
  };

  for (const [name, offset, framing, distance, pitch] of [
    ['stand-front', 0, 'torso', 3.6, 3],
    ['stand-three-quarter', 45, 'torso', 3.6, 3]
  ]) {
    await look(offset, framing, distance, pitch);
    await page.waitForTimeout(900);
    await shoot(name);
  }
  // Real attack, then the signature, then the transform: the game's own animation drives the head.
  for (const [name, key, offset, framing, distance] of [
    ['attack', 'j', 30, 'torso', 3.4],
    ['signature', 'k', 30, 'torso', 3.6],
    ['transform', 'i', 25, 'full', 4.6]
  ]) {
    await look(offset, framing, distance, 4);
    await page.keyboard.press(key);
    const gaps = [];
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
      if (slug === 'jack') gaps.push(await clearance());
    }
    await shoot(name);
    if (slug === 'jack') shots.push({ name: `${name}-clearance-sampled`, gaps: gaps.filter(g => g?.gapM !== null && g?.gapM !== undefined).map(g => g.gapM) });
  }
  if (slug === 'jack') {
    const all = shots.flatMap(s => s.gaps ? s.gaps : (s.clearance?.gapM !== undefined && s.clearance?.gapM !== null ? [s.clearance.gapM] : []));
    shots.push({ name: 'summary', minClearanceM: all.length ? Math.min(...all) : null, samples: all.length });
  }
  if (slug === 'voldemort') {
    for (const [name, offset, framing, distance, pitch] of [
      ['close-front', 0, 'head', 1.3, 2],
      ['close-three-quarter', 45, 'head', 1.3, 2],
      ['close-profile', 90, 'head', 1.3, 2],
      ['gameplay', 0, 'full', 12, 10]
    ]) {
      await look(offset, framing, distance, pitch);
      await page.waitForTimeout(900);
      await shoot(name);
    }
  }
  report.push({ label, shots, errors });
  await page.close();
}
await writeFile(`${out}/identity-gameplay.json`, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
for (const item of report) {
  const summary = item.shots.find(s => s.name === 'summary');
  console.log('GAMEPLAY', item.label, JSON.stringify({ shots: item.shots.filter(s => !s.gaps).map(s => s.name), summary: summary || null, errors: item.errors }));
  const samples = item.shots.filter(s => s.gaps);
  for (const s of samples) console.log('CLEARANCE', s.name, JSON.stringify(s.gaps));
}
await browser.close(); server.close();
