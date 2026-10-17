// public/js/models.js — procedural character generator (polished)
import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

export function makeProceduralCharacter(archetype='warrior'){
  const g = new THREE.Group();
  // palettes
  const palettes = { ninja:{body:0x0f1724,accent:0xff4d6d}, warrior:{body:0x425a9a,accent:0xffc472}, brawler:{body:0x8c3b2f,accent:0xf6c85f}, mage:{body:0x502e9b,accent:0x76e0ff}, cyborg:{body:0x35414f,accent:0x00ffd2} };
  const p = palettes[archetype]||palettes.warrior;
  const bodyMat = new THREE.MeshStandardMaterial({ color:p.body, metalness:0.18, roughness:0.55 });
  const headMat = new THREE.MeshStandardMaterial({ color:0xffdfc6, metalness:0.05, roughness:0.88 });
  const accentMat = new THREE.MeshStandardMaterial({ color:p.accent, emissive:p.accent, emissiveIntensity:0.06, metalness:0.2, roughness:0.2 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.62,1.05,6,12), bodyMat); torso.position.y=1.25; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46,18,12), headMat); head.position.set(0,2.6,0); g.add(head);

  // helmet/hood/hair
  if(archetype==='ninja'){
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.72,0.9,12), bodyMat); hood.rotation.x=Math.PI; hood.position.set(0,2.42,0.04); g.add(hood);
    const sash = new THREE.Mesh(new THREE.BoxGeometry(1.5,0.15,0.15), accentMat); sash.position.set(0,1.1,0.65); g.add(sash);
  } else if(archetype==='mage'){
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.62,1.12,16), bodyMat); hat.position.set(0,3.06,0); hat.rotation.z=0.08; g.add(hat);
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(1.6,2.2), bodyMat); cape.position.set(0,0.6,-0.5); cape.rotation.x=-0.12; cape.material.side=THREE.DoubleSide; g.add(cape);
  } else if(archetype==='cyborg'){
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.92,0.18,0.06), accentMat); visor.position.set(0,2.6,0.38); g.add(visor);
    const chestLight = new THREE.Mesh(new THREE.SphereGeometry(0.12,6,6), accentMat); chestLight.position.set(0,1.28,0.66); g.add(chestLight);
  } else if(archetype==='brawler'){
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.12,0.24,0.72), accentMat); shoulder.position.set(0,1.6,0); g.add(shoulder);
  } else {
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.25,0.6,0.25), accentMat); crest.position.set(0,3.06,0); g.add(crest);
  }

  // limbs
  const armGeom = new THREE.CylinderGeometry(0.12,0.14,0.9,12);
  const legGeom = new THREE.CylinderGeometry(0.16,0.18,1.02,12);
  const leftArm = new THREE.Mesh(armGeom, bodyMat); leftArm.position.set(-0.8,1.4,0); leftArm.rotation.z=0.22; g.add(leftArm);
  const rightArm = leftArm.clone(); rightArm.position.set(0.8,1.4,0); rightArm.rotation.z=-0.22; g.add(rightArm);
  const leftLeg = new THREE.Mesh(legGeom, bodyMat); leftLeg.position.set(-0.28,0.08,0); g.add(leftLeg);
  const rightLeg = leftLeg.clone(); rightLeg.position.set(0.28,0.08,0); g.add(rightLeg);

  if(archetype==='ninja' || archetype==='warrior'){
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.9,0.12), accentMat); blade.position.set(0.9,1.0,0); blade.rotation.z=0.18; g.add(blade);
  }

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.0,12), new THREE.MeshBasicMaterial({ color:0x000000, opacity:0.24, transparent:true }));
  shadow.rotation.x=-Math.PI/2; shadow.position.y=0.015; g.add(shadow);

  g.userData = { archetype };
  return g;
}
