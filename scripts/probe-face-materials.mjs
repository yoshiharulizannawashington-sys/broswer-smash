// Face diagnosis probe: which material owns which surface on the real preview model, and what the
// head actually looks like at 1:1.
//
//   bash scripts/run-browser-test.sh scripts/probe-face-materials.mjs kratos
//
// Loads the fighter in the shipped character-select preview. Then, for every geometry group:
//   * world-space bounding box and vertex count (where that material's surface is),
//   * the dominant skin bone per vertex (the weighting contract the idle animation rides on).
// Then it tints each material a unique colour and shoots the panel, so a surface that hides the
// face is identifiable by colour rather than by guessing from a shaded render. Finally it frames
// the preview camera on the head and shoots front and three-quarter close-ups, which is the only
// honest way to judge a face.
//
// Writes artifacts/p72/<slug>-{materials,head-front,head-quarter}.png and <slug>-materials.json
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, normalize, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const slug = (process.argv[2] || 'kratos').trim();
const outDir = resolve(root, 'artifacts/p72');
await mkdir(outDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let relative = normalize(pathname).replace(/^[/\\]+/, '');
    if (!relative) relative = 'index.html';
    if (['js', 'assets', 'models', 'data'].some(dir => relative === dir || relative.startsWith(dir + sep))) {
      relative = 'public' + sep + relative;
    }
    const filePath = resolve(root, relative);
    if (!filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const bytes = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;

// One colour per material, so the screenshot names the surface.
const TINTS = {
  'fighter-skin': 0xffe8d0, 'fighter-skin-shade': 0xff00ff, 'fighter-eye': 0x00ff40,
  'fighter-iris': 0x0040ff, 'fighter-hair': 0xff2000, 'fighter-undershirt': 0x00ffff,
  'fighter-gi': 0x9a9a9a, 'fighter-gi-shade': 0x5a5a5a, 'fighter-sash': 0x885500,
  'fighter-trousers': 0x3355ff, 'fighter-boot': 0x552200, 'fighter-trim': 0xffff00,
  'fighter-accent': 0xff8800
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1150 }, deviceScaleFactor: 2 });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error).split('\n')[0]));
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__browserSmashPreview), null, { timeout: 120_000 });

  await page.evaluate(() => {
    const panel = document.querySelector('#selectScreen [data-role="preview"]');
    if (!panel) return;
    for (const el of document.querySelectorAll('#selectScreen *')) {
      if (el === panel || panel.contains(el) || el.contains(panel)) continue;
      el.style.visibility = 'hidden';
    }
    const screen = document.querySelector('#selectScreen');
    if (screen) screen.style.background = 'transparent';
    panel.style.height = '920px';
    panel.style.minHeight = '920px';
    panel.style.border = 'none';
    panel.style.background = 'transparent';
    for (const span of panel.querySelectorAll('span')) span.style.display = 'none';
    for (const canvas of panel.querySelectorAll('canvas')) {
      canvas.style.width = '100%';
      canvas.style.height = '920px';
    }
  });
  await page.waitForTimeout(360);

  await page.evaluate(async id => {
    window.__browserSmashPreview.setYaw(0);
    await window.__browserSmashPreview.show(id, id);
  }, slug);
  await page.waitForTimeout(400);

  // Measure every geometry group in world space. The exports are one mesh with one group per
  // material, so a group's box is exactly "where that material's surface actually is".
  const measured = await page.evaluate(() => {
    const root = window.__fighterPreviewDebug?.root;
    if (!root) return { error: 'no root in __fighterPreviewDebug' };
    root.updateMatrixWorld(true);
    const rows = [];
    const v = [0, 0, 0];
    const component = (attribute, index, slot) =>
      slot === 0 ? attribute.getX(index) : slot === 1 ? attribute.getY(index)
        : slot === 2 ? attribute.getZ(index) : attribute.getW(index);
    root.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      const position = node.geometry.attributes.position;
      const index = node.geometry.index;
      const e = node.matrixWorld.elements;
      const groups = node.geometry.groups.length
        ? node.geometry.groups
        : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];
      const skinIndex = node.geometry.attributes.skinIndex;
      const skinWeight = node.geometry.attributes.skinWeight;
      const boneNames = node.isSkinnedMesh ? node.skeleton.bones.map(b => b.name) : [];
      for (const group of groups) {
        const material = mats[group.materialIndex] || mats[0];
        const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        const seen = new Set();
        const bones = {};
        for (let i = group.start; i < group.start + group.count; i++) {
          const vertex = index ? index.getX(i) : i;
          if (seen.has(vertex)) continue;
          seen.add(vertex);
          // Dominant bone per vertex: this is the weighting contract the animation rides on, and
          // a face part bound to the wrong bone renders somewhere the skull is not.
          if (skinIndex && skinWeight) {
            let best = -1, bestWeight = -1;
            for (let k = 0; k < 4; k++) {
              const w = component(skinWeight, vertex, k);
              if (w > bestWeight) { bestWeight = w; best = component(skinIndex, vertex, k); }
            }
            const name = boneNames[best] || `#${best}`;
            bones[name] = (bones[name] || 0) + 1;
          }
          const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
          v[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
          v[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          v[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          for (let k = 0; k < 3; k++) {
            if (v[k] < box.min[k]) box.min[k] = v[k];
            if (v[k] > box.max[k]) box.max[k] = v[k];
          }
        }
        rows.push({
          material: material?.name || '?',
          vertices: seen.size,
          min: box.min.map(n => +n.toFixed(4)),
          max: box.max.map(n => +n.toFixed(4)),
          bones
        });
      }
    });
    rows.sort((a, b) => a.material.localeCompare(b.material));
    // `root` is a live scene graph: copy the scalar framing fields only, or JSON.stringify recurses
    // through parent/children forever.
    const { boxMin, boxMax, size, camera, distance } = window.__fighterPreviewDebug;
    return { debug: { boxMin, boxMax, size, camera, distance }, rows };
  });

  const panel = page.locator('#selectScreen [data-role="preview"]');
  const original = await page.evaluate(() => {
    const root = window.__fighterPreviewDebug.root;
    const saved = [];
    root.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of mats) {
        if (!material || material.userData.__saved) continue;
        material.userData.__saved = true;
        saved.push({ material: material.name });
        material.userData.__restore = {
          color: material.color?.getHex(),
          emissive: material.emissive?.getHex(),
          metalness: material.metalness,
          roughness: material.roughness
        };
      }
    });
    return saved.map(entry => entry.material);
  });

  await page.evaluate(tints => {
    const root = window.__fighterPreviewDebug.root;
    root.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of mats) {
        const hex = tints[material?.name];
        if (hex === undefined) continue;
        material.color?.setHex(hex);
        // Kill metalness/emissive so the tint reads as the surface, not as a highlight.
        if ('emissive' in material) material.emissive.setHex(0x000000);
        if ('metalness' in material) material.metalness = 0;
        if ('roughness' in material) material.roughness = 1;
        material.needsUpdate = true;
      }
    });
  }, TINTS);
  await page.waitForTimeout(300);
  await panel.screenshot({ path: resolve(outDir, `${slug}-materials.png`) });

  // Restore the shipped materials, then frame the head: box max is the crown, and the head is
  // ~13% of total height, so this is derived from the measured model, not a magic offset.
  await page.evaluate(() => {
    const root = window.__fighterPreviewDebug.root;
    root.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of mats) {
        const restore = material?.userData?.__restore;
        if (!restore) continue;
        if (restore.color !== undefined && material.color) material.color.setHex(restore.color);
        if (restore.emissive !== undefined && material.emissive) material.emissive.setHex(restore.emissive);
        if (restore.metalness !== undefined) material.metalness = restore.metalness;
        if (restore.roughness !== undefined) material.roughness = restore.roughness;
        material.needsUpdate = true;
      }
    });
  });
  await page.waitForTimeout(120);

  await page.evaluate(() => {
    const { boxMin, boxMax, camera } = window.__fighterPreviewDebug;
    const height = boxMax[1] - boxMin[1];
    const headY = boxMax[1] - height * 0.075;
    const centerZ = (boxMin[2] + boxMax[2]) / 2;
    const centerX = (boxMin[0] + boxMax[0]) / 2;
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    const distance = (height * 0.30 * 0.5) / halfTan;
    camera.near = Math.max(0.01, distance * 0.2);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    window.__p72Frame = (yaw) => {
      const dx = Math.sin(yaw) * distance;
      const dz = Math.cos(yaw) * distance;
      camera.position.set(centerX + dx, headY, centerZ + dz);
      camera.lookAt(centerX, headY, centerZ);
      camera.updateMatrixWorld(true);
    };
    window.__p72Frame(0);
    window.__browserSmashPreview.setYaw(0);
  });
  await page.waitForTimeout(400);
  await panel.screenshot({ path: resolve(outDir, `${slug}-head-front.png`) });

  await page.evaluate(() => {
    window.__browserSmashPreview.setYaw(0.7);
    window.__p72Frame(0.7);
  });
  await page.waitForTimeout(350);
  await panel.screenshot({ path: resolve(outDir, `${slug}-head-quarter.png`) });

  const report = { slug, materials: original.length, ...measured, pageErrors: [...new Set(errors)].slice(0, 6) };
  await writeFile(resolve(outDir, `${slug}-materials.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ slug, debug: report.debug, pageErrors: report.pageErrors }, null, 2));
  for (const row of report.rows) {
    console.log(row.material.padEnd(20), 'v', String(row.vertices).padEnd(5),
      'y', `${row.min[1].toFixed(2)}..${row.max[1].toFixed(2)}`,
      'z', `${row.min[2].toFixed(2)}..${row.max[2].toFixed(2)}`,
      JSON.stringify(row.bones));
  }
  console.log('OK: wrote', resolve(outDir, `${slug}-materials.png`),
    resolve(outDir, `${slug}-head-front.png`), resolve(outDir, `${slug}-head-quarter.png`));
} finally {
  await browser?.close();
  server.close();
}
