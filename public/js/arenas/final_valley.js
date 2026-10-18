import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Final Valley-inspired arena: procedural geometry, native materials, and collision proxies.
// Original fan-inspired scenery; no external model or texture downloads are required.
export function createFinalValley(THREE) {
  const group = new THREE.Group();
  group.name = 'Final Valley - playable arena';
  // Prefer the Blender-exported GLB when it exists; keep the procedural scene as a no-download fallback.
  const blenderLoader = new GLTFLoader();
  const blenderAssetUrl = new URL('../../assets/final_valley.glb', import.meta.url).href;
  blenderLoader.load(blenderAssetUrl, (gltf) => {
    for (const child of group.children) child.visible = false;
    gltf.scene.name = 'Final Valley Blender environment';
    gltf.scene.traverse((node) => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    group.add(gltf.scene);
  }, undefined, () => {
    // The optional Blender export may not be present yet; the procedural arena remains active.
  });
  const obstacles = [
    [-36, -52, 7.2], [36, -52, 7.2],
    [-27, -55, 8], [27, -55, 8],
    [-43, -72, 9], [43, -72, 9],
    [-31, -26, 3.5], [31, -26, 3.5]
  ];
  const stone = new THREE.MeshStandardMaterial({ color: 0x596a70, roughness: .94, metalness: .04 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x37474e, roughness: .98 });
  const moss = new THREE.MeshStandardMaterial({ color: 0x536c4c, roughness: 1 });
  const green = new THREE.MeshStandardMaterial({ color: 0x2f5945, roughness: 1 });
  const riverMat = new THREE.MeshPhysicalMaterial({
    color: 0x258bb5, roughness: .2, metalness: .18, transmission: .08,
    transparent: true, opacity: .9, clearcoat: 1, clearcoatRoughness: .12,
    emissive: 0x06334c, emissiveIntensity: .45
  });
  const foamMat = new THREE.MeshBasicMaterial({ color: 0x9eeeff, transparent: true, opacity: .52, depthWrite: false });
  const statueMat = new THREE.MeshStandardMaterial({ color: 0x737c7d, roughness: .88, metalness: .08 });
  const statueShadow = new THREE.MeshStandardMaterial({ color: 0x465358, roughness: .94 });
  const add = (geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const rng = (() => { let seed = 948271; return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; })();

  // Broad, gently broken stone clearing. The fighter collision plane stays level at y=0.
  const clearingMat = new THREE.MeshStandardMaterial({ color: 0x5a6659, roughness: .98, metalness: .02 });
  add(new THREE.CircleGeometry(57, 64), clearingMat, 0, -.018, -30, 1, 1, 1).rotation.x = -Math.PI / 2;

  // Long river and two textured waterfall curtains.
  const river = add(new THREE.PlaneGeometry(15, 150, 1, 1), riverMat, 0, .025, -48);
  river.rotation.x = -Math.PI / 2;
  const waterCanvas = document.createElement('canvas');
  waterCanvas.width = 128; waterCanvas.height = 256;
  const ctx = waterCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#17658d'); grad.addColorStop(.45, '#48c4e7'); grad.addColorStop(1, '#174d78');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 100; i++) {
    ctx.strokeStyle = 'rgba(210,250,255,' + (.08 + rng() * .36) + ')';
    ctx.lineWidth = .5 + rng() * 2;
    const x = rng() * 128, y = rng() * 256;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - .5) * 8, y + 4 + rng() * 35); ctx.stroke();
  }
  const waterTexture = new THREE.CanvasTexture(waterCanvas);
  waterTexture.colorSpace = THREE.SRGBColorSpace;
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(1, 2);
  riverMat.map = waterTexture; riverMat.needsUpdate = true;

  for (const side of [-1, 1]) {
    // Layered cliff masses frame the river without blocking the combat clearing.
    for (let i = 0; i < 6; i++) {
      const x = side * (26 + rng() * 12);
      const z = -84 + i * 15 + (rng() - .5) * 7;
      const h = 14 + rng() * 19;
      const cliff = add(new THREE.DodecahedronGeometry(1, 2), i % 2 ? darkStone : stone,
        x, h * .42, z, 7 + rng() * 6, h, 9 + rng() * 5);
      cliff.rotation.set((rng() - .5) * .12, rng() * Math.PI, (rng() - .5) * .16);
      add(new THREE.DodecahedronGeometry(1, 1), moss, x - side * 2, h * .86, z + 1,
        5 + rng() * 4, 1.4, 5 + rng() * 4);
    }
    // Waterfall sheets sit against the rear cliff, with foamy broken edges.
    const fall = add(new THREE.PlaneGeometry(12, 19, 1, 1), foamMat, side * 17, 9, -82);
    fall.rotation.y = side * -.12;
    const pool = add(new THREE.CircleGeometry(8, 32), riverMat, side * 17, .035, -70, 1, 1, 1);
    pool.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 10; i++) {
      const x = side * (18 + rng() * 17);
      const z = -91 + rng() * 84;
      const h = 1.4 + rng() * 4.5;
      add(new THREE.ConeGeometry(.7 + rng(), h, 5), darkStone, x, h * .35, z, 1.3, .8, 1.5);
    }
  }

  // Two monumental, stylized stone shinobi statues, assembled from real 3D meshes.
  function makeStatue(x, z, mirror = 1) {
    const statue = new THREE.Group();
    statue.position.set(x, 0, z);
    statue.scale.setScalar(1.55);
    group.add(statue);
    const part = (geometry, material, px, py, pz, sx = 1, sy = 1, sz = 1, rz = 0) => {
      const mesh = add(geometry, material, px, py, pz, sx, sy, sz, statue);
      mesh.rotation.z = rz;
      return mesh;
    };
    part(new THREE.BoxGeometry(8, 2, 7), darkStone, 0, 1, 0);
    part(new THREE.CylinderGeometry(3.8, 4.6, 2.5, 8), stone, 0, 3.1, 0);
    part(new THREE.CylinderGeometry(2.2, 2.7, 7.5, 8), statueMat, 0, 7.8, 0);
    part(new THREE.SphereGeometry(2.1, 12, 10), statueMat, 0, 13, 0, 1, 1.18, .88);
    // angular brow and long cheek plates give a carved, mask-like face
    part(new THREE.BoxGeometry(3.3, .65, .35), statueShadow, 0, 13.7, 1.75, 1, 1, 1, -.05 * mirror);
    part(new THREE.BoxGeometry(2.3, 1.15, .4), stone, 0, 12.2, 1.75);
    part(new THREE.BoxGeometry(5.5, 2, 2.5), statueMat, 0, 10.5, 0);
    part(new THREE.CylinderGeometry(.85, 1.1, 5.8, 7), statueMat, -3.2 * mirror, 8.5, 0, 1, 1, 1, -.28 * mirror);
    part(new THREE.CylinderGeometry(.8, 1, 5.6, 7), statueMat, 3.2 * mirror, 8.4, 0, 1, 1, 1, .32 * mirror);
    part(new THREE.BoxGeometry(1.35, 4.6, 1.7), statueShadow, -1.35, 2.7, 0, 1, 1, 1, -.08);
    part(new THREE.BoxGeometry(1.35, 4.6, 1.7), statueShadow, 1.35, 2.7, 0, 1, 1, 1, .08);
    // raised arm and stone blade silhouette
    part(new THREE.CylinderGeometry(.55, .72, 5.6, 7), statueMat, 4.1 * mirror, 13.2, 0, 1, 1, 1, -.62 * mirror);
    part(new THREE.BoxGeometry(.55, 8.5, .8), statueShadow, 6.6 * mirror, 17.8, -.1, 1, 1, 1, -.18 * mirror);
    part(new THREE.SphereGeometry(.8, 8, 8), statueMat, 4.8 * mirror, 15.6, 0);
    return statue;
  }
  makeStatue(-38, -51, 1);
  makeStatue(38, -51, -1);

  // Broken stepping stones cross the shallow channel; they are scenery, not fighter blockers.
  for (let i = 0; i < 13; i++) {
    const z = 12 - i * 5.2;
    const x = Math.sin(i * .78) * 4.4;
    const stoneMesh = add(new THREE.DodecahedronGeometry(1, 1), i % 3 ? stone : moss,
      x, .1 + rng() * .12, z, 1.2 + rng() * .8, .18 + rng() * .12, 1.25 + rng() * .7);
    stoneMesh.rotation.y = rng() * Math.PI;
  }

  // Forested ridgelines and wind-shaped trees on the outer margins.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 24; i++) {
      const x = side * (43 + rng() * 33);
      const z = -104 + rng() * 142;
      const h = 3 + rng() * 5;
      add(new THREE.CylinderGeometry(.18, .45, h, 5), darkStone, x, h / 2, z);
      for (let layer = 0; layer < 3; layer++) {
        add(new THREE.ConeGeometry(1.7 + rng() * 1.2, 3.4, 6), i % 3 ? green : moss,
          x, h * .55 + layer * 1.8, z, 1, 1, 1);
      }
    }
  }

  // Small luminous river glints and mist particles make the waterfalls read at game distance.
  const mist = new THREE.Group();
  group.add(mist);
  const mistMaterial = new THREE.MeshBasicMaterial({ color: 0xb3edff, transparent: true, opacity: .38, depthWrite: false });
  const mistPoints = [];
  for (let i = 0; i < 54; i++) {
    const p = add(new THREE.SphereGeometry(.08 + rng() * .12, 5, 4), mistMaterial,
      (rng() - .5) * 42, .4 + rng() * 8, -83 + rng() * 24, 1, 1, 1, mist);
    p.userData.phase = rng() * Math.PI * 2;
    mistPoints.push(p);
  }

  return {
    group,
    obstacles,
    update(dt, time = 0) {
      waterTexture.offset.y = (waterTexture.offset.y + dt * .12) % 1;
      river.position.y = .025 + Math.sin(time * 1.7) * .012;
      for (const p of mistPoints) {
        p.position.y += dt * (.25 + Math.sin(time + p.userData.phase) * .1);
        p.position.x += Math.sin(time * .7 + p.userData.phase) * dt * .12;
        if (p.position.y > 9) p.position.y = .4;
      }
    }
  };
}
