// Runtime roster audit: drives the game's real character select through every launch
// fighter and verifies that the shipped prefab rig, its joints and its weapon actually
// mount on the live fighter. Static validation can prove the files exist; only the
// browser can prove the selection path mounts them.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

async function serveThreeLocally(page) {
  await page.route('https://unpkg.com/three@0.152.2/**', async requestRoute => {
    const requestUrl = new URL(requestRoute.request().url());
    const relative = requestUrl.pathname.replace('/three@0.152.2/', '');
    try {
      const body = await readFile(resolve(root, 'node_modules/three', relative));
      await requestRoute.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    } catch {
      await requestRoute.fulfill({ status: 404, contentType: 'text/plain', body: 'missing ' + relative });
    }
  });
}

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '') || 'index.html';
    if (['js', 'assets', 'models'].some(dir => relative === dir || relative.startsWith(dir + sep))) relative = 'public' + sep + relative;
    const filePath = resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    res.end(bytes);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const origin = 'http://127.0.0.1:' + server.address().port;

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await serveThreeLocally(page);
  await page.goto(origin + '/public/index.html', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    const state = window.__browserSmashAssets || {};
    return state.characters?.status === 'loaded' && state.weapons?.status === 'loaded' && window.fighters?.length === 2;
  }, null, { timeout: 120_000, polling: 250 });

  const libraries = await page.evaluate(() => ({
    characters: window.__browserSmashAssets.characters.count,
    weapons: window.__browserSmashAssets.weapons.count,
    roster: window.characterRosters?.launch?.map(([name]) => name) || []
  }));
  assert.ok(libraries.characters >= 57, 'character prefab library is incomplete: ' + libraries.characters);
  assert.ok(libraries.weapons >= 68, 'weapon prefab library is incomplete: ' + libraries.weapons);
  assert.ok(libraries.roster.length >= 32, 'launch roster is missing from the page');

  const failures = [];
  const rows = [];
  for (const name of libraries.roster) {
    const mounted = await page.evaluate(async fighterName => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
      const fighter = window.fighters[0];
      // The swap is async (prefab clone + weapon attach); poll the live fighter.
      for (let attempt = 0; attempt < 240; attempt++) {
        const model = fighter.model;
        const joints = ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin'];
        if (model?.name?.startsWith('Blender fighter ') && fighter.identity === fighterName
          && model.userData.equippedWeaponRight && joints.every(joint => model.userData[joint])) {
          return {
            model: model.name,
            rig: model.userData.blenderRigVersion || null,
            weapon: model.userData.weaponLabel || null,
            kind: model.userData.weaponKind || null,
            detail: Object.keys(model.userData.surfaceDetail || {})
          };
        }
        await new Promise(done => setTimeout(done, 25));
      }
      const model = fighter.model;
      return {
        error: 'rig or weapon did not mount',
        model: model?.name || null,
        identity: fighter.identity,
        weapon: model?.userData?.equippedWeaponRight ? 'mounted' : 'missing',
        joints: ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin'].filter(joint => model?.userData?.[joint])
      };
    }, name);

    if (mounted.error) failures.push({ name, ...mounted });
    else rows.push({ name, ...mounted });
    process.stdout.write(`\r${rows.length + failures.length}/${libraries.roster.length} fighters audited`);
  }
  process.stdout.write('\n');

  const withoutDetail = rows.filter(row => row.detail.length === 0);
  console.log(JSON.stringify({
    audit: failures.length === 0 ? 'pass' : 'fail',
    prefabs: libraries.characters,
    weapons: libraries.weapons,
    selectable: libraries.roster.length,
    mounted: rows.length,
    withSurfaceDetail: rows.length - withoutDetail.length,
    weaponsAttached: rows.filter(row => row.weapon).length,
    pageErrors: pageErrors.length,
    failures,
    detailClasses: [...new Set(rows.flatMap(row => row.detail))].sort()
  }, null, 2));
  assert.deepEqual(failures, [], 'fighters failed to mount: ' + JSON.stringify(failures, null, 2));
  assert.deepEqual(pageErrors, [], 'page raised runtime errors: ' + pageErrors.join('\n'));
  console.log('Roster audit passed: every selectable fighter mounted its prefab rig and weapon.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
