import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Final Valley-inspired arena: procedural geometry, native materials, and collision proxies.
// Original fan-inspired scenery; no external model or texture downloads are required.
export function createFinalValley(THREE) {
  const group = new THREE.Group();
  group.name = 'Final Valley - playable arena';
  // Three-band toon ramp for anime-like rock and monument shading.
  const toonRamp = new THREE.DataTexture(new Uint8Array([48,48,48,255,94,94,94,255,164,164,164,255,246,246,246,255]),4,1,THREE.RGBAFormat);
  toonRamp.magFilter = THREE.NearestFilter; toonRamp.minFilter = THREE.NearestFilter; toonRamp.generateMipmaps = false; toonRamp.needsUpdate = true;
  // Hand-painted mineral grain and fracture lines keep the cel-shaded surfaces from looking plastic.
  const rockCanvas = document.createElement('canvas'); rockCanvas.width = 512; rockCanvas.height = 512;
  const rockCtx = rockCanvas.getContext('2d');
  rockCtx.fillStyle = '#d6d7ca'; rockCtx.fillRect(0,0,512,512);
  for(let i=0;i<26000;i++){
    const x=Math.random()*512,y=Math.random()*512,v=95+Math.random()*130;
    rockCtx.fillStyle='rgba('+v+','+(v+Math.random()*7)+','+(v-4)+','+(.035+Math.random()*.13)+')';
    rockCtx.fillRect(x,y,.5+Math.random()*2,.5+Math.random()*2);
  }
  for(let i=0;i<62;i++){
    const x=Math.random()*512,y=Math.random()*512;
    rockCtx.strokeStyle=i%3?'rgba(47,58,54,.12)':'rgba(225,224,207,.22)';
    rockCtx.lineWidth=.5+Math.random()*1.5;
    rockCtx.beginPath();rockCtx.moveTo(x,y);
    rockCtx.lineTo(x+(Math.random()-.5)*45,y+4+Math.random()*24);
    rockCtx.lineTo(x+(Math.random()-.5)*72,y+15+Math.random()*44);rockCtx.stroke();
  }
  const rockTexture=new THREE.CanvasTexture(rockCanvas);
  rockTexture.colorSpace=THREE.SRGBColorSpace;rockTexture.wrapS=rockTexture.wrapT=THREE.RepeatWrapping;
  rockTexture.repeat.set(2,2);rockTexture.anisotropy=8;
  const rockNormalData=new Uint8Array(256*256*4);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const i=(y*256+x)*4;const nx=Math.sin(x*.15+Math.cos(y*.055)*1.8)*.12+Math.sin(y*.27-x*.12)*.08;
    const ny=Math.cos(y*.17+x*.07)*.12+Math.cos(x*.09-y*.21)*.08;
    rockNormalData[i]=128+nx*110;rockNormalData[i+1]=128+ny*110;rockNormalData[i+2]=247;rockNormalData[i+3]=255;
  }
  const rockNormal=new THREE.DataTexture(rockNormalData,256,256,THREE.RGBAFormat);
  rockNormal.wrapS=rockNormal.wrapT=THREE.RepeatWrapping;rockNormal.repeat.set(2,2);rockNormal.colorSpace=THREE.NoColorSpace;rockNormal.needsUpdate=true;
  const toon = (color) => new THREE.MeshToonMaterial({color,gradientMap:toonRamp,map:rockTexture,normalMap:rockNormal,normalScale:new THREE.Vector2(.14,.14)});
  const toonFlat = (color) => new THREE.MeshToonMaterial({color,gradientMap:toonRamp});
  // Prefer the Blender-exported GLB when it exists; keep the procedural scene as a no-download fallback.
  const blenderLoader = new GLTFLoader();
  const blenderAssetUrl = new URL('../../assets/final_valley.glb', import.meta.url);
  blenderAssetUrl.searchParams.set('v', 'blender-hd-20261018');
  blenderLoader.load(blenderAssetUrl.href, (gltf) => {
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
    transparent: true, opacity: .72, depthWrite: false,
    emissive: 0x0b2228, emissiveIntensity: .025
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

  // The main ground remains continuous underneath the valley; no raised circular platform.
  // The battle space is a shallow river crossing over the same ground plane as the surrounding banks.

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
  // Fine moving normals create water glints without the old neon-blue flat strip.
  const normalSize=128,normalData=new Uint8Array(normalSize*normalSize*4);
  for(let y=0;y<normalSize;y++)for(let x=0;x<normalSize;x++){
    const i=(y*normalSize+x)*4;
    const nx=Math.sin(x*.19+Math.sin(y*.075)*1.8)*.17+Math.cos(y*.12-x*.04)*.1;
    const ny=Math.cos(y*.16+x*.055)*.14+Math.sin(x*.07-y*.09)*.09;
    normalData[i]=128+nx*120;normalData[i+1]=128+ny*120;normalData[i+2]=246;normalData[i+3]=255;
  }
  const waterNormal=new THREE.DataTexture(normalData,normalSize,normalSize,THREE.RGBAFormat);
  waterNormal.wrapS=waterNormal.wrapT=THREE.RepeatWrapping;waterNormal.repeat.set(2,8);waterNormal.colorSpace=THREE.NoColorSpace;waterNormal.needsUpdate=true;
  riverMat.map = waterTexture;riverMat.normalMap=waterNormal;riverMat.normalScale.set(.3,.24);
  riverMat.roughness=.24;riverMat.clearcoat=.55;riverMat.clearcoatRoughness=.22;riverMat.side=THREE.DoubleSide;riverMat.needsUpdate = true;

  // Riverbed stones remain visible through the thin, shallow water.
  const riverBed = new THREE.Group(); riverBed.name='Visible shallow riverbed'; group.add(riverBed);
  const riverBedMats=[toonFlat(0x62685f),toonFlat(0x7a7a6c),toonFlat(0x4f5b58),toonFlat(0x8a8879)];
  const riverBedRocks=[];
  for(let i=0;i<115;i++){
    const x=(rng()-.5)*7.2,z=-112+rng()*130;
    const rock=add(new THREE.DodecahedronGeometry(.62+rng()*.7,1),riverBedMats[i%riverBedMats.length],x,-.015+rng()*.02,z,.55+rng()*.95,.08+rng()*.09,.5+rng()*.95,riverBed);
    rock.rotation.y=rng()*Math.PI;rock.rotation.x=(rng()-.5)*.1;riverBedRocks.push(rock);
  }
  // Low-contrast rings break up the water surface and reinforce the shallow flow.
  const ripples=[];
  for(let i=0;i<26;i++){
    const rippleMaterial=new THREE.MeshBasicMaterial({color:0xd0dbd4,transparent:true,opacity:.12,depthWrite:false,side:THREE.DoubleSide});
    const ripple=new THREE.Mesh(new THREE.RingGeometry(.22,.34,24),rippleMaterial);
    ripple.rotation.x=-Math.PI/2;ripple.position.set((rng()-.5)*6.8,.031,-111+rng()*127);
    ripple.userData.phase=rng();ripple.userData.width=.7+rng()*1.4;group.add(ripple);ripples.push(ripple);
  }

  // Thin translucent streaks give the waterfall a vertical flow and a soft anime-mist edge.
  const fallCanvas=document.createElement('canvas');fallCanvas.width=128;fallCanvas.height=256;
  const fallCtx=fallCanvas.getContext('2d');fallCtx.clearRect(0,0,128,256);
  const fallGrad=fallCtx.createLinearGradient(0,0,128,0);
  fallGrad.addColorStop(0,'rgba(174,192,189,0)');fallGrad.addColorStop(.2,'rgba(203,215,210,.38)');
  fallGrad.addColorStop(.55,'rgba(232,238,228,.58)');fallGrad.addColorStop(.82,'rgba(174,196,193,.3)');fallGrad.addColorStop(1,'rgba(174,192,189,0)');
  fallCtx.fillStyle=fallGrad;fallCtx.fillRect(0,0,128,256);
  for(let i=0;i<72;i++){
    const x=Math.random()*128,y=Math.random()*256;
    fallCtx.strokeStyle='rgba(241,245,235,'+(.06+Math.random()*.24)+')';
    fallCtx.lineWidth=.4+Math.random()*1.6;fallCtx.beginPath();fallCtx.moveTo(x,y);
    fallCtx.lineTo(x+(Math.random()-.5)*2,y+8+Math.random()*44);fallCtx.stroke();
  }
  const fallTexture=new THREE.CanvasTexture(fallCanvas);
  fallTexture.colorSpace=THREE.SRGBColorSpace;fallTexture.wrapS=fallTexture.wrapT=THREE.RepeatWrapping;
  fallTexture.repeat.set(1,1.4);fallTexture.needsUpdate=true;
  foamMat.map=fallTexture;foamMat.color.setHex(0xffffff);foamMat.side=THREE.DoubleSide;foamMat.opacity=.64;foamMat.needsUpdate=true;

  // Central waterfall and stone amphitheater establish the valley silhouette.
  add(new THREE.DodecahedronGeometry(1, 2), darkStone, 0, 15, -110, 25, 18, 8);
  const centralFall = add(new THREE.PlaneGeometry(20, 28), foamMat, 0, 14, -99.7);
  centralFall.name = 'Central waterfall between Hashirama and Madara';
  const waterfallRibbons=[];
  for(let i=0;i<9;i++){
    const ribbon=add(new THREE.PlaneGeometry(.5+(i%3)*.28,18+(i%4)*2),foamMat,-8.7+i*2.15,8.5+(i%3)*2.5,-99.4);
    ribbon.material=foamMat;ribbon.userData.flow=(i%2?1:-1)*(.7+(i%4)*.15);waterfallRibbons.push(ribbon);
  }
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
      const x = side * (43 + rng() * 8);
      const z = -124 + i * 20 + (rng() - .5) * 9;
      const h = 25 + rng() * 21;
      const cliff = add(new THREE.DodecahedronGeometry(1, 2), i % 2 ? darkStone : stone,
        x, h * .53, z, 8 + rng() * 6, h, 12 + rng() * 6);
      cliff.rotation.set((rng() - .5) * .12, rng() * Math.PI, (rng() - .5) * .16);
      add(new THREE.DodecahedronGeometry(1, 1), moss, x - side * 1.2, h * 1.3, z + 1,
        6 + rng() * 5, 1.1, 7 + rng() * 5);
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


  // Tall, layered canyon faces run along both sides, enclosing the arena instead of leaving it in open space.
  const canyonWallMaterial=toon(0x69746d);canyonWallMaterial.side=THREE.DoubleSide;
  const strataMaterial=toonFlat(0x58635d);
  for(const side of [-1,1]){
    const positions=[],indices=[],segments=30;
    for(let i=0;i<=segments;i++){
      const z=-136+i*6.2, x=side*(50+(rng()-.5)*4);
      const top=36+Math.sin(i*.63+side)*7+Math.sin(i*.21)*8+rng()*9;
      positions.push(x,0,z, x,top,z);
      if(i<segments){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    const wallGeometry=new THREE.BufferGeometry();
    wallGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    wallGeometry.setIndex(indices);wallGeometry.computeVertexNormals();
    const wall=new THREE.Mesh(wallGeometry,canyonWallMaterial);
    wall.name=side<0?'West cliff wall':'East cliff wall';wall.castShadow=true;wall.receiveShadow=true;group.add(wall);
    // Horizontal broken ledges catch light and help show the scale of the canyon.
    for(let i=0;i<18;i++){
      const z=-128+i*10.2+(rng()-.5)*2,y=6+rng()*24,x=side*(48.3+rng()*1.4);
      const ledge=add(new THREE.BoxGeometry(2.1,.26,6.5+rng()*5),strataMaterial,x,y,z,1,1,1);
      ledge.rotation.y=(rng()-.5)*.22;
    }
  }

  // A subtle worn combat circle gives the free-roam environment a deliberate fighting-game stage.
  const combatRing=new THREE.Mesh(
    new THREE.RingGeometry(27.2,27.65,128),
    new THREE.MeshBasicMaterial({color:0x45534d,transparent:true,opacity:.32,side:THREE.DoubleSide,depthWrite:false})
  );
  combatRing.name='Worn stone arena boundary';combatRing.rotation.x=-Math.PI/2;combatRing.position.set(0,.006,-30);group.add(combatRing);
  const ringStones=[];
  for(let i=0;i<48;i++){
    const angle=(i/48)*Math.PI*2,r=27.45+(rng()-.5)*.8;
    const stoneMark=add(new THREE.DodecahedronGeometry(1,0),i%4?darkStone:moss,Math.cos(angle)*r,.015, -30+Math.sin(angle)*r,.38+rng()*.42,.035+rng()*.045,.22+rng()*.35);
    stoneMark.rotation.y=angle;ringStones.push(stoneMark);
  }
  // Rounded broadleaf trees, exposed roots and layered canopies frame the playable channel.
  // Shared meshes keep the richer environment inexpensive to draw.
  const bark=toonFlat(0x53463d),branchGeo=new THREE.CylinderGeometry(.06,.16,2.5,6);
  const trunkGeo=new THREE.CylinderGeometry(.22,.48,6.4,7);
  const canopyGeo=new THREE.IcosahedronGeometry(1,1);
  const canopyMats=[toonFlat(0x36523a),toonFlat(0x496746),toonFlat(0x617950),toonFlat(0x334b3c)];
  for(const side of [-1,1]){
    for(let i=0;i<22;i++){
      const x=side*(43+rng()*34),z=-112+rng()*145,h=5.2+rng()*5.2;
      const trunk=add(trunkGeo,bark,x,h*.48,z,.85+rng()*.35,h/6,.85+rng()*.35);
      trunk.rotation.z=side*(rng()-.5)*.12;
      for(let b=0;b<3;b++){
        const branch=add(branchGeo,bark,x+side*(b-1)*.7,h*.58+b*.5,z+(rng()-.5)*1.1,.7,.8,.7);
        branch.rotation.z=side*(b-1)*.36;
      }
      for(let leaf=0;leaf<9;leaf++){
        const angle=leaf*2.399+i*.37,rad=.8+rng()*1.65;
        const crown=add(canopyGeo,canopyMats[(i+leaf)%canopyMats.length],x+Math.cos(angle)*rad,h+Math.sin(angle*.8)*1.0+((leaf%3)-1)*.55,z+Math.sin(angle)*rad*.72,1.25+rng()*.65,.95+rng()*.62,1.15+rng()*.55);
        crown.rotation.y=angle;crown.rotation.x=(rng()-.5)*.18;
      }
      for(let root=-1;root<=1;root++){
        const foot=add(new THREE.CylinderGeometry(.07,.22,1.9,5),bark,x+root*.48,.3,z+.4,.7,1,.8);
        foot.rotation.z=root*.34;
      }
    }
  }
  // Weathered broken slabs and bank rubble keep the clearing tactile while preserving a safe combat lane.
  for(let i=0;i<76;i++){
    const side=i%2?1:-1,z=-112+rng()*124,x=side*(7.1+rng()*17);
    const rock=add(new THREE.DodecahedronGeometry(.7+rng()*.45,1),i%5?stone:moss,x,.06+rng()*.16,z,1.3+rng()*1.8,.28+rng()*.48,.9+rng()*1.3);
    rock.rotation.set((rng()-.5)*.13,rng()*Math.PI,(rng()-.5)*.16);
  }

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

  // Soft alpha-textured spray clouds pool at the base of the falls instead of using hard white boxes.
  const mistCanvas=document.createElement('canvas');mistCanvas.width=256;mistCanvas.height=128;
  const mistCtx=mistCanvas.getContext('2d');
  const mistGrad=mistCtx.createRadialGradient(128,64,5,128,64,118);
  mistGrad.addColorStop(0,'rgba(220,229,220,.46)');mistGrad.addColorStop(.42,'rgba(194,210,205,.25)');mistGrad.addColorStop(1,'rgba(180,199,197,0)');
  mistCtx.fillStyle=mistGrad;mistCtx.fillRect(0,0,256,128);
  for(let i=0;i<42;i++){
    const x=Math.random()*256,y=20+Math.random()*88;
    mistCtx.strokeStyle='rgba(235,239,229,'+(.025+Math.random()*.07)+')';mistCtx.lineWidth=1+Math.random()*4;
    mistCtx.beginPath();mistCtx.moveTo(x,y);mistCtx.lineTo(x+(Math.random()-.5)*28,y+(Math.random()-.5)*5);mistCtx.stroke();
  }
  const mistTexture=new THREE.CanvasTexture(mistCanvas);mistTexture.colorSpace=THREE.SRGBColorSpace;
  const mistCloudMaterial=new THREE.MeshBasicMaterial({map:mistTexture,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide});
  const mistClouds=new THREE.Group();mistClouds.name='Waterfall spray';group.add(mistClouds);
  const mistBillboards=[];
  for(let i=0;i<7;i++){
    const x=(i%3-1)*11+(rng()-.5)*4,y=1.1+(i%3)*.9,z=-84-(i%4)*5;
    const cloud=new THREE.Mesh(new THREE.PlaneGeometry(17+(i%3)*5,4.2+(i%2)*1.7),mistCloudMaterial);
    cloud.position.set(x,y,z);cloud.rotation.y=(rng()-.5)*.34;cloud.userData.phase=rng()*Math.PI*2;
    mistClouds.add(cloud);mistBillboards.push(cloud);
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
      waterTexture.offset.y = (waterTexture.offset.y + dt * .035) % 1;
      waterNormal.offset.y = (waterNormal.offset.y + dt * .11) % 1;
      for(const ripple of ripples){
        const cycle=(time*.14+ripple.userData.phase)%1;
        const scale=ripple.userData.width*(.7+cycle*2.1);
        ripple.scale.set(scale,scale,1);ripple.material.opacity=.12*(1-cycle);
      }
      fallTexture.offset.y = (fallTexture.offset.y + dt * .24) % 1;
      for(const cloud of mistBillboards)cloud.position.y+=Math.sin(time*.65+cloud.userData.phase)*dt*.045;
      for(const ribbon of waterfallRibbons)ribbon.position.y+=Math.sin(time*1.5+ribbon.userData.flow)*dt*.025;
      river.position.y = .025 + Math.sin(time * 1.7) * .012;
      for (const p of mistPoints) {
        p.position.y += dt * (.25 + Math.sin(time + p.userData.phase) * .1);
        p.position.x += Math.sin(time * .7 + p.userData.phase) * dt * .12;
        if (p.position.y > 9) p.position.y = .4;
      }
    }
  };
}
