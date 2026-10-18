import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Final Valley-inspired arena: procedural geometry, native materials, and collision proxies.
// Original fan-inspired scenery; no external model or texture downloads are required.
export function createFinalValley(THREE) {
  const group = new THREE.Group();
  group.name = 'Final Valley - playable arena';
  // Three-band toon ramp for anime-like rock and monument shading.
  const toonRamp = new THREE.DataTexture(new Uint8Array([48,48,48,255,94,94,94,255,164,164,164,255,246,246,246,255]),4,1,THREE.RGBAFormat);
  toonRamp.magFilter = THREE.NearestFilter; toonRamp.minFilter = THREE.NearestFilter; toonRamp.generateMipmaps = false; toonRamp.needsUpdate = true;
  const toon = (color) => new THREE.MeshToonMaterial({color,gradientMap:toonRamp});
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
    [-36, -76, 9], [36, -76, 9],
    [-27, -55, 8], [27, -55, 8],
    [-43, -92, 9], [43, -92, 9], [0, -111, 20],
    [-31, -26, 3.5], [31, -26, 3.5]
  ];
  const stone = toon(0x7d8780);
  const darkStone = toon(0x4e5d5e);
  const moss = toon(0x6a805e);
  const green = toon(0x42634b);
  const riverMat = new THREE.MeshPhysicalMaterial({
    color: 0x4a7883, roughness: .42, metalness: .04,
    transparent: true, opacity: .86,
    emissive: 0x0b2228, emissiveIntensity: .08
  });
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xa8c2c4, transparent: true, opacity: .48, depthWrite: false });
  const statueMat = toon(0x858b84);
  const statueShadow = toon(0x4e5855);
  const hashiramaArmor = toon(0x765447);
  const madaraArmor = toon(0x75423e);
  const engravedHair = toon(0x343c3a);
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
  const clearingMat = toon(0x70786a);
  add(new THREE.CircleGeometry(57, 64), clearingMat, 0, -.018, -30, 1, 1, 1).rotation.x = -Math.PI / 2;

  // Long river and two textured waterfall curtains.
  const river = add(new THREE.PlaneGeometry(9, 136, 1, 1), riverMat, 0, .025, -48);
  river.rotation.x = -Math.PI / 2;
  const waterCanvas = document.createElement('canvas');
  waterCanvas.width = 128; waterCanvas.height = 256;
  const ctx = waterCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, '#345e6a'); grad.addColorStop(.45, '#6e959b'); grad.addColorStop(1, '#304f5c');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 100; i++) {
    ctx.strokeStyle = 'rgba(224,239,235,' + (.04 + rng() * .18) + ')';
    ctx.lineWidth = .5 + rng() * 2;
    const x = rng() * 128, y = rng() * 256;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - .5) * 8, y + 4 + rng() * 35); ctx.stroke();
  }
  const waterTexture = new THREE.CanvasTexture(waterCanvas);
  waterTexture.colorSpace = THREE.SRGBColorSpace;
  waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
  waterTexture.repeat.set(1, 1.6);
  riverMat.map = waterTexture; riverMat.needsUpdate = true;

  // Central waterfall and stone amphitheater establish the valley silhouette.
  add(new THREE.DodecahedronGeometry(1, 2), darkStone, 0, 15, -110, 25, 18, 8);
  const centralFall = add(new THREE.PlaneGeometry(20, 28), foamMat, 0, 14, -100);
  centralFall.name = 'Central waterfall between Hashirama and Madara';
  const centralPool = add(new THREE.CircleGeometry(10, 48), riverMat, 0, .03, -84);
  centralPool.rotation.x = -Math.PI / 2;
  // A broken-stone bank makes the narrow river read as water between cliffs, not a giant blue floor.
  for (let i=0;i<34;i++) {
    const side=i%2?1:-1, z=-108+i*4;
    const x=side*(5.4+rng()*1.5), h=.5+rng()*1.4;
    const bank=add(new THREE.DodecahedronGeometry(1,1), i%4?stone:moss, x, h*.3, z, 1.0+rng()*.8, h, 1.1+rng()*.7);
    bank.rotation.y=rng()*Math.PI;
  }

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
    const fall = add(new THREE.PlaneGeometry(10, 22, 1, 1), foamMat, side * 21, 11, -97);
    fall.rotation.y = side * -.12;
    const pool = add(new THREE.CircleGeometry(7, 32), riverMat, side * 21, .035, -85, 1, 1, 1);
    pool.rotation.x = -Math.PI / 2;
    for (let i = 0; i < 10; i++) {
      const x = side * (18 + rng() * 17);
      const z = -91 + rng() * 84;
      const h = 1.4 + rng() * 4.5;
      add(new THREE.ConeGeometry(.7 + rng(), h, 5), darkStone, x, h * .35, z, 1.3, .8, 1.5);
    }
  }

  // Two monumental, stylized stone shinobi statues, assembled from real 3D meshes.
  function makeStatue(x, z, mirror = 1, identity = 'hashirama') {
    const isMadara = identity === 'madara';
    const armorMat = isMadara ? madaraArmor : hashiramaArmor;
    const statue = new THREE.Group();
    statue.name = isMadara ? 'Madara Uchiha — stone guardian' : 'Hashirama Senju — stone guardian';
    statue.userData.characterName = identity;
    statue.position.set(x, 0, z);
    statue.scale.setScalar(1.62);
    group.add(statue);
    const part = (geometry, material, px, py, pz, sx = 1, sy = 1, sz = 1, rz = 0) => {
      const mesh = add(geometry, material, px, py, pz, sx, sy, sz, statue);
      mesh.rotation.z = rz;
      return mesh;
    };
    part(new THREE.BoxGeometry(8, 2, 7), darkStone, 0, 1, 0);
    part(new THREE.CylinderGeometry(3.8, 4.6, 2.5, 8), stone, 0, 3.1, 0);
    part(new THREE.CylinderGeometry(2.2, 2.7, 7.5, 8), armorMat, 0, 7.8, 0);
    part(new THREE.SphereGeometry(2.1, 12, 10), statueMat, 0, 13, 0, 1, 1.18, .88);
    // angular brow and long cheek plates give a carved, mask-like face
    part(new THREE.BoxGeometry(3.3, .65, .35), statueShadow, 0, 13.7, 1.75, 1, 1, 1, -.05 * mirror);
    part(new THREE.BoxGeometry(2.3, 1.15, .4), stone, 0, 12.2, 1.75);
    part(new THREE.BoxGeometry(5.5, 2, 2.5), armorMat, 0, 10.5, 0);
    part(new THREE.CylinderGeometry(.85, 1.1, 5.8, 7), armorMat, -3.2 * mirror, 8.5, 0, 1, 1, 1, -.28 * mirror);
    part(new THREE.CylinderGeometry(.8, 1, 5.6, 7), armorMat, 3.2 * mirror, 8.4, 0, 1, 1, 1, .32 * mirror);
    part(new THREE.BoxGeometry(1.35, 4.6, 1.7), statueShadow, -1.35, 2.7, 0, 1, 1, 1, -.08);
    part(new THREE.BoxGeometry(1.35, 4.6, 1.7), statueShadow, 1.35, 2.7, 0, 1, 1, 1, .08);
    // raised arm and stone blade silhouette
    part(new THREE.CylinderGeometry(.55, .72, 5.6, 7), armorMat, 4.1 * mirror, 13.2, 0, 1, 1, 1, -.62 * mirror);
    // The raised hand forms the Valley of the End's confrontation seal, not a sword.
    part(new THREE.BoxGeometry(.88,1.05,.72), armorMat, 5.25*mirror,15.9,.12);
    part(new THREE.BoxGeometry(.2,2.25,.2), statueMat,5.08*mirror,17.45,.25);
    part(new THREE.BoxGeometry(.2,2.0,.2), statueMat,5.43*mirror,17.3,.25);
    part(new THREE.BoxGeometry(.2,1.0,.2), statueMat,5.72*mirror,16.85,.25);
    part(new THREE.SphereGeometry(.8, 8, 8), armorMat, 4.8 * mirror, 15.6, 0);
    // Distinct stone silhouettes based on the two rival shinobi.
    if (!isMadara) {
      // Hashirama: long swept-back hair and several broad Senju armor plates.
      for (let i=-2;i<=2;i++) {
        const lock=part(new THREE.ConeGeometry(.62,5.4,6),engravedHair,i*.52,11.0,-1.05-Math.abs(i)*.12);
        lock.rotation.z=i*.075;
      }
      for (const y of [8.8,9.65,10.5]) part(new THREE.BoxGeometry(4.1,.2,2.3),hashiramaArmor,0,y,.9);
      part(new THREE.BoxGeometry(5.9,.4,2.2),hashiramaArmor,0,10.9,0);
      for (const side of [-1,1]) {
        part(new THREE.BoxGeometry(1.3,2.2,1.8),hashiramaArmor,side*2.9,10.4,0,1,1,1,side*.09);
      }
    } else {
      // Madara: a crown of angular spikes, heavier red-brown armor, and a broad war fan.
      for (let i=0;i<11;i++) {
        const angle=(i/10)*Math.PI*1.45-Math.PI*.72;
        const px=Math.sin(angle)*2.0, py=14.0+Math.cos(angle)*1.0;
        const spike=part(new THREE.ConeGeometry(.58,3.9,5),engravedHair,px,py,-.35);
        spike.rotation.z=-angle*.8;
      }
      for (const side of [-1,1]) {
        part(new THREE.BoxGeometry(1.25,2.2,1.6),madaraArmor,side*2.9,10.4,.15,1,1,1,side*.08);
        for (const y of [8.8,9.55,10.3]) part(new THREE.BoxGeometry(1.15,.18,1.35),madaraArmor,side*2.65,y,.85);
      }
      part(new THREE.CircleGeometry(1,12),statueShadow,-4.4,10.8,-1.55,1.7,1.9,1);
      for (let i=-2;i<=2;i++) {
        const rib=part(new THREE.BoxGeometry(.08,3.0,.08),statueMat,-4.4+i*.65,10.8,-1.25);
        rib.rotation.z=i*.22;
      }
    }
    return statue;
  }
  // Canonical orientation: Madara on the left, Hashirama on the right.
  makeStatue(-36,-76,1,'madara');
  makeStatue(36,-76,-1,'hashirama');

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
  const mistMaterial = new THREE.MeshBasicMaterial({ color: 0xc7d4d3, transparent: true, opacity: .28, depthWrite: false });
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
