/**
 * 2D math on the single gameplay plane (world XZ, y is always 0 for gameplay).
 * Keeping the simulation strictly 2D is what makes the "one gameplay plane"
 * rule structurally true instead of a convention someone can forget.
 *
 * Facing convention: angle 0 points at +Z; forward(a) = (sin a, cos a).
 * The renderer converts with `mesh.rotation.y = facing + Math.PI`.
 */

export const v2 = (x = 0, z = 0) => ({ x, z });
export const clone = (a) => ({ x: a.x, z: a.z });
export const add = (a, b) => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.z * b.z;
export const lenSq = (a) => a.x * a.x + a.z * a.z;
export const len = (a) => Math.hypot(a.x, a.z);
export const distSq = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function norm(a) {
  const l = len(a);
  return l < 1e-9 ? { x: 0, z: 0 } : { x: a.x / l, z: a.z / l };
}

export function clampLen(a, max) {
  const l = len(a);
  return l <= max ? clone(a) : scale(a, max / l);
}

export const forward = (angle) => ({ x: Math.sin(angle), z: Math.cos(angle) });
export const rightOf = (angle) => ({ x: -Math.cos(angle), z: Math.sin(angle) });
export const angleOf = (a) => Math.atan2(a.x, a.z);

/** shortest signed angular difference from `a` to `b`, in (-PI, PI] */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function turnToward(current, target, maxStep) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** frame-rate independent smoothing factor */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Axis-aligned rect {x,z,w,d} where x,z is the center. */
export function rectContains(rect, p, pad = 0) {
  return (
    Math.abs(p.x - rect.x) <= rect.w / 2 + pad &&
    Math.abs(p.z - rect.z) <= rect.d / 2 + pad
  );
}

/** Closest point on an AABB (optionally inflated by `pad`) to `p`. */
export function rectClosestPoint(rect, p, pad = 0) {
  const hx = rect.w / 2 + pad;
  const hz = rect.d / 2 + pad;
  return {
    x: clamp(p.x, rect.x - hx, rect.x + hx),
    z: clamp(p.z, rect.z - hz, rect.z + hz),
  };
}

/**
 * Segment vs inflated AABB test (slab method). Used for line of sight and for
 * movement sweeps; both need the same authoritative answer.
 */
export function segmentIntersectsRect(a, b, rect, pad = 0) {
  const hx = rect.w / 2 + pad;
  const hz = rect.d / 2 + pad;
  const minX = rect.x - hx;
  const maxX = rect.x + hx;
  const minZ = rect.z - hz;
  const maxZ = rect.z + hz;

  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  for (const [p, q0, q1, origin] of [
    [dx, minX, maxX, a.x],
    [dz, minZ, maxZ, a.z],
  ]) {
    if (Math.abs(p) < 1e-9) {
      if (origin < q0 || origin > q1) return false;
      continue;
    }
    let tA = (q0 - origin) / p;
    let tB = (q1 - origin) / p;
    if (tA > tB) [tA, tB] = [tB, tA];
    t0 = Math.max(t0, tA);
    t1 = Math.min(t1, tB);
    if (t0 > t1) return false;
  }
  return true;
}

/** Push `p` out of `rect` inflated by `pad` along the shallowest axis. */
export function resolveRect(rect, p, pad = 0) {
  const hx = rect.w / 2 + pad;
  const hz = rect.d / 2 + pad;
  const dx = p.x - rect.x;
  const dz = p.z - rect.z;
  const overlapX = hx - Math.abs(dx);
  const overlapZ = hz - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return p;
  if (overlapX < overlapZ) {
    return { x: rect.x + Math.sign(dx || 1) * hx, z: p.z };
  }
  return { x: p.x, z: rect.z + Math.sign(dz || 1) * hz };
}
