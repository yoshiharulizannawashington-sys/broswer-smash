// Goku verification: his authored motion set resolves on his own body, his Kamehameha and ultimate
// still work through the real systems, and his poses differ measurably from Naruto's on the same
// move slot (the difference between an authored set and a recoloured one).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/compare/goku';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const shot = name => page.screenshot({ path: `${out}/${name}.png` });

// The attack animator writes named rig groups (torso, rightArm, ...), not bone quaternions.
const pose = () => page.evaluate(() => {
  const joints = {};
  const wanted = /^(torso|pelvis|head|rightArm|rightFore|leftArm|leftFore|rightLeg|rightShin|leftLeg|leftShin)$/i;
  window.fighters[0].model.traverse(node => {
    if (wanted.test(node.name)) joints[node.name] = [node.rotation.x, node.rotation.y, node.rotation.z].map(v => +v.toFixed(3));
  });
  return {
    joints,
    motion: window.__browserSmashAttackMotion?.() || null,
    casting: Boolean(window.fighters[0].casting),
    cine: Boolean(window.smashCamera?.describeCineShot?.().active)
  };
});

async function captureMove({ code, key, ms, screenshot }) {
  const rest = await pose();
  await page.evaluate(({ code, key }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
  }, { code, key });
  // Advance the simulation deterministically. A real-time sampling window at software-render frame
  // rates can contain a single frame, which is far too coarse to observe an attack or an ultimate.
  const frames = await page.evaluate((durationMs) => {
    const sample = () => {
      const joints = {};
      const wanted = /^(torso|pelvis|head|rightArm|rightFore|leftArm|leftFore|rightLeg|rightShin|leftLeg|leftShin)$/i;
      window.fighters[0].model.traverse(node => {
        if (wanted.test(node.name)) joints[node.name] = [node.rotation.x, node.rotation.y, node.rotation.z].map(v => +v.toFixed(3));
      });
      return {
        joints,
        casting: Boolean(window.fighters[0].casting),
        cine: Boolean(window.smashCamera?.describeCineShot?.().active),
        motion: window.__browserSmashAttackMotion?.() || null
      };
    };
    const out = [];
    const steps = Math.max(2, Math.round(durationMs / 50));
    for (let i = 0; i < steps; i += 1) {
      window.__browserSmashStep(0.05);
      out.push(sample());
    }
    return out;
  }, ms);
  if (screenshot) { await page.waitForTimeout(150); await shot(screenshot); }
  await page.evaluate(({ code, key }) => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
  }, { code, key });
  const deviation = {};
  for (const frame of frames) {
    for (const [joint, angles] of Object.entries(frame.joints)) {
      const base = rest.joints[joint];
      if (!base) continue;
      let delta = 0;
      for (let i = 0; i < 3; i += 1) delta = Math.max(delta, Math.abs(angles[i] - base[i]));
      deviation[joint] = Math.max(deviation[joint] || 0, delta);
    }
  }
  return {
    deviation,
    moved: Object.values(deviation).filter(v => v > 0.05).length,
    frames: frames.length,
    joints: Object.keys(deviation).length,
    motion: frames.at(-2)?.motion || frames[0]?.motion || null,
    sawCasting: frames.some(frame => frame.casting),
    sawCine: frames.some(frame => frame.cine)
  };
}

await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#bbTitle') && window.fighters?.length === 2, null, { timeout: 110000, polling: 250 });
await page.waitForTimeout(600);
await page.click('#bbTitle [data-nav="versus"]');
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Goku');
  window.__browserSmashSelect?.select?.('p2', 'Naruto Uzumaki');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1500);

const sets = await page.evaluate(() => window.__browserSmashMotionSets?.() || null);
const gokuSlots = sets?.sets?.goku || [];
check('Goku has his own authored motion set', gokuSlots.includes('special') && gokuSlots.includes('ultimate') && gokuSlots.length >= 10, gokuSlots.join(','));
check('Goku identity is mapped to that set', sets?.identities?.goku === 'goku');

const special = await captureMove({ code: 'KeyK', key: 'k', ms: 900, screenshot: '01-goku-kamehameha' });
check('Goku poses his body through Kamehameha', special.moved >= 3, `joints moved=${special.moved}/${special.joints} frames=${special.frames}`);

await page.evaluate(() => { window.fighters[0].meter = 100; });
await page.waitForTimeout(250);
const meterBefore = await page.evaluate(() => window.fighters[0].meter);
const ultimate = await captureMove({ code: 'KeyO', key: 'o', ms: 2600, screenshot: '02-goku-ultimate' });
// The authored shot runs for seconds; wait for it to hand control back rather than sampling
// mid-sequence. The meter is a resource the game restores after the cast, so the evidence that the
// ultimate actually fired is the cast/cinematic state observed during it.
await page.waitForFunction(() => !window.smashCamera?.describeCineShot?.().active, null, { timeout: 20000, polling: 250 }).catch(() => {});
await page.waitForTimeout(600);
const ultimateState = await page.evaluate(() => ({
  meter: window.fighters[0].meter,
  casting: Boolean(window.fighters[0].casting),
  cine: Boolean(window.smashCamera?.describeCineShot?.().active),
  menuHidden: document.querySelector('#menu')?.classList.contains('hidden') === true
}));
check('Goku ultimate activates the real ultimate systems', ultimate.sawCasting === true || ultimate.sawCine === true, JSON.stringify({ casting: ultimate.sawCasting, cine: ultimate.sawCine, meterBefore, meterAfter: ultimateState.meter }));
check('Goku ultimate poses his authored ultimate', ultimate.moved >= 3, `joints moved=${ultimate.moved}/${ultimate.joints}`);
check('ultimate returns control and the camera', ultimateState.cine === false && ultimateState.menuHidden === true, JSON.stringify(ultimateState));
await shot('03-goku-duel');

// The same move slot on Naruto, for a bone-for-bone comparison of body mechanics.
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await page.click('#pauseMenu [data-action="select"]');
await page.waitForTimeout(1400);
await page.evaluate(() => {
  window.__browserSmashSelect?.select?.('p1', 'Naruto Uzumaki');
  window.__browserSmashSelect?.select?.('p2', 'Goku');
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#play')?.click());
await page.waitForFunction(() => document.querySelector('#menu')?.classList.contains('hidden'), null, { timeout: 25000, polling: 200 });
await page.waitForTimeout(1500);
const narutoSpecial = await captureMove({ code: 'KeyK', key: 'k', ms: 1300, screenshot: '04-naruto-special' });

const shared = Object.keys(special.deviation).filter(joint => joint in narutoSpecial.deviation);
const differing = shared.filter(joint => Math.abs(special.deviation[joint] - narutoSpecial.deviation[joint]) > 0.06);
check('Goku and Naruto differ on the same move slot', differing.length >= 2, `differing=${differing.length}/${shared.length}: ${differing.slice(0, 6).join(', ')}`);

await writeFile(`${out}/goku-report.json`, JSON.stringify({ checks, sets, special, ultimate, ultimateState, narutoSpecial, differing, errors }, null, 2));
console.log('SUMMARY', JSON.stringify({ passed: checks.filter(c => c.ok).length, total: checks.length, differing, errors: errors.length }));
await browser.close(); server.close();
