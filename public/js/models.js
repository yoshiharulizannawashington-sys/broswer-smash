// Original procedural fighters for Browser Smash. Articulated pivot hierarchy enables real limb animation.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
    sesshomaru:{body:0xe6e1d5,armor:0xe8e1d1,accent:0x9973ad,skin:0xe6d8c9,head:'hair',feature:'sesshomaru'},
    norman_bates:{body:0x454b55,armor:0x6c6558,accent:0xc4baa3,head:'hair',feature:'knife'},
    han_solo:{body:0xe6e1d4,armor:0x28313c,accent:0xb78e4f,head:'hair',feature:'blaster'},
    indiana_jones:{body:0x65432e,armor:0x46322a,accent:0x8c6b42,head:'hair',feature:'fedora'},
    lord_voldemort:{body:0x17181b,armor:0x2e3035,accent:0xb6ad9c,skin:0xd4d0c5,head:'hair',feature:'voldemort'},
    sasuke_uchiha:{body:0x17213b,armor:0x353d55,accent:0x5a9ce1,head:'hair',feature:'sasuke'},
    hashirama_senju:{body:0x325a46,armor:0x5b3d2f,accent:0x8a9873,head:'hair',feature:'hashirama',scale:1.22},
    madara_uchiha:{body:0x492e32,armor:0x7c3d3a,accent:0xb79362,head:'hair',feature:'madara',scale:1.22}
  };
  const d={...(designs[archetype]||designs.warrior)};
  const look=looks[key];
  if(look) Object.assign(d,look);
  const cloth=mat(d.body,.12,.72), armor=mat(d.armor,.72,.28), glow=mat(d.accent,.3,.2,d.accent), skin=mat(d.skin,.05,.78), dark=mat(0x10151d,.4,.42);
  // root origin is at the feet; torso and limbs are independently articulated.
  const pelvis=joint(g,[0,1.02,0]); part(pelvis,new THREE.BoxGeometry(.68,.38,.42),armor,[0,0,0]);
  const torso=joint(pelvis,[0,.28,0]); part(torso,new THREE.BoxGeometry(.9,.82,.48),cloth,[0,.28,0]);
  part(torso,new THREE.BoxGeometry(.98,.25,.55),armor,[0,.48,0]);
  part(torso,new THREE.BoxGeometry(.23,.38,.06),glow,[0,.3,.275]);
  for(const s of [-1,1]) {
    const shoulder=part(torso,new THREE.SphereGeometry(.28,12,10),armor,[s*.55,.48,0],[1,1,.9]);
    part(torso,new THREE.BoxGeometry(.18,.36,.12),glow,[s*.42,.25,.27]);
    const arm=joint(torso,[s*.62,.35,0]); part(arm,new THREE.CylinderGeometry(.13,.16,.42,10),cloth,[0,-.2,0]);
    part(arm,new THREE.BoxGeometry(.32,.22,.3),armor,[0,-.42,.015]);
    const fore=joint(arm,[0,-.42,0]); part(fore,new THREE.CylinderGeometry(.11,.14,.38,10),armor,[0,-.18,0]);
    part(fore,new THREE.BoxGeometry(.23,.18,.24),glow,[0,-.37,.035]);
    const leg=joint(pelvis,[s*.22,-.15,0]); part(leg,new THREE.CylinderGeometry(.15,.19,.48,10),cloth,[0,-.25,0]);
    part(leg,new THREE.BoxGeometry(.31,.25,.32),armor,[0,-.43,.015]);
    const shin=joint(leg,[0,-.45,0]); part(shin,new THREE.CylinderGeometry(.12,.15,.43,10),armor,[0,-.21,0]);
    part(shin,new THREE.BoxGeometry(.3,.16,.43),dark,[0,-.42,.08]);
    if(s===-1) { g.userData.leftArm=arm;g.userData.leftFore=fore;g.userData.leftLeg=leg;g.userData.leftShin=shin; }
    else { g.userData.rightArm=arm;g.userData.rightFore=fore;g.userData.rightLeg=leg;g.userData.rightShin=shin; }
  }
  const neck=joint(torso,[0,.72,0]); part(neck,new THREE.CylinderGeometry(.13,.16,.18,10),skin,[0,0,0]);
  const head=joint(neck,[0,.24,0]); part(head,new THREE.SphereGeometry(.28,16,12),skin,[0,0,0],[.88,1.05,.82]);
  if(d.head==='helmet') {
    part(head,new THREE.SphereGeometry(.31,16,12),armor,[0,.04,0],[1,1,.94]);
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
  const spikeHair=(color,count=7,length=.42)=>{
    const hm=mat(color,.05,.82);
    for(let i=0;i<count;i++){const angle=(i/count)*Math.PI*2;const x=Math.cos(angle)*.17,z=Math.sin(angle)*.13;
      const spike=part(head,new THREE.ConeGeometry(.085,length,5),hm,[x,.25+(i%3)*.018,z]);spike.rotation.z=Math.sin(angle)*.6;spike.rotation.x=Math.cos(angle)*.45;}
  };
  if(['superman','superman','burt_reynolds','superman'].includes(feature)) cape(0x982733,.82,1.55);
  if(['superman','ironman','blackadam'].includes(feature)){
    const emblem=part(torso,new THREE.BoxGeometry(.3,.31,.055),glow,[0,.27,.32]);
    if(feature==='ironman')part(torso,new THREE.CircleGeometry(.12,24),mat(0x7af2ff,.1,.2,0x50ccff),[0,.25,.365]);
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
  if(feature==='pirate'){part(head,new THREE.CylinderGeometry(.24,.3,.14,12),dark,[0,.23,-.02]);part(head,new THREE.SphereGeometry(.28,12,8),dark,[0,.3,-.03],[1,.4,1]);part(g,new THREE.BoxGeometry(.48,.05,.05),mat(0xb68f53,.65,.2),[0,1.08,.29]);}


  if(feature==='fedora'){part(head,new THREE.CylinderGeometry(.28,.28,.11,16),mat(0x563521,.04,.8),[0,.24,0]);part(head,new THREE.CylinderGeometry(.15,.21,.26,12),mat(0x563521,.04,.8),[0,.4,-.03]);part(g,new THREE.BoxGeometry(.5,.035,.1),mat(0x563521),[0,1.1,.25]);}

  if(feature==='hashirama'){cape(0x3c5365,.78,1.25);}
  if(feature==='voldemort'){part(head,new THREE.BoxGeometry(.2,.07,.055),dark,[0,-.06,.24]);for(const side of [-1,1])part(head,new THREE.BoxGeometry(.065,.035,.03),glow,[side*.105,-.03,.25]);}
  if(feature==='madara'){for(const side of [-1,1])part(torso,new THREE.BoxGeometry(.2,.56,.14),armor,[side*.42,.25,.2]);}

    // Circular ground markers removed; the environment lighting supplies contact shadows.
  g.userData={...g.userData,archetype,identity,characterScale:look?.scale||1,visualScale:look?.scale||1,torso,pelvis,head,blade};
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return g;
}


const weaponLibraryState={promise:null,prefabs:null};
function characterWeaponKey(identity){
  return String(identity||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function loadWeaponLibrary(){
  if(!weaponLibraryState.promise){
    weaponLibraryState.promise=new Promise((resolve,reject)=>{
      const url=new URL('../assets/character_weapons.glb',import.meta.url);
      url.searchParams.set('v','weapon-library-stormbreaker-flight-20261018');
      new GLTFLoader().load(url.href,gltf=>{
        const prefabs=new Map();
        gltf.scene.traverse(node=>{if(node.name&&node.name.startsWith('weapon_'))prefabs.set(node.name,node);});
        weaponLibraryState.prefabs=prefabs;
        resolve(prefabs);
      },undefined,reject);
    });
  }
  return weaponLibraryState.promise;
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
  if(mount&&prop&&prop.parent===mount)mount.remove(prop);
}
export async function equipCharacterWeapons(fighter){
  const model=fighter?.model;
  if(!model?.userData)return false;
  const rightMount=model.userData.rightFore||model.userData.rightArm;
  const leftMount=model.userData.leftFore||model.userData.leftArm;
  if(!rightMount)return false;
  clearEquippedWeapon(rightMount,model.userData.equippedWeaponRight);
  clearEquippedWeapon(leftMount,model.userData.equippedWeaponLeft);
  const key=characterWeaponKey(fighter.identity||fighter.name);
  const prefabs=await loadWeaponLibrary();
  // A character may have been switched while the asset was loading.
  if(fighter.model!==model)return false;
  const rightTemplate=prefabs.get('weapon_'+key+'_right');
  if(rightTemplate){
    const weapon=rightTemplate.clone(true);
    const kind=rightTemplate.userData.kind||'sword';
    model.userData.weaponKind=kind;
    model.userData.weaponLabel=rightTemplate.userData.display_name||key;
    weapon.name='Equipped '+(rightTemplate.userData.display_name||key);
    weapon.position.set(0,-.39,.065);
    weapon.scale.setScalar(weaponSize(kind));
    weapon.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    rightMount.add(weapon);
    model.userData.equippedWeaponRight=weapon;
  }else{
    model.userData.weaponKind='unarmed';
    console.warn('No signature weapon prefab for',key);
  }
  const leftTemplate=prefabs.get('weapon_'+key+'_left');
  if(leftTemplate&&leftMount){
    const weapon=leftTemplate.clone(true);
    const kind=leftTemplate.userData.kind||'sword';
    weapon.name='Equipped offhand '+key;
    weapon.position.set(0,-.39,.045);
    weapon.scale.setScalar(weaponSize(kind));
    weapon.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    leftMount.add(weapon);
    model.userData.equippedWeaponLeft=weapon;
  }
  return !!rightTemplate;
}

