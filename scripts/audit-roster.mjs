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
    prefabs: window.__browserSmashAssets.characters.keys || [],
    weapons: window.__browserSmashAssets.weapons.count,
    roster: window.characterRosters?.launch?.map(([name]) => name) || []
  }));
  assert.ok(libraries.characters >= 57, 'character prefab library is incomplete: ' + libraries.characters);
  assert.ok(libraries.weapons >= 68, 'weapon prefab library is incomplete: ' + libraries.weapons);
  assert.ok(libraries.roster.length >= 32, 'launch roster is missing from the page');

  const slugOf = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const failures = [];
  const rows = [];
  const withoutPrefab = [];
  for (const name of libraries.roster) {
    // Not every roster identity has a Blender prefab yet (a newly registered fighter keeps the
    // procedural body until one is generated). That is a different outcome from a prefab that
    // exists and fails to mount, so the audit tells them apart instead of failing both.
    const hasPrefab = libraries.prefabs.includes('character_' + slugOf(name));
    if (!hasPrefab) withoutPrefab.push(name);
    const mounted = await page.evaluate(async ({ fighterName, expectPrefab }) => {
      const select = document.querySelector('#p1Character');
      select.value = fighterName;
      select.dispatchEvent(new Event('change'));
      const fighter = window.fighters[0];
      const joints = ['pelvis', 'torso', 'head', 'leftArm', 'rightArm', 'leftFore', 'rightFore', 'leftLeg', 'rightLeg', 'leftShin', 'rightShin'];
      if (!expectPrefab) {
        // Give the async upgrade a chance to land, then judge the body that is on screen.
        await new Promise(done => setTimeout(done, 900));
        const model = fighter.model;
        const rig = window.__browserSmashRigCheck?.(fighter) || { ok: false, issues: ['rig check hook missing'], metrics: {} };
        let visibleMeshes = 0;
        model?.traverse(node => { if (node.isMesh && node.visible) visibleMeshes++; });
        return {
          body: 'procedural',
          model: model?.name || null,
          rig: model?.userData?.blenderRigVersion || null,
          weapon: model?.userData?.weaponLabel || null,
          kind: model?.userData?.weaponKind || null,
          detail: Object.keys(model?.userData?.surfaceDetail || {}),
          visibleMeshes,
          rigOk: rig.ok,
          rigIssues: rig.issues,
          height: rig.metrics?.height ?? null,
          feetY: rig.metrics?.feetY ?? null,
          headAbovePelvis: rig.metrics?.headAbovePelvis ?? null,
          renderable: rig.metrics?.renderableMeshes ?? 0,
          joints: joints.filter(joint => model?.userData?.[joint])
        };
      }
      // The swap is async (prefab clone + weapon attach); poll the live fighter.
      for (let attempt = 0; attempt < 240; attempt++) {
        const model = fighter.model;
        if (model?.name?.startsWith('Blender fighter ') && fighter.identity === fighterName
          && model.userData.equippedWeaponRight && joints.every(joint => model.userData[joint])) {
          // A mounted prefab is not a working fighter: run the same structural gate the game
          // applies before the swap, on the live model, so a detached part, a broken ground
          // origin or a legacy Z-up root fails the audit instead of passing on a node name.
          const rig = window.__browserSmashRigCheck?.(fighter) || { ok: false, issues: ['rig check hook missing'], metrics: {} };
          let visibleMeshes = 0;
          model.traverse(node => { if (node.isMesh && node.visible) visibleMeshes++; });
          return {
            body: 'prefab',
            model: model.name,
            rig: model.userData.blenderRigVersion || null,
            weapon: model.userData.weaponLabel || null,
            kind: model.userData.weaponKind || null,
            detail: Object.keys(model.userData.surfaceDetail || {}),
            visibleMeshes,
            rigOk: rig.ok,
            rigIssues: rig.issues,
            height: rig.metrics?.height ?? null,
            feetY: rig.metrics?.feetY ?? null,
            headAbovePelvis: rig.metrics?.headAbovePelvis ?? null,
            renderable: rig.metrics?.renderableMeshes ?? 0
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
        joints: joints.filter(joint => model?.userData?.[joint])
      };
    }, { fighterName: name, expectPrefab: hasPrefab });

    if (mounted.error) failures.push({ name, ...mounted });
    else if (!mounted.rigOk || mounted.visibleMeshes === 0 || mounted.renderable === 0) {
      failures.push({ name, ...mounted, error: 'mounted rig is not structurally valid' });
    } else rows.push({ name, ...mounted });
    process.stdout.write(`\r${rows.length + failures.length}/${libraries.roster.length} fighters audited`);
  }
  process.stdout.write('\n');

  const withoutDetail = rows.filter(row => row.detail.length === 0);
  const heights = rows.map(row => row.height).filter(value => typeof value === 'number');
  const feet = rows.map(row => row.feetY).filter(value => typeof value === 'number');
  console.log(JSON.stringify({
    audit: failures.length === 0 ? 'pass' : 'fail',
    prefabs: libraries.characters,
    weapons: libraries.weapons,
    selectable: libraries.roster.length,
    mounted: rows.length,
    prefabBacked: rows.filter(row => row.body === 'prefab').length,
    proceduralFallback: withoutPrefab,
    structurallyValid: rows.length,
    withSurfaceDetail: rows.length - withoutDetail.length,
    weaponsAttached: rows.filter(row => row.weapon).length,
    heightRange: heights.length ? [Math.min(...heights), Math.max(...heights)] : null,
    worstGroundOffset: feet.length ? Math.max(...feet.map(value => Math.abs(value))) : null,
    pageErrors: pageErrors.length,
    failures,
    detailClasses: [...new Set(rows.flatMap(row => row.detail))].sort()
  }, null, 2));
  assert.deepEqual(failures, [], 'fighters failed to mount or failed rig validation: ' + JSON.stringify(failures, null, 2));
  // Every fighter that owns a prefab must still mount it: this is the guard that a newly added
  // identity cannot quietly replace or break the existing rigged roster.
  assert.ok(rows.filter(row => row.body === 'prefab').length >= 32,
    'too few fighters mounted a prefab rig: ' + rows.filter(row => row.body === 'prefab').length);
  assert.deepEqual(rows.filter(row => row.body === 'procedural').map(row => row.name), withoutPrefab,
    'procedural fallbacks do not match the identities without a prefab');
  assert.ok(rows.every(row => row.visibleMeshes > 0), 'every mounted fighter must have visible meshes');
  assert.ok(rows.every(row => Math.abs(row.feetY) <= 0.2), 'every mounted fighter must stand on its own origin');
  assert.ok(rows.every(row => row.headAbovePelvis >= 0.35), 'every mounted fighter must have its head above its pelvis');
  assert.deepEqual(pageErrors, [], 'page raised runtime errors: ' + pageErrors.join('\n'));
  console.log('Roster audit passed: every selectable fighter mounted a valid rig, and ' + withoutPrefab.length
    + ' identity/identities without a prefab kept a validated procedural body (' + withoutPrefab.join(', ') + ').');
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
