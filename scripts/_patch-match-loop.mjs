// One-shot patch for the match-loop work (pause menu, match rules, CPU skill).
//
// main.js is a large minified module, which the editing tool refuses as a payload, so the edits
// are applied here with exact anchors. Every anchor must be found exactly once or nothing is
// written, so a stale anchor can never half-apply a patch or silently double an insert.
//
//   node scripts/_patch-match-loop.mjs            # apply, verify, report
//   node scripts/_patch-match-loop.mjs --check     # verify only, no write
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = new URL('../public/js/main.js', import.meta.url);
const checkOnly = process.argv.includes('--check');

const PATCHES = [
  // ---------------------------------------------------------------- imports
  [
    "import { initCharacterSelect } from './ui/character_select.js?v=browser-smash-phase3-v44-20261027';",
    "import { initCharacterSelect } from './ui/character_select.js?v=browser-smash-phase3-v44-20261027';\n"
    + "import { initPauseMenu } from './ui/pause_menu.js?v=browser-smash-phase3-v44-20261027';\n"
    + "import { skillFor, normalizeSkillLevel, DEFAULT_SKILL_LEVEL } from './combat/cpu_skill.js?v=browser-smash-phase3-v44-20261027';"
  ],
  // ------------------------------------------- series rules, pause flag, CPU level
  [
    "let matchState=createMatch();let hitStop=0;let roundPause=0;let twoPlayer=false;let activeLayout=null;let activeLayoutKey='valley';",
    "let matchState=createMatch();let hitStop=0;let roundPause=0;let twoPlayer=false;let activeLayout=null;let activeLayoutKey='valley';\n"
    + "// Series configuration, the CPU skill level and the pause flag are module state rather than\n"
    + "// menu-only values: the round loop and the AI read them, so a setup change applies to the\n"
    + "// running match instead of only the next one.\n"
    + "let matchRules={roundsToWin:2,roundSeconds:80};let paused=false;\n"
    + "let cpuSkillLevel=normalizeSkillLevel((()=>{try{return localStorage.getItem('browserSmashCpuSkill');}catch(_error){return null;}})()||DEFAULT_SKILL_LEVEL);"
  ],
  // ------------------------------------------------------------------- CPU skill
  [
    "const ai={getInputs(){if(window.__browserSmashTrainingDummy)return",
    "// The CPU reads one skill profile per decision, so difficulty changes decision quality and\n"
    + "// never health or damage (see combat/cpu_skill.js).\n"
    + "const cpuSkill=()=>skillFor(cpuSkillLevel);\n"
    + "window.__browserSmashCpuSkill=()=>({...cpuSkill(),level:cpuSkillLevel});\n"
    + "const ai={getInputs(){if(window.__browserSmashTrainingDummy)return"
  ],
  [
    "cpu.aiTimer-=clockDelta;const attack=dist<2.25&&cpu.aiTimer<=0;if(attack)cpu.aiTimer=.62+Math.random()*.5;const incoming=dist<4.8&&player.attackQueue.some(a=>!a.hit&&a.t<a.start&&a.start-a.t<.2);const parry=incoming&&cpu.parryCooldown<=0&&Math.random()<.13;const shield=incoming&&!parry&&Math.random()<.72;const dodge=incoming&&!parry&&!shield&&cpu.dodgeTimer<=0&&Math.random()<.28;",
    "cpu.aiTimer-=clockDelta;const skill=cpuSkill();const attack=dist<skill.range&&cpu.aiTimer<=0;if(attack)cpu.aiTimer=skill.cooldown+Math.random()*skill.cooldownJitter;const incoming=dist<skill.notice&&player.attackQueue.some(a=>!a.hit&&a.t<a.start&&a.start-a.t<skill.readAhead);const parry=incoming&&cpu.parryCooldown<=0&&Math.random()<skill.parry;const shield=incoming&&!parry&&Math.random()<skill.block;const dodge=incoming&&!parry&&!shield&&cpu.dodgeTimer<=0&&Math.random()<skill.dodge;"
  ],
  [
    "dist<11&&Math.random()<.05);const wantUltimate=!!((cpu.meter||0)>=100&&dist>1.4&&dist<16&&Math.random()<.4);const useSpecial=specialReady&&dist>2.8&&dist<12&&Math.random()<.018;",
    "dist<11&&Math.random()<skill.form);const wantUltimate=!!((cpu.meter||0)>=100&&dist>1.4&&dist<16&&Math.random()<skill.ultimate);const useSpecial=specialReady&&dist>2.8&&dist<12&&Math.random()<skill.special;"
  ],
  [
    "attack:attack&&Math.random()>.22&&!shield",
    "attack:attack&&Math.random()>skill.hesitation&&!shield"
  ],
  // ---------------------------------------- pause menu, rules and skill wiring
  [
    "onMode:(mode)=>{twoPlayer=mode==='2p';fighterTypeRefresh();updateHud();}});\nwindow.__browserSmashSelect=selectScreen;",
    "onMode:(mode)=>{twoPlayer=mode==='2p';fighterTypeRefresh();updateHud();},rules:matchRules,difficulty:cpuSkillLevel,onRules:applyMatchRules,onDifficulty:setCpuSkill});\n"
    + "window.__browserSmashSelect=selectScreen;\n"
    + "// ------------------------------------------------------------------ pause / rules / CPU skill\n"
    + "// One place that knows how to stop a match, how the series is configured, and which skill profile\n"
    + "// the CPU is running. Escape is owned here rather than by the overlay, so one press cannot both\n"
    + "// open and close the menu.\n"
    + "const pauseMenu=initPauseMenu({\n"
    + "  audio:combatAudio,\n"
    + "  getStats:()=>({round:matchState.round,wins:[...matchState.wins],arena:(mapThemes[activeLayoutKey]?.label||activeLayoutKey).split(' · ')[0],mode:practice?'PRACTICE MODE':(twoPlayer?'LOCAL TWO-PLAYER':'VS CPU'),rules:{...matchState.rules},skill:twoPlayer?'':skillFor(cpuSkillLevel).label}),\n"
    + "  onResume:()=>setPaused(false),\n"
    + "  onRestart:()=>{setPaused(false);reset(false);},\n"
    + "  onQuitToSelect:()=>{setPaused(false);finish('');},\n"
    + "  onQuitToTitle:()=>{setPaused(false);finish('');selectScreen?.showTitle?.();}\n"
    + "});\n"
    + "function setPaused(next){\n"
    + "  const want=Boolean(next)&&started&&!exploration;\n"
    + "  if(want===paused)return paused;\n"
    + "  paused=want;\n"
    + "  // Keys pressed around the pause are stale once play resumes: the edge-trigger buffers are\n"
    + "  // cleared so a queued attack cannot fire on the first frame back.\n"
    + "  try{if(input.buffers?.[1])input.buffers[1].clear();if(input.buffers?.[2])input.buffers[2].clear();if(Array.isArray(input.buffer))input.buffer.length=0;if(input.keys)input.keys={};}catch(_error){}\n"
    + "  combatAudio.setPaused?.(paused);\n"
    + "  if(paused)pauseMenu?.open();else pauseMenu?.close();\n"
    + "  return paused;\n"
    + "}\n"
    + "function applyMatchRules(next={}){\n"
    + "  const rounds=Number(next.roundsToWin),seconds=Number(next.roundSeconds);\n"
    + "  if(Number.isFinite(rounds)&&rounds>=1)matchRules.roundsToWin=Math.min(5,Math.round(rounds));\n"
    + "  if(Number.isFinite(seconds)&&seconds>=15)matchRules.roundSeconds=Math.min(300,Math.round(seconds));\n"
    + "  // The live match reads its rules from matchState, which resetMatch() re-creates from these.\n"
    + "  matchState.rules.roundsToWin=matchRules.roundsToWin;\n"
    + "  matchState.rules.roundSeconds=matchRules.roundSeconds;\n"
    + "  matchState.timer=(!started||matchState.status!=='fighting')?matchRules.roundSeconds:Math.min(matchState.timer,matchRules.roundSeconds);\n"
    + "  remaining=matchState.timer;\n"
    + "  selectScreen?.setRules?.({...matchRules});\n"
    + "  updateHud();\n"
    + "  return {...matchRules};\n"
    + "}\n"
    + "function setCpuSkill(level){\n"
    + "  cpuSkillLevel=normalizeSkillLevel(level);\n"
    + "  try{localStorage.setItem('browserSmashCpuSkill',cpuSkillLevel);}catch(_error){}\n"
    + "  selectScreen?.setDifficulty?.(cpuSkillLevel);\n"
    + "  return cpuSkillLevel;\n"
    + "}\n"
    + "window.__browserSmashPause={open:()=>setPaused(true),close:()=>setPaused(false),toggle:()=>setPaused(!paused),get paused(){return paused;},get menuOpen(){return Boolean(pauseMenu?.isOpen);},get stats(){return pauseMenu?pauseMenu.root.querySelector('[data-role=\"stats\"]').textContent:'';}};\n"
    + "window.__browserSmashRules=()=>({...matchState.rules,remaining:matchState.timer,skill:cpuSkillLevel});\n"
    + "window.__browserSmashSetRules=next=>applyMatchRules(next);\n"
    + "window.__browserSmashSetCpuSkill=level=>setCpuSkill(level);"
  ],
  // ------------------------------------------ leaving a match clears the pause state
  [
    "hitStop=0;roundPause=0;remaining=matchState.timer;started=true;practice=isPractice;",
    "hitStop=0;roundPause=0;remaining=matchState.timer;started=true;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);practice=isPractice;"
  ],
  [
    "started=false;document.body.classList.add('in-menu');$('#menu').classList.remove('hidden');",
    "started=false;paused=false;pauseMenu?.close();combatAudio.setPaused?.(false);document.body.classList.add('in-menu');$('#menu').classList.remove('hidden');"
  ],
  // ---------------------------------------------------------------- Escape owns the pause
  [
    "addEventListener('keydown',e=>{if(e.key==='Escape'&&exploration)leaveExploration();if(e.key==='F3')",
    "addEventListener('keydown',e=>{if(e.key==='Escape'){if(exploration){leaveExploration();return;}if(started){e.preventDefault();setPaused(!paused);}return;}if(e.key==='F3')"
  ],
  // ------------------------------------------------------- the simulation actually stops
  [
    "function simulationStep(dt){\n  if(started&&hitStop>0){",
    "function simulationStep(dt){\n  // A paused match is frozen: no fighters, no clock, no projectiles. Rendering continues, so the\n  // player keeps seeing the frozen frame instead of a black screen.\n  if(paused)return;\n  if(started&&hitStop>0){"
  ],
  [
    "while(accumulator>=1/60){input.update();simulationStep(1/60);accumulator-=1/60;}",
    "while(accumulator>=1/60){input.update();simulationStep(1/60);accumulator-=1/60;}\n"
    + "if(paused){accumulator=0;composer.render();const pausedDiagnostics=window.__browserSmashAssets;if(pausedDiagnostics){pausedDiagnostics.app=pausedDiagnostics.app||{};pausedDiagnostics.app.status='running';pausedDiagnostics.app.frames=(pausedDiagnostics.app.frames||0)+1;}return;}"
  ]
];

const original = readFileSync(TARGET, 'utf8');
let source = original;
const report = [];

for (const [anchor, replacement] of PATCHES) {
  const first = source.indexOf(anchor);
  const last = source.lastIndexOf(anchor);
  if (first < 0) {
    report.push(`MISSING  ${anchor.slice(0, 70)}`);
    continue;
  }
  if (first !== last) {
    report.push(`AMBIGUOUS (${source.split(anchor).length - 1}x)  ${anchor.slice(0, 70)}`);
    continue;
  }
  if (source.includes(replacement)) {
    report.push(`ALREADY  ${anchor.slice(0, 70)}`);
    continue;
  }
  source = source.replace(anchor, replacement);
  report.push(`ok       ${anchor.slice(0, 70)}`);
}

const failed = report.filter(line => /MISSING|AMBIGUOUS/.test(line));
for (const line of report) console.log('  ' + line);

if (failed.length) {
  console.error(`\n${failed.length} anchor(s) did not apply; main.js left untouched.`);
  process.exit(1);
}
if (checkOnly) {
  console.log('\ncheck only: all anchors present, nothing written.');
  process.exit(0);
}
if (source === original) {
  console.log('\nalready fully patched; nothing to write.');
  process.exit(0);
}
writeFileSync(TARGET, source);
console.log(`\nmain.js patched (${source.length - original.length} bytes added).`);
