// Original procedural fighters for Browser Smash. Articulated pivot hierarchy enables real limb animation.
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

const mat = (color, metalness=.2, roughness=.48, emissive=0x000000) =>
  new THREE.MeshStandardMaterial({color, metalness, roughness, emissive, emissiveIntensity: emissive ? 1.1 : 0});

function part(parent, geometry, material, pos, scale) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function joint(parent, pos) { const g = new THREE.Group(); g.position.set(...pos); parent.add(g); return g; }

export function makeProceduralCharacter(archetype='warrior') {
  const g = new THREE.Group();
  const designs = {
    ninja:{body:0x151b2b, armor:0x303b50, accent:0x35dfff, skin:0xc99c7a, head:'hood'},
    warrior:{body:0x651e2a, armor:0x9b3540, accent:0x36d9ff, skin:0xb7c0cb, head:'helmet'},
    brawler:{body:0x75412d, armor:0xb87938, accent:0xffcc65, skin:0xd49d7c, head:'hair'},
    mage:{body:0x302452, armor:0x6451a0, accent:0x9b79ff, skin:0xe0c2a8, head:'hood'},
    cyborg:{body:0x273b45, armor:0x5d7781, accent:0x00ffd2, skin:0x9bb6be, head:'helmet'}
  };
  const d=designs[archetype]||designs.warrior;
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
  // signature back-mounted blade / energy pack
  const pack=part(torso,new THREE.BoxGeometry(.36,.48,.18),dark,[0,.24,-.3]);
  part(torso,new THREE.BoxGeometry(.18,.34,.08),glow,[0,.24,-.405]);
  const blade=part(torso,new THREE.BoxGeometry(.08,.82,.12),glow,[.72,-.02,-.08]); blade.rotation.z=-.22;
  const shadow=part(g,new THREE.CircleGeometry(.72,24),new THREE.MeshBasicMaterial({color:0x02040a,transparent:true,opacity:.48}),[0,.018,0]); shadow.rotation.x=-Math.PI/2;
  g.userData={...g.userData,archetype,torso,pelvis,head,blade};
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  return g;
}
