/**
 * Enemy AI. Perception, intent and motion are three separate steps, and an
 * intent is never rewritten once a move has been committed — that separation is
 * what makes a telegraph mean something.
 *
 * States are named and dwell-limited so behaviour is legible in the HUD debug
 * overlay and assertable in tests.
 */
import { MOVES } from '../content/moves.js';
import {
  add,
  angleOf,
  clamp,
  dist,
  norm,
  scale,
  sub,
  segmentIntersectsRect,
  turnToward,
  clone,
  v2,
} from '../core/math2.js';
import { coverAgainst, findCoverSpots, hasLineOfSight } from './cover.js';
import { canStartAction, startAction, actionMotion } from './combat.js';
import { moveEntity, nearestHostile } from './world.js';

export const AI_STATES = [
  'idle',
  'investigate',
  'pursue',
  'reposition',
  'windup',
  'attack',
  'recover',
  'stagger',
  'retreat',
  'defeated',
];

export function initAi(e, opts = {}) {
  e.ai = {
    state: 'idle',
    stateT: 0,
    prevState: null,
    targetId: null,
    lastSeen: null,
    lostT: 0,
    repositionCd: 0,
    desired: null,
    committed: false,
    leash: opts.leash ?? null,
    canCommit: true,
    home: clone(e.pos),
  };
  return e.ai;
}

function setState(world, e, next) {
  const ai = e.ai;
  if (ai.state === next) return;
  const hints = e.def.ai ?? {};
  const dwell = hints.minStateDwell ?? 0.3;
  // Minimum dwell stops the flicker that makes enemies unreadable.
  if (ai.stateT < dwell && !FORCED_STATES.has(next)) return;
  ai.prevState = ai.state;
  ai.state = next;
  ai.stateT = 0;
  world.bus?.emit('ai.state', { id: e.id, from: ai.prevState, to: next });
}

const FORCED_STATES = new Set(['stagger', 'defeated', 'windup', 'attack', 'recover']);

/** How long a gunshot stays worth walking toward. */
const NOISE_MEMORY = 5;

// ------------------------------------------------------------- perception

function perceive(world, e, dt) {
  const ai = e.ai;
  const hints = e.def.ai ?? {};
  let target = ai.targetId ? world.byId.get(ai.targetId) : null;
  if (target && (!target.alive || target.downed)) target = null;

  const visible = (o) =>
    dist(e.pos, o.pos) <= (hints.sightRange ?? 30) &&
    hasLineOfSight(world.level, e.pos, o.pos, -0.2);

  if (!target) {
    const candidate = nearestHostile(world, e, hints.aggroRange ?? 26);
    if (candidate && visible(candidate)) {
      target = candidate;
      ai.targetId = target.id;
      ai.lostT = 0;
      world.bus?.emit('ai.acquired', { id: e.id, targetId: target.id });
    }
  }

  if (target) {
    if (visible(target)) {
      ai.lastSeen = clone(target.pos);
      ai.lostT = 0;
    } else {
      ai.lostT += dt;
      if (ai.lostT > (hints.loseTargetTime ?? 5)) {
        world.bus?.emit('ai.lost', { id: e.id, targetId: target.id });
        ai.targetId = null;
        target = null;
      }
    }
  }

  // Hearing. Without this, an enemy parked behind a wall never learns a
  // firefight is happening and the encounter can never be finished.
  if (!target) {
    const noise = world.noise;
    const fresh = noise && world.time - noise.time < NOISE_MEMORY;
    if (
      fresh &&
      noise.sourceId !== e.id &&
      dist(e.pos, noise.pos) <= Math.min(hints.hearRange ?? 34, noise.radius) &&
      dist(e.pos, noise.pos) > 3 && // already there; nothing to walk toward
      (!ai.leash || dist(noise.pos, ai.leash.center) <= ai.leash.radius + 4)
    ) {
      if (!ai.lastSeen || dist(ai.lastSeen, noise.pos) > 2.5) {
        ai.lastSeen = clone(noise.pos);
        world.bus?.emit('ai.alerted', { id: e.id, pos: clone(noise.pos) });
      }
    }
  }

  e.aiThreat = target ?? null;
  return target;
}

// ----------------------------------------------------------------- intent

/** Only moves that are legal *right now* are ever offered to the selector. */
export function legalMoves(world, e, target) {
  const out = [];
  const d = dist(e.pos, target.pos);
  const targetCover = coverAgainst(world.level, target.pos, e.pos);
  for (const id of e.def.moves ?? []) {
    const move = MOVES[id];
    const rule = move.ai;
    if (!rule) continue;
    if (!canStartAction(world, e, id).ok) continue;
    if (d < (rule.minRange ?? 0) || d > (rule.maxRange ?? Infinity)) continue;
    if (rule.requiresLos !== false && !hasLineOfSight(world.level, e.pos, target.pos, -0.2)) continue;
    let weight = rule.weight ?? 1;
    if (rule.preferTargetInCover) weight *= targetCover.inCover ? 2.2 : 0.5;
    out.push({ id, move, weight });
  }
  return out;
}

function selectMove(world, e, target) {
  const options = legalMoves(world, e, target);
  if (!options.length) return null;
  const total = options.reduce((s, o) => s + o.weight, 0);
  let roll = world.rng.next() * total;
  for (const o of options) {
    roll -= o.weight;
    if (roll <= 0) return o.id;
  }
  return options[options.length - 1].id;
}

// ----------------------------------------------------------------- motion

/**
 * Local steering with box avoidance. The arena is flat and convex-ish, so
 * sampling a few headings beats carrying a full navmesh for this slice.
 */
export function steerToward(world, e, destination, dt, speedMul = 1) {
  const toDest = sub(destination, e.pos);
  const distance = Math.hypot(toDest.x, toDest.z);
  if (distance < 0.25) {
    moveEntity(world, e, v2(), dt);
    return true;
  }
  const base = norm(toDest);
  const probe = Math.min(2.6, distance);
  const candidates = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6];
  let chosen = base;
  for (const offset of candidates) {
    const a = angleOf(base) + offset;
    const dir = { x: Math.sin(a), z: Math.cos(a) };
    const ahead = add(e.pos, scale(dir, probe));
    let blocked = false;
    for (const o of world.level.obstacles) {
      if (segmentIntersectsRect(e.pos, ahead, o, e.radius * 0.9)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      chosen = dir;
      break;
    }
  }
  moveEntity(world, e, scale(chosen, e.def.speed * speedMul), dt);
  return false;
}

function faceToward(e, point, dt, turnSpeed) {
  const to = sub(point, e.pos);
  if (Math.hypot(to.x, to.z) < 1e-4) return;
  e.facing = turnToward(e.facing, angleOf(to), (turnSpeed ?? e.def.turnSpeed) * dt);
}

function pickRepositionSpot(world, e, target) {
  const hints = e.def.ai ?? {};
  const [minR, maxR] = hints.preferredRange ?? [8, 20];
  const spots = findCoverSpots(world.level, e.pos, target.pos, { maxRange: 20 });
  let best = null;
  let bestScore = -Infinity;
  for (const s of spots) {
    if (e.ai.leash && dist(s.pos, e.ai.leash.center) > e.ai.leash.radius) continue;
    const rangeError = s.threatDistance < minR ? minR - s.threatDistance : Math.max(0, s.threatDistance - maxR);
    const score =
      (hints.coverSeekWeight ?? 1) * 6 - rangeError * 1.4 - s.travel * 0.5 +
      (hasLineOfSight(world.level, s.pos, target.pos, -0.2) ? 2.5 : -4);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best) return best.pos;

  // No usable cover: fall back to holding preferred range in the open.
  const away = norm(sub(e.pos, target.pos));
  const want = clamp((minR + maxR) / 2, minR, maxR);
  return add(target.pos, scale(away, want));
}

// ------------------------------------------------------------------ update

export function updateEnemyAi(world, e, dt) {
  const ai = e.ai;
  if (!ai) return;
  ai.stateT += dt;
  ai.repositionCd = Math.max(0, ai.repositionCd - dt);

  if (!e.alive) {
    setState(world, e, 'defeated');
    return;
  }
  if (e.staggerT > 0) {
    setState(world, e, 'stagger');
    e.aiThreat = ai.targetId ? world.byId.get(ai.targetId) : null;
    return;
  }

  const target = perceive(world, e, dt);
  const hints = e.def.ai ?? {};

  // A committed action owns the actor until it ends. AI does not re-decide.
  if (e.action) {
    const motion = actionMotion(e);
    const phase =
      e.action.t < e.action.move.startup
        ? 'windup'
        : e.action.firedWindows.size < (e.action.move.windows?.length ?? 0)
          ? 'attack'
          : 'recover';
    setState(world, e, phase);
    if (target) faceToward(e, target.pos, dt, motion.turnSpeed);
    if (motion.impulse) {
      moveEntity(world, e, scale({ x: Math.sin(e.facing), z: Math.cos(e.facing) }, motion.impulse), dt);
    } else if (motion.speedMul > 0 && target) {
      const d = dist(e.pos, target.pos);
      const [minR] = hints.preferredRange ?? [8, 20];
      if (d < minR * 0.6) {
        steerToward(world, e, add(e.pos, scale(norm(sub(e.pos, target.pos)), 3)), dt, motion.speedMul);
      }
    }
    return;
  }

  if (!target) {
    if (ai.lastSeen) {
      setState(world, e, 'investigate');
      const arrived = steerToward(world, e, ai.lastSeen, dt, 0.7);
      faceToward(e, ai.lastSeen, dt);
      if (arrived) ai.lastSeen = null;
    } else {
      setState(world, e, 'idle');
      moveEntity(world, e, v2(), dt);
    }
    return;
  }

  const d = dist(e.pos, target.pos);
  const [minR, maxR] = hints.preferredRange ?? [8, 20];
  const los = hasLineOfSight(world.level, e.pos, target.pos, -0.2);
  const hurt = e.hp / e.maxHp;
  const outsideLeash = ai.leash && dist(e.pos, ai.leash.center) > ai.leash.radius;

  faceToward(e, target.pos, dt);

  // Badly hurt anchors break contact instead of trading to the death.
  if (hurt < 0.28 && hints.coverSeekWeight >= 0.8 && ai.state !== 'retreat' && ai.stateT > 0.6) {
    setState(world, e, 'retreat');
    ai.desired = pickRepositionSpot(world, e, target);
  }

  if (outsideLeash) {
    setState(world, e, 'reposition');
    ai.desired = clone(ai.leash.center);
  }

  switch (ai.state) {
    case 'retreat': {
      const dest = ai.desired ?? ai.home;
      const arrived = steerToward(world, e, dest, dt, 1);
      if (arrived || ai.stateT > 3) setState(world, e, 'reposition');
      return;
    }
    case 'reposition': {
      if (!ai.desired) ai.desired = pickRepositionSpot(world, e, target);
      const arrived = steerToward(world, e, ai.desired, dt, 1);
      if (arrived || ai.stateT > 3.5) {
        ai.desired = null;
        ai.repositionCd = hints.repositionCooldown ?? 3;
        setState(world, e, 'pursue');
      }
      return;
    }
    default: {
      // In range, in sight, allowed to commit → attack.
      const wantsCloser = d > maxR || !los;
      const tooClose = d < minR * 0.75;
      if (!wantsCloser && !tooClose && ai.canCommit) {
        const moveId = selectMove(world, e, target);
        if (moveId) {
          setState(world, e, 'windup');
          startAction(world, e, moveId, {
            targetId: target.id,
            dir: norm(sub(target.pos, e.pos)),
          });
          return;
        }
      }

      if ((wantsCloser || tooClose) && ai.repositionCd <= 0) {
        setState(world, e, 'reposition');
        ai.desired = pickRepositionSpot(world, e, target);
        return;
      }

      setState(world, e, 'pursue');
      const inCover = coverAgainst(world.level, e.pos, target.pos).inCover;
      if (wantsCloser) {
        steerToward(world, e, target.pos, dt, 1);
      } else if (tooClose) {
        steerToward(world, e, add(target.pos, scale(norm(sub(e.pos, target.pos)), minR)), dt, 1);
      } else if (!inCover && ai.repositionCd <= 0) {
        ai.desired = pickRepositionSpot(world, e, target);
        setState(world, e, 'reposition');
      } else {
        moveEntity(world, e, v2(), dt);
      }
      return;
    }
  }
}

/**
 * Encounter-level pressure cap: only `maxCommitted` enemies may be inside an
 * attack commitment at once. Everyone else keeps manoeuvring, so the player is
 * never hit by more telegraphs than they can read.
 */
export function applyCommitmentCap(world, enemies, maxCommitted) {
  const committed = enemies.filter((e) => e.alive && e.action && e.action.move.contact);
  let slots = Math.max(0, maxCommitted - committed.length);
  for (const e of enemies) {
    if (!e.ai) continue;
    if (e.action) {
      e.ai.canCommit = true;
      continue;
    }
    e.ai.canCommit = slots > 0;
    if (slots > 0) slots--;
  }
}
