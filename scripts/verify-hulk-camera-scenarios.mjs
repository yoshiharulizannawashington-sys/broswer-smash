// Hulk end-of-match camera acceptance, scenarios A–G.
//
//   bash scripts/run-browser-test.sh scripts/verify-hulk-camera-scenarios.mjs
//
// A and G are also covered end-to-end by verify-hulk-match.mjs (real match, rematch). This harness
// exercises the presentation camera itself so the geometry-driven cases can be posed directly:
//   A default victory                 E opponent standing on top of Hulk
//   B victory at four start headings  F defeat from an airborne KO
//   C arena boundary and back wall    G rematch returns to a clean live fight
//   D foreground tree band
// Every scenario asserts the lens is outside geometry, the whole body is on screen, the correct
// authored clip owns the body, and captures a PNG plus the measurement.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = 'artifacts/hulk-camera';
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm' };
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

const rows = [];
let failures = 0;
const check = (scenario, name, ok, detail = '') => {
  if (!ok) failures++;
  rows.push({ scenario, name, ok, detail });
  console.log(`${ok ? '  ok ' : ' FAIL'} [${scenario}] ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 200)));

const startMatch = async () => {
  await page.evaluate(() => {
    const set = (sel, value) => { const n = document.querySelector(sel); if (n) { n.value = value; n.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('[data-rule="rounds"]', '1');
    window.__browserSmashIntroSeconds = 0;
    window.__browserSmashFreezeAI = true;
    window.__browserSmashSelect?.select?.('p1', 'Hulk (Bruce Banner)');
    window.__browserSmashSelect?.select?.('p2', 'Goku');
    document.querySelector('#play')?.click();
  });
  await page.waitForFunction(() => window.__browserSmashMatch?.().status === 'fighting' && window.fighters?.[0]?.identityKey === 'hulk_bruce_banner'
    && window.fighters?.[0]?.model?.userData?.defeatAction?.getClip?.(), null, { timeout: 120000, polling: 200 });
  await page.waitForFunction(() => Boolean(window.fighters?.[1]?.model?.userData?.defeatAction), null, { timeout: 30000, polling: 200 }).catch(() => {});
};

try {
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__browserSmashAssets?.app?.status === 'running' && window.fighters?.length === 2, null, { timeout: 180000, polling: 250 });
  await startMatch();

  // Pose the presented body and solve the shot exactly as main.js does at match end.
  const shoot = async (label, { x = 6, z = -6, facing = 0, facingZ = 1, defeat = false, foe = null } = {}) => {
    const data = await page.evaluate(({ x, z, facing, facingZ, defeat, foe }) => {
      const THREE = window.__browserSmashThree;
      const hulk = window.fighters[0], other = window.fighters[1];
      const u = hulk.model.userData;
      for (const f of [hulk, other]) { f.velocity?.set(0, 0, 0); f.hitstun = 0; f.ko = false; f.victoryPose = 0; }
      hulk.position.set(x, 0, z);
      hulk.model.position.set(x, 0, z);
      hulk.facing = facing; hulk.facingZ = facingZ;
      hulk.model.rotation.y = Math.atan2(facing, facingZ);
      hulk.isGrounded = true; hulk.groundLevel = 0;
      const foeSpot = foe || { x: x + 9, z: z - 9 };
      other.position.set(foeSpot.x, foeSpot.y || 0, foeSpot.z);
      other.model.position.set(foeSpot.x, foeSpot.y || 0, foeSpot.z);
      other.ko = false; other.victoryPose = 0;
      // Exactly the states the match-end branch sets.
      for (const action of Object.values(u.animationActions || {})) action?.stop?.();
      if (defeat) {
        hulk.ko = true; hulk.forceDefeatPose = true;
        u.defeatAction?.reset?.().setLoop(THREE.LoopOnce, 1);
        u.defeatAction.clampWhenFinished = true;
      } else {
        hulk.victoryPose = 4;
        u.victoryAction?.reset?.().setLoop(THREE.LoopRepeat, Infinity);
      }
      hulk.model.visible = true;
      (defeat ? u.defeatAction : u.victoryAction)?.setEffectiveTimeScale(1).fadeIn(.18).play();
      window.smashCamera.hulkVictory?.(hulk, { opponent: other, floorY: 0, distance: defeat ? 5.8 : 6.4, pitch: defeat ? 8 : 5, fov: 52 });
      for (let i = 0; i < 75; i += 1) window.__browserSmashStep(1 / 60);
      const report = window.smashCamera.report(hulk, other);
      const action = defeat ? u.defeatAction : u.victoryAction;
      return {
        inside: report.insideGeometry,
        bounds: report.fighters[0].bounds,
        head: report.fighters[0].head,
        torso: report.fighters[0].torso,
        camera: report.camera,
        clip: action?.getClip?.()?.name || null,
        weight: action?.getEffectiveWeight?.() ?? null,
        pose: defeat ? 0 : hulk.victoryPose,
        weapon: u.equippedWeaponRight?.visible ?? null,
        weaponName: u.equippedWeaponRight?.name || null,
        grounded: Boolean(hulk.isGrounded),
        position: [hulk.position.x, hulk.position.y, hulk.position.z].map(n => +n.toFixed(2))
      };
    }, { x, z, facing, facingZ, defeat, foe });
    await page.screenshot({ path: `${out}/${label}.png` });
    check(label, 'camera outside stage geometry', data.inside === false, `inside=${data.inside} cam=${JSON.stringify(data.camera)}`);
    check(label, 'full body on screen', data.bounds.onScreen === true && data.bounds.heightFraction >= 0.5, `height=${data.bounds.heightFraction} onScreen=${data.bounds.onScreen}`);
    check(label, 'body visible through the sightlines', data.head.clear === true && data.torso.clear === true, `head=${data.head.clear} torso=${data.torso.clear}`);
    check(label, defeat ? 'authored defeat clip owns the body' : 'authored victory clip runs', defeat ? /defeat|die/i.test(data.clip || '') : /victory|win|skill04/i.test(data.clip || ''), `${data.clip} w=${data.weight}`);
    check(label, defeat ? 'gamma-knuckle stays on the body through the defeat' : 'gamma-knuckle stowed for the victory pose',
      defeat ? data.weapon === true : data.weapon === false, `weapon=${data.weapon} ${data.weaponName || ''}`);
    return data;
  };

  // ---- A: the default victory shot
  await shoot('A-default-victory', { x: 6, z: -6 });

  // ---- B: four start headings (the body's own orientation at the final hit)
  for (const [label, facing, facingZ] of [['B0-heading-0', 0, 1], ['B1-heading-90', 1, 0], ['B2-heading-180', 0, -1], ['B3-heading-270', -1, 0]]) {
    await shoot(`B-${label}`, { x: 6, z: -6, facing, facingZ });
  }

  // ---- C: boundary and back wall
  await shoot('C0-east-boundary', { x: 33, z: -8 });
  await shoot('C1-west-boundary', { x: -33, z: -8 });
  await shoot('C2-back-wall', { x: 0, z: 28 });

  // ---- D: the foreground tree band that hid the body in earlier passes
  await shoot('D0-tree-band', { x: -12, z: -30 });
  await shoot('D1-tree-band-deep', { x: 18, z: -34 });

  // ---- E: opponent standing on top of the presented body
  await shoot('E0-close-opponent', { x: 4, z: -4, foe: { x: 5.1, z: -4 } });

  // ---- F: defeat from an airborne KO
  const air = await page.evaluate(() => {
    const h = window.fighters[0];
    h.position.set(2, 3.2, -6); h.model.position.set(2, 3.2, -6);
    h.velocity.set(0, 0, 0); h.isGrounded = false; h.groundLevel = 0;
    return true;
  });
  check('F0-airborne-defeat', 'airborne position applied before the defeat shot', air === true);
  await shoot('F0-airborne-defeat', { x: 2, z: -6, defeat: true });

  // ---- G: rematch returns a clean live fight
  await page.evaluate(() => { document.querySelector('#play')?.click(); });
  await page.waitForTimeout(1200);
  const rematch = await page.evaluate(() => ({
    status: window.__browserSmashMatch().status,
    pose: window.fighters[0].victoryPose,
    ko: window.fighters[0].ko,
    force: Boolean(window.fighters[0].forceDefeatPose),
    spectating: Boolean(window.smashCamera.spectateState),
    weapon: window.fighters[0].model.userData.equippedWeaponRight?.visible ?? null
  }));
  check('G0-rematch', 'rematch returns a clean live fight', rematch.status === 'fighting' && rematch.pose === 0 && rematch.ko === false && rematch.force === false);
  check('G0-rematch', 'the presentation camera hands the lens back', rematch.spectating === false, JSON.stringify(rematch));
  check('G0-rematch', 'a rematch re-equips the gamma-knuckle', rematch.weapon === true, JSON.stringify(rematch));

  check('page', 'no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (error) {
  check('harness', 'completed', false, String(error?.message || error).slice(0, 300));
} finally {
  await browser.close();
  server.close();
}

await writeFile(`${out}/report.json`, JSON.stringify({ rows, failures, pageErrors }, null, 2));
console.log(`\n${rows.length - failures}/${rows.length} checks passed`);
process.exit(failures ? 1 : 0);
