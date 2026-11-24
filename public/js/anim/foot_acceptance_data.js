// Accepted rigs for the grounded foot-plant layer.
//
// Generated from artifacts/grounded-locomotion/foot-scenarios-a.json, artifacts/grounded-locomotion/foot-scenarios-b.json by scripts/build-foot-acceptance.mjs.
//
// 16 of 38 measured rigs passed every run. A rig is listed only when
// every supplied run measured a walk/run clip with at least 12 ankle contact frames
// (5% coverage), no raised planted frame, a settled sample at or below
// 0.020 m of ankle travel per sample (1.2 m/s at 60 fps), at least
// 12 visible-foot contact frames (3% coverage) with sole, toe and heel all
// touching, mean/max floor penetration at or below 0.030/0.080 m,
// planted yaw mean/max at or below 6/30 deg, and screen-space foot slip
// mean/max at or below 40/150 px at 960x600.
//
// Transition checks use a 12-frame minimum, at least 6 visible-foot contact frames,
// 6 support frames (8 on landing/strafe), the matching transition weight and target reason,
// a braced front foot on stop, a planted pivot and pivot step, a landing replant, and mean
// floor penetration at or below 0.080 m (0.090 on landing).
// Strafe also requires 8 lateral frames, planted yaw mean at or below 6 deg, and screen slip
// mean/max at or below 40/150 px.
// Slope requires 0.50 m of rise, no more than 2 downward steps, 24 frames, 8 foot-contact frames,
// 10 support frames and mean penetration at or below 0.120 m. Stairs require
// 0.80 m of rise, 2 treads, 40 frames, 8 foot-contact frames, 10 support frames and
// mean penetration at or below 0.100 m; stair max penetration is not gated because
// a toe ahead of a riser is expected to clip at the edge.
// A rig that passes one run and fails another, or is missing from a run, is omitted.
// Unlisted and unknown identities fail closed and keep their authored clip feet.
export const FOOT_ACCEPTANCE_ACCEPTED = Object.freeze([
  'aang',
  'arnold_schwarzenegger',
  'captain_jack_sparrow',
  'doctor_strange',
  'doom_slayer',
  'edna_mode',
  'edward_elric',
  'geralt_of_rivia',
  'iron_man_tony_stark',
  'kaze',
  'levi_ackerman',
  'link',
  'luigi',
  'naruto_uzumaki',
  'saitama',
  'wolverine_logan',
]);
