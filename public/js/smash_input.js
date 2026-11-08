// Keyboard and gamepad input for both local players.
//
// Every button that has to fire exactly once per press (attack, special, jump, dash) is
// edge-triggered through a per-player buffer, while movement, sprint and guard are read
// from held keys. Player 2 has a complete, separate binding set so two people can fight on
// one keyboard; gamepad 0 drives P1 and gamepad 1 drives P2.
//
//   P1  WASD move · J attack · K special · U grab · SPACE jump · SHIFT sprint/dash
//       E guard (tap to parry) · F flight · C descend · X flight brake · G web swing
//       I transform · O ultimate
//   P2  ARROWS move · , attack · . special · / grab · ENTER jump · RIGHT SHIFT sprint/dash
//       ; guard (tap to parry) · [ flight · ] descend · \ web swing · N transform · M ultimate
//   Gamepad: D-pad up transforms, D-pad down casts the ultimate, for either player.

const P1_KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  sprint: ['ShiftLeft'], jump: ['Space'], attack: ['KeyJ'], special: ['KeyK'],
  grab: ['KeyU'], guard: ['KeyE'], flight: ['KeyF'], descend: ['KeyC'], web: ['KeyG'],
  brake: ['KeyX'], transform: ['KeyI'], ultimate: ['KeyO'],
  special2: ['KeyL'], special3: ['KeyH'], special4: ['KeyT'], special5: ['KeyY']
};

const P2_KEYS = {
  left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
  sprint: ['ShiftRight'], jump: ['Enter', 'NumpadEnter'], attack: ['Comma', 'Numpad1'],
  special: ['Period', 'Numpad2'], grab: ['Slash', 'Numpad3'],
  guard: ['Semicolon', 'Numpad5'], flight: ['BracketLeft', 'Numpad7'],
  descend: ['BracketRight', 'Numpad8'], web: ['Backslash', 'Numpad9'],
  brake: ['Minus', 'NumpadSubtract'], transform: ['KeyN'], ultimate: ['KeyM'],
  special2: ['Quote', 'Numpad4'], special3: ['Backquote', 'Numpad6'],
  special4: ['KeyP'], special5: ['KeyL']
};

const BUFFER_WINDOW = 9;
const SCROLL_BLOCKERS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Slash']);

function anyHeld(keys, codes) {
  return codes.some(code => keys[code]);
}

class PlayerBuffer {
  constructor() { this.entries = []; }
  push(code) { this.entries.push({ code, frame: 0 }); }
  age() {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      this.entries[i].frame++;
      if (this.entries[i].frame > BUFFER_WINDOW) this.entries.splice(i, 1);
    }
  }
  take(codes) {
    const index = this.entries.findIndex(entry => codes.includes(entry.code));
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }
  clear() { this.entries.length = 0; }
}

export default class SmashInputHandler {
  constructor() {
    this.keys = {};
    this.buffers = { 1: new PlayerBuffer(), 2: new PlayerBuffer() };
    // Kept for backwards compatibility with code that reads `buffer`.
    this.buffer = [];
    this.bufferWindow = BUFFER_WINDOW;
    this.lastDevice = 'keyboard';
    window.addEventListener('keydown', event => {
      if (SCROLL_BLOCKERS.has(event.code)) event.preventDefault();
      if (!this.keys[event.code]) {
        this.buffers[1].push(event.code);
        this.buffers[2].push(event.code);
        this.buffer.push({ code: event.code, frame: 0 });
      }
      this.keys[event.code] = true;
    });
    window.addEventListener('keyup', event => { this.keys[event.code] = false; });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.buffers[1].clear();
      this.buffers[2].clear();
      this.buffer.length = 0;
    });
  }

  update() {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      this.buffer[i].frame++;
      if (this.buffer[i].frame > BUFFER_WINDOW) this.buffer.splice(i, 1);
    }
    this.buffers[1].age();
    this.buffers[2].age();
  }

  consumeBuffer(code) {
    const index = this.buffer.findIndex(entry => entry.code === code);
    if (index < 0) return false;
    this.buffer.splice(index, 1);
    return true;
  }

  readGamepad(index = 0) {
    return navigator.getGamepads?.()[index] || null;
  }

  /**
   * Read one player's inputs. `1` is keyboard/mouse player one, `2` is the second local
   * player. Gamepad 0 is assigned to P1 and gamepad 1 to P2 automatically.
   */
  getInputs(player = 1) {
    const isP2 = Number(player) === 2;
    const map = isP2 ? P2_KEYS : P1_KEYS;
    const buffer = this.buffers[isP2 ? 2 : 1];
    const pad = this.readGamepad(isP2 ? 1 : 0);
    const lx = pad?.axes?.[0] || 0;
    const ly = pad?.axes?.[1] || 0;
    const pressed = index => !!pad?.buttons?.[index]?.pressed;
    const jumpHeld = anyHeld(this.keys, map.jump);

    return {
      player: isP2 ? 2 : 1,
      left: anyHeld(this.keys, map.left) || lx < -0.5,
      right: anyHeld(this.keys, map.right) || lx > 0.5,
      up: anyHeld(this.keys, map.up) || ly < -0.5,
      down: anyHeld(this.keys, map.down) || ly > 0.5,
      run: anyHeld(this.keys, map.sprint) || pressed(10),
      sprint: anyHeld(this.keys, map.sprint) || pressed(10),
      jump: buffer.take(map.jump) || pressed(2),
      flightToggle: buffer.take(map.flight) || pressed(3),
      ascend: jumpHeld || pressed(10),
      descend: anyHeld(this.keys, map.descend) || pressed(11),
      // Held brake for flight: a dedicated button, so stopping is a decision rather than
      // releasing the stick and waiting for drag.
      brake: anyHeld(this.keys, map.brake) || pressed(9),
      webSwing: anyHeld(this.keys, map.web) || pressed(5),
      attack: buffer.take(map.attack) || pressed(0),
      special: buffer.take(map.special) || pressed(1),
      special2: buffer.take(map.special2) || pressed(2),
      special3: buffer.take(map.special3) || pressed(3),
      special4: buffer.take(map.special4) || pressed(14),
      special5: buffer.take(map.special5) || pressed(15),
      grab: buffer.take(map.grab) || pressed(7),
      dodge: buffer.take(map.sprint) || pressed(4),
      shield: anyHeld(this.keys, map.guard) || pressed(6),
      // Transform / ultimate are edge-triggered like attacks, so holding the key cannot
      // re-activate a form or spend a second meter.
      transform: buffer.take(map.transform) || pressed(12),
      ultimate: buffer.take(map.ultimate) || pressed(13),
      parry: buffer.take(map.guard),
      vertical: anyHeld(this.keys, map.up) ? 1 : anyHeld(this.keys, map.down) ? -1 : 0,
      analogX: lx,
      analogY: ly
    };
  }
}
