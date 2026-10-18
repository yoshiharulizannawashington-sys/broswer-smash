// Cinematic sunset environment for Browser Smash. All geometry and sky textures are generated locally.
export function addCinematicEnvironment(THREE, scene) {
  const group = new THREE.Group();
  group.name = 'CinematicValleyEnvironment';
  scene.add(group);

  // Camera-following gradient sky dome; this stays behind the playable world.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(190, 48, 28),
    new THREE.ShaderMaterial({
      uniforms: { uFinalValley: { value: 0 } },
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uFinalValley; varying vec3 vWorld;
        void main(){
          float h=normalize(vWorld).y;
          vec3 zenith=mix(vec3(0.025,0.055,0.12),vec3(0.045,0.075,0.105),uFinalValley);
          vec3 upper=mix(vec3(0.16,0.25,0.39),vec3(0.27,0.36,0.40),uFinalValley);
          vec3 mid=mix(vec3(0.75,0.36,0.25),vec3(0.48,0.57,0.58),uFinalValley);
          vec3 horizon=mix(vec3(1.0,0.68,0.40),vec3(0.69,0.75,0.73),uFinalValley);
          vec3 c=mix(horizon,mid,smoothstep(-0.12,0.20,h));
          c=mix(c,upper,smoothstep(0.18,0.48,h));
          c=mix(c,zenith,smoothstep(0.45,0.9,h));
          float glow=exp(-pow((h-0.025)*8.0,2.0));
          c+=mix(vec3(0.32,0.12,0.035),vec3(0.11,0.16,0.17),uFinalValley)*glow;
          gl_FragColor=vec4(c,1.0);
        }`
    })
  );
  sky.renderOrder = -100;
  group.add(sky);

  // Procedural wispy cloud cards, made with Canvas so no external textures are required.
  const cloudGroup = new THREE.Group(); cloudGroup.name = 'Atmospheric clouds'; group.add(cloudGroup);
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(255,190,150,0)');
  gradient.addColorStop(.45, 'rgba(255,173,133,.55)');
  gradient.addColorStop(.7, 'rgba(116,145,183,.35)');
  gradient.addColorStop(1, 'rgba(30,52,83,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i=0;i<260;i++) {
    const x=Math.random()*canvas.width, y=25+Math.random()*125;
    const rx=12+Math.random()*58, ry=2+Math.random()*10;
    const g=ctx.createRadialGradient(x,y,1,x,y,rx);
    g.addColorStop(0, i%3===0?'rgba(255,214,181,.5)':'rgba(123,154,192,.38)');
    g.addColorStop(1,'rgba(60,80,112,0)');
    ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y,rx,ry,Math.random()*.12,0,Math.PI*2);ctx.fill();
  }
  const cloudTexture = new THREE.CanvasTexture(canvas);
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  for (let i=0;i<9;i++) {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(44+Math.random()*38, 10+Math.random()*9),
      new THREE.MeshBasicMaterial({map:cloudTexture,transparent:true,opacity:.32+Math.random()*.32,depthWrite:false,side:THREE.DoubleSide})
    );
    cloud.position.set(-64+i*16, 17+Math.random()*12, -68-Math.random()*20);
    cloud.rotation.y=(Math.random()-.5)*.22;
    cloud.userData.baseOpacity=cloud.material.opacity;
    cloudGroup.add(cloud);
  }

  // Layered mountain ranges make the horizon feel vast rather than like a flat backdrop.
  const ridgeMatters = [
    new THREE.MeshStandardMaterial({color:0x39465b,roughness:1,metalness:0}),
    new THREE.MeshStandardMaterial({color:0x26364a,roughness:1,metalness:0}),
    new THREE.MeshStandardMaterial({color:0x18283c,roughness:1,metalness:0})
  ];
  const ridgeLayers = new THREE.Group(); ridgeLayers.name = 'Distant valley ridgelines'; group.add(ridgeLayers);
  for (let layer=0;layer<3;layer++) {
    const points=[];
    const baseZ=-47-layer*13;
    for(let i=0;i<=30;i++){
      const x=-100+i*(200/30);
      const y=5+Math.abs(Math.sin(i*1.7+layer))* (5+layer*2)+Math.abs(Math.sin(i*.47+layer*2))*7;
      points.push(new THREE.Vector2(x,y));
    }
    const shape=new THREE.Shape();shape.moveTo(points[0].x,0);
    for(const p of points)shape.lineTo(p.x,p.y);
    shape.lineTo(points[points.length-1].x,0);shape.closePath();
    const ridge=new THREE.Mesh(new THREE.ShapeGeometry(shape),ridgeMatters[layer]);
    ridge.position.set(0,-2,baseZ);ridge.renderOrder=-5-layer;
    ridgeLayers.add(ridge);
  }

  // Floating rock shelves and lit falls echo the reference's fantasy valley.
  const floatingIslands = new THREE.Group(); floatingIslands.name = 'Floating rock shelves — Valley of Echoes only'; group.add(floatingIslands);
  const rockMat = new THREE.MeshStandardMaterial({color:0x273444,roughness:.94,metalness:.08});
  const waterMat = new THREE.MeshBasicMaterial({color:0x79dfff,transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide});
  for (const [x,y,z,s] of [[-39,9,-34,1],[35,12,-40,1.2],[-58,5,-52,.8],[58,7,-48,.9]]) {
    const island=new THREE.Mesh(new THREE.DodecahedronGeometry(1,2),rockMat);
    island.position.set(x,y,z);island.scale.set(8*s,2.4*s,5*s);island.rotation.z=.1;island.castShadow=true;floatingIslands.add(island);
    for(let k=0;k<3;k++){
      const fall=new THREE.Mesh(new THREE.PlaneGeometry(.6*s,8+Math.random()*5),waterMat);
      fall.position.set(x+(k-1)*1.7*s,y-5,z+.4);floatingIslands.add(fall);
    }
  }

  // Distant futuristic citadel silhouette and vertical light beacon.
  const city = new THREE.Group(); city.name = 'Neon citadel — Valley of Echoes only'; city.position.set(0,0,-55); group.add(city);
  const buildingMat=new THREE.MeshStandardMaterial({color:0x1a2c42,roughness:.55,metalness:.3,emissive:0x071c37,emissiveIntensity:.8});
  for(let i=0;i<25;i++){
    const w=.7+Math.random()*2.1,h=2+Math.random()*10;
    const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,1.3+Math.random()),buildingMat);
    b.position.set(-24+i*2,h*.5-1,Math.random()*3);city.add(b);
    if(i%3===0){
      const light=new THREE.Mesh(new THREE.BoxGeometry(.055,h*.72,.06),new THREE.MeshBasicMaterial({color:i%2?0x42cfff:0xffa15c}));
      light.position.set(b.position.x,b.position.y,b.position.z+.68);city.add(light);
    }
  }
  const sciFiBeacon = new THREE.Group(); sciFiBeacon.name = 'Sci-fi beacon — Valley of Echoes only'; group.add(sciFiBeacon);
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.035,.12,19,8),new THREE.MeshBasicMaterial({color:0x45dfff,transparent:true,opacity:.8}));
  beacon.position.set(0,10,-53);sciFiBeacon.add(beacon);
  const beaconHalo=new THREE.Mesh(new THREE.TorusGeometry(.8,.045,8,48),new THREE.MeshBasicMaterial({color:0x4de7ff}));
  beaconHalo.position.set(0,5,-53);sciFiBeacon.add(beaconHalo);

  // Lush valley framing: layered broadleaf trees, exposed roots, ferns and grass clumps.
  const barkMat=new THREE.MeshStandardMaterial({color:0x493629,roughness:.98});
  const leafMats=[
    new THREE.MeshStandardMaterial({color:0x244b31,roughness:.92}),
    new THREE.MeshStandardMaterial({color:0x356b3c,roughness:.9}),
    new THREE.MeshStandardMaterial({color:0x568246,roughness:.88})
  ];
  const fernMat=new THREE.MeshStandardMaterial({color:0x397a42,roughness:.9,side:THREE.DoubleSide});
  const broadleafForest = new THREE.Group(); broadleafForest.name = 'Broadleaf trees — Valley of Echoes only'; group.add(broadleafForest);
  function makeTree(x,z,scale=1,variant=0){
    const tree=new THREE.Group();tree.position.set(x,0,z);tree.scale.setScalar(scale);broadleafForest.add(tree);
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.48,5.8,9),barkMat);trunk.position.y=2.9;trunk.castShadow=true;tree.add(trunk);
    for(let r=0;r<4;r++){
      const branch=new THREE.Mesh(new THREE.CylinderGeometry(.08,.18,2.2,7),barkMat);
      branch.position.set((r%2?1:-1)*(.55+r*.12),3.1+r*.45,0);branch.rotation.z=(r%2?-.65:.65);tree.add(branch);
    }
    for(let i=0;i<11;i++){
      const ang=i*2.399+variant,rad=(i%4)*.48;
      const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.25+(i%3)*.22,2),leafMats[(i+variant)%leafMats.length]);
      crown.position.set(Math.cos(ang)*rad,4.9+(i%4)*.55,Math.sin(ang)*rad*.72);
      crown.scale.set(1.05,.78+((i+variant)%3)*.12,.95);crown.rotation.y=ang;crown.castShadow=true;tree.add(crown);
    }
    for(let r=0;r<3;r++){const root=new THREE.Mesh(new THREE.CylinderGeometry(.04,.15,1.8,6),barkMat);root.position.set((r-1)*.45,.28,.32);root.rotation.z=(r-1)*.45;tree.add(root);}
  }
  // Keep the immediate center readable for combat; trees frame the camera and trail.
  for(let i=0;i<30;i++){
    const side=i%2===0?-1:1;
    const z=18-Math.floor(i/2)*4.2;
    const x=side*(23+(i%5)*4.8+Math.random()*3);
    makeTree(x,z,.78+Math.random()*.82,i%3);
  }
  for(let i=0;i<90;i++){
    const x=(Math.random()-.5)*170,z=(Math.random()-.5)*125;
    if(Math.abs(x)<11&&Math.abs(z)<15)continue;
    const tuft=new THREE.Group();tuft.position.set(x,.015,z);broadleafForest.add(tuft);
    const h=.22+Math.random()*.48;
    for(let b=0;b<5;b++){
      const blade=new THREE.Mesh(new THREE.ConeGeometry(.055,h,4),fernMat);
      blade.position.set((Math.random()-.5)*.34,h*.45,(Math.random()-.5)*.34);
      blade.rotation.z=(Math.random()-.5)*.65;blade.rotation.x=(Math.random()-.5)*.5;tuft.add(blade);
    }
  }
  // Layered mossy boulders and small flowers break up the terrain silhouette.
  const mossMat=new THREE.MeshStandardMaterial({color:0x3c5140,roughness:1});
  const flowerMats=[new THREE.MeshBasicMaterial({color:0xf5d58a}),new THREE.MeshBasicMaterial({color:0x8bdcf2})];
  for(let i=0;i<42;i++){
    const x=(Math.random()-.5)*150,z=(Math.random()-.5)*110;
    if(Math.abs(x)<14&&Math.abs(z)<14)continue;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.55+Math.random()*.9,1),mossMat);
    rock.position.set(x,.15+Math.random()*.28,z);rock.scale.set(1.2,.55,.85);rock.rotation.y=Math.random()*Math.PI;rock.castShadow=true;broadleafForest.add(rock);
    if(i%3===0){const flower=new THREE.Mesh(new THREE.SphereGeometry(.09,7,5),flowerMats[i%2]);flower.position.set(x+.35,.45,z+.1);broadleafForest.add(flower);}
  }

  // Small warm glints in the air add scale and depth.
  const glints=new THREE.Group();glints.name='Floating light particles — Valley of Echoes only';group.add(glints);
  const glintGeo=new THREE.SphereGeometry(.045,6,5);
  for(let i=0;i<65;i++){
    const g=new THREE.Mesh(glintGeo,new THREE.MeshBasicMaterial({color:i%4===0?0x67dcff:0xffbd82,transparent:true,opacity:.25+Math.random()*.5}));
    g.position.set((Math.random()-.5)*90,Math.random()*17-1,-35-Math.random()*38);
    g.userData.phase=Math.random()*Math.PI*2;g.userData.speed=.2+Math.random()*.45;glints.add(g);
  }
  group.userData.setMap=(key)=>{
    const isFinalValley=key==='finalvalley';
    sky.material.uniforms.uFinalValley.value=isFinalValley?1:0;
    cloudGroup.children.forEach((cloud)=>{cloud.material.color.setHex(isFinalValley?0x9aa9a3:0xffffff);cloud.material.opacity=cloud.userData.baseOpacity*(isFinalValley?.62:1);});
    const ridgeColors=isFinalValley?[0x4f605c,0x3b4d4a,0x293b3b]:[0x39465b,0x26364a,0x18283c];
    ridgeMatters.forEach((material,index)=>material.color.setHex(ridgeColors[index]));
    floatingIslands.visible=key==='valley';
    city.visible=key==='valley';
    sciFiBeacon.visible=key==='valley';
    broadleafForest.visible=key==='valley';
    glints.visible=key==='valley';
  };
  group.userData.setMap('valley');
  group.userData.update=(dt,time,camera)=>{
    for(const g of glints.children){g.position.y+=Math.sin(time*g.userData.speed+g.userData.phase)*dt*.18;g.position.x+=Math.cos(time*.25+g.userData.phase)*dt*.12;}
    if(camera)sky.position.copy(camera.position);
  };
  return group;
}
