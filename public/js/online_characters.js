// In-game online character import browser.
//
// The page only talks to its own origin (/api/models/*). Searching, retrieval, preparation and
// reporting run on the machine serving the game. This module is deliberately strict about what it
// claims: results carry a classification, a rig state that may be unknown, and an availability
// badge; IMPORT TO GAME only appears enabled when the source can actually be retrieved, and
// nothing enters the roster until the user picks an operation and approves it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const STYLE = `
#ocButton { border-color: #9b7bff99; }
#ocPanel { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center;
  background: #030812e6; backdrop-filter: blur(6px); }
#ocPanel.open { display: flex; }
#ocShell { position: relative; width: min(1180px, 95vw); height: min(760px, 90vh); display: flex; flex-direction: column;
  background: #081321; border: 1px solid #5ee6ff55; box-shadow: 0 24px 80px #000a; overflow: hidden; }
#ocHead { padding: 14px 18px; border-bottom: 1px solid #5ee6ff33; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#ocHead h2 { margin: 0; font-size: 15px; letter-spacing: .16em; color: #7af2ff; }
#ocHead .sub { font-size: 10px; color: #8fb3cc; letter-spacing: .06em; }
#ocHead .spacer { flex: 1; }
#ocClose, #ocDrawerClose { background: transparent; border: 1px solid #5ee6ff55; color: #cfe9ff; }
#ocBar { display: flex; gap: 7px; padding: 10px 18px; border-bottom: 1px solid #5ee6ff22; flex-wrap: wrap; align-items: center; }
#ocBar input[type=text] { flex: 1; min-width: 180px; background: #0a1b2d; border: 1px solid #4ddfff88; color: #f3f7ff; padding: 9px; font: inherit; }
#ocBar select { background: #0a1b2d; border: 1px solid #4ddfff88; color: #f3f7ff; padding: 8px; font: inherit; font-size: 11px; }
#ocBar label.chk { font-size: 10px; color: #9feaff; display: flex; align-items: center; gap: 4px; letter-spacing: .06em; }
#ocResults { overflow: auto; padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(212px, 1fr)); gap: 11px; flex: 1; align-content: start; }
.ocCard { background: #0b1b2c; border: 1px solid #5ee6ff33; display: flex; flex-direction: column; }
.ocCard img, .ocThumb { width: 100%; height: 116px; object-fit: cover; display: block; background: #060f1a; }
.ocBody { padding: 8px 9px; display: flex; flex-direction: column; gap: 4px; }
.ocName { font-size: 11.5px; font-weight: 800; color: #eaf7ff; line-height: 1.3; }
.ocMeta { font-size: 9.5px; color: #8fb3cc; }
.ocTags { display: flex; gap: 4px; flex-wrap: wrap; }
.ocTag { font-size: 8.5px; padding: 2px 5px; border: 1px solid #5ee6ff55; color: #9feaff; letter-spacing: .07em; }
.ocTag.warn { border-color: #ffb45e88; color: #ffcf9a; }
.ocTag.bad { border-color: #ff7188aa; color: #ffb0bd; }
.ocTag.good { border-color: #5effb888; color: #a9ffd7; }
.ocCard .row { display: flex; gap: 5px; margin-top: 3px; }
.ocCard button { flex: 1; padding: 6px 4px; font-size: 9px; letter-spacing: .06em; }
.ocCard button[disabled] { opacity: .45; cursor: not-allowed; }
#ocStatus { padding: 8px 18px 12px; font-size: 10.5px; color: #a9c6de; border-top: 1px solid #5ee6ff22; min-height: 30px; white-space: pre-wrap; max-height: 104px; overflow: auto; }
#ocDrawer { position: absolute; inset: 0; z-index: 3; display: none; background: #06111ee8; }
#ocDrawer.open { display: flex; }
#ocDrawerShell { display: flex; flex-direction: column; width: 100%; height: 100%; background: #081321; }
#ocDrawerHead { padding: 12px 16px; border-bottom: 1px solid #5ee6ff33; display: flex; gap: 10px; align-items: center; }
#ocDrawerHead h3 { margin: 0; font-size: 13px; letter-spacing: .1em; color: #eaf7ff; }
#ocDrawerBody { flex: 1; display: flex; min-height: 0; }
#ocViewer { flex: 1; position: relative; background: #050c16; min-width: 0; }
#ocViewer canvas { display: block; width: 100%; height: 100%; }
#ocViewerTools { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 5px; flex-wrap: wrap; }
#ocViewerTools button { padding: 5px 8px; font-size: 9px; }
#ocViewerHint { position: absolute; left: 10px; top: 10px; font-size: 9.5px; color: #7f9db5; }
#ocInfo { width: min(360px, 42%); padding: 12px 14px; border-left: 1px solid #5ee6ff22; overflow: auto; font-size: 10.5px; color: #b8d2e6; }
#ocInfo h4 { margin: 12px 0 5px; font-size: 10px; letter-spacing: .14em; color: #7af2ff; }
#ocInfo table { width: 100%; border-collapse: collapse; }
#ocInfo td { padding: 2px 0; vertical-align: top; }
#ocInfo td:first-child { color: #7f9db5; width: 44%; }
#ocStages { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
#ocStages li { font-size: 10px; padding: 3px 6px; border-left: 2px solid #2b3d52; color: #8fb3cc; }
#ocStages li.running { border-color: #5ee6ff; color: #eaf7ff; }
#ocStages li.done { border-color: #5effb8; color: #b9ffe0; }
#ocStages li.failed { border-color: #ff7188; color: #ffb0bd; }
#ocApproval { margin-top: 8px; padding: 9px; border: 1px solid #9b7bff66; background: #0b1626; display: flex; flex-direction: column; gap: 6px; }
#ocApproval label { display: flex; gap: 6px; align-items: flex-start; font-size: 10px; color: #cfe4f6; }
#ocApproval select { background: #0a1b2d; color: #f3f7ff; border: 1px solid #4ddfff88; padding: 5px; font: inherit; font-size: 10px; }
#ocApproval .approve { background: linear-gradient(100deg,#7a4dff,#b56bff); border: 0; color: #fff; padding: 8px; font-size: 10px; letter-spacing: .08em; }
#ocApproval .approve[disabled] { opacity: .45; }
#ocReport { white-space: pre-wrap; font-size: 9.5px; color: #9fbdd4; max-height: 150px; overflow: auto; background: #050d18; padding: 7px; border: 1px solid #22364a; }
#ocLog { white-space: pre-wrap; font-size: 9px; color: #86a3ba; max-height: 96px; overflow: auto; margin-top: 6px; }
`;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'style') node.style.cssText = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

const fmt = (value, suffix = '') => (value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`);
const kb = bytes => (bytes ? `${(bytes / 1024).toFixed(0)} KB` : '—');

export function installOnlineCharacters({ onImported } = {}) {
  if (document.getElementById('ocPanel')) return null;
  document.head.append(el('style', { text: STYLE }));

  const state = {
    sources: [], roster: { launch: [], manifestKeys: [] }, results: [], row: null,
    preview: null, job: null, report: null, commit: null, pollTimer: null
  };

  /* ------------------------------------------------------------------ chrome */
  const status = el('div', { id: 'ocStatus', text: 'Pick a source, search, preview the actual model, then choose what the import should do.' });
  const results = el('div', { id: 'ocResults' });
  const query = el('input', { id: 'ocQuery', type: 'text', placeholder: 'Search models — knight, sword, dragon, chair…', 'aria-label': 'Search models' });
  const sourceSelect = el('select', { id: 'ocSource', 'aria-label': 'Model source' });
  const kindSelect = el('select', { id: 'ocKind', 'aria-label': 'Asset kind' });
  const rigSelect = el('select', { id: 'ocRig', 'aria-label': 'Rig status' });
  const animatedSelect = el('select', { id: 'ocAnimated', 'aria-label': 'Animation' });
  const downloadableBox = el('input', { id: 'ocDownloadable', type: 'checkbox' });
  const searchButton = el('button', { id: 'ocSearch', class: 'primary', text: 'SEARCH' });
  const directButton = el('button', { id: 'ocDirect', text: 'DIRECT URL' });

  for (const [value, label] of [['all', 'ALL KINDS'], ['character', 'CHARACTERS'], ['creature', 'CREATURES'],
    ['weapon', 'WEAPONS'], ['armor', 'ARMOUR'], ['accessory', 'ACCESSORIES'], ['environment', 'ENVIRONMENTS'],
    ['material', 'MATERIALS']]) kindSelect.append(el('option', { value, text: label }));
  for (const [value, label] of [['any', 'ANY RIG'], ['yes', 'RIGGED'], ['no', 'UNRIGGED']]) rigSelect.append(el('option', { value, text: label }));
  for (const [value, label] of [['any', 'ANY MOTION'], ['yes', 'ANIMATED'], ['no', 'STATIC']]) animatedSelect.append(el('option', { value, text: label }));

  /* ------------------------------------------------------------------ drawer */
  const viewerHost = el('div', { id: 'ocViewer' });
  const viewerHint = el('div', { id: 'ocViewerHint', text: 'Drag to orbit · wheel to zoom' });
  const clipSelect = el('select', { id: 'ocClips', 'aria-label': 'Animation clip' });
  const viewerTools = el('div', { id: 'ocViewerTools' }, [
    el('button', { text: 'FRONT', onclick: () => setView('front') }),
    el('button', { text: 'SIDE', onclick: () => setView('side') }),
    el('button', { text: 'BACK', onclick: () => setView('back') }),
    el('button', { text: 'SKELETON', onclick: toggleSkeleton }),
    clipSelect
  ]);
  viewerHost.append(viewerHint, viewerTools);
  const info = el('div', { id: 'ocInfo' });
  const drawerTitle = el('h3', { text: 'MODEL PREVIEW' });
  const drawerClose = el('button', { id: 'ocDrawerClose', text: 'BACK TO RESULTS', onclick: closeDrawer });
  const drawer = el('div', { id: 'ocDrawer' }, [
    el('div', { id: 'ocDrawerShell' }, [
      el('div', { id: 'ocDrawerHead' }, [drawerTitle, el('span', { style: 'flex:1' }), drawerClose]),
      el('div', { id: 'ocDrawerBody' }, [viewerHost, info])
    ])
  ]);

  const panel = el('div', { id: 'ocPanel' }, [
    el('div', { id: 'ocShell' }, [
      el('div', { id: 'ocHead' }, [
        el('h2', { text: 'ONLINE CHARACTERS' }),
        el('span', { class: 'sub', text: 'search → preview → retrieve → prepare → approve' }),
        el('span', { class: 'spacer' }),
        el('button', { id: 'ocClose', text: 'CLOSE', onclick: () => panel.classList.remove('open') })
      ]),
      el('div', { id: 'ocBar' }, [
        query, sourceSelect, kindSelect, rigSelect, animatedSelect,
        el('label', { class: 'chk' }, [downloadableBox, el('span', { text: 'DOWNLOADABLE ONLY' })]),
        searchButton, directButton
      ]),
      results,
      status
    ]),
    drawer
  ]);
  document.body.append(panel);

  const setStatus = text => { status.textContent = String(text).replace(/\n{3,}/g, '\n\n').trim(); };

  /* ------------------------------------------------------------------ viewer */
  let viewer = null;

  function disposeViewer() {
    if (!viewer) return;
    cancelAnimationFrame(viewer.raf);
    viewer.mixer?.stopAllAction();
    viewer.resizeObserver?.disconnect();
    viewer.host.removeEventListener('pointerdown', viewer.onDown);
    viewer.host.removeEventListener('pointermove', viewer.onMove);
    viewer.host.removeEventListener('pointerup', viewer.onUp);
    viewer.host.removeEventListener('wheel', viewer.onWheel);
    viewer.root?.traverse(node => {
      if (!node.isMesh) return;
      node.geometry?.dispose?.();
      for (const material of [].concat(node.material || [])) material?.dispose?.();
    });
    viewer.renderer.dispose();
    viewer.host.querySelectorAll('canvas').forEach(canvas => canvas.remove());
    viewer = null;
  }

  async function openViewer(descriptor, title) {
    drawerTitle.textContent = title || 'MODEL PREVIEW';
    drawer.classList.add('open');
    disposeViewer();
    info.replaceChildren(el('div', { text: 'Loading the actual model…' }));
    if (!descriptor.modelUrl) {
      info.replaceChildren(
        el('div', { text: descriptor.embedUrl ? 'This source only exposes an embed, not a downloadable file. Opening it is not an import.' : 'No previewable file for this result.' }),
        descriptor.embedUrl ? el('a', { href: descriptor.embedUrl, target: '_blank', rel: 'noopener', text: 'Open source embed ↗', style: 'color:#7af2ff' }) : null
      );
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050c16);
    scene.add(new THREE.HemisphereLight(0xdfefff, 0x2a3644, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fd2ff, 0.9);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    viewerHost.insertBefore(canvas, viewerHint);

    viewer = { scene, camera, renderer, host: viewerHost, theta: 0.7, phi: 1.28, radius: 2.2, target: new THREE.Vector3(), raf: 0 };

    const resize = () => {
      const width = viewerHost.clientWidth || 480;
      const height = viewerHost.clientHeight || 360;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    viewer.resizeObserver = new ResizeObserver(resize);
    viewer.resizeObserver.observe(viewerHost);
    resize();

    const applyCamera = () => {
      if (!viewer) return;
      const { theta, phi, radius, target } = viewer;
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    };
    // One loop drives the camera, clip playback and rendering; dispose() cancels exactly this
    // handle, so no stale frame can touch a disposed viewer.
    const clock = new THREE.Clock();
    const loop = () => {
      if (!viewer) return;
      const delta = clock.getDelta();
      if (viewer.mixer) viewer.mixer.update(delta);
      applyCamera();
      renderer.render(scene, camera);
      viewer.raf = requestAnimationFrame(loop);
    };
    loop();

    const pointer = { down: false, x: 0, y: 0 };
    viewer.onDown = event => { pointer.down = true; pointer.x = event.clientX; pointer.y = event.clientY; canvas.setPointerCapture?.(event.pointerId); };
    viewer.onMove = event => {
      if (!pointer.down) return;
      viewer.theta -= (event.clientX - pointer.x) * 0.01;
      viewer.phi = Math.max(0.25, Math.min(Math.PI - 0.25, viewer.phi - (event.clientY - pointer.y) * 0.008));
      pointer.x = event.clientX; pointer.y = event.clientY;
    };
    viewer.onUp = () => { pointer.down = false; };
    viewer.onWheel = event => {
      event.preventDefault();
      viewer.radius = Math.max(viewer.minRadius, Math.min(viewer.maxRadius, viewer.radius * (1 + Math.sign(event.deltaY) * 0.12)));
    };
    viewerHost.addEventListener('pointerdown', viewer.onDown);
    viewerHost.addEventListener('pointermove', viewer.onMove);
    viewerHost.addEventListener('pointerup', viewer.onUp);
    viewerHost.addEventListener('pointercancel', viewer.onUp);
    viewerHost.addEventListener('wheel', viewer.onWheel, { passive: false });

    const gltf = await new Promise((ok, bad) => new GLTFLoader().load(descriptor.modelUrl, ok, undefined, bad));
    if (!viewer) return;
    const root = gltf.scene;
    viewer.root = root;
    scene.add(root);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z) || 1;
    viewer.target.copy(centre);
    viewer.radius = span * 1.9;
    viewer.minRadius = span * 0.6;
    viewer.maxRadius = span * 6;

    const gridSize = Math.max(span * 2.4, 1);
    const grid = new THREE.GridHelper(gridSize, 24, 0x2e5a7a, 0x16293a);
    grid.position.set(centre.x, box.min.y, centre.z);
    scene.add(grid);

    const mixer = gltf.animations.length ? new THREE.AnimationMixer(root) : null;
    viewer.mixer = mixer;
    clipSelect.replaceChildren(el('option', { value: '', text: gltf.animations.length ? 'NO CLIP' : 'NO CLIPS' }));
    for (const clip of gltf.animations) clipSelect.append(el('option', { value: clip.name, text: `${clip.name} (${clip.duration.toFixed(1)}s)` }));
    clipSelect.onchange = () => {
      if (!mixer) return;
      mixer.stopAllAction();
      const clip = gltf.animations.find(item => item.name === clipSelect.value);
      if (clip) mixer.clipAction(clip).reset().play();
    };
    if (gltf.animations.length) {
      clipSelect.value = gltf.animations[0].name;
      clipSelect.dispatchEvent(new Event('change'));
    }
    viewer.skeleton = null;
    viewer.toggleSkeleton = () => {
      if (viewer.skeleton) {
        scene.remove(viewer.skeleton);
        viewer.skeleton.geometry?.dispose?.();
        viewer.skeleton.material?.dispose?.();
        viewer.skeleton = null;
      } else {
        viewer.skeleton = new THREE.SkeletonHelper(root);
        scene.add(viewer.skeleton);
      }
    };

    const inspection = descriptor.inspection || {};
    const rows = [
      ['Source', `${descriptor.source || ''}${descriptor.uid ? ` · ${descriptor.uid}` : ''}`],
      ['Classified as', `${descriptor.classification?.kind || 'unknown'} (${descriptor.classification?.confidence || 'low'})`],
      ['Rig', inspection.rig === 'yes' ? `yes — ${inspection.joints} joints` : inspection.rig === 'no' ? 'no skeleton' : 'unknown'],
      ['Humanoid bones', fmt(inspection.humanoidJoints)],
      ['Animations', inspection.clips?.length ? `${inspection.clips.length}` : '0'],
      ['Triangles', inspection.triangles?.toLocaleString?.() ?? fmt(inspection.triangles)],
      ['Meshes / materials', `${fmt(inspection.meshes)} / ${fmt(inspection.materials)}`],
      ['Textures', fmt(inspection.textures)],
      ['Height', inspection.height ? `${inspection.height} m` : '—'],
      ['Bounds', inspection.width ? `${inspection.width} × ${inspection.height} × ${inspection.depth} m` : '—'],
      ['Feet below origin', inspection.feetBelowOrigin !== null ? `${inspection.feetBelowOrigin} m` : '—'],
      ['Licence', fmt(descriptor.licence)],
      ['Creator', fmt(descriptor.creator)]
    ];
    info.replaceChildren(
      el('div', { text: descriptor.name || 'Model', style: 'font-size:12px;font-weight:800;color:#eaf7ff' }),
      el('h4', { text: 'MEASURED FROM THE FILE' }),
      el('table', {}, rows.map(([key, value]) => el('tr', {}, [el('td', { text: key }), el('td', { text: String(value) })]))),
      descriptor.classification?.reasons?.length
        ? el('div', { text: `Why: ${descriptor.classification.reasons.join('; ')}`, style: 'margin-top:6px;font-size:9.5px;color:#8fb3cc' })
        : null
    );
    viewerHint.textContent = 'Drag to orbit · wheel to zoom · clips play live';
  }

  function setView(which) {
    if (!viewer) return;
    const angles = { front: 0, side: Math.PI / 2, back: Math.PI };
    viewer.theta = angles[which] ?? viewer.theta;
    viewer.phi = 1.35;
  }
  function toggleSkeleton() { viewer?.toggleSkeleton?.(); }

  function closeDrawer() {
    drawer.classList.remove('open');
    disposeViewer();
  }

  /* ------------------------------------------------------------------ results */
  const availability = row => {
    if (row.downloadableNow) return { text: 'DOWNLOAD READY', cls: 'good' };
    if (row.downloadable && !row.downloadableNow) return { text: 'NEEDS PROVIDER TOKEN', cls: 'warn' };
    return { text: 'NO DOWNLOAD', cls: 'bad' };
  };

  const renderResults = rows => {
    results.replaceChildren();
    if (!rows.length) {
      setStatus('No results matched. Try another term, relax a filter, or use DIRECT URL for a file you already have.');
      return;
    }
    for (const row of rows) {
      const availabilityBadge = availability(row);
      const tags = el('div', { class: 'ocTags' }, [
        el('span', { class: row.classification?.playable ? 'ocTag good' : 'ocTag warn', text: (row.classification?.kind || 'unknown').toUpperCase() }),
        el('span', { class: row.rig === 'yes' ? 'ocTag good' : row.rig === 'no' ? 'ocTag' : 'ocTag warn', text: row.rig === 'yes' ? 'RIGGED' : row.rig === 'no' ? 'UNRIGGED' : 'RIG UNKNOWN' }),
        row.animations ? el('span', { class: 'ocTag', text: `${row.animations} ANIMS` }) : null,
        row.triangles ? el('span', { class: 'ocTag', text: `${Number(row.triangles).toLocaleString()} TRIS` }) : null,
        el('span', { class: `ocTag ${availabilityBadge.cls}`, text: availabilityBadge.text })
      ]);
      const importButton = el('button', {
        text: 'IMPORT TO GAME',
        title: row.downloadableNow ? 'Retrieve and prepare this model' : row.downloadable ? 'This source needs a configured API token before it can download' : 'This result has no downloadable file',
        onclick: () => startImport(row)
      });
      if (!row.downloadableNow) {
        importButton.setAttribute('disabled', 'disabled');
        importButton.setAttribute('aria-disabled', 'true');
      }
      const card = el('div', { class: 'ocCard' }, [
        row.thumbnail ? el('img', { src: row.thumbnail, alt: row.name, loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('div', { class: 'ocThumb' }),
        el('div', { class: 'ocBody' }, [
          el('div', { class: 'ocName', text: row.name }),
          el('div', { class: 'ocMeta', text: `${row.author || row.source}${row.licence ? ` · ${String(row.licence).slice(0, 22)}` : ''}` }),
          tags,
          el('div', { class: 'row' }, [
            el('button', { text: 'PREVIEW', onclick: () => previewRow(row) }), importButton
          ])
        ])
      ]);
      results.append(card);
    }
    setStatus(`${rows.length} result(s). Classification and rig status come from the source metadata; the preview measures the real file.`);
  };

  /* ------------------------------------------------------------------ search */
  const runSearch = async () => {
    const q = query.value.trim();
    const source = sourceSelect.value;
    if (!q) { setStatus('Type a name to search for.'); return; }
    setStatus(`Searching ${source}…`);
    const params = new URLSearchParams({ q, source });
    if (kindSelect.value !== 'all') params.set('kind', kindSelect.value);
    if (rigSelect.value !== 'any') params.set('rigged', rigSelect.value);
    if (animatedSelect.value !== 'any') params.set('animated', animatedSelect.value);
    if (downloadableBox.checked) params.set('downloadable', 'yes');
    let payload;
    try {
      const response = await fetch(`/api/models/search?${params}`);
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `search failed (${response.status})`);
    } catch (error) {
      setStatus(`${payload?.needs === 'NEEDS_TOKEN' ? 'Source needs configuration' : 'Search failed'}: ${error.message}`);
      results.replaceChildren();
      return;
    }
    state.results = payload.results;
    renderResults(payload.results);
  };

  /* ------------------------------------------------------------------ preview */
  const previewRow = async row => {
    state.row = row;
    drawerTitle.textContent = row.name;
    drawer.classList.add('open');
    info.replaceChildren(el('div', { text: 'Retrieving the model for preview…' }));
    try {
      const response = await fetch('/api/models/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, row })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `preview failed (${response.status})`);
      state.preview = { ...payload, source: row.source, uid: row.uid, name: row.name };
      await openViewer(state.preview, row.name);
    } catch (error) {
      info.replaceChildren(el('div', { text: `Preview unavailable: ${error.message}` }));
      disposeViewer();
    }
  };

  /* ------------------------------------------------------------------ import + approval */
  const stageListEl = el('ul', { id: 'ocStages' });
  const logEl = el('div', { id: 'ocLog' });
  const reportEl = el('div', { id: 'ocReport' });
  const operationSelect = el('select', { id: 'ocOperation' });
  const targetSelect = el('select', { id: 'ocTarget' });
  const approveBox = el('input', { id: 'ocApprove', type: 'checkbox' });
  const approveButton = el('button', { class: 'approve', text: 'APPLY APPROVED CHANGE', disabled: 'disabled' });
  const verifyButton = el('button', { class: 'approve', text: 'VERIFY IN RUNTIME', disabled: 'disabled' });
  const approval = el('div', { id: 'ocApproval' }, [
    el('div', { text: 'WHAT SHOULD THIS IMPORT BECOME?', style: 'font-size:9px;letter-spacing:.12em;color:#9feaff' }),
    operationSelect, targetSelect,
    el('label', {}, [approveBox, el('span', { text: 'I approve changing game files with this model' })]),
    approveButton, verifyButton
  ]);
  approval.style.display = 'none';

  const renderStages = stages => {
    stageListEl.replaceChildren(...stages.map(stage => el('li', {
      class: stage.state === 'done' ? 'done' : stage.state === 'running' ? 'running' : stage.state === 'failed' ? 'failed' : '',
      text: `${stage.label}${stage.detail ? ` — ${stage.detail}` : ''}`
    })));
  };

  const opsFor = report => {
    const isProp = report.path === 'prop';
    return isProp
      ? [['prop', 'Install as prop / attachment (not a playable character)']]
      : [
        ['replace', 'Replace an existing character’s model — keeps identity, roster slot, moveset, stats'],
        ['variant', 'Add this as an alternate selectable skin (new roster entry)'],
        ['new', 'Create a completely new playable character'],
        ['prop', 'Install as a prop / attachment instead']
      ];
  };

  const showApproval = report => {
    state.report = report;
    approval.style.display = 'flex';
    operationSelect.replaceChildren(...opsFor(report).map(([value, label]) => el('option', { value, text: label })));
    const refreshTargets = () => {
      const mode = operationSelect.value;
      targetSelect.replaceChildren();
      targetSelect.style.display = mode === 'replace' || mode === 'variant' ? '' : 'none';
      if (mode === 'replace' || mode === 'variant') {
        for (const key of state.roster.manifestKeys) {
          const display = state.roster.launch.find(entry => String(entry.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') === key);
          targetSelect.append(el('option', { value: key, text: display ? `${display.name} (${key})` : key }));
        }
      }
    };
    operationSelect.onchange = refreshTargets;
    refreshTargets();
    approveBox.checked = false;
    approveButton.disabled = true;
    approveBox.onchange = () => { approveButton.disabled = !approveBox.checked; };
    approveButton.onclick = () => commit(report);
    verifyButton.disabled = true;
  };

  const startImport = async row => {
    state.row = row;
    drawerTitle.textContent = `${row.name} — IMPORT`;
    drawer.classList.add('open');
    disposeViewer();
    state.report = null;
    state.commit = null;
    approval.style.display = 'none';
    reportEl.textContent = '';
    logEl.textContent = '';
    stageListEl.replaceChildren();
    info.replaceChildren(
      el('h4', { text: 'IMPORT PIPELINE' }),
      stageListEl,
      el('h4', { text: 'REPORT' }), reportEl,
      el('h4', { text: 'LOG' }), logEl,
      approval
    );
    setStatus(`Importing ${row.name}…`);
    let payload;
    try {
      const response = await fetch('/api/models/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: row.source, row, name: row.name, intent: 'auto' })
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `import refused (${response.status})`);
    } catch (error) {
      reportEl.textContent = `Import refused: ${error.message}`;
      setStatus(`Import refused: ${error.message}`);
      return;
    }
    state.job = payload.job;
    renderStages(payload.job.stages || []);
    poll(payload.job.id);
    setStatus('Retrieving and preparing on the game machine. Nothing is added to the roster until you approve a change.');
  };

  const poll = async id => {
    clearTimeout(state.pollTimer);
    let payload;
    try {
      const response = await fetch(`/api/models/jobs/${id}`);
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'job lookup failed');
    } catch (error) {
      logEl.textContent = `Job lookup failed: ${error.message}`;
      return;
    }
    state.job = payload;
    renderStages(payload.stages || []);
    logEl.textContent = (payload.log || []).slice(-8).join('\n');
    if (payload.state === 'queued' || payload.state === 'running') {
      state.pollTimer = setTimeout(() => poll(id), 1500);
      return;
    }
    if (payload.state === 'failed') {
      const needs = payload.needs === 'TOKEN' ? '\nThis source needs a configured API token before it can download. Search, preview and direct files still work.' : '';
      reportEl.textContent = `FAILED at "${payload.stage}": ${payload.error}${needs}\nThe failing import is kept under artifacts/dev/imports/${payload.id} for diagnosis.`;
      setStatus(`Import failed: ${payload.error}`);
      approval.style.display = 'none';
      return;
    }
    if (payload.state === 'ready' && payload.report) {
      reportEl.textContent = describe(payload.report);
      setStatus('Prepared and validated. Choose what this import should become, then approve it.');
      showApproval(payload.report);
      return;
    }
    if (payload.state === 'integrated' || payload.state === 'verified') {
      reportEl.textContent = describe(payload.report);
      setStatus(payload.state === 'verified' ? 'Integrated and verified in the runtime.' : 'Integrated. Verify it in the runtime when ready.');
    }
  };

  const describe = report => {
    const lines = [];
    lines.push(`${report.name} — ${report.path === 'prop' ? 'PROP / ATTACHMENT' : 'CHARACTER'}`);
    lines.push(`classified: ${report.classification?.kind} (${report.classification?.confidence}) — ${report.classification?.reasons?.join('; ') || 'no reasons'}`);
    lines.push(`origin: ${report.origin?.page || report.source}${report.origin?.licence ? ` · licence ${report.origin.licence}` : ''}`);
    if (report.inspection?.inspected) {
      lines.push(`source file: ${report.inspection.triangles.toLocaleString()} tris · ${report.inspection.meshes} meshes · `
        + `rig ${report.inspection.rig} · ${report.inspection.clips.length} clip(s) · ${report.inspection.height} m tall`);
    } else {
      lines.push(`source file: ${report.inspection?.reason || 'not inspected'}`);
    }
    if (report.character) {
      lines.push(`rig: ${report.character.rigState} · ${report.character.bones ?? 0} bones mapped · ${report.character.joints ?? 0} joints`);
      lines.push(`states: ${Object.entries(report.character.states || {}).map(([state, clip]) => `${state}=${clip}`).join(', ')}`);
      if (report.character.substitutions?.length) lines.push(`substitutions: ${report.character.substitutions.join(' | ')}`);
      lines.push(`character gate: ${report.character.geometryGate} · registry: ${report.character.registered ? 'registered' : 'review mode (not registered)'}`);
    } else {
      lines.push('no rigging or roster work was performed for this asset.');
    }
    lines.push(`roster untouched: ${report.rosterUntouched ? 'yes' : 'no'}`);
    return lines.join('\n');
  };

  const commit = async report => {
    const mode = operationSelect.value;
    const target = targetSelect.style.display === 'none' ? null : targetSelect.value;
    if ((mode === 'replace' || mode === 'variant') && !target) { setStatus('Pick which existing character this applies to.'); return; }
    approveButton.disabled = true;
    setStatus(`Applying approved ${mode}…`);
    let payload;
    try {
      const response = await fetch('/api/models/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: state.job?.id || report.id, mode, target, approved: true, name: report.name })
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `commit failed (${response.status})`);
    } catch (error) {
      setStatus(`Commit refused: ${error.message}`);
      approveButton.disabled = false;
      return;
    }
    state.commit = payload.commit;
    const changed = payload.commit?.roster?.launchAdded?.length ? `added to roster: ${payload.commit.roster.launchAdded.join(', ')}` : 'roster entries unchanged';
    const activeLine = mode === 'replace' ? `\nactive model for ${payload.commit.manifestKey}: ${payload.commit.url}` : '';
    reportEl.textContent += `\n\nAPPLIED (${mode})\n${changed}${activeLine}\nwrote: ${(payload.commit?.wrote || []).join(', ')}`;
    if (mode === 'replace') {
      const restore = el('button', { class: 'approve', text: 'RESTORE PREVIOUS MODEL', onclick: async () => {
        restore.disabled = true;
        setStatus('Restoring the previous model…');
        try {
          const response = await fetch('/api/models/rollback', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: payload.commit.manifestKey, jobId: state.job?.id, approved: true })
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || `restore failed (${response.status})`);
          reportEl.textContent += `\n\nRESTORED\nactive model: ${body.rollback?.url}\nremaining versions: ${body.rollback?.restorableVersions}`;
          setStatus(`Restored ${payload.commit.manifestKey} to its previous model. Reload the page to see it.`);
        } catch (error) {
          setStatus(`Restore refused: ${error.message}`);
          restore.disabled = false;
        }
      } });
      approval.append(restore);
      status.textContent = `Replaced ${payload.commit.manifestKey}'s active model (${payload.commit.restorableVersions ?? 0} previous version(s) kept for rollback).`;
    }
    setStatus(`Applied ${mode}. ${changed}. Reload the page to pick up roster changes; existing models swap on next load.`);
    verifyButton.disabled = false;
    verifyButton.onclick = () => verify(report);
    onImported?.(payload.commit);
  };

  const verify = async report => {
    verifyButton.disabled = true;
    setStatus('Opening the game runtime to verify the committed model…');
    let payload;
    try {
      const response = await fetch('/api/models/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: state.job?.id || report.id })
      });
      payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'verification failed');
    } catch (error) {
      setStatus(`Runtime verification failed: ${error.message}`);
      return;
    }
    reportEl.textContent += `\n\nRUNTIME VERIFICATION\n${JSON.stringify(payload, null, 1)}`;
    setStatus(payload.ok ? 'Runtime verification passed: the committed model loads, binds and plays animation in the game page.'
      : 'Runtime verification did not pass — see the report.');
  };

  /* ------------------------------------------------------------------ direct */
  const directImport = async () => {
    const value = query.value.trim();
    if (!value) { setStatus('Paste a direct .glb/.gltf/.fbx/.obj/.vrm/.blend/.zip link, or a path inside this project.'); return; }
    const isLocal = !/^https?:\/\//i.test(value);
    const row = {
      source: 'direct', uid: null, name: value.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || 'Direct import',
      url: isLocal ? null : value, localPath: isLocal ? value : null, rig: 'unknown', animations: null,
      downloadable: true, downloadableNow: true, triangles: null, licence: null, pageUrl: isLocal ? null : value
    };
    startImport(row);
  };

  /* ------------------------------------------------------------------ wiring */
  searchButton.addEventListener('click', runSearch);
  directButton.addEventListener('click', directImport);
  query.addEventListener('keydown', event => { if (event.key === 'Enter') runSearch(); });

  (async () => {
    try {
      const response = await fetch('/api/models/sources');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'sources unavailable');
      state.sources = payload.sources;
      state.roster = payload.roster || { launch: [], manifestKeys: [] };
      sourceSelect.replaceChildren(...payload.sources
        .filter(source => source.capabilities.search !== 'none')
        .map(source => el('option', { value: source.id, text: `${source.label}${source.capabilities.download === 'direct' ? ' · downloads' : source.capabilities.download === 'token' ? ' · token' : ''}` })));
      const preferred = payload.sources.find(source => source.capabilities.download === 'direct' && !source.needsToken);
      if (preferred) sourceSelect.value = preferred.id;
      const unsupportedCount = Object.keys(payload.unsupported || {}).length;
      const notes = payload.sources.map(source => `${source.label}: ${source.requires}`);
      setStatus(`${notes.join('\n')}\n${unsupportedCount} further sources have no public retrieval route and are listed as unsupported rather than faked.`);
    } catch (error) {
      setStatus(`Model service unavailable in this build (${error.message}). It runs on the dev/import machine.`);
    }
  })();

  const button = el('button', {
    id: 'ocButton', text: 'ONLINE CHARACTERS',
    style: 'position:fixed;right:22px;bottom:22px;z-index:35;padding:10px 14px;font-size:11px;'
      + 'letter-spacing:.12em;background:#0b1b2cf2;border:1px solid #9b7bffaa;color:#e9f6ff;cursor:pointer',
    onclick: () => { panel.classList.add('open'); query.focus(); }
  });
  document.body.append(button);

  window.__ocDebug = { state, previewRow, startImport, open: () => panel.classList.add('open') };
  return {
    open: () => panel.classList.add('open'),
    close: () => { panel.classList.remove('open'); disposeViewer(); }
  };
}
