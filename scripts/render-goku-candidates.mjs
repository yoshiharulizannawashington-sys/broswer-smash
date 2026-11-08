// Render downloaded candidate GLBs with the same Three.js import path the game uses.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html' };
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#11151d;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.152.2/build/three.module.js","three/addons/":"https://unpkg.com/three@0.152.2/examples/jsm/"}}</script></head>
<body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const file = new URLSearchParams(location.search).get('file');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(900, 900); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x11151d);
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x263040, 1.25));
const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0x7fc8ff, 1.2); rim.position.set(-4, 3, -3); scene.add(rim);
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
new GLTFLoader().load('/' + file, gltf => {
  const model = gltf.scene;
  model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m) m.side = THREE.FrontSide; } });
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 1.8 / Math.max(size.y, 0.0001);
  model.position.sub(center);
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(scale); scene.add(wrap);
  wrap.updateMatrixWorld(true);
  const framed = new THREE.Box3().setFromObject(wrap);
  wrap.position.y = -framed.min.y;
  if (gltf.animations?.length) { const mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); mixer.setTime(0.25); }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ color: 0x222b38, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  camera.position.set(2.35, 1.55, 3.15); camera.lookAt(0, 0.95, 0);
  renderer.render(scene, camera);
  window.__render = { width: renderer.domElement.width, height: renderer.domElement.height, triangles: (() => { let n = 0; model.traverse(o => { if (o.isMesh && o.geometry) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); })(), clips: gltf.animations.map(c => c.name), size: size.toArray().map(v => +v.toFixed(2)) };
  document.title = 'ready';
}, undefined, e => { document.title = 'error'; window.__error = String(e); });
</script></body></html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const data = await readFile(resolve(root, rel));
    res.writeHead(200, { 'Content-Type': mime[extname(rel).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
await mkdir('artifacts/goku-candidates', { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
for (const [name, file] of [['kari', 'artifacts/goku-candidates/kari_rigged_animated.glb'], ['lightk', 'artifacts/goku-candidates/lightk_textured_rigged.glb'], ['joaoraiz', 'artifacts/goku-candidates/joaoraiz_force_jump.glb']]) {
  await page.goto(origin + '/?file=' + encodeURIComponent(file), { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction(() => document.title === 'ready' || document.title === 'error', null, { timeout: 90000 }); } catch (_e) {}
  const info = await page.evaluate(() => ({ state: document.title, render: window.__render || null, error: window.__error || null }));
  await page.screenshot({ path: `artifacts/goku-candidates/render-${name}.png` });
  console.log(name, JSON.stringify(info));
}
console.log('ERRORS', JSON.stringify(errors));
await browser.close(); server.close();
