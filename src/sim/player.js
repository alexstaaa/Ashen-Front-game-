/**
 * Player control. Input is translated into the same authored moves the AI uses;
 * there is no separate "player combat" path, so timing and contact rules are
 * identical on both sides of the fight.
 */
import { actionMotion, canStartAction, startAction } from './combat.js';
import { hasLineOfSight, coverAgainst } from './cover.js';
import { moveEntity, hostilesOf } from './world.js';
import {
  angleDelta,
  angleOf,
  clamp,
  dist,
  len,
  norm,
  scale,
  sub,
  turnToward,
  v2,
} from '../core/math2.js';

export const LOCK_ON_RANGE = 30;
export const LOCK_ON_CONE_DEG = 75;

export function createPlayerControl() {
  return { lockTargetId: null, sprinting: false, lastFireAt: -99 };
}

/** Acquire or clear the lock-on target. Returns the new target id or null. */
export function toggleLockOn(world, e, control) {
  if (control.lockTargetId) {
    const current = world.byId.get(control.lockTargetId);
    if (current?.alive) {
      control.lockTargetId = null;
      world.bus?.emit('lockon.cleared', {});
      return null;
    }
  }
  const half = (LOCK_ON_CONE_DEG * Math.PI) / 360;
  let best = null;
  let bestScore = Infinity;
  for (const o of hostilesOf(world, e)) {
    const to = sub(o.pos, e.pos);
    const d = len(to);
    if (d > LOCK_ON_RANGE) continue;
    const off = Math.abs(angleDelta(e.facing, angleOf(to)));
    if (off > half) continue;
    if (!hasLineOfSight(world.level, e.pos, o.pos, -0.2)) continue;
    const score = off * 8 + d * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  control.lockTargetId = best?.id ?? null;
  world.bus?.emit(best ? 'lockon.acquired' : 'lockon.failed', { targetId: best?.id ?? null });
  return control.lockTargetId;
}

/** Drop a lock that has died, gone out of range, or broken line of sight. */
function validateLock(world, e, control) {
  const t = control.lockTargetId ? world.byId.get(control.lockTargetId) : null;
  if (!t || !t.alive || dist(e.pos, t.pos) > LOCK_ON_RANGE + 6) {
    if (control.lockTargetId) world.bus?.emit('lockon.cleared', {});
    control.lockTargetId = null;
    return null;
  }
  return t;
}

/**
 * @param input {
 *   axisX, axisZ  -1..1 movement in camera space
 *   yaw           camera yaw in radians (the direction the player aims)
 *   fire, melee, relic, reload, dive, sprint, interact  booleans (edge-filtered by caller)
 * }
 */
export function updatePlayer(world, e, control, input, dt) {
  if (!e.alive) return { moved: false };

  const lock = validateLock(world, e, control);
  const motion = actionMotion(e);

  // ---- facing -----------------------------------------------------------
  let desiredFacing = input.yaw ?? e.facing;
  if (lock) desiredFacing = angleOf(sub(lock.pos, e.pos));
  if (motion.turnSpeed !== 0) {
    const rate = motion.turnSpeed ?? e.def.turnSpeed;
    e.facing = turnToward(e.facing, desiredFacing, rate * dt);
  }

  // ---- movement ---------------------------------------------------------
  const forwardDir = { x: Math.sin(input.yaw ?? e.facing), z: Math.cos(input.yaw ?? e.facing) };
  const rightDir = { x: -forwardDir.z, z: forwardDir.x };
  let wish = v2(
    forwardDir.x * (input.axisZ ?? 0) + rightDir.x * (input.axisX ?? 0),
    forwardDir.z * (input.axisZ ?? 0) + rightDir.z * (input.axisX ?? 0),
  );
  const wishLen = len(wish);
  if (wishLen > 1) wish = scale(wish, 1 / wishLen);

  const staggered = e.staggerT > 0;
  let speed = e.def.speed * (staggered ? 0.25 : motion.speedMul);
  if (input.sprint && !e.action && wishLen > 0.1) speed *= e.def.sprintMul ?? 1;

  let velocity = scale(wish, speed);
  if (motion.impulse && e.action) velocity = scale(e.action.dir, motion.impulse);
  moveEntity(world, e, velocity, dt);

  // ---- verbs ------------------------------------------------------------
  const aimDir = { x: Math.sin(e.facing), z: Math.cos(e.facing) };
  const opts = { dir: aimDir, targetId: lock?.id ?? null };

  if (input.dive) {
    const diveDir = wishLen > 0.1 ? norm(wish) : scale(aimDir, -1);
    startAction(world, e, 'move.dive', { dir: diveDir });
  } else if (input.melee) {
    startAction(world, e, 'melee.bayonet', opts);
  } else if (input.relic) {
    startAction(world, e, 'relic.emberlash', opts);
  } else if (input.reload) {
    if (e.mag < e.magSize && e.reserve > 0) startAction(world, e, 'rifle.reload');
  } else if (input.fire) {
    if (e.mag <= 0) {
      if (e.reserve > 0) startAction(world, e, 'rifle.reload');
      else world.bus?.emit('action.rejected', { id: e.id, moveId: 'rifle.fire', reason: 'empty' });
    } else if (canStartAction(world, e, 'rifle.fire').ok) {
      startAction(world, e, 'rifle.fire', opts);
      control.lastFireAt = world.time;
    }
  }

  return {
    moved: wishLen > 0.01,
    lockTargetId: control.lockTargetId,
    inCover: e.inCover,
    sprinting: !!input.sprint && wishLen > 0.1,
  };
}

/** Read-only snapshot the HUD renders from. */
export function playerStatus(world, e, control) {
  const threat = world.entities.find((o) => o.alive && o.aiThreat === e) ?? null;
  const cover = threat ? coverAgainst(world.level, e.pos, threat.pos) : { inCover: e.inCover };
  return {
    hp: e.hp,
    maxHp: e.maxHp,
    posture: clamp(e.posture, 0, e.maxPosture),
    maxPosture: e.maxPosture,
    mag: e.mag,
    magSize: e.magSize,
    reserve: e.reserve,
    relic: e.relic ? { charges: e.relic.charges, max: e.relic.max } : null,
    inCover: !!cover.inCover,
    staggered: e.staggerT > 0,
    lockTargetId: control.lockTargetId,
    action: e.action ? { moveId: e.action.moveId, t: e.action.t } : null,
  };
}
