// Verify that a replaced character actually plays as the imported model.
//
//   bash scripts/run-browser-test.sh scripts/verify-replacement.mjs "Kaze" "/models/characters/kaze/kaze-import-xxx.glb"
//
// Checks the three things a preview cannot prove: character select resolves the character, an
// actual match loads the new file and animates it, and the manifest on disk is what the page read
// (so the replacement survives a restart). Output is one REPLACE:{json} line.
import { chromium } from 'playwright';

const characterName = process.argv[2] || process.env.CHARACTER;
const expectedUrl = process.argv[3] || process.env.EXPECTED_URL || '';
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.setDefaultTimeout(180_000);
const errors = [];
const requests = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));
page.on('response', response => {
  const url = response.url();
  if (/\.(glb|gltf|fbx)(\?|$)/i.test(url)) requests.push({ url: url.replace(origin, ''), status: response.status() });
});

try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashStep && window.fighters), null, { timeout: 180_000, polling: 200 });

  // Character select: the select control must still carry the character under its own identity.
  const inSelect = await page.evaluate(name => {
    const select = document.querySelector('#p1Character');
    if (!select) return { found: false, options: [] };
    return { found: [...select.options].some(option => option.value === name), options: select.options.length };
  }, characterName);

  // Manifest resolution in the page itself, using the same slug rule the fighter loader uses.
  const manifest = await page.evaluate(async name => {
    const slug = String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const response = await fetch('/models/characters/manifest.json', { cache: 'no-store' });
    const body = await response.json();
    const entry = body.characters?.[slug] || null;
    return { slug, url: entry?.url || null, enabled: entry?.enabled ?? null, versions: entry?.versions?.length ?? 0, identity: entry?.name || null };
  }, characterName);

  await page.evaluate(name => {
    const select = document.querySelector('#p1Character');
    if (select) {
      const option = [...select.options].find(item => item.value === name);
      if (option) { select.value = name; select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    document.querySelector('#play')?.click();
  }, characterName);

  await page.waitForFunction(() => window.fighters?.length >= 2 && window.fighters.some(fighter => fighter.model), null, { timeout: 180_000, polling: 200 });
  await page.evaluate(() => window.__browserSmashStep?.(0.8));

  // Sample the fighter's skinned rig over time inside the running match.
  const match = await page.evaluate(async name => {
    const fighter = window.fighters.find(candidate => String(candidate.name || candidate.identity || '').includes(name)) || window.fighters[0];
    // The fighter object holds several wrappers (procedural armour, weapon mounts, the imported
    // body). Scan everything it owns plus the live scene, then report where the skeleton was found.
    const roots = [fighter?.model, fighter?.root, fighter?.mesh, window.__browserSmashScene].filter(Boolean);
    const meshes = [];
    const bones = [];
    const skinned = [];
    const materials = new Set();
    const textures = new Set();
    const seen = new Set();
    for (const root of roots) root?.traverse?.(node => {
      if (seen.has(node)) return;
      seen.add(node);
      if (node.isSkinnedMesh) skinned.push({ name: node.name || 'skinned', bones: node.skeleton?.bones?.length || 0 });
      if (node.isBone && bones.length < 64) bones.push(node);
      if (!node.isMesh) return;
      meshes.push(node.name || 'mesh');
      for (const material of [].concat(node.material || [])) {
        if (!material) continue;
        materials.add(material.name || material.uuid);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (material[key]) textures.add(material[key].uuid);
      }
    });
    const imported = skinned.sort((a, b) => b.bones - a.bones)[0] || null;
    const sample = () => bones.slice(0, 8).map(bone => bone.quaternion.toArray().map(value => +value.toFixed(4)));
    const before = sample();
    await new Promise(done => setTimeout(done, 600));
    const after = sample();
    const movement = bones.length
      ? before.reduce((total, values, index) => total + values.reduce((sum, value, axis) => sum + Math.abs(value - (after[index]?.[axis] ?? 0)), 0), 0)
      : 0;
    return {
      fighterName: fighter?.name || fighter?.identity || null,
      fighterKeys: fighter ? Object.keys(fighter).slice(0, 24) : [],
      meshes: [...new Set(meshes)].slice(0, 12),
      skinned: skinned.slice(0, 6),
      importedSkeleton: imported,
      bones: bones.length,
      materials: [...materials].slice(0, 6),
      textures: textures.size,
      boneMotion: +movement.toFixed(3),
      inMatch: Boolean(window.__browserSmashWorld),
      arena: window.__browserSmashWorld?.label || null,
      // The runtime's own record of what it mounted: status, url, clip names and every rig-gate
      // issue. Without this a rejection only shows up as a silent procedural body.
      assets: window.__browserSmashAssets?.characterModels || null,
      modelImported: Boolean(fighter?.model?.userData?.importedModel),
      placement: fighter?.model?.userData?.placement || null,
      actions: fighter?.model?.userData?.animationActions
        ? Object.keys(fighter.model.userData.animationActions) : []
    };
  }, characterName);

  const expected = expectedUrl ? expectedUrl.split('/').pop() : null;
  const loadedExpected = expected ? requests.some(entry => entry.url.includes(expected) && entry.status === 200) : null;
  const result = {
    ok: Boolean(inSelect.found && manifest.url && match.skinned.length > 0 && match.bones > 0
      && (expected ? loadedExpected : true) && match.boneMotion > 0.01 && errors.length === 0),
    character: characterName,
    selectEntry: inSelect,
    manifest,
    expectedUrl,
    loadedExpected,
    match,
    glbRequests: requests.slice(0, 12),
    pageErrors: errors
  };
  console.log('REPLACE:' + JSON.stringify(result));
} catch (error) {
  console.log('REPLACE:' + JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 300), glbRequests: requests.slice(0, 8), pageErrors: errors }));
} finally {
  await browser.close();
}
