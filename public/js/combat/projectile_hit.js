// Swept collision for projectiles.
//
// The projectile update used to compare its new position with the target's chest once per
// rendered frame. At 60 fps a 30 m/s shot travels 0.5 m per frame, but the render loop clamps
// `elapsed` to 0.05 s, so one frame can be 1.5 m — wider than the 0.95 m hit sphere, and the
// shot tunnels through the fighter. These helpers test the segment the shot actually covered
// instead of the point it landed on, and the same segment against solid world volumes so a
// building cannot be skipped by the same jump.

/**
 * Segment-versus-sphere test (closest approach), in world units.
 * Returns true when the segment from `from` to `to` passes within `radius` of `center`.
 */
export function sweptSphere(from, to, center, radius) {
  if (!from || !to || !center) return false;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const fx = from.x - center.x, fy = from.y - center.y, fz = from.z - center.z;
  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  if (c <= 0) return true;               // starts inside the sphere
  if (a <= 1e-9) return false;           // no movement and outside
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1;
}

/** True when any solid volume sits on the segment, sampled rather than raycast. */
export function segmentSolid(from, to, solidAt, samples = 6) {
  if (!from || !to || typeof solidAt !== 'function') return false;
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    if (solidAt(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t
    )) return true;
  }
  return false;
}
