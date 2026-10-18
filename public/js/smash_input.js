// Keyboard and gamepad input with browser-safe key handling.
export default class SmashInputHandler {
 constructor(){this.keys={};this.buffer=[];this.bufferWindow=8;
  window.addEventListener('keydown',e=>{if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();if(!this.keys[e.code])this.buffer.push({code:e.code,frame:0});this.keys[e.code]=true;});
  window.addEventListener('keyup',e=>{this.keys[e.code]=false;});
  window.addEventListener('blur',()=>{this.keys={};});
 }
 update(){for(let i=this.buffer.length-1;i>=0;i--){this.buffer[i].frame++;if(this.buffer[i].frame>this.bufferWindow)this.buffer.splice(i,1);}}
 consumeBuffer(code){const i=this.buffer.findIndex(b=>b.code===code);if(i<0)return false;this.buffer.splice(i,1);return true;}
 readGamepad(){return navigator.getGamepads?.()[0]||null;}
 getInputs(){const gp=this.readGamepad(),lx=gp?.axes?.[0]||0,ly=gp?.axes?.[1]||0;return {
  left:!!(this.keys.ArrowLeft||this.keys.KeyA||lx<-.5),right:!!(this.keys.ArrowRight||this.keys.KeyD||lx>.5),
  up:!!(this.keys.ArrowUp||this.keys.KeyW||ly<-.5),down:!!(this.keys.ArrowDown||this.keys.KeyS||ly>.5),
  run:!!(this.keys.ShiftLeft||this.keys.ShiftRight),sprint:!!(this.keys.ShiftLeft||this.keys.ShiftRight),
  jump:this.consumeBuffer('Space')||!!gp?.buttons?.[3]?.pressed,
  attack:this.consumeBuffer('KeyJ')||!!this.keys.ArrowUp&&this.consumeBuffer('KeyZ')||!!gp?.buttons?.[0]?.pressed,
  special:this.consumeBuffer('KeyK')||!!gp?.buttons?.[1]?.pressed,
  dodge:this.consumeBuffer('KeyQ')||!!this.keys.KeyQ,shield:!!this.keys.KeyE,
  grab:!!this.keys.KeyU,analogX:lx,analogY:gp?.axes?.[1]||0
 };}
}
