// Height comparison scene for the production roster.
//
// This is deliberately not a second renderer or a mocked preview: it calls the same spawn() path a
// match uses, waits for each production body to mount, applies the same character_scale profiles,
// and then freezes the arena so every body is standing on the same ground line. The camera is a
// single perspective camera with all bodies at the same depth, so relative pixel heights are
// comparable. It is URL/debug driven and never runs during a normal match.
import * as THREE from 'three';
import { applyHeightProfile, heightProfileFor, identitySlug } from './character_scale.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function bodyBounds(model) {
  const box = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (!node.isMesh) return;
    for (let parent = node; parent; parent = parent.parent) {
      if (String(parent.name || '').startsWith('Equipped')) return;
    }
    const meshBox = new THREE.Box3().setFromObject(node);
    if (!meshBox.isEmpty()) box.union(meshBox);
  });
  return box;
}

function hideMatchUi() {
  const selectors = [
    '#loading', '#hud', '#combatHud', '#roundScore', '#timer', '#p1power', '#p2power',
    '#healthbars', '#topbar', '#controls', '#menu', '#characterSelect', '#character-select',
    '.hud', '.hudbar', '.topbar', '.controls', '.menu', '.select-screen'
  ];
  const hidden = [];
  for (const element of document.querySelectorAll(selectors.join(','))) {
    if (!element || element.id === 'heightLineupOverlay') continue;
    if (element.style.visibility === 'hidden') continue;
    element.style.visibility = 'hidden';
    hidden.push(element.id || element.className || element.tagName);
  }
  return hidden;
}

function makeOverlay(count, min, max) {
  const overlay = document.createElement('div');
  overlay.id = 'heightLineupOverlay';
  Object.assign(overlay.style, {
    position: 'fixed', left: '24px', top: '18px', zIndex: '30', pointerEvents: 'none',
    color: '#eaf8ff', font: '700 14px/1.45 system-ui, sans-serif', textShadow: '0 2px 8px #00121e'
  });
  const title = document.createElement('div');
  title.textContent = 'BROWSER BROS — PRODUCTION HEIGHT LINEUP';
  title.style.cssText = 'font-size:22px;letter-spacing:.08em;font-weight:1000;color:#fff';
  const sub = document.createElement('div');
  sub.textContent = count + ' fighters · one ground line · ordered short → tall · ' + min.toFixed(2) + '–' + max.toFixed(2) + ' m';
  sub.style.cssText = 'font-size:12px;letter-spacing:.06em;color:#9cd9ee;margin-top:3px';
  overlay.append(title, sub);
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Install the debug scene. `spawn` is main.js's real spawn function, passed in so this module does
 * not duplicate (or drift from) the mount/weapon/animation path.
 */
export function installHeightLineup({ spawn, scene, camera, renderer, roster }) {
  window.__browserSmashHeightLineupActive = false;
  window.__browserSmashHeightLineupData = null;
  let lineupWidth = 0;
  let lineupLookX = 0;
  let isolationState = null;

  function frameLineup(focusWidth = lineupWidth, aspectOverride = 0) {
    const aspect = aspectOverride > 0
      ? aspectOverride
      : Math.max(.5, renderer.domElement.width / renderer.domElement.height);
    const verticalFov = THREE.MathUtils.degToRad(24);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const distance = focusWidth / (2 * Math.tan(horizontalFov / 2)) + 5;
    camera.fov = 24;
    camera.aspect = aspect;
    camera.position.set(lineupLookX, 1.8, distance);
    camera.lookAt(lineupLookX, 1.12, 0);
    camera.updateProjectionMatrix();
    return { focusWidth, distance, aspect };
  }

  function isolateScene(lineup, width) {
    const keep = new Set();
    for (const { fighter } of lineup) {
      let node = fighter.model;
      while (node) { keep.add(node); node = node.parent; }
      fighter.model.traverse(node => keep.add(node));
    }
    const hidden = [];
    scene.traverse(object => {
      if (!(object.isMesh || object.isSprite || object.isLine)) return;
      if (keep.has(object)) return;
      hidden.push({ object, visible: object.visible });
      object.visible = false;
    });
    const background = scene.background;
    const fog = scene.fog;
    scene.background = new THREE.Color(0x0d1722);
    scene.fog = null;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 12, 28),
      new THREE.MeshStandardMaterial({ color: 0x263640, roughness: .93, metalness: .02 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.012;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(width + 12, Math.max(24, Math.round(width * 2)), 0x3b5a6b, 0x1c2a33);
    grid.position.y = 0;
    scene.add(grid);
    return { hidden, background, fog, floor, grid };
  }

  window.__browserSmashHeightLineup = async (names = null, options = {}) => {
    if (window.__browserSmashHeightLineupActive) return window.__browserSmashHeightLineupData;
    const requested = names && names.length
      ? names.map(name => Array.isArray(name) ? { name: name[0], archetype: name[1] } : { name, archetype: roster.find(([n]) => n === name)?.[1] || 'warrior' })
      : roster.map(([name, archetype]) => ({ name, archetype }));
    const entries = requested
      .map(entry => ({ ...entry, profile: heightProfileFor(entry.name), key: identitySlug(entry.name) }))
      .sort((a, b) => a.profile.targetHeight - b.profile.targetHeight || a.name.localeCompare(b.name));
    if (!entries.length) return null;

    const spacing = Math.max(.7, Number(options.spacing) || 1.02);
    const width = (entries.length - 1) * spacing;
    lineupWidth = width;
    lineupLookX = 0;
    const previous = (window.fighters || []).slice();
    for (const fighter of previous) if (fighter?.model) fighter.model.visible = false;
    window.__browserSmashHeightLineupActive = true;
    window.paused = true;
    if (typeof window.__browserSmashPause === 'function') window.__browserSmashPause?.(true);

    const lineup = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const fighter = spawn(entry.name, -width / 2 + index * spacing, entry.archetype, false);
      fighter.lineupFighter = true;
      fighter.facing = 0;
      fighter.facingZ = 1;
      fighter.model.position.set(-width / 2 + index * spacing, 0, 0);
      fighter.position.copy(fighter.model.position);
      fighter.model.rotation.y = Number(fighter.model.userData?.modelFacingOffset) || 0;
      fighter.velocity?.set?.(0, 0, 0);
      lineup.push({ fighter, entry });
      if (index % 6 === 0) await wait(0);
    }

    const timeout = Math.max(4000, Number(options.timeout) || 60000);
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline && lineup.some(({ fighter }) => !fighter.characterModelLoaded)) {
      await wait(200);
    }
    // One more pass after the last mount: this is the profile that the live match uses, and it
    // records authored/target/applied scale for every body.
    for (const { fighter } of lineup) {
      applyHeightProfile(fighter, { stageScale: 1 });
      fighter.facing = 0;
      fighter.facingZ = 1;
      fighter.model.rotation.y = Number(fighter.model.userData?.modelFacingOffset) || 0;
      fighter.model.visible = true;
      fighter.velocity?.set?.(0, 0, 0);
      fighter.attackQueue.length = 0;
      fighter.hitboxes.length = 0;
    }

    isolationState = options.isolate === false ? null : isolateScene(lineup, width);

    const rows = lineup.map(({ fighter, entry }) => {
      const bounds = bodyBounds(fighter.model);
      const size = bounds.getSize(new THREE.Vector3());
      const userData = fighter.model.userData || {};
      return {
        name: entry.name,
        identityKey: entry.key,
        profile: entry.profile.label,
        targetHeight: entry.profile.targetHeight,
        referenceHeight: entry.profile.referenceHeight,
        bodyRadius: entry.profile.bodyRadius,
        hurtboxHeight: entry.profile.hurtboxHeight,
        seated: entry.profile.seated,
        authoredHeight: Number(userData.authoredHeight) || null,
        appliedScale: Number(userData.appliedScale) || null,
        modelScale: fighter.model.scale.toArray().map(value => +value.toFixed(4)),
        modelHeight: +size.y.toFixed(3),
        modelWidth: +size.x.toFixed(3),
        feetY: +bounds.min.y.toFixed(3),
        position: fighter.model.position.toArray().map(value => +value.toFixed(3)),
        loaded: Boolean(fighter.characterModelLoaded),
        imported: Boolean(userData.characterAssetUrl || userData.importedModel)
      };
    });

    const minTarget = Math.min(...rows.map(row => row.targetHeight));
    const maxTarget = Math.max(...rows.map(row => row.targetHeight));
    const overlay = makeOverlay(rows.length, minTarget, maxTarget);
    const hiddenUi = hideMatchUi();
    if (document.body) document.body.classList.add('bb-height-lineup');

    // One depth plane. Use a narrow FOV to reduce perspective distortion; all bodies are at z=0.
    const framed = frameLineup();
    if (renderer.xr?.enabled) renderer.xr.enabled = false;

    const data = {
      count: rows.length,
      spacing,
      width: +width.toFixed(2),
      camera: { x: 0, y: 1.8, z: +framed.distance.toFixed(2), fov: 24, aspect: +framed.aspect.toFixed(3), focusWidth: +framed.focusWidth.toFixed(2) },
      hiddenUi,
      rows
    };
    window.__browserSmashHeightLineupData = data;
    window.__browserSmashHeightLineupActive = true;
    window.__browserSmashHeightLineupOverlay = overlay;
    // Capture helper: pan to a section and frame only that slice, so a wide roster can be
    // reviewed at a readable size without moving the models or changing their ground line.
    window.__browserSmashHeightLineupReframe = (reframe = {}) => {
      lineupLookX = Number(reframe.x) || 0;
      const focusWidth = Number(reframe.focusWidth) || lineupWidth;
      const result = frameLineup(focusWidth, Number(reframe.aspect) || 0);
      const cameraState = {
        x: lineupLookX, y: 1.8, z: +result.distance.toFixed(2), fov: 24,
        aspect: +result.aspect.toFixed(3), focusWidth: +result.focusWidth.toFixed(2)
      };
      window.__browserSmashHeightLineupData.camera = cameraState;
      return cameraState;
    };
    return data;
  };

  window.__browserSmashHeightLineupCleanup = () => {
    const data = window.__browserSmashHeightLineupData;
    for (const fighter of window.fighters || []) {
      if (!fighter.lineupFighter) {
        if (fighter.model) fighter.model.visible = true;
        continue;
      }
      fighter.model?.removeFromParent?.();
      fighter.model?.traverse?.(node => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose?.());
        else node.material?.dispose?.();
      });
      fighter.animationController?.dispose?.();
    }
    window.fighters = (window.fighters || []).filter(fighter => !fighter.lineupFighter);
    if (isolationState) {
      for (const entry of isolationState.hidden) entry.object.visible = entry.visible;
      scene.background = isolationState.background;
      scene.fog = isolationState.fog;
      isolationState.floor.removeFromParent();
      isolationState.floor.geometry.dispose();
      isolationState.floor.material.dispose();
      isolationState.grid.removeFromParent();
      isolationState.grid.geometry.dispose();
      isolationState.grid.material.dispose();
      isolationState = null;
    }
    // The lineup hid the live fighters before isolating the scene. Restore those bodies and the
    // normal HUD after putting back the environment, otherwise ending a debug capture leaves the
    // match invisible even though its simulation is still running.
    for (const fighter of window.fighters || []) if (fighter.model) fighter.model.visible = true;
    for (const element of document.querySelectorAll('#loading,#hud,#combatHud,#roundScore,#timer,#p1power,#p2power,#healthbars,#topbar,#controls,#menu,#characterSelect,#character-select,.hud,.hudbar,.topbar,.controls,.menu,.select-screen')) {
      if (element.id !== 'heightLineupOverlay') element.style.visibility = '';
    }
    document.getElementById('heightLineupOverlay')?.remove();
    if (document.body) document.body.classList.remove('bb-height-lineup');
    window.__browserSmashHeightLineupActive = false;
    window.__browserSmashHeightLineupData = null;
    window.__browserSmashHeightLineupReframe = null;
    return data;
  };
}
