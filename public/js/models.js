// Original procedural fighters for Browser Smash. Articulated pivot hierarchy enables real limb animation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { enhanceSurfaceMaterials, surfaceDetailReport } from './surface_detail.js';
import { claimModelTextures, releaseModelTextures } from './render/texture_ownership.js';
import { bindRigJoints, validateFighterRig, describeRigValidation } from './rig_validation.js';
import { attachSpiderLegs } from './anim/spider_legs.js';
import { createSculptedFighter, hasSculptedFighter } from './characters/sculpted.js';

const runtimeAssetState = typeof window !== 'undefined'
  ? (window.__browserSmashAssets ||= {})
  : {};

const mat = (color, metalness=.2, roughness=.48, emissive=0x000000) =>
  new THREE.MeshStandardMaterial({color, metalness, roughness, emissive, emissiveIntensity: emissive ? 1.1 : 0});

function part(parent, geometry, material, pos, scale) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function joint(parent, pos) { const g = new THREE.Group(); g.position.set(...pos); parent.add(g); return g; }

export function makeProceduralCharacter(archetype='warrior', identity=archetype) {
  const g = new THREE.Group();
  const designs = {
    ninja:{body:0x151b2b, armor:0x303b50, accent:0x35dfff, skin:0xc99c7a, head:'hood'},
    warrior:{body:0x651e2a, armor:0x9b3540, accent:0x36d9ff, skin:0xb7c0cb, head:'helmet'},
    brawler:{body:0x75412d, armor:0xb87938, accent:0xffcc65, skin:0xd49d7c, head:'hair'},
    mage:{body:0x302452, armor:0x6451a0, accent:0x9b79ff, skin:0xe0c2a8, head:'hood'},
    cyborg:{body:0x273b45, armor:0x5d7781, accent:0x00ffd2, skin:0x9bb6be, head:'helmet'}
  };
  const key=String(identity||archetype).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  // Character-specific palette and silhouette cues. These are original, game-ready stylizations
  // guided by the supplied reference sheet, not photo scans or ripped game assets.
  const looks={
    the_rock:{body:0x13161c,armor:0x292e37,accent:0xe0b94f,head:'hair',feature:'blackadam',scale:1.06},
    samuel_l_jackson:{body:0x111720,armor:0x232c38,accent:0x5c88bc,head:'hair',feature:'eyepatch'},
    bruce_lee:{body:0xf0bd20,armor:0x171a1e,accent:0xf8d64d,head:'hair',feature:'yellowtracksuit',scale:.94},
    jean_claude_van_damme:{body:0x6f1720,armor:0x9b2937,accent:0xe8d9bb,head:'hair',feature:'sunglasses'},
    lucy_liu:{body:0xe4e0d5,armor:0xf3f0e8,accent:0x9d1c2d,head:'hair',feature:'katana'},
    sigourney_weaver:{body:0x586247,armor:0x303c34,accent:0xb7a05c,head:'hair',feature:'flightpack'},
    keanu_reeves:{body:0x24405c,armor:0x2a303b,accent:0xc93844,head:'hair',feature:'longhair'},
    burt_reynolds:{body:0x861e2a,armor:0xe7e2da,accent:0xca3541,head:'hair',feature:'mustache',scale:1.08},
    grace_jones:{body:0x16151c,armor:0x34313b,accent:0xc7a150,head:'hair',feature:'crown'},
    arnold_schwarzenegger:{body:0x171b22,armor:0x424b56,accent:0xb8c4cd,head:'helmet',feature:'terminator',scale:1.12},
    superman:{body:0x1653a3,armor:0x16478f,accent:0xc62b3b,head:'hair',feature:'superman',scale:1.08},
    iron_man_tony_stark:{body:0x8b1b20,armor:0xb72b27,accent:0xe6b64a,skin:0xc7a18b,head:'helmet',feature:'ironman'},
    hulk_bruce_banner:{body:0x287e3b,armor:0x452454,accent:0x75c45b,skin:0x39894a,head:'hair',feature:'hulk',scale:1.32},
    green_lantern_hal_jordan:{body:0x123d34,armor:0x1c5745,accent:0x62f4a6,head:'hair',feature:'lantern'},
    wolverine_logan:{body:0x174f9d,armor:0xd3ad26,accent:0xe7be35,head:'helmet',feature:'wolverine'},
    wonder_woman:{body:0x87252c,armor:0x233b75,accent:0xe0b84e,head:'hair',feature:'wonderwoman'},
    professor_x_charles_xavier:{body:0x303946,armor:0x56606e,accent:0x7bcad7,head:'hair',feature:'hoverchair'},
    the_flash_barry_allen:{body:0x941f26,armor:0xb52a31,accent:0xe7bf42,head:'helmet',feature:'flash'},
    aquaman:{body:0x185747,armor:0xb57926,accent:0xd7af51,head:'hair',feature:'trident'},
    doctor_strange:{body:0x3b2424,armor:0x6f2e2c,accent:0xd9a746,head:'hair',feature:'strange'},
    thor:{body:0x1a2b44,armor:0x8f9aa4,accent:0xe3be58,head:'hair',feature:'stormbreaker',scale:1.1},
    goku:{body:0xe36b20,armor:0x2864ad,accent:0xffc43e,head:'hair',feature:'goku',scale:1.04},
    naruto_uzumaki:{body:0xe97920,armor:0x24466e,accent:0x328add,head:'hair',feature:'naruto'},
    aang:{body:0xe1a24f,armor:0xb86c36,accent:0x55c7ff,skin:0xd2a783,head:'hair',feature:'aang',scale:.92},
    vegeta:{body:0x1d3459,armor:0xe0e3e1,accent:0x3d70bd,head:'hair',feature:'vegeta'},
    saitama:{body:0xd8c9a5,armor:0xe2bb36,accent:0xa92c2c,head:'hair',feature:'saitama'},
    l_death_note_style:{body:0xf1eee6,armor:0x22232a,accent:0x596276,head:'hair',feature:'darkcircles'},
    levi_ackerman:{body:0x283b4c,armor:0x526a49,accent:0xbfc9c9,head:'hair',feature:'odm'},
    edward_elric:{body:0x8f202a,armor:0x2a2d34,accent:0xc8bd9b,head:'hair',feature:'automail'},
    roronoa_zoro:{body:0x246345,armor:0x2b4638,accent:0x9ac578,head:'hair',feature:'zoro'},
    all_might:{body:0x1b3158,armor:0xc49a35,accent:0xbe3440,head:'hair',feature:'allmight',scale:1.24},
    jotaro_kujo:{body:0x222b52,armor:0x3d456d,accent:0xd8b34d,head:'hair',feature:'jotaro'},
    mario:{body:0x2c4f9a,armor:0xd12e29,accent:0xe9c44a,head:'hair',feature:'mario'},
    luigi:{body:0x2e5a41,armor:0x365da0,accent:0xe9c44a,head:'hair',feature:'luigi'},
    solid_snake:{body:0x465363,armor:0x58616b,accent:0x8e9ca7,head:'hair',feature:'bandana'},
    geralt_of_rivia:{body:0x181c24,armor:0x41464c,accent:0x9db4c7,head:'hair',feature:'whitehair'},
    kratos:{body:0x34353a,armor:0x5e4138,accent:0xb32b30,skin:0xe2ded2,head:'hair',feature:'kratos',scale:1.18},
    link:{body:0x3e7b3d,armor:0x326a45,accent:0xc8b86c,head:'hair',feature:'link'},
    lara_croft:{body:0x9c6b3d,armor:0x303d44,accent:0x92784d,head:'hair',feature:'lara'},
    sephiroth:{body:0x171a24,armor:0x2e333c,accent:0xd8dee5,head:'hair',feature:'sephiroth',scale:1.12},
    master_chief:{body:0x48543a,armor:0x5a6748,accent:0xd1ba6c,head:'helmet',feature:'chief',scale:1.16},
    doom_slayer:{body:0x314538,armor:0x3e5347,accent:0x99ad9d,head:'helmet',feature:'doom',scale:1.15},
    shrek:{body:0x56883c,armor:0x6b583b,accent:0xb0a17a,skin:0x72a34b,head:'hair',feature:'shrek',scale:1.18},
    aladdin:{body:0x28634d,armor:0x70402b,accent:0xbf9d4c,head:'hair',feature:'fez'},
    ariel:{body:0x22806f,armor:0x6c376f,accent:0xf2bd5b,skin:0xf0c7ad,head:'hair',feature:'ariel'},
    ursula:{body:0x482760,armor:0x3b214f,accent:0xb89bdb,skin:0x8871b0,head:'hair',feature:'ursula',scale:1.2},
    edna_mode:{body:0x11151b,armor:0x2a3038,accent:0xe8e5df,head:'hair',feature:'edna',scale:.83},
    captain_jack_sparrow:{body:0x68513e,armor:0x272e38,accent:0xb98f52,head:'hair',feature:'pirate'},
    spider_man:{body:0xc62930,armor:0x154b91,accent:0xe54244,skin:0x8c99a7,head:'mask',feature:'spiderman',scale:1.0},
    iron_spider:{body:0xb81f27,armor:0xd8a640,accent:0xffcf63,skin:0x8c99a7,head:'mask',feature:'ironspider',scale:1.04},
    sesshomaru:{body:0xe6e1d5,armor:0xe8e1d1,accent:0x9973ad,skin:0xe6d8c9,head:'hair',feature:'sesshomaru'},
    norman_bates:{body:0x454b55,armor:0x6c6558,accent:0xc4baa3,head:'hair',feature:'knife'},
    han_solo:{body:0xe6e1d4,armor:0x28313c,accent:0xb78e4f,head:'hair',feature:'blaster'},
    indiana_jones:{body:0x65432e,armor:0x46322a,accent:0x8c6b42,head:'hair',feature:'fedora'},
    lord_voldemort:{body:0x17181b,armor:0x2e3035,accent:0xb6ad9c,skin:0xd4d0c5,head:'hair',feature:'voldemort'},
    sasuke_uchiha:{body:0x17213b,armor:0x353d55,accent:0x5a9ce1,head:'hair',feature:'sasuke'},
    hashirama_senju:{body:0x325a46,armor:0x5b3d2f,accent:0x8a9873,head:'hair',feature:'hashirama',scale:1.22},
    madara_uchiha:{body:0x492e32,armor:0x7c3d3a,accent:0xb79362,head:'hair',feature:'madara',scale:1.22},
    // Original fighter: the fallback body is only visible until the exported GLB loads.
    kaze:{body:0xe9e6da,armor:0x1b1f27,accent:0x7fe6cf,skin:0xc79a78,head:'hair',scale:1}
  };
  const d={...(designs[archetype]||designs.warrior)};
  const look=looks[key];
  if(look) Object.assign(d,look);
  // Spider-Man's suit already carries the wrist silhouette, and the shared signature-weapon
  // prefab is a generic-rig web-shooter built from a large cuff, cartridge and nozzles. On the
  // imported body it reads as a floating grey brick across the hands and hides the authored
  // poses, so equipment stays off. The web moves supply their own webshooter projectile profile
  // and do not read an equipped weapon, so this changes presentation, not the moveset.
  if(key==='spider_man')g.userData.unarmed=true;
  // Authored bodies: real anatomy, layered clothing and armour, modelled hands and faces.
  // These replace the primitive assembly for the three fighters whose source assets were never
  // supplied, and they are skipped by the prefab swap below so nothing overwrites them.
  if(hasSculptedFighter(key)){
    const sculpted=createSculptedFighter(key,{identity});
    if(sculpted){
      const scale=look?.scale||1;
      sculpted.scale.setScalar(scale);
      sculpted.userData.identity=identity;
      sculpted.userData.archetype=archetype;
      sculpted.userData.characterScale=scale;
      sculpted.userData.visualScale=scale;
      sculpted.userData.unarmed=true;
      // Authored bodies are lofted from code and carry no UV chart, so the tiling weave maps
      // the prefab path bakes would sample one texel and smear it across every limb (and on a
      // UV-mapped material turned the figure into a visible grid). Their detail is geometry:
      // lapels, plates, fingers, hair locks. Leave their materials alone.
      sculpted.userData.surfaceDetail={applied:false,reason:'authored geometry, no UV chart'};
      runtimeAssetState.lastSculptedDetail={key,applied:false,materials:0};
      return sculpted;
    }
  }
  // The accent material is the fighter's emissive trim. Tagging it by name lets a form's
  // authored look retint the trim without touching skin, cloth or armour.
  const cloth=mat(d.body,.10,.72),
    armor=new THREE.MeshPhysicalMaterial({color:d.armor,metalness:.78,roughness:.27,clearcoat:.78,clearcoatRoughness:.16,envMapIntensity:1.15}),
    glow=new THREE.MeshPhysicalMaterial({name:'fighter-accent',color:d.accent,metalness:.36,roughness:.2,clearcoat:.72,clearcoatRoughness:.12,emissive:d.accent,emissiveIntensity:1.0,envMapIntensity:1.1}),
    skin=new THREE.MeshStandardMaterial({color:d.skin,metalness:.02,roughness:.64,envMapIntensity:.72}),
    dark=new THREE.MeshStandardMaterial({color:0x10151d,metalness:.38,roughness:.38});
  // root origin is at the feet; torso and limbs are independently articulated.
  const pelvis=joint(g,[0,1.02,0]); part(pelvis,new THREE.BoxGeometry(.68,.38,.42),armor,[0,0,0]);
  // Two-stage spine, matching characters/sculpted.js: the chest pivots mid-spine, not at the pelvis.
  const spine=joint(pelvis,[0,.14,0]);
  const torso=joint(spine,[0,.14,0]); part(torso,new THREE.BoxGeometry(.9,.82,.48),cloth,[0,.28,0]);
  part(torso,new THREE.BoxGeometry(.98,.25,.55),armor,[0,.48,0]);
  part(torso,new THREE.BoxGeometry(.23,.38,.06),glow,[0,.3,.275]);
  for(const s of [-1,1]) {
    const shoulder=part(torso,new THREE.SphereGeometry(.28,12,10),armor,[s*.55,.48,0],[1,1,.9]);
    part(torso,new THREE.BoxGeometry(.18,.36,.12),glow,[s*.42,.25,.27]);
    // Clavicle rolls the arm from the chest. Offsets preserved (0.16+0.46=0.62, 0.30+0.05=0.35).
    const clavicle=joint(torso,[s*.16,.30,0]);
    const arm=joint(clavicle,[s*.46,.05,0]); part(arm,new THREE.CylinderGeometry(.13,.16,.42,10),cloth,[0,-.2,0]);
    part(arm,new THREE.BoxGeometry(.32,.22,.3),armor,[0,-.42,.015]);
    const fore=joint(arm,[0,-.42,0]); part(fore,new THREE.CylinderGeometry(.11,.14,.38,10),armor,[0,-.18,0]);
    part(fore,new THREE.BoxGeometry(.23,.18,.24),glow,[0,-.37,.035]);
    const leg=joint(pelvis,[s*.22,-.15,0]); part(leg,new THREE.CylinderGeometry(.15,.19,.48,10),cloth,[0,-.25,0]);
    part(leg,new THREE.BoxGeometry(.31,.25,.32),armor,[0,-.43,.015]);
    const shin=joint(leg,[0,-.45,0]); part(shin,new THREE.CylinderGeometry(.12,.15,.43,10),armor,[0,-.21,0]);
    part(shin,new THREE.BoxGeometry(.3,.16,.43),dark,[0,-.42,.08]);
    // Wrist and ankle articulation points. The prefab keeps its existing end geometry on the
    // forearm/shin, so these are pure articulation joints: a clip can angle the hand or roll the
    // foot on a body that has the geometry for it (characters/sculpted.js does), and a prefab body
    // simply has nothing hanging off the joint.
    const hand=joint(fore,[0,-.34,0]);
    const foot=joint(shin,[0,-.40,0]);
    if(s===-1) { g.userData.leftClavicle=clavicle;g.userData.leftArm=arm;g.userData.leftFore=fore;g.userData.leftHand=hand;g.userData.leftLeg=leg;g.userData.leftShin=shin;g.userData.leftFoot=foot; }
    else { g.userData.rightClavicle=clavicle;g.userData.rightArm=arm;g.userData.rightFore=fore;g.userData.rightHand=hand;g.userData.rightLeg=leg;g.userData.rightShin=shin;g.userData.rightFoot=foot; }
  }
  const neck=joint(torso,[0,.72,0]); part(neck,new THREE.CylinderGeometry(.13,.16,.18,10),skin,[0,0,0]);
  const head=joint(neck,[0,.24,0]); part(head,new THREE.SphereGeometry(.28,24,18),skin,[0,0,0],[.88,1.05,.82]);
  if(d.head==='helmet') {
    part(head,new THREE.SphereGeometry(.31,24,18),armor,[0,.04,0],[1,1,.94]);
    part(head,new THREE.BoxGeometry(.38,.09,.08),glow,[0,.015,.245]);
    part(head,new THREE.BoxGeometry(.19,.1,.12),dark,[0,-.12,.22]);
  } else {
    part(head,new THREE.BoxGeometry(.43,.16,.42),cloth,[0,.19,-.015]);
    part(head,new THREE.BoxGeometry(.34,.075,.05),glow,[0,.025,.235]);
    if(d.head==='hair') for(let i=0;i<5;i++){const spike=part(head,new THREE.ConeGeometry(.09,.25,5),armor,[(i-2)*.1,.28,.02]);spike.rotation.z=(i-2)*-.25;}
  }
  // Layered silhouette details: segmented chest plates, shoulder armor, knee guards and emissive seams.
  const chestPlate=part(torso,new THREE.BoxGeometry(.62,.34,.12),armor,[0,.43,.31],[1,1,.7]);
  part(torso,new THREE.BoxGeometry(.38,.055,.035),glow,[0,.44,.39]);
  for(const s of [-1,1]){
    const pauldron=part(torso,new THREE.SphereGeometry(.25,18,12),armor,[s*.58,.49,.015],[1.18,.78,1.05]);
    pauldron.rotation.z=s*-.18;
    part(torso,new THREE.BoxGeometry(.11,.22,.07),glow,[s*.57,.43,.235],[1,1,.8]);
    const thigh=part(pelvis,new THREE.BoxGeometry(.24,.18,.33),armor,[s*.22,-.27,.08]);
    thigh.rotation.z=s*.08;
    part(pelvis,new THREE.BoxGeometry(.17,.07,.035),glow,[s*.22,-.27,.25]);
  }
  // Distinctive face visor and cheek guards help read the character at gameplay distance.
  if(archetype==='warrior'||archetype==='cyborg'){
    part(head,new THREE.BoxGeometry(.34,.075,.075),glow,[0,.02,.27]);
    part(head,new THREE.BoxGeometry(.1,.13,.08),dark,[-.19,-.075,.245]);
    part(head,new THREE.BoxGeometry(.1,.13,.08),dark,[.19,-.075,.245]);
  } else {
    part(head,new THREE.BoxGeometry(.28,.045,.06),glow,[0,-.015,.265]);
  }
  // Forearm emitters and boot caps reinforce the sci-fi fighter design.
  for(const s of [-1,1]){
    part(g,new THREE.BoxGeometry(.28,.11,.33),armor,[s*.22,.12,.09]);
    part(g,new THREE.BoxGeometry(.18,.035,.035),glow,[s*.22,.17,.26]);
  }
  // signature back-mounted blade / energy pack
  const pack=part(torso,new THREE.BoxGeometry(.36,.48,.18),dark,[0,.24,-.3]);
  part(torso,new THREE.BoxGeometry(.18,.34,.08),glow,[0,.24,-.405]);
  const blade=part(torso,new THREE.BoxGeometry(.08,.82,.12),glow,[.72,-.02,-.08]); blade.rotation.z=-.22;
  // Character silhouette/accessory kit: each roster entry gets at least one identity cue.
  const feature=looks[key]?.feature||'';
  const cape=(color,width=.78,height=1.3)=>{
    const shape=new THREE.Shape();shape.moveTo(-.32,.56);shape.lineTo(.32,.56);shape.lineTo(width,-height*.5);shape.lineTo(-width,-height*.5);shape.closePath();
    const capeMat=mat(color,.04,.88);
    const mesh=part(g,new THREE.ShapeGeometry(shape),capeMat,[0,1.93,-.31]);mesh.renderOrder=1;return mesh;
  };
  // Hair is a form surface: a transformation may retint it and change its silhouette, so the
  // material and the meshes are tagged here rather than sniffed out later.
  const spikeHair=(color,count=7,length=.42)=>{
    const hm=mat(color,.05,.82);
    hm.name='fighter-hair';
    (g.userData.hairMaterials||=[]).push(hm);
    for(let i=0;i<count;i++){const angle=(i/count)*Math.PI*2;const x=Math.cos(angle)*.17,z=Math.sin(angle)*.13;
      const spike=part(head,new THREE.ConeGeometry(.085,length,5),hm,[x,.25+(i%3)*.018,z]);spike.rotation.z=Math.sin(angle)*.6;spike.rotation.x=Math.cos(angle)*.45;
      spike.userData.formSurface='hair';
      (head.userData.hairMeshes||=[]).push(spike);}
  };
  if(['superman','superman','burt_reynolds','superman'].includes(feature)) cape(0x982733,.82,1.55);
  if(['superman','ironman','blackadam'].includes(feature)){
    const emblem=part(torso,new THREE.BoxGeometry(.3,.31,.055),glow,[0,.27,.32]);
    if(feature==='ironman'){
      const reactor=part(torso,new THREE.CircleGeometry(.12,24),mat(0x7af2ff,.1,.2,0x50ccff),[0,.25,.365]);
      reactor.material.name='arc-reactor';
      reactor.userData.formSurface='reactor';
      g.userData.reactorMesh=reactor;
    }
  }
  if(['superman','the_flash_barry_allen','all_might'].includes(feature)) cape(feature==='superman'?0x972a35:0x26375d,.82,1.55);
  if(feature==='blackadam'){part(torso,new THREE.BoxGeometry(.11,.39,.045),glow,[0,.24,.35]);}
  if(feature==='yellowtracksuit'){for(const side of [-1,1])part(g,new THREE.BoxGeometry(.055,.75,.04),mat(0x11151b),[side*.23,1.2,.19]);}
  if(feature==='eyepatch'){part(head,new THREE.BoxGeometry(.23,.12,.06),dark,[.11,.03,.23]);part(head,new THREE.BoxGeometry(.35,.045,.035),dark,[0,.11,.24]);}
  if(['sunglasses','terminator'].includes(feature)){const lenses=mat(0x10151b,.45,.22);part(head,new THREE.BoxGeometry(.38,.095,.065),lenses,[0,.055,.245]);}
  if(feature==='mustache'||feature==='mario'||feature==='luigi'){const mmat=mat(0x2c211c,.02,.9);part(head,new THREE.SphereGeometry(.12,10,7),mmat,[-.09,-.12,.245],[1,.45,.5]);part(head,new THREE.SphereGeometry(.12,10,7),mmat,[.09,-.12,.245],[1,.45,.5]);}
  if(feature==='flightpack'){part(torso,new THREE.BoxGeometry(.48,.5,.26),dark,[0,.23,-.34]);}
  if(feature==='longhair'||feature==='sephiroth'||feature==='sesshomaru'||feature==='whitehair'){
    spikeHair(feature==='longhair'?0x1c1c24:feature==='sephiroth'?0xe7e6e1:0xeeeeea,feature==='sephiroth'?9:6,.62);
    for(const side of [-1,1])part(head,new THREE.ConeGeometry(.07,.62,5),mat(feature==='longhair'?0x1c1c24:0xe9e6dc),[side*.21,.02,-.01]);
  }
  if(['superman','goku','vegeta','allmight'].includes(feature))spikeHair(feature==='superman'?0x282128:feature==='allmight'?0xd7ae36:0x1c1b20,feature==='vegeta'?9:7,.48);
  if(feature==='goku')spikeHair(0x17171b,9,.52);
  if(feature==='vegeta')part(head,new THREE.ConeGeometry(.14,.4,5),dark,[0,.36,.02]);
  if(feature==='naruto'||feature==='sasuke'||feature==='hashirama'||feature==='madara'){
    const hairColor=feature==='sasuke'?0x171820:0x29262a;spikeHair(hairColor,feature==='madara'?11:7,feature==='madara'?.58:.42);
  }
  if(feature==='naruto'||feature==='sasuke'){
    const band=part(head,new THREE.BoxGeometry(.42,.105,.08),dark,[0,.18,.02]);
    part(head,new THREE.BoxGeometry(.22,.08,.035),mat(0x8896a2,.8,.3),[0,.18,.075]);
    for(const side of [-1,1])for(let line=0;line<3;line++)part(head,new THREE.BoxGeometry(.1,.018,.025),dark,[side*.19,-.06+line*.05,.246]);
  }
  if(feature==='hulk'){for(const side of [-1,1])part(g,new THREE.BoxGeometry(.2,.35,.06),skin,[side*.27,.55,.21]);}
  if(feature==='green_lantern_hal_jordan'){part(g,new THREE.TorusGeometry(.05,.018,6,12),glow,[.28,1.08,.25]);}
  if(feature==='hoverchair'){
    const chairFrame=mat(0x697786,.72,.28), chairDark=mat(0x242b36,.55,.36), hoverGlow=mat(0x65eaff,.25,.2,0x1ebbea);
    part(g,new THREE.BoxGeometry(.66,.12,.62),chairDark,[0,.67,-.03]);
    part(g,new THREE.BoxGeometry(.58,.58,.14),armor,[0,.99,-.27]);
    part(g,new THREE.BoxGeometry(.68,.09,.62),chairFrame,[0,.75,-.04]);
    for(const side of [-1,1]){
      part(g,new THREE.BoxGeometry(.12,.1,.46),chairFrame,[side*.42,.91,-.02]);
      const wheel=part(g,new THREE.TorusGeometry(.34,.055,8,28),chairDark,[side*.49,.45,-.03]);
      wheel.rotation.y=Math.PI/2;
      const inner=part(g,new THREE.TorusGeometry(.21,.022,6,24),hoverGlow,[side*.495,.45,-.03]);
      inner.rotation.y=Math.PI/2;
      part(g,new THREE.BoxGeometry(.14,.22,.3),chairFrame,[side*.43,.56,.18]);
    }
    part(g,new THREE.BoxGeometry(.48,.07,.38),chairFrame,[0,.33,.26]);
    part(g,new THREE.BoxGeometry(.42,.035,.08),hoverGlow,[0,.24,.25]);
  }

  if(feature==='wonderwoman'){part(head,new THREE.TorusGeometry(.21,.035,7,28),mat(0xd7ad4f,.8,.2),[0,.13,0]);cape(0x8c202a,.62,1.1);}
  if(feature==='lantern'){part(g,new THREE.TorusGeometry(.07,.035,7,16),glow,[.28,1.1,.24]);}
  if(feature==='flash'){for(const side of [-1,1]){const bolt=part(head,new THREE.ConeGeometry(.07,.28,4),mat(0xf0c34b,.25,.24),[side*.3,.04,.02]);bolt.rotation.z=side*Math.PI/2;}}

  if(feature==='trident'){
    // Aquaman's beard was missing entirely at gameplay distance: a dark auburn jaw, sideburns and
    // moustache read as a beard silhouette instead of a clean-shaven face.
    const beardMat=mat(0x7a4a28,.32,.88),beardDark=mat(0x5e361b,.28,.9);
    part(head,new THREE.SphereGeometry(.158,12,9),beardMat,[0,-.145,.135],[1,.92,.58]);
    part(head,new THREE.BoxGeometry(.1,.055,.035),beardDark,[0,-.062,.228]);
    for(const side of [-1,1]){
      part(head,new THREE.BoxGeometry(.055,.13,.035),beardMat,[side*.115,-.105,.185]);
      part(head,new THREE.BoxGeometry(.045,.12,.025),beardMat,[side*.145,-.055,.12]);
      part(head,new THREE.BoxGeometry(.05,.1,.025),beardMat,[side*.075,-.115,.215]);
    }
  }
  if(feature==='strange'){cape(0x77262c,.9,1.4);part(torso,new THREE.TorusGeometry(.11,.035,7,20),mat(0xd8ad50,.75,.2),[0,.22,.35]);}
  if(feature==='hammer'){cape(0x7a2026,.7,1.2);}
  if(feature==='stormbreaker'){
    cape(0x7a2026,.78,1.42);
    spikeHair(0xc99e61,5,.18);
    const plate=mat(0xaeb9c5,.78,.27), darkSteel=mat(0x4a5969,.62,.35), runeBlue=mat(0x57d5ff,.2,.2,0x168edc);
    for(const side of [-1,1]){
      const pauldron=part(torso,new THREE.BoxGeometry(.26,.17,.18),plate,[side*.36,.43,.22]);pauldron.rotation.z=side*.18;
      for(let row=0;row<3;row++){
        const disc=part(torso,new THREE.CylinderGeometry(.085,.085,.04,16),row===1?darkSteel:plate,[side*(.18+row*.025),.29-row*.18,.315]);
        disc.rotation.x=Math.PI/2;
      }
      part(g,new THREE.BoxGeometry(.16,.28,.18),darkSteel,[side*.32,.36,.16]);
      part(g,new THREE.BoxGeometry(.13,.045,.12),runeBlue,[side*.32,.35,.265]);
    }
    part(torso,new THREE.BoxGeometry(.12,.32,.035),runeBlue,[0,.24,.335]);
  }
  if(feature==='vegeta'||feature==='madara'||feature==='hashirama')for(const side of [-1,1])part(torso,new THREE.BoxGeometry(.2,.56,.14),armor,[side*.42,.25,.2]);
  if(feature==='saitama'){part(head,new THREE.SphereGeometry(.29,16,10),skin,[0,.02,0],[1.02,1.02,.95]);cape(0xf0ede3,.8,1.5);for(const side of [-1,1])part(g,new THREE.SphereGeometry(.12,10,8),mat(0xc7322e),[side*.32,.32,.05]);}
  if(feature==='darkcircles'){for(const side of [-1,1])part(head,new THREE.BoxGeometry(.12,.04,.035),dark,[side*.12,-.03,.225]);}
  if(feature==='odm'){for(const side of [-1,1]){part(g,new THREE.BoxGeometry(.16,.42,.23),armor,[side*.42,.78,-.03]);part(g,new THREE.BoxGeometry(.09,.5,.06),dark,[side*.35,.86,.12]);}}
  if(feature==='automail'){part(g,new THREE.CylinderGeometry(.09,.13,.48,8),mat(0xa8b5c1,.85,.23),[-.3,.95,.1]);}
  if(feature==='zoro'){spikeHair(0x458344,7,.24); }
  if(feature==='all_might'){spikeHair(0xe9ba47,7,.68);cape(0xe7ddd1,.9,1.5);}
  if(feature==='jotaro'){part(head,new THREE.BoxGeometry(.58,.11,.45),armor,[0,.18,-.02]);part(head,new THREE.TorusGeometry(.25,.035,6,18),mat(0xdbb45b,.7,.25),[.34,.13,.04]);cape(0x1b2244,.9,1.4);}
  if(feature==='aang'){
    const arrow=mat(0x4ebfff,.15,.25,0x1289e5);
    // Distinct blue arrow tattoos on the scalp, brow, arms and tunic.
    part(head,new THREE.BoxGeometry(.075,.42,.035),arrow,[0,.28,.238]);
    part(head,new THREE.ConeGeometry(.09,.18,3),arrow,[0,.49,.235]);
    part(head,new THREE.BoxGeometry(.2,.04,.025),arrow,[0,.12,.265]);
    part(torso,new THREE.BoxGeometry(.07,.44,.025),arrow,[0,.26,.32]);
    for(const side of [-1,1]){
      const stripe=part(g,new THREE.BoxGeometry(.045,.36,.024),arrow,[side*.28,.79,.19]);
      stripe.rotation.z=side*.1;
      part(g,new THREE.TorusGeometry(.075,.018,6,18),arrow,[side*.30,.72,.12]);
    }
  }
  if(feature==='mario'||feature==='luigi'){const cap=part(head,new THREE.CylinderGeometry(.29,.28,.12,16),feature==='mario'?mat(0xc72e2e):mat(0x34804a),[0,.25,0]);part(head,new THREE.SphereGeometry(.27,12,8),feature==='mario'?mat(0xc72e2e):mat(0x34804a),[0,.3,-.02],[1,.45,1]);}
  if(feature==='bandana'){part(head,new THREE.BoxGeometry(.56,.12,.17),mat(0x707d8a),[0,.15,-.05]);}
  if(feature==='kratos'){part(head,new THREE.BoxGeometry(.11,.75,.055),mat(0xb72a35),[-.17,.0,.27]);part(head,new THREE.BoxGeometry(.18,.13,.05),mat(0xb72a35),[.09,-.16,.27]);}
  if(feature==='link'){part(head,new THREE.ConeGeometry(.2,.38,4),cloth,[0,.28,-.01]);}
  if(feature==='lara'){for(const side of [-1,1])part(g,new THREE.BoxGeometry(.11,.36,.11),dark,[side*.31,.9,-.04]);}
  if(feature==='chief'||feature==='doom'){part(head,new THREE.BoxGeometry(.43,.24,.23),armor,[0,.02,.04]);part(head,new THREE.BoxGeometry(.35,.1,.025),mat(feature==='chief'?0xcbbd72:0x232a25,.8,.22),[0,.01,.17]);}
  if(feature==='shrek'){for(const side of [-1,1]){const ear=part(head,new THREE.CylinderGeometry(.07,.12,.24,8),skin,[side*.34,.04,0]);ear.rotation.z=side*Math.PI/2;} }
  if(feature==='fez'){part(head,new THREE.CylinderGeometry(.22,.25,.25,12),mat(0xb72d32,.05,.8),[0,.28,0]);}
  if(feature==='ariel'){spikeHair(0xc54435,8,.34);part(head,new THREE.TorusGeometry(.16,.035,8,18),mat(0x45b7a4,.2,.4),[0,-.05,.24]);}
  if(feature==='ursula'){for(let i=0;i<6;i++){const arm=part(g,new THREE.CylinderGeometry(.08,.16,.9,8),mat(0x2b183a,.2,.4),[-.55+i*.22,.2,-.12]);arm.rotation.z=(i-2.5)*.12;}}
  if(feature==='edna'){const lens=mat(0x0a0a0a,.15,.15);for(const side of [-1,1])part(head,new THREE.TorusGeometry(.14,.03,8,20),lens,[side*.15,.02,.25]);part(head,new THREE.BoxGeometry(.12,.035,.04),lens,[0,.02,.25]);}
  if(feature==='pirate'){
    // A tricorn, not a flattened cap: a leather dome, a thin brim disc and three stiff panels
    // turned up and outward at 120 degrees. Gold edging runs along each peak so the silhouette
    // still reads at gameplay distance.
    // NOTE: a second build of this hat (three flared panels with a torus band) placed the pieces at
    // head-local y .21-.38 and rendered as a black ring across the eyes, proving the `head` group's
    // local origin is not at the chin. Reverted rather than shipped. Measure the head bbox and the
    // face-feature offsets in a capture before re-authoring; do not guess the vertical frame.
    const leather=mat(0x241b14,.05,.85),leatherEdge=mat(0x3a2c1f,.12,.7),hatGold=mat(0xc39a52,.72,.28);
    part(head,new THREE.CylinderGeometry(.3,.325,.035,18),leather,[0,.235,-.02]);
    const crown=part(head,new THREE.SphereGeometry(.255,14,10),leather,[0,.3,-.02],[1,.62,1]);
    crown.rotation.x=.02;
    // Three upturned panels stand above the brim, leaning out only slightly so the tricorn
    // silhouette is wide at the top instead of reading as a flat cap.
    for(const angle of [Math.PI,Math.PI/3,-Math.PI/3]){
      const peak=part(head,new THREE.BoxGeometry(.46,.30,.05),leatherEdge,[Math.sin(angle)*.245,.44,Math.cos(angle)*.245]);
      peak.rotation.y=angle;peak.rotation.x=.3;
      // Edging is a child of the panel, so it stays on the panel's top edge instead of floating
      // in front of the face.
      part(peak,new THREE.BoxGeometry(.47,.032,.062),hatGold,[0,.155,.001]);
    }
    part(g,new THREE.BoxGeometry(.48,.05,.05),hatGold,[0,1.08,.29]);
  }
  if(feature==='spiderman'){
    const webBlack=mat(0x10131a,.12,.5),lens=mat(0xeaf6ff,.12,.22,.08),spiderSilver=mat(0x96a9c1,.45,.38);
    // Angular white lenses with dark raised rims are readable at fighting-camera distance.
    for(const side of [-1,1]){
      const rim=part(head,new THREE.BoxGeometry(.24,.145,.045),webBlack,[side*.132,.055,.235]);
      rim.rotation.z=side*.15;
      const eyeShape=new THREE.Shape();
      if(side<0){eyeShape.moveTo(-.09,-.025);eyeShape.lineTo(-.015,.07);eyeShape.lineTo(.075,.045);eyeShape.lineTo(.04,-.055);eyeShape.closePath();}
      else{eyeShape.moveTo(.09,-.025);eyeShape.lineTo(.015,.07);eyeShape.lineTo(-.075,.045);eyeShape.lineTo(-.04,-.055);eyeShape.closePath();}
      const lensMesh=part(head,new THREE.ShapeGeometry(eyeShape),lens,[side*.132,.055,.26]);
      lensMesh.rotation.z=side*.1;
    }
    // Raised black spider emblem on the chest.
    part(torso,new THREE.SphereGeometry(.075,12,8),webBlack,[0,.30,.347],[.68,1.8,.28]);
    for(const side of [-1,1]){
      const legTop=part(torso,new THREE.BoxGeometry(.035,.18,.025),webBlack,[side*.095,.34,.344]);legTop.rotation.z=side*.48;
      const legMid=part(torso,new THREE.BoxGeometry(.03,.22,.025),webBlack,[side*.14,.23,.344]);legMid.rotation.z=-side*.38;
      const wrist=part(g,new THREE.BoxGeometry(.15,.13,.18),webBlack,[side*.31,.94,.16]);
      part(g,new THREE.CylinderGeometry(.06,.06,.09,12),spiderSilver,[side*.31,.94,.27],[1,1,1]);
      for(let row=0;row<3;row++)part(g,new THREE.BoxGeometry(.12,.018,.02),webBlack,[side*.31,.90+row*.04,.285]);
      // Web seams on the shoulders and boots establish the classic suit pattern.
      for(let row=0;row<4;row++)part(torso,new THREE.BoxGeometry(.035,.24,.018),webBlack,[side*(.24-row*.018),.28-row*.018,.315]);
      part(g,new THREE.BoxGeometry(.13,.055,.1),spiderSilver,[side*.21,.14,.17]);
    }
    for(let side=-1;side<=1;side+=2){
      const waist=part(torso,new THREE.BoxGeometry(.35,.022,.025),webBlack,[0,.04,.334]);
      waist.rotation.z=side*.08;
    }
  }


  if(feature==='ironspider'){
    const gold=mat(0xd8a640,.88,.22,0xffb63c), lens=mat(0xf2dfae,.3,.16,.12), steel=mat(0x2b2f38,.7,.3);
    // Nano-suit lenses and the raised gold spider emblem, so the fallback body still reads as
    // the Iron Spider rather than a recoloured Iron Man.
    for(const side of [-1,1]){
      const rim=part(head,new THREE.BoxGeometry(.26,.16,.045),steel,[side*.132,.055,.232]);rim.rotation.z=side*.16;
      part(head,new THREE.BoxGeometry(.19,.06,.03),lens,[side*.132,.05,.255]);
    }
    part(torso,new THREE.SphereGeometry(.07,12,8),gold,[0,.3,.347],[.7,1.7,.3]);
    for(const side of [-1,1]){
      const upper=part(torso,new THREE.BoxGeometry(.035,.19,.025),gold,[side*.1,.34,.344]);upper.rotation.z=side*.5;
      const lower=part(torso,new THREE.BoxGeometry(.03,.2,.025),gold,[side*.145,.22,.344]);lower.rotation.z=-side*.4;
    }
    // The four mechanical legs are not decoration: anim/spider_legs.js attaches a real
    // three-joint chain per leg (12 joints total) that poses from the fighter's combat state
    // and reports its tip positions for the leg sweep. Attached below, once the body exists.
  }
  if(feature==='fedora'){part(head,new THREE.CylinderGeometry(.28,.28,.11,16),mat(0x563521,.04,.8),[0,.24,0]);part(head,new THREE.CylinderGeometry(.15,.21,.26,12),mat(0x563521,.04,.8),[0,.4,-.03]);part(g,new THREE.BoxGeometry(.5,.035,.1),mat(0x563521),[0,1.1,.25]);}

  if(feature==='hashirama'){cape(0x3c5365,.78,1.25);}
  if(feature==='voldemort'){
    // The pale skull needs structure, not just colour: a heavy brow, sunken sockets, snake-slit
    // nostrils, hollow cheeks, a thin mouth and a pointed chin, all proud of the head surface.
    const bone=mat(0xd4d0c5,.42,.85),boneShade=mat(0xa9a294,.5,.9),socket=mat(0x1a1a1e,.1,.9),slit=glow,mouthMat=mat(0x6d4a4c,.35,.9);
    for(const side of [-1,1]){
      const brow=part(head,new THREE.BoxGeometry(.15,.032,.05),bone,[side*.082,.072,.228]);
      brow.rotation.z=side*-.2;
      part(head,new THREE.BoxGeometry(.1,.05,.03),socket,[side*.085,.036,.245]);
      const eye=part(head,new THREE.BoxGeometry(.072,.02,.025),slit,[side*.085,.036,.262]);
      eye.rotation.z=side*.12;
      const cheek=part(head,new THREE.BoxGeometry(.055,.085,.018),boneShade,[side*.132,-.01,.222]);
      cheek.rotation.z=side*.16;
    }
    // Snake-flat nose: a short bridge with two forward nostril slits, not a long pale bar.
    part(head,new THREE.BoxGeometry(.038,.042,.05),boneShade,[0,.006,.258]);
    for(const side of [-1,1]){
      const wing=part(head,new THREE.BoxGeometry(.022,.026,.032),bone,[side*.032,-.014,.268]);
      wing.rotation.z=side*.22;
      part(head,new THREE.BoxGeometry(.012,.016,.016),socket,[side*.026,-.026,.284]);
      // A deep hollow under the cheekbone gives the gaunt skull its shape.
      const hollow=part(head,new THREE.BoxGeometry(.05,.07,.014),mat(0x8f887c,.4,.95),[side*.138,-.035,.218]);
      hollow.rotation.z=side*.2;
    }
    part(head,new THREE.BoxGeometry(.15,.016,.022),mouthMat,[0,-.074,.264]);
    part(head,new THREE.BoxGeometry(.085,.014,.02),boneShade,[0,-.088,.256]);
    part(head,new THREE.BoxGeometry(.05,.05,.05),bone,[0,-.118,.232]);
  }
  if(feature==='madara'){for(const side of [-1,1])part(torso,new THREE.BoxGeometry(.2,.56,.14),armor,[side*.42,.25,.2]);}

    // Circular ground markers removed; the environment lighting supplies contact shadows.
  // rigKind tells the pose writer which skeleton it is driving: this one is Y-up with
  // absolute joint offsets the procedural pose owns, unlike the Z-up Blender prefab.
  g.userData={...g.userData,archetype,identity,rigKind:'procedural',characterScale:look?.scale||1,visualScale:look?.scale||1,spine,torso,pelvis,neck,head,blade};
  // Iron Spider's appendages are a jointed rig on the body itself, so they exist before, during
  // and after the sweep instead of being spawned as one-shot VFX.
  if(feature==='ironspider')attachSpiderLegs(g);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return g;
}


const characterModelLibraryState={promise:null,prefabs:null};
function loadCharacterModelLibrary(){
  if(!characterModelLibraryState.promise){
    characterModelLibraryState.promise=new Promise((resolve,reject)=>{
      const url=new URL('../assets/character_models.glb',import.meta.url);
      url.searchParams.set('v','browser-smash-character-prefabs-v3-20261018');
      runtimeAssetState.characters={status:'loading',url:url.href};
      new GLTFLoader().load(url.href,gltf=>{
        const prefabs=new Map();
        let meshCount=0;
        gltf.scene.traverse(node=>{
          if(node.name&&node.name.startsWith('character_'))prefabs.set(node.name,node);
          if(node.isMesh)meshCount++;
        });
        characterModelLibraryState.prefabs=prefabs;
        runtimeAssetState.characters={
          status:prefabs.size>=57?'loaded':'partial',
          count:prefabs.size,
          // The roster audit reads this to tell "this identity has a prefab that failed to
          // mount" (a regression) from "this identity has no prefab yet" (a fallback body).
          keys:[...prefabs.keys()],
          meshCount,url:url.href
        };
        resolve(prefabs);
      },undefined,error=>{
        runtimeAssetState.characters={status:'error',message:String(error?.message||error),url:url.href};
        reject(error);
      });
    });
  }
  return characterModelLibraryState.promise;
}

/** Swap the procedural startup body with the matching editable Blender prefab. */
export async function upgradeCharacterWithBlenderModel(fighter){
  const oldModel=fighter?.model;
  if(!oldModel||!oldModel.userData)return false;
  // An authored body is already the finished model: the prefab library holds primitive
  // cylinder assemblies, so swapping one in would be a downgrade.
  if(oldModel.userData.sculptedBody)return false;
  const key=characterWeaponKey(fighter.identity||fighter.name);
  let prefabs;
  try{
    prefabs=await loadCharacterModelLibrary();
  }catch(error){
    console.warn('Blender character GLB unavailable; keeping procedural character.',error);
    await equipCharacterWeapons(fighter).catch(()=>false);
    return false;
  }
  if(fighter.model!==oldModel)return false;
  const template=prefabs.get('character_'+key);
  if(!template){
    await equipCharacterWeapons(fighter).catch(()=>false);
    return false;
  }
  const avatar=template.clone(true);
  avatar.name='Blender fighter '+(fighter.identity||fighter.name);
  avatar.position.copy(oldModel.position);
  // The prefab is authored Y-up with an identity root (scripts/normalize-character-rig.mjs),
  // so it only needs the fighter's current heading - the same convention the procedural body
  // and fighter3D.js use. Carry the armour template's own rotation through in case a prefab
  // ever ships one.
  const heading = Math.atan2(Number(fighter.facingZ) || 0, Number(fighter.facing) || 1);
  avatar.rotation.set(template.rotation.x, heading + template.rotation.y, template.rotation.z);
  avatar.scale.copy(oldModel.scale);
  avatar.userData={...avatar.userData,
    rigKind:'prefab',
    identity:fighter.identity||fighter.name,
    archetype:fighter.archetype,
    characterScale:Number(template.userData.characterScale)||Number(oldModel.userData.characterScale)||1,
    visualScale:Number(oldModel.userData.visualScale)||1,
    blenderRigVersion:template.userData.rigVersion||'bs-articulated-v1'
  };
  bindRigJoints(avatar,key);
  if(!avatar.userData.rightArm||!avatar.userData.rightFore||!avatar.userData.torso||!avatar.userData.pelvis){
    console.warn('Incomplete Blender rig for '+key+'; keeping procedural model.');
    await equipCharacterWeapons(fighter).catch(()=>false);
    return false;
  }
  const parent=oldModel.parent;
  if(!parent)return false;
  // The prefab libraries ship no image textures at all, so the fighter would render as
  // smooth plastic. Apply generated weave/brushed/leather/skin detail maps before the
  // model is measured and mounted.
  const detail=enhanceSurfaceMaterials(avatar);
  avatar.userData.surfaceDetail=surfaceDetailReport(avatar);
  runtimeAssetState.lastCharacterDetail={key,...detail,classes:avatar.userData.surfaceDetail};
  avatar.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  avatar.updateMatrixWorld(true);
  // Gate the swap on structure, not on "the GLB parsed": detached parts, a cape through the
  // floor, joints flung off the body or a legacy Z-up root all keep the working procedural
  // fighter instead of shipping a broken one into the arena.
  const validation=validateFighterRig(avatar,{ground:avatar.position.y});
  runtimeAssetState.lastCharacter={key,loaded:true,...validation.metrics,validation:{ok:validation.ok,issues:validation.issues}};
  if(!validation.ok){
    console.warn('Character rig for '+key+' failed validation; keeping the procedural fighter. '+describeRigValidation(validation));
    await equipCharacterWeapons(fighter).catch(()=>false);
    return false;
  }
  parent.add(avatar);
  // This clone's geometry belongs to the avatar alone, and the body it replaces is done. The old
  // body used to be detached without disposing anything, so every swap stranded a full prefab
  // clone's geometries (and any maps it owned) in the renderer for the rest of the session.
  claimModelTextures(avatar);
  releaseModelTextures(oldModel,{keep:(window.fighters||[]).map(f=>f.model).filter(model=>model&&model!==oldModel)});
  parent.remove(oldModel);
  oldModel.traverse?.(node=>{ if(node.isMesh) node.geometry?.dispose?.(); });
  fighter.model=avatar;
  fighter.position=avatar.position;
  await equipCharacterWeapons(fighter).catch(error=>console.warn('Weapon reattachment after Blender model swap:',error));
  return true;
}

const weaponLibraryState={promise:null,prefabs:null};
function characterWeaponKey(identity){
  return String(identity||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function loadWeaponLibrary(){
  if(!weaponLibraryState.promise){
    weaponLibraryState.promise=new Promise((resolve,reject)=>{
      const url=new URL('../assets/character_weapons.glb',import.meta.url);
      url.searchParams.set('v','browser-smash-weapons-v6-20261103');
      runtimeAssetState.weapons={status:'loading',url:url.href};
      new GLTFLoader().load(url.href,gltf=>{
        const prefabs=new Map();
        let meshCount=0;
        gltf.scene.traverse(node=>{
          if(node.name&&node.name.startsWith('weapon_'))prefabs.set(node.name,node);
          if(node.isMesh)meshCount++;
        });
        weaponLibraryState.prefabs=prefabs;
        runtimeAssetState.weapons={
          status:prefabs.size>=68?'loaded':'partial',
          count:prefabs.size,meshCount,url:url.href
        };
        resolve(prefabs);
      },undefined,error=>{
        runtimeAssetState.weapons={status:'error',message:String(error?.message||error),url:url.href};
        reject(error);
      });
    });
  }
  return weaponLibraryState.promise;
}
function makeProceduralWeapon(key, side='right') {
  const group=new THREE.Group();
  const accentColor=key.includes('iron_man')||key.includes('master_chief')?0x38eaff:key.includes('thor')||key.includes('kratos')?0xffc35a:key.includes('naruto')||key.includes('sasuke')?0x56a9ff:0xb9d9ed;
  const metal=new THREE.MeshStandardMaterial({color:0x394959,metalness:.88,roughness:.24});
  const edge=new THREE.MeshStandardMaterial({color:accentColor,metalness:.48,roughness:.2,emissive:accentColor,emissiveIntensity:1.15});
  const grip=new THREE.MeshStandardMaterial({color:0x171d28,metalness:.18,roughness:.76});
  const add=(geometry,material,x,y,z,rx=0,ry=0,rz=0)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
  const staff=['doctor_strange','green_lantern','aang','lord_voldemort','edward_elric'].some(n=>key.includes(n));
  const blaster=['iron_man','master_chief','solid_snake','han_solo','the_flash'].some(n=>key.includes(n));
  const hammer=['thor','kratos','hulk','all_might'].some(n=>key.includes(n));
  const katana=['naruto','sasuke','levi','link','geralt','sephiroth','sesshomaru','captain_jack','indiana_jones'].some(n=>key.includes(n));
  add(new THREE.CylinderGeometry(.045,.055,.55,10),grip,0,-.19,0,0,0,Math.PI*.04);
  if(blaster){
    add(new THREE.BoxGeometry(.19,.23,.5),metal,0,.08,.02);
    add(new THREE.BoxGeometry(.11,.27,.13),grip,0,-.12,.08,.12);
    add(new THREE.BoxGeometry(.09,.07,.28),edge,0,.1,.31);
    add(new THREE.BoxGeometry(.22,.045,.14),edge,0,.22,-.02);
    add(new THREE.BoxGeometry(.05,.05,.18),metal,0,.08,.34);
    group.userData.kind='blaster';
  }else if(hammer){
    add(new THREE.BoxGeometry(.43,.34,.34),metal,0,.34,0);
    add(new THREE.BoxGeometry(.12,.4,.39),edge,0,.34,0);
    add(new THREE.BoxGeometry(.48,.06,.37),edge,0,.53,0);
    group.userData.kind=key.includes('thor')?'stormbreaker':'hammer';
  }else if(staff){
    add(new THREE.CylinderGeometry(.055,.075,.82,10),metal,0,.32,0);
    add(new THREE.OctahedronGeometry(.16,1),edge,0,.79,0);
    add(new THREE.TorusGeometry(.2,.025,7,24),edge,0,.79,0,0,0,Math.PI/2);
    group.userData.kind='staff';
  }else{
    add(new THREE.BoxGeometry(.12,.22,.1),metal,0,.08,0);
    add(new THREE.BoxGeometry(.065,.13,.09),edge,0,.08,.07);
    const blade=add(new THREE.ConeGeometry(.105,.86,6),edge,0,.61,0,0,0,Math.PI);
    blade.scale.set(1,.95,.48);
    add(new THREE.BoxGeometry(.31,.075,.14),metal,0,.2,0);
    add(new THREE.BoxGeometry(.035,.16,.07),edge,0,.2,.02);
    group.userData.kind=katana?'katana':'sword';
  }
  group.userData.display_name=key.replace(/_/g,' ').replace(/\\b\\w/g,c=>c.toUpperCase())+(side==='left'?' Offhand':' Signature Weapon');
  group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return group;
}
function weaponSize(kind){
  if(kind==='stormbreaker')return 1.05;
  if(kind==='giant_sword'||kind==='war_fan')return 1.02;
  if(['rifle','plasma_rifle','shotgun'].includes(kind))return .66;
  if(['pistol','blaster'].includes(kind))return .72;
  if(['gauntlet','energy_gauntlet','repulsor','lightning','energy_construct','alchemy_glove','claws'].includes(kind))return .78;
  if(['trident','staff','wand','hammer','axe'].includes(kind))return .8;
  if(kind==='whip'||kind==='tentacle')return .9;
  if(kind==='shield')return .9;
  return .76;
}
function clearEquippedWeapon(mount,prop){
  if(!prop)return;
  // The prop hangs off the mount itself, or off the aligned holder made for a skeleton mount.
  if(prop.parent===mount||prop.parent?.parent===mount)prop.parent.remove(prop);
}
/**
 * Where a weapon hangs. A prefab body's joints are already in the game's frame, so a weapon
 * parents straight onto them. A rigged character's bones are not: a Blender bone's +Y runs down
 * the bone, so a weapon parented directly to the forearm pointed along the arm and hung through
 * the floor (Stormbreaker reached 0.30 m below the fighter's origin). One holder per mount,
 * aligned with the world in the bind pose, gives the weapon the frame its authored offsets were
 * written for while still riding the hand rigidly once the arm moves.
 */
function weaponMount(bone,model){
  if(!bone||!bone.isBone)return bone||null;
  const cached=bone.userData.weaponHolder;
  if(cached){
    // A holder made for an earlier body must move with the current one: its position is written in
    // model-local space, so a stale parent offsets the prop by the difference between the frames.
    if(model&&cached.parent!==model)model.add(cached);
    return cached;
  }
  const holder=new THREE.Group();
  holder.name='weapon-holder';
  // The holder is what gets parented, so it has to remember which bone it rides: the grip offset
  // depends on whether that bone is the hand or the forearm.
  holder.userData.attachBone=bone.name;
  holder.userData.attachBoneObject=bone;
  holder.userData.attachIsHand=/hand|wrist|palm/i.test(bone.name||'');
  // The holder rides the body root so it inherits the fighter's yaw; syncEquippedWeapons() writes
  // its position from the hand bone after the skeleton has been posed.
  (model||bone.parent||bone).add(holder);
  holder.position.set(0,0,0);
  bone.userData.weaponHolder=holder;
  return holder;
}
/**
 * A grip belongs in the palm, not at the far end of the forearm.
 *
 * The authored props put the grip at their own origin and run the blade or head up from there,
 * so a hand mount needs only a palm-sized offset. The forearm fallback keeps the old -0.39 m
 * reach towards the wrist. Parenting to the forearm alone made Stormbreaker swing around the
 * elbow instead of the wrist, which read in a live match as a hammer floating beside Thor's
 * shoulder, and did the same to Wonder Woman's sword and shield.
 */
// Per-weapon grip origins, in the prop's own scaled units. A prop's geometry origin is not where a
// hand closes on it, so the correction belongs to the weapon kind rather than to a character.
//   shield: centre-grip round shield. After the Z-up export its boss sits at local (0, +0.50, +0.15),
//   so the root drops 0.50 and moves back 0.15 to put the boss itself in the palm.
const PROP_GRIPS={
  // With a body-frame holder the authored face normal (local +Z) already points along the bearer's
  // forward axis, so the shield needs only its centre-grip offset.
  shield:{y:-.50,z:-.15}
};
function weaponSpin(kind){return PROP_GRIPS[kind]?.spin||null;}
function weaponGrip(mount,side,kind,size){
  const hand=mount?.userData?.attachIsHand===true;
  const prop=PROP_GRIPS[kind]||null;
  if(prop)return{x:(prop.x||0)*size,y:(prop.y||0)*size-.045,z:(prop.z||0)*size+(side==='left'?.040:.055)};
  return hand?{y:-.045,z:side==='left'?.040:.055}:{y:-.39,z:side==='left'?.045:.065};
}
/**
 * Weapon orientation is the fighter's horizontal facing, not the arm's.
 *
 * Position belongs to the hand bone: the prop rides the palm wherever the arm goes. Orientation is
 * a separate concern. Cancelling the bone's rotation outright (the original holder) kept props
 * upright but locked them to a fixed compass direction, so a shield pointed the same way after a
 * 180-degree turn. Using the bone's own rotation instead made every prop tumble with each swing.
 * This writes the holder's world rotation as pure body yaw, which leaves the authored grip
 * offsets, and the prop's own upright axis, untouched.
 */
export function syncEquippedWeapons(model){
  if(!model?.userData)return;
  model.updateWorldMatrix(true,false);
  for(const side of ['Right','Left']){
    const weapon=model.userData['equippedWeapon'+side];
    const holder=weapon?.parent;
    const bone=holder?.userData?.attachBoneObject;
    if(!holder||!bone)continue;
    bone.updateWorldMatrix(true,false);
    holder.position.copy(model.worldToLocal(new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld)));
  }
}
export async function equipCharacterWeapons(fighter){
  const model=fighter?.model;
  if(!model?.userData)return false;
  // Spider-Man is a web-slinger, not a weapon carrier. The shared prefab for his wrists is a
  // generic-rig cuff/cartridge assembly that reads as a floating grey brick on both the imported
  // suit and the fallback body, and it obscures the hand poses this pass is judging. Do this before
  // the mount path so no body can acquire the prop; the web abilities carry their own projectile
  // profile, so the moveset is unchanged.
  if(characterWeaponKey(fighter?.identityKey||fighter?.identity||fighter?.name)==='spider_man'){
    model.userData.unarmed=true;
    model.userData.weaponKind='unarmed';
    model.userData.weaponLabel='WEB SHOOTERS';
    return false;
  }
  // Hands are the weapon: a sky-authored fighter with an energy beam does not carry a sword,
  // and the palm repulsor / ki emitter is already modelled on the body.
  if(model.userData.unarmed===true||model.userData.sculptedBody){
    model.userData.weaponKind='unarmed';
    model.userData.weaponLabel=model.userData.sculptedBody==='iron_man_tony_stark'?'REPULSOR':'KI STRIKE';
    return false;
  }
  const rightMount=weaponMount(model.userData.rightHand||model.userData.rightFore||model.userData.rightArm,model);
  const leftMount=weaponMount(model.userData.leftHand||model.userData.leftFore||model.userData.leftArm,model);
  if(!rightMount)return false;
  clearEquippedWeapon(rightMount,model.userData.equippedWeaponRight);
  clearEquippedWeapon(leftMount,model.userData.equippedWeaponLeft);
  const key=characterWeaponKey(fighter.identity||fighter.name);
  const prefabs=await loadWeaponLibrary().catch(error=>{console.warn('Weapon GLB unavailable; using procedural signature gear.',error);return new Map();});
  // A character may have been switched while the asset was loading.
  if(fighter.model!==model)return false;
  const rightTemplate=prefabs.get('weapon_'+key+'_right');
  {
    const template=rightTemplate||makeProceduralWeapon(key,'right');
    const weapon=template.clone(true);
    const kind=template.userData.kind||'sword';
    model.userData.weaponKind=kind;
    model.userData.weaponLabel=template.userData.display_name||key;
    weapon.name='Equipped '+(template.userData.display_name||key);
    const rightSize=weaponSize(kind);
    const grip=weaponGrip(rightMount,'right',kind,rightSize);
    weapon.position.set(grip.x||0,grip.y,grip.z);
    const rightSpin=weaponSpin(kind);
    if(rightSpin)weapon.rotation.set(rightSpin[0],rightSpin[1],rightSpin[2]);
    weapon.scale.setScalar(rightSize);
    enhanceSurfaceMaterials(weapon,{weapon:true});
    weapon.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    rightMount.add(weapon);
    model.userData.equippedWeaponRight=weapon;
  }
  const leftTemplate=prefabs.get('weapon_'+key+'_left');
  if(leftTemplate&&leftMount){
    const weapon=leftTemplate.clone(true);
    const kind=leftTemplate.userData.kind||'sword';
    weapon.name='Equipped offhand '+key;
    const leftSize=weaponSize(kind);
    const grip=weaponGrip(leftMount,'left',kind,leftSize);
    weapon.position.set(grip.x||0,grip.y,grip.z);
    const leftSpin=weaponSpin(kind);
    if(leftSpin)weapon.rotation.set(leftSpin[0],leftSpin[1],leftSpin[2]);
    weapon.scale.setScalar(leftSize);
    enhanceSurfaceMaterials(weapon,{weapon:true});
    weapon.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    leftMount.add(weapon);
    model.userData.equippedWeaponLeft=weapon;
    // The offhand has its own identity - Wonder Woman's and Link's shield, Geralt's second sword -
    // and it is not what weaponKind describes (that is the right-hand weapon, and it is what the
    // combat reach and impact tables key on). Recorded from the prefab's own `kind` so the game
    // never has to guess from a mesh name.
    model.userData.offhandKind=kind;
    model.userData.offhandLabel=leftTemplate.userData.display_name||key;
  }
  syncEquippedWeapons(model);
  return true;
}

