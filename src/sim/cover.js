/**
 * Cover and line of sight. Both answers are geometric and authoritative: AI,
 * combat resolution and the HUD all call the same functions, so what the
 * player is told about cover is the same fact the bullet uses.
 */
import {
  dist,
  norm,
  sub,
  add,
  scale,
  segmentIntersectsRect,
  rectClosestPoint,
} from '../core/math2.js';

/** How close you must be to a low obstacle for it to actually cover you. */
export const COVER_HUG_DISTANCE = 1.35;
export const COVER_HIT_MULTIPLIER = 0.45;
export const COVER_DAMAGE_MULTIPLIER = 0.75;

/** High obstacles block sight. Low ones never do — that is the whole point. */
export function hasLineOfSight(level, from, to, pad = 0) {
  for (const o of level.obstacles) {
    if (o.height !== 'high') continue;
    if (segmentIntersectsRect(from, to, o, pad)) return false;
  }
  return true;
}

/** First high obstacle blocking the segment, or null. */
export function sightBlocker(level, from, to, pad = 0) {
  for (const o of level.obstacles) {
    if (o.height !== 'high') continue;
    if (segmentIntersectsRect(from, to, o, pad)) return o;
  }
  return null;
}

/**
 * Is `pos` in cover from `threatPos`?
 * Requires a low obstacle that is (a) close enough to hug and (b) actually
 * between the two points.
 */
export function coverAgainst(level, pos, threatPos) {
  let best = null;
  let bestDist = Infinity;
  for (const o of level.obstacles) {
    if (o.height !== 'low') continue;
    const closest = rectClosestPoint(o, pos);
    const d = dist(closest, pos);
    if (d > COVER_HUG_DISTANCE) continue;
    // Trace from the threat to a point just past the actor: if the low
    // obstacle interrupts that line, the actor is behind it.
    if (!segmentIntersectsRect(threatPos, pos, o, 0.05)) continue;
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best ? { inCover: true, obstacle: best, distance: bestDist } : { inCover: false, obstacle: null, distance: Infinity };
}

/**
 * Candidate cover positions near an actor, scored against a threat.
 * Used by AI repositioning; returns points on the plane only.
 */
export function findCoverSpots(level, from, threatPos, { maxRange = 18, samplesPerObstacle = 6 } = {}) {
  const spots = [];
  for (const o of level.obstacles) {
    if (o.height !== 'low') continue;
    const center = { x: o.x, z: o.z };
    if (dist(center, from) > maxRange) continue;

    const away = norm(sub(center, threatPos));
    const hug = Math.max(o.w, o.d) * 0.5 + 0.75;
    const base = add(center, scale(away, hug));
    const lateral = { x: -away.z, z: away.x };
    const spread = Math.max(o.w, o.d) * 0.5;

    for (let i = 0; i < samplesPerObstacle; i++) {
      const t = samplesPerObstacle === 1 ? 0 : (i / (samplesPerObstacle - 1)) * 2 - 1;
      const p = add(base, scale(lateral, t * spread));
      const c = coverAgainst(level, p, threatPos);
      if (!c.inCover) continue;
      spots.push({
        pos: p,
        obstacleId: o.id,
        travel: dist(from, p),
        threatDistance: dist(p, threatPos),
      });
    }
  }
  return spots;
}
