// Upgrades the arena-switch wrapper in main.js to carry deterministic per-switch state.
//
// main.js is a generated-format single-line file above the edit-tool size limit, so the wrapper is
// patched by exact string replacement and the result is verified before the file is written. The
// script migrates an earlier patched copy as well as the untouched original.
import { readFile, writeFile } from 'node:fs/promises';

const PATH = 'public/js/main.js';
const OLD = "window.__browserSmashApplyMap=(key)=>{try{window.__browserSmashApplyMapError=null;return applyMap(key);}catch(error){window.__browserSmashApplyMapError=String(error?.message||error);console.warn('applyMap failed',key,error);}};";

const HOOK_START = "window.__browserSmashFloorState=()=>({key:";
// `activeLayoutKey` is only written when a layout is built for a match, so reading it here reported
// the previously played arena. The floor material is chosen by the switch key held in the state.
const NEW_HOOK = "window.__browserSmashFloorState=()=>({key:window.__browserSmashApplyMapState?.key||activeLayoutKey,material:floor.material?.name||null,uuid:floor.material?.uuid||null,color:floor.material?.color?.getHexString?.()||null,tone:renderer.toneMappingExposure});";
const OLD_HOOK = "window.__browserSmashFloorState=()=>({key:activeLayoutKey,material:floor.material?.name||null,uuid:floor.material?.uuid||null,color:floor.material?.color?.getHexString?.()||null,tone:renderer.toneMappingExposure});";

const NEW = [
  "window.__browserSmashApplyMapState={key:null,seq:0,ok:null,error:null};",
  "window.__browserSmashApplyMapHistory=[];",
  NEW_HOOK,
  // One object per switch: a fresh state cannot inherit an earlier failure, so a successful switch
  // can never be reported as failed because of an unrelated historical error.
  "window.__browserSmashApplyMap=(key)=>{const entry={key,seq:(window.__browserSmashApplyMapState?.seq||0)+1,ok:false,error:null,at:Date.now()};window.__browserSmashApplyMapState=entry;window.__browserSmashApplyMapError=null;try{const result=applyMap(key);entry.ok=true;return result;}catch(error){const message=String(error?.message||error);entry.error=message;entry.context='arena '+key+': '+message;window.__browserSmashApplyMapError=message;console.warn('[arena:'+key+'] switch failed',error);}finally{window.__browserSmashApplyMapHistory.push({...entry});if(window.__browserSmashApplyMapHistory.length>100)window.__browserSmashApplyMapHistory.shift();}};"
].join('');

const source = await readFile(PATH, 'utf8');
if (source.includes(OLD)) {
  await writeFile(PATH, source.replace(OLD, NEW));
  console.log('arena switch guard: patched');
} else if (source.includes(OLD_HOOK)) {
  await writeFile(PATH, source.replace(OLD_HOOK, NEW_HOOK));
  console.log('arena switch guard: migrated floor hook');
} else if (source.includes(NEW_HOOK)) {
  console.log('arena switch guard: already patched');
} else {
  console.error('arena switch guard: anchor not found; refusing to write');
  process.exit(1);
}

const after = await readFile(PATH, 'utf8');
const problems = [];
if (!after.includes('__browserSmashApplyMapState')) problems.push('state object missing');
if (!after.includes('__browserSmashApplyMapHistory')) problems.push('history missing');
if (!after.includes(NEW_HOOK)) problems.push('floor state hook missing or stale');
// Every switch must go through the guard. In the comment-stripped source `applyMap(` may appear
// exactly twice: the declaration and the single call inside the wrapper.
const code = after.replace(/\/\/[^\n]*/g, '');
const occurrences = [...code.matchAll(/applyMap\(/g)].length;
if (!code.includes('function applyMap(key){')) problems.push('applyMap declaration not found');
if (occurrences !== 2) problems.push(`expected 2 applyMap( occurrences (declaration + wrapper call), found ${occurrences}`);
if (problems.length) {
  console.error('arena switch guard: verification failed: ' + problems.join('; '));
  process.exit(1);
}
console.log('arena switch guard: verified (state, history, floor hook, single guarded call site)');
