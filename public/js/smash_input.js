// public/js/smash_input.js — keyboard + buffering + gamepad
export default class SmashInputHandler{
  constructor(){
    this.keys = {}; this.buffer = []; this.bufferWindow = 6;
    window.addEventListener('keydown', e => { if(!this.keys[e.code]) this.buffer.push({code:e.code,frame:0}); this.keys[e.code]=true; });
    window.addEventListener('keyup', e=>{ this.keys[e.code]=false; });
  }
  update(){
    for(let i=this.buffer.length-1;i>=0;i--){ this.buffer[i].frame++; if(this.buffer[i].frame>this.bufferWindow) this.buffer.splice(i,1); }
  }
  consumeBuffer(code){ const i=this.buffer.findIndex(b=>b.code===code); if(i>=0){ this.buffer.splice(i,1); return true;} return false; }
  readGamepad(){ const gp=(navigator.getGamepads && navigator.getGamepads()[0])||null; return gp; }
  getInputs(){ const gp=this.readGamepad(); const lx=gp?gp.axes[0]:0, ly=gp?gp.axes[1]:0; const left=this.keys['ArrowLeft']||this.keys['KeyA']||lx<-0.5; const right=this.keys['ArrowRight']||this.keys['KeyD']||lx>0.5; const up=this.keys['ArrowUp']||this.keys['KeyW']||ly<-0.6; const down=this.keys['ArrowDown']||this.keys['KeyS']||ly>0.6; const attack=this.consumeBuffer('KeyJ')||(gp&&gp.buttons[0]&&gp.buttons[0].pressed); const special=this.consumeBuffer('KeyK')||(gp&&gp.buttons[1]&&gp.buttons[1].pressed); const jump=this.consumeBuffer('Space')||(gp&&gp.buttons[3]&&gp.buttons[3].pressed); const shield=this.keys['ShiftLeft']||(gp&&gp.buttons[5]&&gp.buttons[5].pressed); const grab=this.keys['KeyU']||(gp&&gp.buttons[4]&&gp.buttons[4].pressed); return {left,right,up,down,attack,special,jump,shield,grab,analogX:lx,analogY:ly}; }
}
