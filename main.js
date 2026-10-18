import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { RosterManager } from './rosterIntegration.js';
import { ItemManager } from './items.js';
import { loadMapById } from './mapLoader.js';
import { renderRoster } from './charSelect.js';
import { createRealismPipeline } from './smash_render_pipeline.js';
import { Fighter3DPhysics } from './smash_3d_physics.js';

const canvas = document.querySelector('#game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080c18);
scene.fog = new THREE.Fog(0x080c18, 45, 115);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 8, 18);
camera.lookAt(0, 1, 0);

const { composer, renderer } = createRealismPipeline(canvas, scene, camera);
const ambient = new THREE.HemisphereLight(0xd5e5ff, 0x1b1730, 1.2);
scene.add(ambient);

const rosterManager = new RosterManager(renderer, scene);
const itemManager = new ItemManager(scene);
let fighters = [];
let physics = [];
let stageRadius = 30;
const keys = new Set();
let spawnTimer = 0;
let lastTime = 0;
let running = false;

window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
    event.preventDefault();
  }
  keys.add(event.key.toLowerCase());
});
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

function getInputs(player) {
  if (player === 0) {
    return {
      left: keys.has('a') || keys.has('arrowleft'),
      right: keys.has('d') || keys.has('arrowright'),
      up: keys.has('w') || keys.has('arrowup'),
      down: keys.has('s') || keys.has('arrowdown'),
      jump: keys.has(' ') || keys.has('w') || keys.has('arrowup')
    };
  }
  return {
    left: keys.has('j'), right: keys.has('l'), up: keys.has('i'),
    down: keys.has('k'), jump: keys.has('u')
  };
}

function clearFighters() {
  for (const fighter of fighters) {
    scene.remove(fighter.model);
    fighter.model.traverse?.((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
        else obj.material.dispose?.();
      }
    });
  }
  fighters = [];
  physics = [];
}

async function startMatch(playerOneId, playerTwoId, mapId = 'rainbow_road') {
  clearFighters();
  const map = await loadMapById(scene, renderer, mapId);
  stageRadius = map.radius;
  const [p1, p2] = await Promise.all([
    rosterManager.spawnFighterById(playerOneId, { x: -3, y: 0, z: 0 }),
    rosterManager.spawnFighterById(playerTwoId, { x: 3, y: 0, z: 0 })
  ]);
  fighters = [p1, p2];
  physics = [
    new Fighter3DPhysics(p1.model),
    new Fighter3DPhysics(p2.model)
  ];
  running = true;
  document.querySelector('#menu')?.classList.add('hidden');
  document.querySelector('#hud')?.classList.remove('hidden');
}

function animate(now = 0) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - (lastTime || now)) / 1000, 1 / 20);
  lastTime = now;

  if (running && fighters.length === 2) {
    physics[0].update(getInputs(0), fighters[1].model.position, null, dt);
    physics[1].update(getInputs(1), fighters[0].model.position, null, dt);

    for (const fighter of fighters) fighter.mixer?.update(dt);
    itemManager.update(fighters, dt, stageRadius);

    spawnTimer += dt;
    if (spawnTimer >= 15) {
      spawnTimer = 0;
      const types = ['capsule', 'food', 'smash_ball'];
      itemManager.spawnItem(types[Math.floor(Math.random() * types.length)]);
    }

    // Basic follow camera; use a more advanced camera rig for production.
    const midpoint = fighters[0].model.position.clone().add(fighters[1].model.position).multiplyScalar(0.5);
    const desired = new THREE.Vector3(midpoint.x, midpoint.y + 7, midpoint.z + 16);
    camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    camera.lookAt(midpoint.x, midpoint.y + 1, midpoint.z);
  }
  composer.render();
}

async function init() {
  const roster = await rosterManager.fetchRosterData();
  const first = roster[0];
  const second = roster[5] || roster[1] || roster[0];

  await renderRoster({
    onSelect: (character) => {
      const selected = document.querySelector('#selected-fighter');
      if (selected) selected.textContent = `Player 1: ${character.name}`;
      document.querySelector('#start-match').dataset.p1 = character.id;
    }
  });

  const startButton = document.querySelector('#start-match');
  startButton.dataset.p1 = first.id;
  startButton.addEventListener('click', () => {
    startMatch(
      startButton.dataset.p1 || first.id,
      document.querySelector('#player-two').value || second.id,
      document.querySelector('#map-select').value || 'rainbow_road'
    ).catch(console.error);
  });

  const playerTwo = document.querySelector('#player-two');
  for (const character of roster) {
    const option = document.createElement('option');
    option.value = character.id;
    option.textContent = character.name;
    playerTwo.append(option);
  }
  animate();
}

init().catch((error) => {
  console.error(error);
  const status = document.querySelector('#status');
  if (status) status.textContent = `Startup error: ${error.message}`;
});
