// Collectible combat items for Browser Smash. Native Three.js geometry keeps the game playable offline.
export function createCombatItems(THREE, scene, onPickup = () => {}) {
  const items = [];
  const shared = {
    blade: new THREE.MeshStandardMaterial({ color: 0xc8f5ff, metalness: .92, roughness: .19, emissive: 0x12617c, emissiveIntensity: .7 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffbd48, metalness: .68, roughness: .26, emissive: 0x8a3c08, emissiveIntensity: .55 }),
    health: new THREE.MeshStandardMaterial({ color: 0x63ff9a, metalness: .18, roughness: .28, emissive: 0x0a9e4a, emissiveIntensity: 1.4 }),
    power: new THREE.MeshStandardMaterial({ color: 0xff5e91, metalness: .35, roughness: .24, emissive: 0xb90048, emissiveIntensity: 1.6 }),
    shield: new THREE.MeshStandardMaterial({ color: 0x59cfff, metalness: .25, roughness: .2, transparent: true, opacity: .85, emissive: 0x087ebf, emissiveIntensity: 1.3 }),
  };
  const definitions = [
    { kind: 'blade', label: 'STORM BLADE', color: 0x59eaff },
    { kind: 'health', label: 'VITALITY CORE', color: 0x58ff9b },
    { kind: 'power', label: 'OVERDRIVE CORE', color: 0xff4c8c },
    { kind: 'shield', label: 'AEGIS ORB', color: 0x5bcaff },
  ];
  function makeItem(def, x, z) {
    const root = new THREE.Group();
    root.position.set(x, .9, z);
    root.userData.kind = def.kind;
    root.userData.label = def.label;
    const glow = new THREE.Mesh(new THREE.TorusGeometry(.48, .045, 8, 32), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: .8 }));
    glow.rotation.x = Math.PI / 2; root.add(glow);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.3, 1), shared[def.kind] || shared.blade);
    core.castShadow = true; root.add(core);
    const halo = new THREE.PointLight(def.color, 1.1, 4, 2);
    halo.position.y = .2; root.add(halo);
    if (def.kind === 'blade') {
      const sword = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.12, .88, .055), shared.blade);
      blade.position.y = .53; sword.add(blade);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(.48, .09, .13), shared.gold);
      guard.position.y = .08; sword.add(guard);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(.055, .065, .34, 8), shared.gold);
      grip.position.y = -.13; sword.add(grip);
      sword.rotation.z = -.22; sword.rotation.x = -.12; root.add(sword);
    }
    scene.add(root);
    items.push({ root, core, glow, halo, def, x, z, phase: Math.random() * 6.28, respawn: 0, available: true });
  }
  const spots = [[-4.5, -2.5], [4.5, -2.5], [0, -6.5], [-8, 2.8], [8, 2.8], [0, 5.2]];
  function seed(mapKey = 'valley') {
    items.forEach(i => scene.remove(i.root));
    items.length = 0;
    const offset = mapKey === 'finalvalley' ? -27 : mapKey === 'hogwarts' ? -25 : mapKey === 'deathstar' ? -21 : mapKey === 'asgard' ? -27 : mapKey === 'starktower' ? -23 : mapKey === 'tournament' ? -12 : mapKey === 'volcano' || mapKey === 'ice' || mapKey === 'neon' ? -20 : 0;
    spots.forEach((p, i) => makeItem(definitions[i % definitions.length], p[0], p[1] + offset));
  }
  function update(dt, fighters, active, mapKey) {
    if (!items.length) seed(mapKey);
    for (const item of items) {
      if (!item.available) {
        item.respawn -= dt;
        if (item.respawn <= 0) { item.available = true; item.root.visible = true; }
        continue;
      }
      item.phase += dt * 1.9;
      item.root.rotation.y += dt * .8;
      item.root.position.y = .9 + Math.sin(item.phase * 1.4) * .16;
      item.core.rotation.x += dt * .7;
      item.glow.rotation.z += dt * .9;
      item.halo.intensity = 1.0 + Math.sin(item.phase * 2) * .25;
      if (!active) continue;
      for (const fighter of fighters) {
        if (!fighter || fighter.model?.visible === false) continue;
        const dx = fighter.position.x - item.root.position.x;
        const dz = fighter.position.z - item.root.position.z;
        if (dx * dx + dz * dz > 1.45 * 1.45 || fighter.position.y > 2.6) continue;
        const kind = item.def.kind;
        if (kind === 'health') fighter.percent = Math.max(0, fighter.percent - 24);
        if (kind === 'power') { fighter.itemDamageMultiplier = 1.65; fighter.itemPowerTimer = 8; }
        if (kind === 'shield') { fighter.invulnerable = Math.max(fighter.invulnerable || 0, 2.6); fighter.itemShieldTimer = 2.6; }
        if (kind === 'blade') {
          fighter.model.userData.weaponKind = 'sword';
          fighter.itemDamageMultiplier = 1.35;
          fighter.itemPowerTimer = 10;
          fighter.itemWeaponTimer = 10;
          const arm = fighter.model.userData.rightArm;
          if (arm && !fighter.model.userData.pickupBlade) {
            const bladeGroup = new THREE.Group();
            const metal = new THREE.Mesh(new THREE.BoxGeometry(.095, .82, .045), shared.blade);
            metal.position.y = .46; bladeGroup.add(metal);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(.34, .07, .1), shared.gold);
            guard.position.y = .04; bladeGroup.add(guard);
            const grip = new THREE.Mesh(new THREE.CylinderGeometry(.04, .045, .26, 8), shared.gold);
            grip.position.y = -.12; bladeGroup.add(grip);
            bladeGroup.rotation.z = -.25; bladeGroup.position.set(0, -.24, .05); arm.add(bladeGroup);
            fighter.model.userData.pickupBlade = bladeGroup;
          }
        }
        item.available = false; item.respawn = 12; item.root.visible = false;
        onPickup(fighter, item.def);
        break;
      }
    }
    for (const fighter of fighters) {
      if (!fighter) continue;
      fighter.itemPowerTimer = Math.max(0, (fighter.itemPowerTimer || 0) - dt);
      fighter.itemShieldTimer = Math.max(0, (fighter.itemShieldTimer || 0) - dt);
      fighter.itemWeaponTimer = Math.max(0, (fighter.itemWeaponTimer || 0) - dt);
      if (fighter.itemPowerTimer <= 0) fighter.itemDamageMultiplier = 1;
      if (fighter.itemWeaponTimer <= 0 && fighter.model?.userData?.weaponKind === 'sword') {
        delete fighter.model.userData.weaponKind;
        if (fighter.model.userData.pickupBlade) {
          fighter.model.userData.pickupBlade.parent?.remove(fighter.model.userData.pickupBlade);
          fighter.model.userData.pickupBlade = null;
        }
      }
    }
  }
  seed('valley');
  return { update, seed, items };
}
