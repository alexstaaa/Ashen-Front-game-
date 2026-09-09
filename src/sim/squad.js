/**
 * Squad. One squadmate in this slice, but the systems are the ones a full crew
 * would use: an order the player sets, morale that changes how well the order
 * is carried out, and loyalty that decides whether it is carried out at all.
 *
 * Morale is a combat stat. Loyalty is a narrative one. They move separately on
 * purpose — a squadmate can trust you and still be too frightened to be useful.
 */
import { angleOf, clamp, clone, dist, norm, scale, sub, turnToward, v2 } from '../core/math2.js';
import { coverAgainst, findCoverSpots, hasLineOfSight } from './cover.js';
import { startAction, actionMotion } from './combat.js';
import { moveEntity, nearestHostile } from './world.js';
import { steerToward } from './ai.js';

export const ORDERS = {
  hold: { id: 'hold', label: 'Hold', hint: 'Stay in cover and shoot what shoots at us.' },
  advance: { id: 'advance', label: 'Advance', hint: 'Move up with me. Costs her nerve.' },
  focus: { id: 'focus', label: 'Focus', hint: 'Put everything on my target.' },
};

/** Below this she will not take Advance, whatever you shout. */
export const REFUSAL_MORALE = 26;

export function initSquad(e) {
  const def = e.def;
  e.squad = {
    order: 'hold',
    morale: def.morale?.start ?? 60,
    loyalty: def.loyalty?.start ?? 50,
    holdPoint: clone(e.pos),
    reviveT: 0,
    barkCd: 0,
    lastRefusal: -99,
    refusing: false,
  };
  e.accuracyMul = moraleAccuracy(e.squad.morale);
  return e.squad;
}

export const moraleAccuracy = (morale) => 0.6 + 0.5 * clamp(morale / 100, 0, 1);

export function adjustMorale(world, e, delta, reason) {
  if (!e?.squad) return;
  const before = e.squad.morale;
  e.squad.morale = clamp(before + delta, e.def.morale?.min ?? 0, e.def.morale?.max ?? 100);
  e.accuracyMul = moraleAccuracy(e.squad.morale);
  if (e.squad.morale !== before) {
    world.bus?.emit('squad.morale', {
      id: e.id,
      morale: e.squad.morale,
      delta: e.squad.morale - before,
      reason,
    });
  }
}

export function adjustLoyalty(world, e, delta, reason) {
  if (!e?.squad) return;
  const before = e.squad.loyalty;
  e.squad.loyalty = clamp(before + delta, e.def.loyalty?.min ?? 0, e.def.loyalty?.max ?? 100);
  if (e.squad.loyalty !== before) {
    world.bus?.emit('squad.loyalty', {
      id: e.id,
      loyalty: e.squad.loyalty,
      delta: e.squad.loyalty - before,
      reason,
    });
  }
}

export function bark(world, e, key) {
  if (!e.squad || e.squad.barkCd > 0) return;
  const lines = e.def.barks?.[key];
  if (!lines?.length) return;
  const line = lines[world.rng.int(0, lines.length - 1)];
  e.squad.barkCd = 3.2;
  world.bus?.emit('squad.bark', { id: e.id, speaker: e.name, key, line });
}

export function setOrder(world, e, orderId) {
  if (!e.squad || !ORDERS[orderId]) return false;
  if (orderId === 'advance' && e.squad.morale < REFUSAL_MORALE) {
    e.squad.refusing = true;
    e.squad.lastRefusal = world.time;
    bark(world, e, 'refuse');
    world.bus?.emit('squad.refused', { id: e.id, order: orderId, morale: e.squad.morale });
    return false;
  }
  e.squad.refusing = false;
  e.squad.order = orderId;
  e.squad.holdPoint = clone(e.pos);
  world.bus?.emit('squad.order', { id: e.id, order: orderId });
  if (orderId === 'advance') bark(world, e, 'advance');
  return true;
}

/** Player-side revive: hold the interact key next to her. */
export function updateRevive(world, ally, player, holding, dt) {
  if (!ally?.downed) return { active: false, progress: 0 };
  const reviveTime = ally.def.ai?.reviveTime ?? 2.5;
  const inRange = dist(ally.pos, player.pos) <= 2.2 && player.alive;
  if (!holding || !inRange) {
    ally.squad.reviveT = Math.max(0, ally.squad.reviveT - dt * 1.5);
    return { active: false, progress: ally.squad.reviveT / reviveTime, inRange };
  }
  ally.squad.reviveT += dt;
  if (ally.squad.reviveT >= reviveTime) {
    ally.squad.reviveT = 0;
    ally.downed = false;
    ally.downedT = 0;
    ally.hp = ally.maxHp * 0.4;
    ally.posture = ally.maxPosture;
    adjustMorale(world, ally, 18, 'revived');
    adjustLoyalty(world, ally, 12, 'revived');
    bark(world, ally, 'revived');
    world.bus?.emit('ally.revived', { id: ally.id });
    return { active: false, progress: 0, done: true };
  }
  return { active: true, progress: ally.squad.reviveT / reviveTime, inRange: true };
}

export function updateSquadmate(world, e, dt, ctx = {}) {
  const squad = e.squad;
  if (!squad) return;
  squad.barkCd = Math.max(0, squad.barkCd - dt);

  if (e.downed) {
    e.downedT += dt;
    const limit = e.def.ai?.downedTime ?? 20;
    if (e.downedT >= limit && e.alive) {
      e.alive = false;
      world.bus?.emit('ally.lost', { id: e.id, name: e.name });
    }
    return;
  }
  if (!e.alive) return;

  // Low morale speaks for itself, occasionally.
  if (squad.morale < 35 && world.rng.next() < dt * 0.08) bark(world, e, 'lowMorale');

  const player = world.player;
  const focusTarget = squad.order === 'focus' && ctx.focusId ? world.byId.get(ctx.focusId) : null;
  let target = focusTarget?.alive ? focusTarget : nearestHostile(world, e, 30);
  if (target && !hasLineOfSight(world.level, e.pos, target.pos, -0.2)) {
    const fallback = nearestHostile(world, e, 30);
    target = fallback && hasLineOfSight(world.level, e.pos, fallback.pos, -0.2) ? fallback : null;
  }
  e.aiThreat = target ?? null;

  if (e.action) {
    const motion = actionMotion(e);
    if (target) faceToward(e, target.pos, dt, motion.turnSpeed);
    return;
  }

  // Where she wants to be, by order.
  let anchor = squad.holdPoint;
  if (squad.order === 'advance' && player) {
    anchor = { x: player.pos.x - 2.0, z: player.pos.z - 1.4 };
  } else if (squad.order === 'focus' && player) {
    anchor = { x: player.pos.x + 2.2, z: player.pos.z - 2.0 };
  }

  // Frightened soldiers hug cover harder than confident ones.
  const coverPull = clamp(1.35 - squad.morale / 100, 0.35, 1.2);
  let destination = anchor;
  if (target) {
    const inCover = coverAgainst(world.level, e.pos, target.pos).inCover;
    if (!inCover) {
      const spots = findCoverSpots(world.level, e.pos, target.pos, { maxRange: 14 });
      let best = null;
      let bestScore = -Infinity;
      for (const s of spots) {
        const score = 6 * coverPull - s.travel * 0.6 - dist(s.pos, anchor) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best) destination = best.pos;
    } else {
      destination = e.pos;
    }
  }

  const arrived = steerToward(world, e, destination, dt, 1);
  if (target) {
    faceToward(e, target.pos, dt);
    const d = dist(e.pos, target.pos);
    const [minR, maxR] = e.def.ai?.preferredRange ?? [8, 22];
    if (d >= minR * 0.5 && d <= maxR && hasLineOfSight(world.level, e.pos, target.pos, -0.2)) {
      startAction(world, e, 'vela.aimed', {
        targetId: target.id,
        dir: norm(sub(target.pos, e.pos)),
      });
    }
  } else if (arrived) {
    moveEntity(world, e, v2(), dt);
  }
}

function faceToward(e, point, dt, turnSpeed) {
  const to = sub(point, e.pos);
  if (Math.hypot(to.x, to.z) < 1e-4) return;
  e.facing = turnToward(e.facing, angleOf(to), (turnSpeed ?? e.def.turnSpeed) * dt);
}

/**
 * Wire the squad's reactions to simulation events. Everything here is a
 * downstream consumer: it reads resolved facts and adjusts morale/loyalty.
 */
export function attachSquadReactions(world, ally) {
  const bus = world.bus;
  if (!bus || !ally) return () => {};
  const offs = [
    bus.on('entity.damaged', (e) => {
      if (e.id === ally.id) {
        adjustMorale(world, ally, -e.amount * 0.18, 'wounded');
        if (world.rng.next() < 0.35) bark(world, ally, 'hurt');
      }
    }),
    bus.on('enemy.defeated', () => adjustMorale(world, ally, 4, 'enemy-down')),
    bus.on('ally.downed', () => {
      bark(world, ally, 'down');
    }),
    bus.on('civilian.killed', () => {
      adjustMorale(world, ally, -14, 'civilian-killed');
      adjustLoyalty(world, ally, -10, 'civilian-killed');
    }),
    bus.on('relic.used', () => {
      adjustMorale(world, ally, -2, 'relic');
    }),
    bus.on('objective.completed', () => adjustMorale(world, ally, 6, 'objective')),
  ];
  return () => offs.forEach((off) => off());
}
