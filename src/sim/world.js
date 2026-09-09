/**
 * Runtime world. Everything here is instance state: transforms, health,
 * timers, targets. Authored definitions in src/content are read-only and are
 * referenced by id — nothing in this file may write to them.
 *
 * The world is plain data plus pure-ish functions so the whole simulation runs
 * headless in tests with no renderer and no browser.
 */
import { ACTORS } from '../content/actors.js';
import { MOVES } from '../content/moves.js';
import { RELICS } from '../content/relics.js';
import { makeRng } from '../core/rng.js';
import {
  add,
  clamp,
  clampLen,
  clone,
  dist,
  norm,
  rectClosestPoint,
  rectContains,
  resolveRect,
  scale,
  sub,
  v2,
} from '../core/math2.js';
import { coverAgainst } from './cover.js';

export const TEAMS = { marches: 'marches', kaldreich: 'kaldreich', neutral: 'neutral' };

const TEAM_BY_KIND = {
  player: TEAMS.marches,
  ally: TEAMS.marches,
  enemy: TEAMS.kaldreich,
  civilian: TEAMS.neutral,
};

export function createWorld({ level, mission, seed = 1, bus }) {
  return {
    level,
    mission,
    bus,
    seed,
    rng: makeRng(seed),
    time: 0,
    nextId: 1,
    entities: [],
    byId: new Map(),
    projectiles: [],
    markers: [],
    player: null,
    /**
     * Most recent combat noise. Enemies that cannot see anything use this to
     * decide where to look, so a fight on the other side of a wall does not
     * leave them standing at their spawn forever.
     */
    noise: null,
    /** mission-scoped runtime flags: cleared encounters, objectives, choice */
    flags: {
      clearedEncounters: [],
      completedObjectives: [],
      choiceTaken: null,
      civiliansAlive: 0,
      attunement: 0,
      kills: 0,
    },
  };
}

export function spawnActor(world, defId, pos, opts = {}) {
  const def = ACTORS[defId];
  if (!def) throw new Error(`unknown actor definition: ${defId}`);

  const e = {
    id: world.nextId++,
    defId,
    def,
    kind: def.kind,
    faction: def.faction,
    team: opts.team ?? TEAM_BY_KIND[def.kind] ?? TEAMS.neutral,
    name: def.name,

    pos: clone(pos),
    vel: v2(),
    facing: opts.facing ?? 0,
    radius: def.radius,

    hp: def.maxHp,
    maxHp: def.maxHp,
    posture: def.maxPosture,
    maxPosture: def.maxPosture,
    alive: true,
    downed: false,
    downedT: 0,

    action: null,
    cooldowns: {},
    statuses: [],
    staggerT: 0,
    invulnT: 0,
    lastHitTime: -999,

    inCover: false,
    coverId: null,

    /** ranged actors carry their own ammunition state */
    mag: def.magSize ?? 6,
    magSize: def.magSize ?? 6,
    reserve: def.reserveAmmo ?? 0,

    ai: null,
  };

  if (def.kind === 'player') {
    const relic = RELICS.emberlash;
    e.relic = { id: relic.id, charges: relic.startCharges, max: relic.maxCharges };
    world.player = e;
  }

  world.entities.push(e);
  world.byId.set(e.id, e);
  world.bus?.emit('entity.spawned', { id: e.id, defId, pos: clone(pos), kind: def.kind });
  return e;
}

/**
 * Record a loud event. Only the latest is kept: AI needs "where is the fight",
 * not an audio history.
 */
export function emitNoise(world, pos, { radius = 34, sourceId = null } = {}) {
  world.noise = { pos: clone(pos), time: world.time, radius, sourceId };
  world.bus?.emit('noise.made', { pos: clone(pos), radius, sourceId });
  return world.noise;
}

export function removeEntity(world, e) {
  world.byId.delete(e.id);
  const i = world.entities.indexOf(e);
  if (i >= 0) world.entities.splice(i, 1);
  world.bus?.emit('entity.removed', { id: e.id });
}

export const isHostile = (a, b) =>
  a.team !== b.team && a.team !== TEAMS.neutral && b.team !== TEAMS.neutral;

export function livingEntities(world, filter) {
  return world.entities.filter((e) => e.alive && !e.downed && (!filter || filter(e)));
}

export function hostilesOf(world, e) {
  return world.entities.filter((o) => o.alive && !o.downed && isHostile(e, o));
}

export function nearestHostile(world, e, maxRange = Infinity) {
  let best = null;
  let bestD = maxRange;
  for (const o of hostilesOf(world, e)) {
    const d = dist(e.pos, o.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

export function entitiesInRadius(world, pos, radius, filter) {
  return world.entities.filter(
    (e) => e.alive && dist(e.pos, pos) <= radius + e.radius && (!filter || filter(e)),
  );
}

/**
 * World-space position of a named socket, projected onto the gameplay plane.
 * Uses the same local-+Z-forward convention as the renderer, so a muzzle flash
 * and the shot it represents start from the same point.
 */
export function socketPos(e, name) {
  const s = e.def.sockets?.[name];
  if (!s) return clone(e.pos);
  // Only the planar offset matters to the simulation; y is presentation.
  const sin = Math.sin(e.facing);
  const cos = Math.cos(e.facing);
  return {
    x: e.pos.x + s.x * cos + s.z * sin,
    z: e.pos.z - s.x * sin + s.z * cos,
  };
}

// ---------------------------------------------------------------- movement

/**
 * Integrate a desired planar velocity and resolve it against level geometry.
 * Movement never leaves y = 0, so no code downstream has to consider height.
 */
export function moveEntity(world, e, desiredVel, dt) {
  const level = world.level;
  const next = add(e.pos, scale(desiredVel, dt));

  // Level bounds first, so nothing can be pushed out of the world by geometry.
  const b = level.bounds;
  next.x = clamp(next.x, b.x - b.w / 2 + e.radius, b.x + b.w / 2 - e.radius);
  next.z = clamp(next.z, b.z - b.d / 2 + e.radius, b.z + b.d / 2 - e.radius);

  let resolved = next;
  // Two passes handles inside-corner cases without a full physics solver.
  for (let pass = 0; pass < 2; pass++) {
    for (const o of level.obstacles) {
      if (!rectContains(o, resolved, e.radius)) continue;
      resolved = resolveRect(o, resolved, e.radius);
    }
  }

  // Soft separation so squadmates and enemies do not stack into one silhouette.
  for (const other of world.entities) {
    if (other === e || !other.alive || other.downed) continue;
    const d = dist(resolved, other.pos);
    const minD = e.radius + other.radius;
    if (d > 1e-4 && d < minD) {
      const push = scale(norm(sub(resolved, other.pos)), (minD - d) * 0.5);
      resolved = add(resolved, push);
    }
  }

  e.vel = scale(sub(resolved, e.pos), dt > 0 ? 1 / dt : 0);
  e.pos = resolved;
  return e.pos;
}

/** Nearest point outside all obstacles — used to sanitise authored spawns. */
export function nudgeOntoPlane(world, pos, radius) {
  let p = clone(pos);
  for (let pass = 0; pass < 3; pass++) {
    for (const o of world.level.obstacles) {
      if (rectContains(o, p, radius)) p = resolveRect(o, p, radius);
    }
  }
  const b = world.level.bounds;
  p.x = clamp(p.x, b.x - b.w / 2 + radius, b.x + b.w / 2 - radius);
  p.z = clamp(p.z, b.z - b.d / 2 + radius, b.z + b.d / 2 - radius);
  return p;
}

// ---------------------------------------------------------------- statuses

export function applyStatus(world, e, status) {
  const existing = e.statuses.find((s) => s.id === status.id);
  if (existing) {
    existing.t = 0;
    existing.duration = Math.max(existing.duration, status.duration);
    return existing;
  }
  const s = { ...status, t: 0 };
  e.statuses.push(s);
  world.bus?.emit('status.applied', { id: e.id, status: s.id, duration: s.duration });
  return s;
}

export const hasStatus = (e, id) => e.statuses.some((s) => s.id === id);

export function updateStatuses(world, e, dt, onDamage) {
  for (let i = e.statuses.length - 1; i >= 0; i--) {
    const s = e.statuses[i];
    s.t += dt;
    if (s.dps) onDamage?.(s.dps * dt, s);
    if (s.t >= s.duration) {
      e.statuses.splice(i, 1);
      world.bus?.emit('status.expired', { id: e.id, status: s.id });
    }
  }
}

// ------------------------------------------------------------------- cover

/** Refresh each actor's cover flag against its most relevant threat. */
export function updateCoverState(world) {
  for (const e of world.entities) {
    if (!e.alive) {
      e.inCover = false;
      e.coverId = null;
      continue;
    }
    const threat = e.aiThreat ?? nearestHostile(world, e, 40);
    if (!threat) {
      e.inCover = false;
      e.coverId = null;
      continue;
    }
    const c = coverAgainst(world.level, e.pos, threat.pos);
    e.inCover = c.inCover;
    e.coverId = c.obstacle?.id ?? null;
  }
}

/** Distance from an actor to the nearest low obstacle it could take cover behind. */
export function nearestCoverDistance(world, e) {
  let best = Infinity;
  for (const o of world.level.obstacles) {
    if (o.height !== 'low') continue;
    best = Math.min(best, dist(rectClosestPoint(o, e.pos), e.pos));
  }
  return best;
}

// ----------------------------------------------------------------- helpers

export const moveOf = (id) => MOVES[id];

export function setCooldown(e, moveId, seconds) {
  e.cooldowns[moveId] = seconds;
}

export function tickCooldowns(e, dt) {
  for (const k of Object.keys(e.cooldowns)) {
    e.cooldowns[k] -= dt;
    if (e.cooldowns[k] <= 0) delete e.cooldowns[k];
  }
}

export const isOnCooldown = (e, moveId) => (e.cooldowns[moveId] ?? 0) > 0;

/** Serializable snapshot for saves and deterministic test fixtures. */
export function snapshotWorld(world) {
  return {
    time: world.time,
    seed: world.seed,
    rngState: world.rng.getState(),
    flags: JSON.parse(JSON.stringify(world.flags)),
    entities: world.entities.map((e) => ({
      id: e.id,
      defId: e.defId,
      pos: clone(e.pos),
      facing: e.facing,
      hp: e.hp,
      posture: e.posture,
      alive: e.alive,
      downed: e.downed,
      action: e.action ? { moveId: e.action.moveId, t: e.action.t } : null,
      mag: e.mag,
      reserve: e.reserve,
      relic: e.relic ? { ...e.relic } : undefined,
      statuses: e.statuses.map((s) => ({ id: s.id, t: s.t, duration: s.duration })),
      aiState: e.ai?.state ?? null,
    })),
  };
}
