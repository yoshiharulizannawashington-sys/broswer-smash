// Cinematic sunset environment for Browser Smash. All geometry and sky textures are generated locally.
export function addCinematicEnvironment(THREE, scene) {
  const group = new THREE.Group();
  group.name = 'CinematicValleyEnvironment';
  scene.add(group);

  // Camera-following gradient sky dome; this stays behind the playable world.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(190, 48, 28),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
      fragmentShader: `varying vec3 vWorld;
        void main(){
          float h=normalize(vWorld).y;
          vec3 zenith=vec3(0.025,0.055,0.12);
          vec3 upper=vec3(0.16,0.25,0.39);
          vec3 mid=vec3(0.75,0.36,0.25);
          vec3 horizon=vec3(1.0,0.68,0.40);
          vec3 c=mix(horizon,mid,smoothstep(-0.12,0.20,h));
          c=mix(c,upper,smoothstep(0.18,0.48,h));
          c=mix(c,zenith,smoothstep(0.45,0.9,h));
          float glow=exp(-pow((h-0.025)*8.0,2.0));
          c+=vec3(0.32,0.12,0.035)*glow;
          gl_FragColor=vec4(c,1.0);
        }`
    })
  );
  sky.renderOrder = -100;
  group.add(sky);

  // Procedural wispy cloud cards, made with Canvas so no external textures are required.
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
    group.add(cloud);
  }

  // Layered mountain ranges make the horizon feel vast rather than like a flat backdrop.
  const ridgeMatters = [
    new THREE.MeshStandardMaterial({color:0x39465b,roughness:1,metalness:0}),
    new THREE.MeshStandardMaterial({color:0x26364a,roughness:1,metalness:0}),
    new THREE.MeshStandardMaterial({color:0x18283c,roughness:1,metalness:0})
  ];
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
    group.add(ridge);
  }

  // Floating rock shelves and lit falls echo the reference's fantasy valley.
  const rockMat = new THREE.MeshStandardMaterial({color:0x273444,roughness:.94,metalness:.08});
  const waterMat = new THREE.MeshBasicMaterial({color:0x79dfff,transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide});
  for (const [x,y,z,s] of [[-39,9,-34,1],[35,12,-40,1.2],[-58,5,-52,.8],[58,7,-48,.9]]) {
    const island=new THREE.Mesh(new THREE.DodecahedronGeometry(1,2),rockMat);
    island.position.set(x,y,z);island.scale.set(8*s,2.4*s,5*s);island.rotation.z=.1;island.castShadow=true;group.add(island);
    for(let k=0;k<3;k++){
      const fall=new THREE.Mesh(new THREE.PlaneGeometry(.6*s,8+Math.random()*5),waterMat);
      fall.position.set(x+(k-1)*1.7*s,y-5,z+.4);group.add(fall);
    }
  }

  // Distant futuristic citadel silhouette and vertical light beacon.
  const city = new THREE.Group(); city.position.set(0,0,-55); group.add(city);
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
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.035,.12,19,8),new THREE.MeshBasicMaterial({color:0x45dfff,transparent:true,opacity:.8}));
  beacon.position.set(0,10,-53);group.add(beacon);
  const beaconHalo=new THREE.Mesh(new THREE.TorusGeometry(.8,.045,8,48),new THREE.MeshBasicMaterial({color:0x4de7ff}));
  beaconHalo.position.set(0,5,-53);group.add(beaconHalo);

  // Small warm glints in the air add scale and depth.
  const glints=new THREE.Group();group.add(glints);
  const glintGeo=new THREE.SphereGeometry(.045,6,5);
  for(let i=0;i<65;i++){
    const g=new THREE.Mesh(glintGeo,new THREE.MeshBasicMaterial({color:i%4===0?0x67dcff:0xffbd82,transparent:true,opacity:.25+Math.random()*.5}));
    g.position.set((Math.random()-.5)*90,Math.random()*17-1,-35-Math.random()*38);
    g.userData.phase=Math.random()*Math.PI*2;g.userData.speed=.2+Math.random()*.45;glints.add(g);
  }
  group.userData.update=(dt,time,camera)=>{
    for(const g of glints.children){g.position.y+=Math.sin(time*g.userData.speed+g.userData.phase)*dt*.18;g.position.x+=Math.cos(time*.25+g.userData.phase)*dt*.12;}
    if(camera)sky.position.copy(camera.position);
  };
  return group;
}
