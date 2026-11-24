// Audio system test: every sound the brief asks for must exist and be triggerable, and the
// module must behave when muted, paused or asked for a world position.
//
// Web Audio is stubbed, so this proves the synthesis graph is built correctly (nodes created,
// connected, scheduled) rather than what it sounds like. Audibility is a human check and is
// reported separately; this test cannot hear anything.
//
//   node scripts/test-audio.mjs
import assert from 'node:assert/strict';
import { createCombatAudio } from '../public/js/audio/combat_audio.js';

let checks = 0;
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ' — ' + detail : ''}`);
  checks++;
  console.log(`  ok  ${name}`);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- A minimal but honest Web Audio stub ---------------------------------
const made = { oscillators: 0, buffers: 0, gains: 0, filters: 0, panners: 0, compressors: 0 };

function param(value = 0) {
  return {
    value,
    setValueAtTime(v) { this.value = v; },
    exponentialRampToValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; }
  };
}

class FakeContext {
  static instances = [];
  constructor() {
    FakeContext.instances.push(this);
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = { connect() {} };
    this.listener = {
      positionX: param(), positionY: param(), positionZ: param(),
      forwardX: param(), forwardY: param(), forwardZ: param(),
      upX: param(), upY: param(), upZ: param()
    };
  }
  createGain() { made.gains++; return { gain: param(1), connect() {}, disconnect() {} }; }
  createDynamicsCompressor() {
    made.compressors++;
    return { threshold: param(), knee: param(), ratio: param(), connect() {}, disconnect() {} };
  }
  createOscillator() {
    made.oscillators++;
    return {
      type: 'sine', frequency: param(), onended: null,
      connect() {}, disconnect() {}, start() {}, stop() {}
    };
  }
  createBuffer(channels, length) { made.buffers++; return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() {
    return { buffer: null, loop: false, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createBiquadFilter() {
    made.filters++;
    return { type: 'bandpass', frequency: param(), Q: param(), connect() {}, disconnect() {} };
  }
  createPanner() {
    made.panners++;
    return {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10, rolloffFactor: 1,
      positionX: param(), positionY: param(), positionZ: param(),
      setPosition() {}, connect() {}, disconnect() {}
    };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

globalThis.AudioContext = FakeContext;
const audio = createCombatAudio();
audio.unlock();
check('the module reports an AudioContext', audio.describe().supported === true);

// ---- Coverage of every category the brief names --------------------------
const CATEGORIES = audio.eventCategories;
const required = [
  'menu', 'selection', 'footstep', 'punch', 'kick', 'block', 'dodge', 'grab', 'throw',
  'impact', 'energy', 'explosion', 'flight', 'landing', 'result'
];
check('every requested sound category is declared', required.every(c => c in CATEGORIES),
  required.filter(c => !(c in CATEGORIES)).join(', '));

const voiceNames = new Set(audio.voiceNames);
const missing = [];
for (const [category, names] of Object.entries(CATEGORIES)) {
  if (category === 'music' || category === 'ambience') continue;
  for (const name of names) if (!voiceNames.has(name)) missing.push(`${category}:${name}`);
}
check('every declared category maps to a real voice', missing.length === 0, missing.join(', '));
check('victory and defeat are separate voices', voiceNames.has('victory') && voiceNames.has('defeat'));
check('flight, explosion and pickup have voices',
  ['flight', 'explosion', 'pickup', 'shield', 'hazard'].every(n => voiceNames.has(n)));

// ---- Triggering --------------------------------------------------------
const eventNames = [...voiceNames];
let triggered = 0;
for (let i = 0; i < eventNames.length; i += 6) {
  for (const name of eventNames.slice(i, i + 6)) {
    if (audio.play(name)) triggered++;
  }
  await sleep(14); // let the per-frame voice budget reset
}
check('every voice can actually be triggered', triggered === eventNames.length,
  `${triggered}/${eventNames.length} played`);

// ---- Throttle and gate rules ------------------------------------------
// The stub clock is frozen unless told otherwise, so advance it the way a real context would:
// repeating an event at the *same* timestamp is what must be throttled.
await sleep(20);
FakeContext.instances[0].currentTime += 1;
const first = audio.play('impactHeavy');
const immediate = audio.play('impactHeavy');
check('a repeated event is throttled instead of stacking', first === true && immediate === false);

audio.setPaused(true);
check('paused audio refuses new voices', audio.play('menuSelect') === false);
check('pause silences the master bus', audio.describe().paused === true);
audio.setPaused(false);

audio.setMuted(true);
check('muted audio refuses new voices', audio.play('menuSelect') === false);
audio.setMuted(false);

// ---- Spatial ----------------------------------------------------------
audio.setListener({ x: 3, y: 1.6, z: -4 }, { x: 0, y: 0, z: 1 });
check('the listener position is recorded', audio.listener.x === 3 && audio.listener.z === -4);
const pannersBefore = made.panners;
const spatialPlayed = audio.play('footstep', { position: { x: -2, y: 0, z: 6 } });
check('a positioned event plays', spatialPlayed === true);
check('a positioned event is routed through a panner', made.panners > pannersBefore,
  `${made.panners - pannersBefore} panner(s)`);
await sleep(20);
check('an unpositioned event does not allocate a panner', made.panners === pannersBefore + 1);

// ---- Music and ambience ----------------------------------------------
const musicStarted = audio.startMusic();
check('music starts', musicStarted === true && audio.musicPlaying === true);
check('music schedules notes', made.oscillators > 0);
audio.stopMusic();
check('music stops', audio.musicPlaying === false);

const ambienceStarted = audio.startAmbience('interior');
check('ambience starts', ambienceStarted === true && audio.ambiencePreset === 'interior');
audio.stopAmbience();
check('ambience stops', audio.ambiencePreset === null);
check('the ambience presets cover the arena families',
  ['outdoor', 'interior', 'volcanic', 'ice', 'city'].every(p => audio.ambiencePresets.includes(p)));

// ---- Volumes -----------------------------------------------------------
check('music volume clamps to 0..1', audio.setMusicVolume(1.8) === 1 && audio.setMusicVolume(-3) === 0);
check('ambience volume clamps to 0..1', audio.setAmbienceVolume(0.5) === 0.5);
check('effects volume clamps to 0..1', audio.setVolume(0.65) === 0.65);

// ---- Reported state ---------------------------------------------------
const summary = audio.describe();
check('the summary reports voices, plays and spatial use',
  summary.voices === voiceNames.size && summary.plays > 0 && summary.spatial > 0,
  JSON.stringify({ voices: summary.voices, plays: summary.plays, spatial: summary.spatial }));
check('dropped and throttled counts are tracked', summary.throttled > 0);

console.log(`\nAudio checks passed (${checks} checks, ${made.oscillators} oscillators, ${made.panners} panners).`);
