#!/usr/bin/env node
// Flight locomotion plan checks. These are the phase/clip/bank decisions shared by Goku's baked
// mixer path and Iron Man's controller path; the browser probe verifies the same fields on a live
// body after each owner has written its pose.
import assert from 'node:assert/strict';
import {
  advanceFlightLocomotion,
  flightLocomotionFor,
  resetFlightLocomotion
} from '../public/js/anim/flight_locomotion.js';

let checks = 0;
function check(name, condition, detail = '') {
  checks++;
  assert.ok(condition, `${name}${detail ? ` (${detail})` : ''}`);
  console.log(`  ok  ${name}`);
}

function fighter(overrides = {}) {
  const f = {
    identityKey: 'goku',
    flightMode: false,
    isGrounded: true,
    facing: 1,
    facingZ: 0,
    velocity: { x: 0, y: 0, z: 0 },
    model: { userData: {} },
    ...overrides
  };
  resetFlightLocomotion(f);
  return f;
}

function step(f, dt = 1 / 60, overrides = null) {
  const plan = flightLocomotionFor(f, { dt, ...(overrides || {}) });
  advanceFlightLocomotion(f, dt);
  return plan;
}

// Phase tests start after the takeoff transition, exactly as they do in a match.
function settled(overrides = {}) {
  const f = fighter({ flightMode: true, isGrounded: false, ...overrides });
  for (let i = 0; i < 40; i++) step(f);
  return f;
}

// Takeoff is a real transition, then a stationary flyer settles into hover.
const takeoff = fighter();
takeoff.flightMode = true;
takeoff.isGrounded = false;
let plan = step(takeoff);
check('engaging flight reports takeoff', plan.phase === 'takeoff', JSON.stringify(plan.phase));
check('Goku takeoff selects the baked takeoff action', plan.action === 'flyTakeoffAction', plan.action);
for (let i = 0; i < 40; i++) plan = step(takeoff);
check('takeoff hands off to hover', plan.phase === 'hover', JSON.stringify(plan.phase));
check('Goku hover selects the hover action', plan.action === 'hoverAction', plan.action);

// Forward, boost, back, strafe and vertical phases are distinct.
const forward = settled({ velocity: { x: 12, y: 0, z: 0 } });
plan = step(forward, 1 / 60, { speed: 12 });
check('level forward speed is forward flight', plan.phase === 'forward', plan.phase);
check('forward flight uses the loop clip', plan.clip === 'fly_loop', plan.clip);

const boost = settled({ velocity: { x: 20, y: 0, z: 0 } });
plan = step(boost, 1 / 60, { speed: 20 });
check('speed above the cruise band is boost', plan.phase === 'boost', plan.phase);
check('boost uses the boost clip', plan.clip === 'fly_boost', plan.clip);
check('Goku boost reuses the authored forward clip at a faster cadence',
  plan.action === 'flyForwardAction' && plan.timeScale > 1, `${plan.action} x${plan.timeScale}`);

const back = settled({ facing: -1, facingZ: 0, velocity: { x: 5, y: 0, z: 0 } });
plan = step(back, 1 / 60, { speed: 5 });
check('moving against the facing direction is backpedal flight', plan.phase === 'back', plan.phase);
check('Goku backpedal selects the baked back clip', plan.action === 'flyBackAction', plan.action);

const strafeR = settled({ velocity: { x: 0, y: 0, z: -5 } });
plan = step(strafeR, 1 / 60, { speed: 5 });
check('sideways flight reports a strafe phase', plan.phase === 'strafe_right' || plan.phase === 'strafe_left', plan.phase);
check('strafe reports a bank target', Math.abs(plan.bankTarget) > 0.05, String(plan.bankTarget));

const ascend = settled({ velocity: { x: 0, y: 4, z: 0 } });
plan = step(ascend, 1 / 60, { speed: 0.8 });
check('climbing without forward speed reports ascend', plan.phase === 'ascend', plan.phase);
const descend = settled({ velocity: { x: 0, y: -4, z: 0 } });
plan = step(descend, 1 / 60, { speed: 0.8 });
check('dropping without forward speed reports descend', plan.phase === 'descend', plan.phase);

// Bank is signed by the heading rate, so a left and right turn are visibly opposite.
const right = settled({ velocity: { x: 10, y: 0, z: 0 } });
let rightPlan = null;
for (let i = 0; i < 12; i++) rightPlan = step(right, 1 / 60, { speed: 10, turnRate: 3 });
check('a fast heading change reports a banked turn', rightPlan.phase === 'turn', rightPlan.phase);
check('right turn banks positive', rightPlan.bank > 0.1, String(rightPlan.bank));
const left = settled({ velocity: { x: 10, y: 0, z: 0 } });
let leftPlan = null;
for (let i = 0; i < 12; i++) leftPlan = step(left, 1 / 60, { speed: 10, turnRate: -3 });
check('left turn banks negative', leftPlan.bank < -0.1, String(leftPlan.bank));

// Iron Man gets the authored thruster set; Goku keeps his own baked actions.
const iron = settled({ identityKey: 'iron_man_tony_stark', velocity: { x: 12, y: 0, z: 0 } });
plan = step(iron, 1 / 60, { speed: 12 });
check('Iron Man uses the thruster loop, not the generic fly loop',
  plan.clip === 'iron_fly_loop' && plan.clipFallback === 'fly_loop', `${plan.clip}/${plan.clipFallback}`);
check('Iron Man is tagged as the thruster body', plan.body === 'iron_man' && plan.style === 'thruster', `${plan.body}/${plan.style}`);
const ironBoost = settled({ identityKey: 'iron_man_tony_stark', velocity: { x: 18, y: 0, z: 0 } });
plan = step(ironBoost, 1 / 60, { speed: 18 });
check('Iron Man boost uses the thruster boost clip', plan.clip === 'iron_fly_boost', plan.clip);

// Landing is an airborne transition; once grounded the ordinary land state takes over.
const landing = fighter({ flightMode: true, isGrounded: false, velocity: { x: 2, y: 0, z: 0 } });
for (let i = 0; i < 40; i++) step(landing);
landing.flightMode = false;
plan = step(landing);
check('leaving flight reports a landing transition', plan.phase === 'landing', plan.phase);
check('Goku landing selects the baked flight-land clip', plan.action === 'flyLandAction', plan.action);
for (let i = 0; i < 45; i++) plan = step(landing);
check('the landing transition expires', plan === null, plan?.phase);
landing.flightMode = true;
for (let i = 0; i < 40; i++) step(landing);
landing.flightMode = false;
landing.isGrounded = false;
plan = step(landing);
check('an airborne flight exit starts its landing transition', plan?.phase === 'landing', plan?.phase);
landing.isGrounded = true;
plan = step(landing);
check('touching down hands that contact to the grounded land state', plan === null, plan?.phase);

// A controlled descent disengages on the contact frame. That transition gets its own short
// flight-landing read, unlike a landing that was already airborne and then touched down.
const controlled = fighter({ flightMode: true, isGrounded: false, velocity: { x: 2, y: 0, z: 0 } });
for (let i = 0; i < 40; i++) step(controlled);
controlled.flightMode = false;
controlled.isGrounded = true;
plan = step(controlled);
check('a controlled touchdown keeps the flight-landing transition for its read',
  plan?.phase === 'landing', plan?.phase);
for (let i = 0; i < 45; i++) plan = step(controlled);
check('the controlled landing returns to the ordinary grounded state', plan === null, plan?.phase);

console.log(`\nFlight locomotion checks passed (${checks} checks).`);
