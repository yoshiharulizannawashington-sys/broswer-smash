// Asgard atmosphere and architecture: a Norse plaza, a snowstorm, carved braziers and breakable
// pillars, all as live systems driven by the game's own update step.
//
// The plaza itself is built here rather than left to the flat authored floor: an arc of fluted
// columns with carved bands and gilded capitals, arcade arches, hanging banners, a rune-inlaid
// dais rim and a palace backdrop with spires. Geometry that repeats is drawn through InstancedMesh,
// so a full colonnade is a handful of draw calls rather than a hundred.
//
// Weather is three layers of snow at different sizes and speeds plus a gusting wind vector, so it
// reads as a snowstorm instead of sparse dust. Braziers are real stone furniture with layered
// flames, embers, a glow pool on the ground and lights that follow the nearest fire; pillars are
// carved, keep a broken stump, and throw large tumbling debris with a ground shock ring.
//
// Performance: counts and lights scale with the quality setting, shadow casting is off for props,
// and every material, geometry and texture created here is disposed on teardown.
import * as THREE from 'three';

export const ASGARD_PROPS = Object.freeze({
  braziers: [[-6.4, 2.6], [6.4, 2.6], [-6.4, -3.2], [6.4, -3.2]],
  pillars: [[-4.0, -6.0], [4.0, -6.0], [0.0, -8.2]]
});

const QUALITY = {
  low: { snow: [700, 0, 0], debris: 16, shadows: false, columns: 8, lights: 1, detail: .7 },
  medium: { snow: [1500, 900, 420], debris: 24, shadows: true, columns: 12, lights: 2, detail: 1 },
  high: { snow: [2000, 1200, 600], debris: 34, shadows: true, columns: 16, lights: 4, detail: 1.3 }
};

const TAU = Math.PI * 2;

function standard(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? .82,
    metalness: options.metalness ?? .05,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    flatShading: options.flatShading !== false
  });
}

/** Soft round flake sprite, generated once and shared by every snow layer. */
function makeFlakeTexture() {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.45, 'rgba(238,247,255,.85)');
  gradient.addColorStop(1, 'rgba(220,238,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One InstancedMesh from a list of {position, rotation, scale} placements. */
function instance(geometry, material, placements) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  placements.forEach((placement, index) => {
    position.set(...placement.position);
    euler.set(...(placement.rotation || [0, 0, 0]));
    quaternion.setFromEuler(euler);
    scale.set(...(placement.scale || [1, 1, 1]));
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** The Norse plaza: colonnade, arcade, banners, dais rim, palace backdrop and distant spires. */
function buildArchitecture(group, { ground, settings, materials }) {
  const counts = { columns: 0, arches: 0, banners: 0, towers: 0, runes: 0, stones: 0 };
  const { stone, paleStone, darkStone, gold, snowStone, rune } = materials;
  const columns = settings.columns;
  // Leave the camera side of the ring open so the pulled-back shot looks between the columns.
  const span = Math.PI * 1.52;
  const start = Math.PI / 2 + (TAU - span) / 2;
  const radius = 26;
  const placements = { base: [], shaft: [], band: [], capital: [], abacus: [], snow: [], flute: [], gold: [] };
  const archPlacements = [];
  const bannerPlacements = [];
  const bannerTrim = [];
  const angles = [];
  for (let index = 0; index < columns; index++) {
    const angle = start + (index / Math.max(1, columns - 1)) * span;
    angles.push(angle);
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    const yaw = angle;
    placements.base.push({ position: [x, ground + .23, z], rotation: [0, yaw, 0] });
    placements.shaft.push({ position: [x, ground + 2.3, z] });
    placements.band.push({ position: [x, ground + 1.15, z], rotation: [Math.PI / 2, 0, 0] });
    placements.band.push({ position: [x, ground + 3.35, z], rotation: [Math.PI / 2, 0, 0] });
    placements.gold.push({ position: [x, ground + 1.22, z], rotation: [Math.PI / 2, 0, 0] });
    placements.capital.push({ position: [x, ground + 4.14, z], rotation: [0, yaw, 0] });
    placements.abacus.push({ position: [x, ground + 4.4, z], rotation: [0, yaw, 0] });
    placements.snow.push({ position: [x, ground + 4.52, z] });
    // Six flutes per shaft: the vertical channels that make the column read as carved stone.
    for (let flute = 0; flute < 6; flute++) {
      const fluteAngle = (flute / 6) * TAU;
      placements.flute.push({
        position: [x + Math.sin(fluteAngle) * .43, ground + 2.3, z + Math.cos(fluteAngle) * .43],
        rotation: [0, fluteAngle, 0]
      });
    }
    counts.columns++;
    if (index < columns - 1) {
      const next = start + ((index + 1) / Math.max(1, columns - 1)) * span;
      const midAngle = (angle + next) / 2;
      const archX = Math.sin(midAngle) * radius;
      const archZ = Math.cos(midAngle) * radius;
      archPlacements.push({ position: [archX, ground + 4.5, archZ], rotation: [0, midAngle + Math.PI / 2, 0] });
      counts.arches++;
      if (index % 2 === 0) {
        bannerPlacements.push({ position: [archX, ground + 3.3, archZ], rotation: [0, midAngle + Math.PI / 2, 0] });
        bannerTrim.push({ position: [archX, ground + 2.2, archZ], rotation: [0, midAngle + Math.PI / 2, 0] });
        counts.banners++;
      }
    }
  }

  group.add(instance(new THREE.CylinderGeometry(.72, .94, .46, 10), stone, placements.base));
  group.add(instance(new THREE.CylinderGeometry(.40, .48, 3.55, 12), paleStone, placements.shaft));
  group.add(instance(new THREE.TorusGeometry(.47, .05, 6, 16), darkStone, placements.band));
  group.add(instance(new THREE.TorusGeometry(.5, .028, 6, 16), gold, placements.gold));
  group.add(instance(new THREE.BoxGeometry(1.06, .34, 1.06), stone, placements.capital));
  group.add(instance(new THREE.BoxGeometry(1.28, .16, 1.28), paleStone, placements.abacus));
  group.add(instance(new THREE.BoxGeometry(1.3, .06, 1.3), snowStone, placements.snow));
  group.add(instance(new THREE.BoxGeometry(.055, 3.1, .055), darkStone, placements.flute));
  counts.stones += 8;
  group.add(instance(new THREE.TorusGeometry(2.18, .16, 6, 18, Math.PI), paleStone, archPlacements));
  group.add(instance(new THREE.BoxGeometry(.95, 2.3, .05), new THREE.MeshStandardMaterial({ color: 0x7d2230, roughness: .92, side: THREE.DoubleSide, flatShading: true }), bannerPlacements));
  group.add(instance(new THREE.BoxGeometry(1.02, .14, .07), gold, bannerTrim));

  // Dais rim: a carved parapet that gives the fight a defined ground plane instead of an endless
  // pale floor. Rune inlays sit at the four cardinal points.
  const rimSegments = 24;
  const rim = [];
  const runePlates = [];
  const rimRadius = 13.6;
  for (let index = 0; index < rimSegments; index++) {
    const angle = (index / rimSegments) * TAU;
    if (Math.abs(Math.cos(angle)) > .93 && Math.cos(angle) > 0) continue; // entry gap
    rim.push({ position: [Math.sin(angle) * rimRadius, ground + .09, Math.cos(angle) * rimRadius], rotation: [0, angle, 0] });
    if (index % 6 === 0) {
      runePlates.push({ position: [Math.sin(angle) * (rimRadius - .12), ground + .2, Math.cos(angle) * (rimRadius - .12)], rotation: [0, angle, 0], scale: [1, 1, 1] });
    }
  }
  group.add(instance(new THREE.BoxGeometry(3.4, .18, .5), paleStone, rim));
  group.add(instance(new THREE.BoxGeometry(1.5, .04, .18), rune, runePlates));
  counts.runes += runePlates.length;
  counts.stones += 2;

  // A defined stone plaza under the fight. The authored floor is a pale plane that read as
  // infinite white; a darker inlaid disc gives the arena an edge, gives the snow something to
  // fall against, and makes the dais ring legible.
  const plazaMaterial = standard(0x6d727d, { roughness: .93 });
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(13.3, 13.7, .14, 56), plazaMaterial);
  plaza.position.set(0, ground + .02, 0);
  plaza.receiveShadow = true;
  group.add(plaza);
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(9.4, .09, 6, 64), gold);
  inlay.position.set(0, ground + .1, 0);
  inlay.rotation.x = Math.PI / 2;
  group.add(inlay);
  const inlayRune = new THREE.Mesh(new THREE.TorusGeometry(6.6, .05, 6, 56), rune);
  inlayRune.position.set(0, ground + .1, 0);
  inlayRune.rotation.x = Math.PI / 2;
  group.add(inlayRune);
  counts.stones += 3;

  // Palace backdrop: a long wall of arches with flanking towers and a gilded roof, so the stage
  // has a recognizable Asgard silhouette behind the fight.
  const backdropZ = -46;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(46, 9.5, 2.2), paleStone);
  wall.position.set(0, ground + 4.75, backdropZ);
  group.add(wall);
  const wallTrim = new THREE.Mesh(new THREE.BoxGeometry(47, .7, 2.5), gold);
  wallTrim.position.set(0, ground + 9.6, backdropZ);
  group.add(wallTrim);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(48, .5, 3.4), darkStone);
  roof.position.set(0, ground + 10.1, backdropZ);
  group.add(roof);
  const windowPlacements = [];
  for (const x of [-15, -5, 5, 15]) {
    windowPlacements.push({ position: [x, ground + 4.4, backdropZ + 1.16], rotation: [0, 0, 0] });
  }
  group.add(instance(new THREE.BoxGeometry(2.6, 5.4, .18), rune, windowPlacements));
  group.add(instance(new THREE.BoxGeometry(3.0, .22, .3), gold, windowPlacements.map(item => ({ ...item, position: [item.position[0], item.position[1] + 2.9, item.position[2]] }))));
  counts.stones += 3;
  counts.towers += 4;

  const towerPlacements = [];
  const towerRoofs = [];
  for (const [x, z, height, width] of [[-40, -52, 20, 3.0], [40, -52, 20, 3.0], [-24, -60, 26, 2.4], [24, -60, 26, 2.4]]) {
    towerPlacements.push({ position: [x, ground + height / 2, z], rotation: [0, .2 * Math.sign(x || 1), 0], scale: [width / 2.8, height / 18, width / 2.8] });
    towerRoofs.push({ position: [x, ground + height + 1.9, z], scale: [width / 2.8, 1, width / 2.8] });
  }
  group.add(instance(new THREE.CylinderGeometry(2.5, 2.9, 18, 10), paleStone, towerPlacements));
  group.add(instance(new THREE.ConeGeometry(3.1, 4.2, 8), gold, towerRoofs));

  // Central dome and needle spires on the horizon: the Golden City silhouette.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 20, 14), gold);
  dome.position.set(0, ground + 12.5, -72);
  dome.scale.set(1, .62, 1);
  group.add(dome);
  const domeCollar = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.6, 1.2, 20), paleStone);
  domeCollar.position.set(0, ground + 10.4, -72);
  group.add(domeCollar);
  const spirePlacements = [];
  for (let index = 0; index < 10; index++) {
    const angle = (index / 10) * TAU;
    const distance = 66 + (index % 3) * 16;
    spirePlacements.push({
      position: [Math.sin(angle) * distance, ground + 10 + (index % 4) * 6, -54 + Math.cos(angle) * distance * .5],
      scale: [.7 + (index % 3) * .2, 1 + (index % 4) * .28, .7 + (index % 3) * .2]
    });
  }
  group.add(instance(new THREE.ConeGeometry(1.9, 12, 6), gold, spirePlacements));
  counts.towers += 1;

  // Snow drifts banked against the colonnade.
  const drift = [];
  for (let index = 0; index < 14; index++) {
    const angle = start + (index / 14) * span;
    drift.push({
      position: [Math.sin(angle) * (radius - 2.2), ground + .12, Math.cos(angle) * (radius - 2.2)],
      rotation: [0, angle, 0],
      scale: [1.4 + (index % 3) * .4, .5, .9]
    });
  }
  group.add(instance(new THREE.SphereGeometry(1, 9, 6), snowStone, drift));
  counts.stones += 1;

  return counts;
}

export function createAsgardAtmosphere({ scene, renderer = null, quality = 'medium', ground = 0 } = {}) {
  if (!scene) return null;
  const settings = QUALITY[quality] || QUALITY.medium;
  const group = new THREE.Group();
  group.name = 'asgard-atmosphere';
  scene.add(group);

  const materials = {
    stone: standard(0x8f887b, { roughness: .88 }),
    paleStone: standard(0xcfc6b2, { roughness: .8 }),
    darkStone: standard(0x6b665d, { roughness: .9 }),
    gold: standard(0xd8b055, { roughness: .3, metalness: .9 }),
    snowStone: standard(0xeaf2ff, { roughness: .96, metalness: 0 }),
    rune: standard(0x8fe4ff, { roughness: .4, metalness: .2, emissive: 0x2f8ecf, emissiveIntensity: 1.5 })
  };

  const architecture = buildArchitecture(group, { ground, settings, materials });

  // ---- weather: three layers of snow with a gusting wind --------------------------------------
  const flakeTexture = makeFlakeTexture();
  const snowLayers = [];
  const snowConfig = [
    { size: .1, opacity: .7, fall: .95, wind: .85, spread: 60, height: 24 },
    { size: .17, opacity: .92, fall: 1.5, wind: 1.2, spread: 50, height: 19 },
    { size: .27, opacity: 1, fall: 2.3, wind: 1.7, spread: 36, height: 14 }
  ];
  settings.snow.forEach((count, index) => {
    if (!count) return;
    const config = snowConfig[index] || snowConfig[0];
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const drift = new Float32Array(count);
    for (let particle = 0; particle < count; particle++) {
      positions[particle * 3] = (Math.random() - .5) * config.spread;
      positions[particle * 3 + 1] = ground + Math.random() * config.height;
      positions[particle * 3 + 2] = (Math.random() - .5) * config.spread;
      drift[particle] = .6 + Math.random() * 1.4;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: index === 2 ? 0xffffff : 0xeaf3ff,
      size: config.size,
      map: flakeTexture || null,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      sizeAttenuation: true,
      alphaTest: .02
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 4;
    group.add(points);
    snowLayers.push({ points, geometry, config, drift, count });
  });

  // ---- braziers: carved stone furniture, layered fire, glow pool and local light ---------------
  const braziers = [];
  const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
  const flameMaterials = {
    outer: new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }),
    inner: new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }),
    core: new THREE.MeshBasicMaterial({ color: 0xfff6cf, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false })
  };
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false });
  ASGARD_PROPS.braziers.forEach(([x, z], index) => {
    const brazier = new THREE.Group();
    brazier.position.set(x, ground, z);
    const add = (mesh, position, rotation) => {
      mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      brazier.add(mesh);
      return mesh;
    };
    add(new THREE.Mesh(new THREE.CylinderGeometry(.52, .64, .18, 12), materials.darkStone), [0, .09, 0]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.2, .3, .72, 10), materials.stone), [0, .54, 0]);
    add(new THREE.Mesh(new THREE.TorusGeometry(.26, .035, 6, 16), materials.gold), [0, .32, 0], [Math.PI / 2, 0, 0]);
    add(new THREE.Mesh(new THREE.CylinderGeometry(.52, .3, .36, 16, 1, true), materials.stone), [0, 1.02, 0]);
    add(new THREE.Mesh(new THREE.TorusGeometry(.52, .055, 6, 20), materials.paleStone), [0, 1.2, 0], [Math.PI / 2, 0, 0]);
    for (let leg = 0; leg < 3; leg++) {
      const angle = (leg / 3) * TAU;
      const strut = add(new THREE.Mesh(new THREE.BoxGeometry(.07, .5, .07), materials.darkStone), [Math.sin(angle) * .34, .34, Math.cos(angle) * .34]);
      strut.rotation.z = Math.sin(angle) * .18;
      strut.rotation.x = -Math.cos(angle) * .18;
    }
    for (let ember = 0; ember < 5; ember++) {
      const angle = (ember / 5) * TAU;
      add(new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 5), emberMaterial), [Math.sin(angle) * .26, 1.16, Math.cos(angle) * .26]);
    }
    const outer = add(new THREE.Mesh(new THREE.ConeGeometry(.3, .92, 10, 1, true), flameMaterials.outer.clone()), [0, 1.62, 0]);
    const inner = add(new THREE.Mesh(new THREE.ConeGeometry(.19, .62, 8, 1, true), flameMaterials.inner.clone()), [0, 1.56, 0]);
    const core = add(new THREE.Mesh(new THREE.ConeGeometry(.1, .36, 6, 1, true), flameMaterials.core.clone()), [0, 1.46, 0]);
    const glow = add(new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), glowMaterial.clone()), [0, .02, 0], [-Math.PI / 2, 0, 0]);
    glow.renderOrder = 2;
    group.add(brazier);
    braziers.push({ x, z, group: brazier, flames: [outer, inner, core], glow, flare: 0, lit: true, index, light: null });
  });
  // One shared key light, plus per-brazier lights only where the quality setting can afford them.
  const fireLight = new THREE.PointLight(0xffa94d, 2.4, 18, 1.7);
  fireLight.position.set(0, ground + 2.4, 0);
  group.add(fireLight);
  const localLights = [];
  braziers.slice(0, Math.max(0, settings.lights - 1)).forEach(brazier => {
    const light = new THREE.PointLight(0xffb15c, 0, 9, 2);
    light.position.set(brazier.x, ground + 1.5, brazier.z);
    brazier.light = light;
    localLights.push(light);
    group.add(light);
  });

  // ---- breakable carved pillars ---------------------------------------------------------------
  const pillars = [];
  const debris = [];
  const shockwaves = [];
  const debrisGeometry = new THREE.DodecahedronGeometry(1, 0);
  const debrisMaterial = standard(0x8b8477, { roughness: .92 });
  let destroyed = 0;
  let frames = 0;
  let time = 0;
  let flashes = 0;
  let nextFlash = 7 + Math.random() * 8;

  ASGARD_PROPS.pillars.forEach(([x, z], index) => {
    const pillar = new THREE.Group();
    pillar.position.set(x, ground, z);
    const standing = new THREE.Group();
    const add = (group3, mesh, position, rotation) => {
      mesh.position.set(...position);
      if (rotation) mesh.rotation.set(...rotation);
      group3.add(mesh);
      return mesh;
    };
    add(standing, new THREE.Mesh(new THREE.BoxGeometry(1.2, .3, 1.2), materials.darkStone), [0, .15, 0]);
    add(standing, new THREE.Mesh(new THREE.CylinderGeometry(.56, .7, .5, 10), materials.stone), [0, .55, 0]);
    add(standing, new THREE.Mesh(new THREE.CylinderGeometry(.4, .48, 2.5, 12), materials.paleStone), [0, 2.05, 0]);
    add(standing, new THREE.Mesh(new THREE.TorusGeometry(.46, .05, 6, 16), materials.darkStone), [0, 1.1, 0], [Math.PI / 2, 0, 0]);
    add(standing, new THREE.Mesh(new THREE.TorusGeometry(.46, .05, 6, 16), materials.darkStone), [0, 2.9, 0], [Math.PI / 2, 0, 0]);
    add(standing, new THREE.Mesh(new THREE.BoxGeometry(.95, .3, .95), materials.stone), [0, 3.42, 0]);
    add(standing, new THREE.Mesh(new THREE.BoxGeometry(1.1, .14, 1.1), materials.paleStone), [0, 3.62, 0]);
    add(standing, new THREE.Mesh(new THREE.BoxGeometry(.13, 1.8, .05), materials.rune.clone()), [0, 2.15, .44]);
    add(standing, new THREE.Mesh(new THREE.BoxGeometry(1.14, .06, 1.14), materials.snowStone), [0, 3.72, 0]);
    // Six flutes, matching the colonnade.
    for (let flute = 0; flute < 6; flute++) {
      const angle = (flute / 6) * TAU;
      add(standing, new THREE.Mesh(new THREE.BoxGeometry(.05, 2.2, .05), materials.darkStone),
        [Math.sin(angle) * .43, 2.05, Math.cos(angle) * .43]);
    }
    pillar.add(standing);
    // Stump and broken spikes, hidden until the pillar breaks.
    const stump = new THREE.Group();
    stump.visible = false;
    add(stump, new THREE.Mesh(new THREE.CylinderGeometry(.44, .48, .55, 12), materials.paleStone), [0, .78, 0]);
    for (let spike = 0; spike < 4; spike++) {
      const angle = (spike / 4) * TAU + .4;
      const shard = add(stump, new THREE.Mesh(new THREE.ConeGeometry(.13, .45 + (spike % 2) * .2, 5), materials.paleStone),
        [Math.sin(angle) * .24, 1.08, Math.cos(angle) * .24]);
      shard.rotation.z = Math.sin(angle) * .3;
      shard.rotation.x = -Math.cos(angle) * .3;
    }
    add(stump, new THREE.Mesh(new THREE.BoxGeometry(.13, .5, .05), materials.rune.clone()), [0, .78, .44]);
    pillar.add(stump);
    group.add(pillar);
    pillars.push({ x, z, group: pillar, standing, stump, broken: false, radius: .95 });
  });

  function promoteDebris(position, count) {
    for (let index = 0; index < count && debris.length < settings.debris; index++) {
      const piece = new THREE.Mesh(debrisGeometry, debrisMaterial);
      const scale = .16 + Math.random() * .22;
      piece.scale.set(scale, scale * (.6 + Math.random() * .8), scale);
      piece.position.copy(position);
      piece.position.y += .25 + Math.random() * 1.5;
      piece.position.x += (Math.random() - .5) * .8;
      piece.position.z += (Math.random() - .5) * .8;
      piece.castShadow = false;
      group.add(piece);
      debris.push({
        mesh: piece,
        velocity: new THREE.Vector3((Math.random() - .5) * 5.6, 2.2 + Math.random() * 4.4, (Math.random() - .5) * 5.6),
        spin: new THREE.Vector3((Math.random() - .5) * 5, (Math.random() - .5) * 5, (Math.random() - .5) * 5),
        life: 4.5 + Math.random() * 1.6,
        settled: false
      });
    }
  }

  function spawnShockwave(position) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(.9, .07, 6, 32),
      new THREE.MeshBasicMaterial({ color: 0xd8c79b, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.position.set(position.x, ground + .06, position.z);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    shockwaves.push({ mesh: ring, t: 0, life: .7 });
  }

  function breakPillar(pillar) {
    if (pillar.broken) return false;
    pillar.broken = true;
    pillar.standing.visible = false;
    pillar.stump.visible = true;
    destroyed++;
    const at = new THREE.Vector3(pillar.x, ground + 1.6, pillar.z);
    promoteDebris(at, 13);
    spawnShockwave(at);
    // A brief flash at the break sells the impact before the debris reads.
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flash.position.copy(at);
    group.add(flash);
    shockwaves.push({ mesh: flash, t: 0, life: .3, burst: true });
    globalThis.window?.spawnImpact?.(at, 22, 0xc9b98a);
    globalThis.window?.combatAudio?.play?.('explosion', { position: { x: pillar.x, y: ground + 1, z: pillar.z } });
    return true;
  }

  function flareBrazier(position) {
    let nearest = null;
    let best = Infinity;
    for (const brazier of braziers) {
      const distance = Math.hypot(brazier.x - position.x, brazier.z - position.z);
      if (distance < best) { best = distance; nearest = brazier; }
    }
    if (nearest && best < 4.6) {
      nearest.flare = 1;
      flashes++;
      return true;
    }
    return false;
  }

  /** Advance weather, firelight, debris and shock rings; also watches live attacks for prop hits. */
  function update(dt, fighters = []) {
    const step = Math.min(.05, Math.max(0, Number(dt) || 0));
    frames++;
    time += step;

    // Gusting wind, shared by every layer so the storm has one direction.
    const gust = 1 + Math.sin(time * .45) * .55 + Math.sin(time * 1.3) * .18;
    const windX = (2.6 + gust * 1.4);
    const windZ = .9 + Math.sin(time * .3) * .5;
    for (const layer of snowLayers) {
      const attributes = layer.geometry.getAttribute('position');
      const { config, drift } = layer;
      for (let particle = 0; particle < layer.count; particle++) {
        const offset = particle * 3;
        attributes.array[offset] += windX * step * drift[particle] * config.wind * .55;
        attributes.array[offset + 1] -= config.fall * drift[particle] * step * 1.4;
        attributes.array[offset + 2] += windZ * step * drift[particle] * config.wind * .4;
        if (attributes.array[offset + 1] < ground - .6) {
          attributes.array[offset + 1] = ground + config.height + Math.random() * 4;
          attributes.array[offset] = (Math.random() - .5) * config.spread - 6;
          attributes.array[offset + 2] = (Math.random() - .5) * config.spread;
        }
        if (attributes.array[offset] > config.spread * .55) attributes.array[offset] = -config.spread * .55;
      }
      attributes.needsUpdate = true;
    }

    let nearest = braziers[0];
    let nearestDistance = Infinity;
    braziers.forEach((brazier, index) => {
      brazier.flare = Math.max(0, brazier.flare - step * 1.6);
      const flicker = 1 + Math.sin(time * (9 + index * 1.7) + index) * .09 + Math.sin(time * 23 + index) * .04;
      const flare = brazier.flare;
      brazier.flames[0].scale.set(1 + flare * .55, flicker * (1 + flare * .9), 1 + flare * .55);
      brazier.flames[1].scale.set(1 + flare * .4, flicker * (1.04 + flare * .7), 1 + flare * .4);
      brazier.flames[2].scale.set(1 + flare * .3, flicker * (1.08 + flare * .5), 1 + flare * .3);
      brazier.flames[0].rotation.y = time * .7 + index;
      brazier.flames[1].rotation.y = -time * 1.1 + index;
      brazier.glow.material.opacity = .13 + flare * .16 + Math.sin(time * 7 + index) * .02;
      brazier.glow.scale.setScalar(1 + flare * .35);
      if (brazier.light) brazier.light.intensity = .9 + flicker * .35 + flare * 2.4;
      for (const fighter of fighters) {
        if (!fighter?.position) continue;
        const distance = Math.hypot(brazier.x - fighter.position.x, brazier.z - fighter.position.z);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = brazier; }
      }
    });
    // The key light sits on the fire nearest the action, so a lit brazier actually lights the
    // fighter standing beside it instead of a fixed point in the middle of the plaza.
    fireLight.position.set(nearest.x, ground + 2.1, nearest.z);
    fireLight.intensity = 2.6 + Math.sin(time * 9) * .25 + braziers.reduce((sum, brazier) => sum + brazier.flare * 1.8, 0);

    if (time > nextFlash) {
      nextFlash = time + 9 + Math.random() * 12;
      flashes++;
    }

    for (let index = debris.length - 1; index >= 0; index--) {
      const piece = debris[index];
      piece.life -= step;
      piece.velocity.y -= 12 * step;
      piece.mesh.position.addScaledVector(piece.velocity, step);
      piece.mesh.rotation.x += piece.spin.x * step;
      piece.mesh.rotation.y += piece.spin.y * step;
      piece.mesh.rotation.z += piece.spin.z * step;
      if (piece.mesh.position.y < ground + .18) {
        piece.mesh.position.y = ground + .18;
        if (!piece.settled) {
          // One bounce, then it rests: rubble should stay on the floor instead of sliding.
          if (piece.velocity.y < -1.5) {
            piece.velocity.y *= -.32;
            piece.velocity.x *= .55;
            piece.velocity.z *= .55;
          } else {
            piece.settled = true;
            piece.velocity.set(0, 0, 0);
            piece.spin.set(0, 0, 0);
          }
        }
      }
      if (piece.life <= 0) {
        group.remove(piece.mesh);
        debris.splice(index, 1);
      }
    }

    for (let index = shockwaves.length - 1; index >= 0; index--) {
      const wave = shockwaves[index];
      wave.t += step;
      const t = wave.t / wave.life;
      if (wave.burst) {
        wave.mesh.scale.setScalar(1 + t * 2.4);
      } else {
        wave.mesh.scale.setScalar(1 + t * 6);
        wave.mesh.rotation.z += step;
      }
      wave.mesh.material.opacity = (wave.burst ? .55 : .75) * (1 - t);
      if (t >= 1) {
        group.remove(wave.mesh);
        wave.mesh.geometry.dispose();
        wave.mesh.material.dispose();
        shockwaves.splice(index, 1);
      }
    }

    // Props respond to real attacks: a live, unspent active frame within reach breaks a pillar and
    // lights a brazier. This uses the same attackQueue the combat resolver uses.
    for (const fighter of fighters) {
      if (!fighter?.position) continue;
      const strikes = (fighter.attackQueue || []).filter(attack => !attack.hit && attack.damage >= 10);
      for (const strike of strikes) {
        for (const pillar of pillars) {
          if (pillar.broken) continue;
          if (Math.hypot(pillar.x - fighter.position.x, pillar.z - fighter.position.z) < pillar.radius + 1.15) {
            breakPillar(pillar);
          }
        }
        flareBrazier(fighter.position);
      }
    }
  }

  function report() {
    return {
      active: true,
      quality,
      snow: snowLayers.reduce((sum, layer) => sum + layer.count, 0),
      snowLayers: snowLayers.length,
      braziers: braziers.length,
      litBraziers: braziers.filter(brazier => brazier.lit).length,
      flameLayers: braziers.reduce((sum, brazier) => sum + brazier.flames.length, 0),
      pillars: pillars.length,
      destroyed,
      debris: debris.length,
      flashes,
      frames,
      fireLight: +fireLight.intensity.toFixed(2),
      architecture,
      localLights: localLights.length,
      drawCalls: renderer?.info?.render?.calls ?? null
    };
  }

  function dispose() {
    scene.remove(group);
    for (const layer of snowLayers) {
      layer.geometry.dispose();
      layer.points.material.dispose();
    }
    flakeTexture?.dispose?.();
    scene.traverse?.(() => {});
    group.traverse(node => {
      if (node.isInstancedMesh) node.dispose?.();
      if (node.geometry) node.geometry.dispose();
      if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => material.dispose?.());
    });
    debris.length = 0;
    shockwaves.length = 0;
    pillars.forEach(pillar => {
      pillar.broken = false;
      pillar.standing.visible = true;
      pillar.stump.visible = false;
    });
  }

  return { update, report, dispose, group, breakPillar, flareBrazier, get destroyed() { return destroyed; } };
}
