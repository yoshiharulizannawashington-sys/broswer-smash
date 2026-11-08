// Runtime verification for a committed imported model.
//
//   bash scripts/run-browser-test.sh scripts/verify-model-runtime.mjs /models/characters/x/x.glb
//
// Opens the real game page, loads the committed file in that page's three.js runtime, binds it to
// a mixer, advances every clip and measures the result. Output is a single VERIFY:{json} line.
import { chromium } from 'playwright';

const target = process.argv[2] || process.env.MODEL_URL;
if (!target) {
  console.log('VERIFY:{"ok":false,"detail":"no model url supplied"}');
  process.exit(0);
}
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error).slice(0, 200)));
try {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__browserSmashThree && window.__browserSmashScene), null, { timeout: 120_000, polling: 200 });
  const result = await page.evaluate(async url => {
    const THREE = window.__browserSmashThree;
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new Promise((ok, bad) => new GLTFLoader().load(url, ok, undefined, bad));
    const root = gltf.scene;
    const scene = window.__browserSmashScene;
    root.position.set(0, 0, 0);
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    let skinned = 0; let bones = 0; let meshes = 0; let textures = 0;
    const materialNames = new Set();
    root.traverse(node => {
      if (node.isSkinnedMesh) { skinned++; bones = Math.max(bones, node.skeleton?.bones?.length || 0); }
      if (!node.isMesh) return;
      meshes++;
      for (const material of [].concat(node.material || [])) {
        if (!material) continue;
        materialNames.add(material.name || material.uuid);
        if (material.map) textures++;
      }
    });
    const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    const played = [];
    if (mixer) {
      for (const clip of gltf.animations.slice(0, 8)) {
        mixer.stopAllAction();
        const action = mixer.clipAction(clip);
        action.reset().play();
        const bone = root.getObjectByProperty('isBone', true);
        const before = bone ? bone.quaternion.clone() : null;
        mixer.update(Math.min(clip.duration * 0.5, 0.5));
        const after = bone ? bone.quaternion.clone() : null;
        played.push({ clip: clip.name, moved: Boolean(before && after && before.angleTo(after) > 1e-4) });
      }
      mixer.stopAllAction();
    }
    scene.remove(root);
    return {
      ok: meshes > 0 && (gltf.animations.length === 0 || played.some(entry => entry.moved)),
      url,
      meshes, skinned, bones, textures, materials: [...materialNames].slice(0, 6),
      clips: gltf.animations.map(clip => clip.name),
      clipsPlayed: played,
      height: +size.y.toFixed(3),
      feetBelowOrigin: +(-box.min.y).toFixed(3),
      upright: size.y >= Math.max(size.x, size.z) * 0.55,
      pageErrors: 0
    };
  }, target);
  result.pageErrors = errors.length;
  if (errors.length) result.ok = false;
  console.log('VERIFY:' + JSON.stringify(result));
} catch (error) {
  console.log('VERIFY:' + JSON.stringify({ ok: false, detail: String(error?.message || error).slice(0, 300), pageErrors: errors }));
} finally {
  await browser.close();
}
