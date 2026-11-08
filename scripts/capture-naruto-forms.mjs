// Capture every Naruto form with its rig-bound costume - at gameplay distance, on a closer
// gameplay camera, while moving and mid-attack - plus the Rasenshuriken at launch, in flight and
// on impact. The disc's travel is held still between the three shots so the software renderer can
// actually frame it; size, geometry and origin are the live values.
//
//   CHROME_PATH=... bash scripts/run-browser-test.sh scripts/capture-naruto-forms.mjs
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = process.env.OUT || 'artifacts/compare/naruto-phase2-1';
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
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push(String(e.stack || e).slice(0, 300)));
const step = seconds => page.evaluate(value => window.__browserSmashStep(value), seconds);
const frames = n => page.evaluate(async total => { for (let i = 0; i < total; i++) await new Promise(r => requestAnimationFrame(r)); }, n);
const zoom = value => page.evaluate(v => { window.smashCamera?.setZoom?.(v); }, value);
const shoot = async name => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('CAPTURE', name); };

await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 150000, polling: 250 });
await page.evaluate(() => {
  window.__browserSmashTrainingDummy = true;
  window.__browserSmashSelect?.chooseArena('valley');
  window.__browserSmashSelect?.select('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select('p2', 'Thor');
  document.querySelector('#play').click();
});
await page.evaluate(() => window.__browserSmashSkipCinematic?.());
await step(.4);

for (let stage = 1; stage <= 5; stage++) {
  await page.evaluate(() => {
    const f = window.fighters[0];
    f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0;
    f.power = 100; f.transformCooldown = 0; f.formLock = 0; f.abilityReadyAt = {};
    f.hitstun = 0; f.guardBreak = 0; f.grabbedBy = null;
    window.fighters[1].position.set(4.2, .6, 0);
    window.fighters[1].invulnerable = 30;
  });
  await page.keyboard.press('i');
  await step(.7);
  await frames(2);
  console.log(`FORM ${stage}`, JSON.stringify(await page.evaluate(() => window.__browserSmashFormCostume().p1)));
  await shoot(`form-${stage}`);

  // A closer gameplay camera, the way a player zooms in with the wheel.
  await zoom(.8);
  await frames(2);
  await shoot(`form-${stage}-close`);
  await zoom(1.2);
  await frames(1);

  // Isolated costume: aura and HUD hidden, closest gameplay zoom. This is the only way to judge
  // the garment silhouette instead of the transformation glow on top of it.
  await page.evaluate(() => {
    const f = window.fighters[0];
    if (f.aura) f.aura.visible = false;
    const canvas = document.querySelector('canvas');
    const keep = canvas?.closest('body > *');
    [...document.body.children].forEach(el => {
      if (el === keep) return;
      el.dataset.costumeHidden = el.style.visibility;
      el.style.visibility = 'hidden';
    });
    window.smashCamera?.setZoom?.(.76);
  });
  await frames(2);
  console.log('BOXES ' + stage, JSON.stringify(await page.evaluate(() => {
    const THREE = window.__browserSmashThree;
    const parts = window.fighters[0].formCostume?.parts || [];
    return parts.map(mesh => {
      const box = new THREE.Box3().setFromObject(mesh);
      const size = box.getSize(new THREE.Vector3());
      return `${mesh.name.replace('costume:', '')} ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} @y${((box.min.y + box.max.y) / 2).toFixed(2)}`;
    });
  })));
  await shoot(`form-${stage}-isolated`);
  await page.evaluate(() => {
    const f = window.fighters[0];
    if (f.aura) f.aura.visible = true;
    [...document.body.children].forEach(el => {
      if (el.dataset.costumeHidden === undefined) return;
      el.style.visibility = el.dataset.costumeHidden;
      delete el.dataset.costumeHidden;
    });
    window.smashCamera?.setZoom?.(1.2);
  });
  await frames(2);

  // Moving: the coat, mantle, pads and tails have to stay on the body through a stride.
  await page.keyboard.down('d');
  await step(.34);
  await frames(1);
  await page.keyboard.up('d');
  await shoot(`form-${stage}-move`);

  // Attacking: the chest and shoulders rotate, which is exactly where the costume is bound.
  await page.keyboard.press('j');
  await step(.11);
  await frames(1);
  await shoot(`form-${stage}-attack`);
  await step(.4);

  await page.evaluate(() => { const f = window.fighters[0]; if (f.transform) f.transform.time = 0; });
  await step(.15);
  console.log(`CLEARED ${stage}`, JSON.stringify(await page.evaluate(() => {
    const report = window.__browserSmashFormCostume().p1;
    let leftovers = 0;
    window.fighters[0].model.traverse(node => { if (String(node.name || '').startsWith('costume')) leftovers++; });
    return { report, leftovers };
  })));
  await page.evaluate(() => { window.fighters[0].transformCooldown = 0; window.fighters[0].formLock = 0; });
}

// ---- Rasenshuriken: launch, mid-flight, impact -------------------------------------------
await page.evaluate(() => {
  const f = window.fighters[0];
  f.transform = null; f.formStage = 1; f.power = 100; f.specialCooldown = 0; f.formLock = 0;
  f.position.set(0, .6, 0); f.facing = 1; f.facingZ = 0; f.hitstun = 0;
  window.fighters[1].position.set(9, .6, 0);
  window.fighters[1].invulnerable = 60;
  window.__browserSmashLastImpact = null;
});
await step(.05);
await page.keyboard.press('k');
await frames(1);
console.log('SHOT', JSON.stringify(await page.evaluate(() => window.__browserSmashLastShot)));
console.log('DISC', JSON.stringify(await page.evaluate(() => {
  const THREE = window.__browserSmashThree;
  const p = window.browserSmashProjectiles?.[0];
  if (!p) return { spawn: false };
  const disc = p.group.getObjectByName('rasenshuriken');
  const box = new THREE.Box3().setFromObject(disc || p.group);
  const size = box.getSize(new THREE.Vector3());
  const body = new THREE.Box3().setFromObject(window.fighters[0].model).getSize(new THREE.Vector3());
  return {
    radius: +(Math.max(size.x, size.y) / 2).toFixed(2), fighterHeight: +body.y.toFixed(2),
    blades: disc?.children.filter(n => n.name === 'shuriken-blade').length,
    winds: disc?.children.filter(n => n.name === 'shuriken-wind').length,
    scale: disc?.scale.x
  };
})));

// Hold the disc still beside the caster and frame it head-on from the close gameplay camera.
await page.evaluate(() => {
  const p = window.browserSmashProjectiles?.[0];
  const f = window.fighters[0];
  if (!p) return;
  p.velocity.set(0, 0, 0); p.life = 99;
  p.group.position.set(f.position.x + 1.0, 1.45, f.position.z + .1);
  p.group.rotation.set(0, 0, 0);
});
await zoom(.8);
await frames(2);
await shoot('rasenshuriken-launch');

await page.evaluate(() => {
  const p = window.browserSmashProjectiles?.[0];
  if (!p) return;
  p.group.position.set(4.4, 1.45, 0);
  p.group.rotation.set(.35, .2, 0);
});
await frames(2);
await shoot('rasenshuriken-flight');

// Impact: hand the disc its real speed back with the target on top of it.
await page.evaluate(() => {
  const p = window.browserSmashProjectiles?.[0];
  const t = window.fighters[1];
  t.invulnerable = 0;
  if (p) {
    t.position.set(p.group.position.x, Math.max(0, p.group.position.y - 1.1), p.group.position.z);
    p.velocity.set(26, 0, 0);
  }
});
await frames(2);
console.log('IMPACT', JSON.stringify(await page.evaluate(() => window.__browserSmashLastImpact || null)));
await shoot('rasenshuriken-impact');
await zoom(1.2);

console.log('ERRORS', errors.slice(0, 2).join(' | ') || 'none');
await browser.close();
server.close();
