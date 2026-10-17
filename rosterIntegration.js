import * as THREE from 'three';
import { makeLoaders, loadCharacter } from './assetLoader.js';
import { getMovesForArchetype } from './moveFrameData.js';

export class RosterManager {
  constructor(renderer, scene, options = {}) {
    this.scene = scene;
    this.loaders = makeLoaders(renderer);
    this.rosterUrl = options.rosterUrl ?? '/data/roster.json';
    this.roster = [];
  }

  async fetchRosterData() {
    const response = await fetch(this.rosterUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch roster (${response.status}): ${this.rosterUrl}`);
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('roster.json must contain a non-empty array.');
    }
    this.roster = data;
    return this.roster;
  }

  async spawnFighterById(characterId, position = { x: 0, y: 0, z: 0 }) {
    if (!this.roster.length) await this.fetchRosterData();

    const charData = this.roster.find((c) => c.id === characterId) || this.roster[0];
    if (!charData) throw new Error(`Character not found: ${characterId}`);

    const spawn = new THREE.Vector3(position.x ?? 0, position.y ?? 0, position.z ?? 0);
    try {
      if (!charData.model) throw new Error('No model path specified in roster entry.');
      const loadedAsset = await loadCharacter(charData.model, this.loaders.gltfLoader, this.scene);
      loadedAsset.model.position.copy(spawn);
      return this.makeFighterRecord(charData, loadedAsset.model, loadedAsset.mixer, loadedAsset.actions, false);
    } catch (error) {
      console.warn(`Could not load ${charData.name} model; using procedural fallback.`, error);
      return this.spawnFallbackProcedural(charData, spawn);
    }
  }

  makeFighterRecord(charData, model, mixer, actions, isFallback) {
    return {
      id: charData.id,
      name: charData.name,
      archetype: charData.archetype || 'default',
      playstyle: charData.playstyle || '',
      model,
      mixer,
      actions: actions || {},
      moveData: getMovesForArchetype(charData.archetype),
      isFallback,
      percent: 0,
      heldItem: null
    };
  }

  spawnFallbackProcedural(charData, position) {
    const group = new THREE.Group();
    const color = charData.palette?.base ?? 0x00d9ff;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.48 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.2, 5, 12), mat);
    body.position.y = 1.05;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.31, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0xe9faff, emissive: color, emissiveIntensity: 1.25,
        metalness: 0.25, roughness: 0.2
      })
    );
    visor.scale.set(1.0, 0.42, 0.45);
    visor.position.set(0, 1.65, 0.43);
    group.add(visor);
    group.position.copy(position);
    this.scene.add(group);

    return this.makeFighterRecord(charData, group, null, {}, true);
  }

  dispose() {
    this.loaders.dracoLoader?.dispose?.();
    this.loaders.ktx2Loader?.dispose?.();
  }
}
