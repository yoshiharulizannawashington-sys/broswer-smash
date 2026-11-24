import * as THREE from 'three';

// Additions mounted on the authored tournament arena, not a replacement for it. Every
// coordinate below is in the GLB's own arena space: the ring is centred at z = -12 and the
// gate sits at z = -43. Adds broadcast screens, a four-star-ball beacon, corner pylons and
// a painted centre medallion so the supplied ring reads as a televised world tournament.
const GOLD = 0xd9b45c;
const RED = 0xc93a2f;
const DARK = 0x11151a;

function standard(color, { metalness = .35, roughness = .5, emissive = 0, emissiveIntensity = 1 } = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity });
}

function textTexture(title, subtitle, accent) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 512, 220);
  bg.addColorStop(0, '#101923');
  bg.addColorStop(.55, '#1d3042');
  bg.addColorStop(1, '#0b1118');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 220);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 504, 212);
  ctx.fillStyle = accent;
  ctx.fillRect(20, 155, 472, 5);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff5d6';
  ctx.font = '900 52px "Trebuchet MS", Arial, sans-serif';
  ctx.fillText(title, 256, 82, 462);
  ctx.fillStyle = accent;
  ctx.font = '700 26px "Trebuchet MS", Arial, sans-serif';
  ctx.fillText(subtitle, 256, 132);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeScreen(title, subtitle, accent, width, height) {
  const screen = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(width + .55, height + .55, .28), standard(DARK, { metalness: .65, roughness: .3 }));
  frame.castShadow = false;
  frame.receiveShadow = false;
  screen.add(frame);
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: textTexture(title, subtitle, accent), toneMapped: false })
  );
  face.position.z = .16;
  screen.add(face);
  return screen;
}

function addPylon(parent, x, z, gold, flame) {
  const pylon = new THREE.Group();
  pylon.name = 'Tournament broadcast pylon';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.7, 1.1, .8, 8), standard(DARK, { metalness: .55, roughness: .4 }));
  base.position.y = .4;
  pylon.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.17, .3, 7.6, 8), gold);
  mast.position.y = 4.4;
  pylon.add(mast);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(.9, .13, 7, 20), gold);
  cage.position.y = 8.3;
  cage.rotation.x = Math.PI / 2;
  pylon.add(cage);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(.54, 12, 8), flame);
  lamp.position.y = 8.3;
  pylon.add(lamp);
  pylon.position.set(x, .18, z);
  parent.add(pylon);
  return pylon;
}

function addFourStarBeacon(parent, gold, flame) {
  const beacon = new THREE.Group();
  beacon.name = 'Four-star ball beacon';
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(.11, .18, 13, 7), gold);
  arm.position.set(0, 6.5, 0);
  beacon.add(arm);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.9, .09, 7, 28), gold);
  halo.position.y = 13.2;
  halo.rotation.x = Math.PI / 2;
  beacon.add(halo);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(2.5, 24, 16), standard(0xff8a1f, {
    metalness: .15, roughness: .32, emissive: 0xff4b0a, emissiveIntensity: .75
  }));
  ball.position.y = 13.2;
  beacon.add(ball);
  const starMaterial = standard(RED, { metalness: .25, roughness: .35, emissive: 0x7a1008, emissiveIntensity: .35 });
  for (const [sx, sy, sz] of [[0, .16, .99], [.57, .56, .62], [-.61, .31, .73], [.34, -.54, .77]]) {
    const length = Math.hypot(sx, sy, sz) || 1;
    const star = new THREE.Mesh(new THREE.SphereGeometry(.52, 9, 7), starMaterial);
    star.position.set(sx / length * 2.48, 13.2 + sy / length * 2.48, sz / length * 2.48);
    beacon.add(star);
  }
  beacon.position.set(0, 0, -42);
  parent.add(beacon);
  return beacon;
}

/**
 * Build the broadcast furniture on the already-loaded tournament GLB. Purely visual: no
 * collision volumes, no mesh replacement and no new texture downloads.
 */
export function buildTournamentBroadcast(group) {
  if (!group) return { added: 0, meshes: 0 };
  const gold = standard(GOLD, { metalness: .72, roughness: .33 });
  const flame = standard(0xffdf8a, { metalness: .1, roughness: .2, emissive: 0xff9d35, emissiveIntensity: 1.5 });
  const red = standard(RED, { metalness: .25, roughness: .5 });
  const white = standard(0xf3ead3, { metalness: .08, roughness: .72 });
  const root = new THREE.Group();
  root.name = 'Tournament broadcast dressing';
  let meshes = 0;

  // Painted centre medallion. The authored ring surface is white marble; the medallion gives
  // the wide duel shot a visual anchor without touching the ring mesh or its collider.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.25, 4.25, .06, 48), red);
  disc.position.set(0, .235, -12);
  root.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(4.35, .16, 8, 48), gold);
  rim.position.set(0, .27, -12);
  rim.rotation.x = Math.PI / 2;
  root.add(rim);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, .07, 36), white);
  inner.position.set(0, .28, -12);
  root.add(inner);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const star = new THREE.Mesh(new THREE.SphereGeometry(.22, 7, 5), red);
    star.position.set(Math.cos(a) * 3.1, .34, -12 + Math.sin(a) * 3.1);
    root.add(star);
  }

  // Broadcast screens above the rear stands, angled toward the duel camera.
  for (const [x, z, ry, title, subtitle, accent] of [
    [-18, -31, .12, 'WORLD MARTIAL ARTS', 'CAPSULE CORP · LIVE', '#e8c860'],
    [18, -31, -.12, 'GRAND CHAMPION', 'PAPAYA ISLAND', '#d8452f']
  ]) {
    const screen = makeScreen(title, subtitle, accent, 8.8, 4.1);
    screen.position.set(x, 8.4, z);
    screen.rotation.y = ry;
    root.add(screen);
  }

  // Four corner pylons frame the ring without sitting inside the playable rectangle.
  for (const [x, z] of [[-21.5, -27], [21.5, -27], [-21.5, 2.5], [21.5, 2.5]]) addPylon(root, x, z, gold, flame);
  addFourStarBeacon(root, gold, flame);

  // Ring apron signage: low boards just outside the ring edge, facing the camera.
  for (const [x, z, ry, title, subtitle, accent] of [
    [-14.6, 6.2, 0, 'WORLD TOURNAMENT', 'FINALS · ROUND 1', '#e8c860'],
    [14.6, 6.2, 0, 'CAPSULE CORP', 'OFFICIAL SPONSOR', '#8fdcff']
  ]) {
    const board = makeScreen(title, subtitle, accent, 6.2, 1.25);
    board.position.set(x, 1.45, z);
    board.rotation.y = ry;
    root.add(board);
  }

  group.add(root);
  root.traverse(node => {
    if (node.isMesh) {
      meshes++;
      node.castShadow = false;
      node.receiveShadow = false;
    }
  });
  group.userData.tournamentBroadcast = { added: root.children.length, meshes };
  return { added: root.children.length, meshes };
}
