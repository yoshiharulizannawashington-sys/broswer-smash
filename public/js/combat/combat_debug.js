// Development-only visualisation of the combat volumes.
//
// The real hit test is a sphere-vs-sphere check in fighter3D.js: an attack spawns a hitbox at
// its reach, and a fighter's body is a hurtbox sphere around its chest. When a punch "feels
// like it should have hit", this overlay is what shows whether the attack volume actually got
// there. It is pooled (a handful of wireframe spheres reused every frame) and off by default,
// so it costs nothing in normal play.
import * as THREE from 'three';
import { stateOf, attackPhase } from './fighter_state.js';
import { comboScale } from './combo.js';

const COLORS = {
  hurt: 0x5ad1ff,
  melee: 0xff5a7a,
  grab: 0xffd166,
  projectile: 0x9bffb0
};

export function createCombatDebug(scene, { poolSize = 24 } = {}) {
  const group = new THREE.Group();
  group.name = 'combat-debug';
  group.visible = false;
  scene.add(group);

  const geometry = new THREE.SphereGeometry(1, 10, 8);
  const materials = {
    hurt: new THREE.MeshBasicMaterial({ color: COLORS.hurt, wireframe: true, depthTest: false, transparent: true, opacity: .85 }),
    melee: new THREE.MeshBasicMaterial({ color: COLORS.melee, wireframe: true, depthTest: false, transparent: true, opacity: .9 }),
    grab: new THREE.MeshBasicMaterial({ color: COLORS.grab, wireframe: true, depthTest: false, transparent: true, opacity: .9 }),
    projectile: new THREE.MeshBasicMaterial({ color: COLORS.projectile, wireframe: true, depthTest: false, transparent: true, opacity: .9 })
  };

  const pool = [];
  for (let i = 0; i < poolSize; i++) {
    const mesh = new THREE.Mesh(geometry, materials.melee);
    mesh.visible = false;
    mesh.renderOrder = 999;
    mesh.frustumCulled = false;
    group.add(mesh);
    pool.push(mesh);
  }

  let enabled = false;
  let used = 0;
  let readout = null;

  /** Lazily created text panel. Only exists while the overlay is on. */
  function ensureReadout() {
    if (readout || typeof document === 'undefined') return readout;
    readout = document.createElement('div');
    readout.id = 'combatDebugReadout';
    readout.style.cssText = 'position:fixed;left:10px;top:64px;z-index:20;padding:8px 10px;'
      + 'background:rgba(8,12,20,.82);border:1px solid #2c4a63;border-radius:6px;'
      + 'color:#bfe9ff;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;'
      + 'white-space:pre;pointer-events:none;max-width:46ch';
    document.body.appendChild(readout);
    return readout;
  }

  /** One fighter's live combat numbers, in frames and seconds with the unit named. */
  function describe(fighter, index) {
    const phase = attackPhase(fighter);
    const shield = Math.round(fighter.shield ?? 100);
    const lines = [
      `P${index + 1} ${String(fighter.name || '').toUpperCase().slice(0, 14)}  ${stateOf(fighter)}`,
      `  move=${phase ? phase.id : '-'} ${phase ? phase.phase : ''} f${phase ? phase.frame : 0}`
        + ` shield=${shield}${fighter.guardRegenDelay > 0 ? ' (regen wait)' : ''}`,
      `  hitstun=${(fighter.hitstun || 0).toFixed(2)}s combo=${fighter.comboHitCount || 0}`
        + ` x${comboScale(fighter.comboHitCount || 1).toFixed(2)} air=${fighter.airHits || 0}`
        + ` iframes=${(fighter.invulnerable || 0).toFixed(2)}s`,
      `  vel=(${Math.round(fighter.velocity?.x || 0)},${Math.round(fighter.velocity?.y || 0)},`
        + `${Math.round(fighter.velocity?.z || 0)}) ${fighter.isGrounded ? 'grounded' : 'airborne'}`,
      `  ult=${Math.round(fighter.meter || 0)}/100 power=${Math.round(fighter.power || 0)}`
        + `${fighter.casting ? ' casting=' + fighter.casting : ''}`
    ];
    const form = fighter.transform;
    if (form) {
      const mods = form.form?.mods || {};
      lines.push(`  form=${form.id} ${form.time.toFixed(1)}s left`
        + ` dmg x${(mods.damage ?? 1).toFixed(2)} def x${(mods.defense ?? 1).toFixed(2)}`);
    } else if (fighter.transformCooldown > 0) {
      lines.push(`  form cooling down ${fighter.transformCooldown.toFixed(1)}s`);
    }
    if (fighter.grabbedBy) lines.push('  GRABBED · struggle window open');
    if (fighter.grabTarget) lines.push('  HOLDING A GRAB');
    return lines.join('\n');
  }

  function take(radius, position, material) {
    if (used >= pool.length) return null;
    const mesh = pool[used++];
    mesh.material = material;
    mesh.position.copy(position);
    mesh.scale.setScalar(Math.max(.05, radius));
    mesh.visible = true;
    return mesh;
  }

  /**
   * Draw one frame of combat volumes. `fighters` are Fighter3D instances, whose `hitboxes`
   * are the live attack volumes and whose body is the hurtbox.
   */
  function update(fighters = []) {
    if (!enabled) {
      if (readout) readout.hidden = true;
      return { objects: 0, hitboxes: 0 };
    }
    const panel = ensureReadout();
    if (panel) {
      panel.hidden = false;
      panel.textContent = fighters.filter(Boolean).map(describe).join('\n\n');
    }
    used = 0;
    let hitboxCount = 0;
    for (const fighter of fighters) {
      if (!fighter || fighter.model?.visible === false) continue;
      const chest = fighter.position.clone().add(new THREE.Vector3(0, 1, 0));
      take(fighter.hurtboxRadius ?? .7, chest, materials.hurt);
      for (const hit of fighter.hitboxes || []) {
        hitboxCount++;
        const material = hit.kind === 'grab' ? materials.grab
          : hit.projectile ? materials.projectile : materials.melee;
        take(hit.radius ?? 1, hit.pos, material);
      }
    }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    return { objects: used, hitboxes: hitboxCount };
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    group.visible = enabled;
    if (!enabled) {
      used = 0;
      for (const mesh of pool) mesh.visible = false;
      if (readout) readout.hidden = true;
    }
    return enabled;
  }

  function toggle() {
    return setEnabled(!enabled);
  }

  function dispose() {
    scene.remove(group);
    geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
    pool.length = 0;
  }

  return {
    group,
    get enabled() { return enabled; },
    setEnabled,
    toggle,
    update,
    dispose
  };
}
