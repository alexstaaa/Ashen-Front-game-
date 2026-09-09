/**
 * Combat. Every verb is an explicit state machine over the authored move table,
 * and every outcome comes from an authoritative geometric contact test — never
 * from an animation, a particle, or a guess about what looked like a hit.
 *
 * Contract:
 *   - a move fires each active window exactly once
 *   - a single window may hit a given target at most once
 *   - visuals are emitted as events *after* the outcome is already resolved
 */
import { MOVES, moveDuration, movePhase, isInvulnerable } from '../content/moves.js';
import { RELICS } from '../content/relics.js';
import {
  angleDelta,
  angleOf,
  clamp,
  dist,
  len,
  lerp,
  norm,
  scale,
  sub,
  add,
  clone,
} from '../core/math2.js';
import { coverAgainst, hasLineOfSight, COVER_HIT_MULTIPLIER, COVER_DAMAGE_MULTIPLIER } from './cover.js';
import {
  applyStatus,
  emitNoise,
  entitiesInRadius,
  hasStatus,
  isHostile,
  isOnCooldown,
  setCooldown,
  socketPos,
} from './world.js';

export const MIN_HIT_CHANCE = 0.03;
export const MAX_HIT_CHANCE = 0.97;

// --------------------------------------------------------------- resources

function resourceAvailable(e, move) {
  const cost = move.cost;
  if (!cost) return true;
  if (cost.ammo != null && e.mag < cost.ammo) return false;
  if (cost.relic != null && (e.relic?.charges ?? 0) < cost.relic) return false;
  return true;
}

function spendResources(world, e, move) {
  const cost = move.cost;
  if (!cost) return;
  if (cost.ammo != null) {
    e.mag -= cost.ammo;
    world.bus?.emit('ammo.changed', { id: e.id, mag: e.mag, reserve: e.reserve });
  }
  if (cost.relic != null && e.relic) {
    e.relic.charges -= cost.relic;
    world.flags.attunement += move.attunement ?? 0;
    world.bus?.emit('relic.used', {
      id: e.id,
      charges: e.relic.charges,
      attunement: world.flags.attunement,
    });
  }
}

// ------------------------------------------------------------------ action

export function canStartAction(world, e, moveId) {
  const move = MOVES[moveId];
  if (!move) return { ok: false, reason: 'unknown-move' };
  if (!e.alive || e.downed) return { ok: false, reason: 'dead' };
  if (e.staggerT > 0) return { ok: false, reason: 'staggered' };
  if (isOnCooldown(e, moveId)) return { ok: false, reason: 'cooldown' };
  if (!resourceAvailable(e, move)) return { ok: false, reason: 'resource' };
  if (e.action) {
    const current = e.action.move;
    const past = e.action.t >= (current.minCommit ?? current.startup);
    const allowed = current.cancelableBy?.includes(moveId);
    if (!(past && allowed)) return { ok: false, reason: 'busy' };
  }
  return { ok: true, move };
}

export function startAction(world, e, moveId, opts = {}) {
  const check = canStartAction(world, e, moveId);
  if (!check.ok) {
    world.bus?.emit('action.rejected', { id: e.id, moveId, reason: check.reason });
    return null;
  }
  const move = check.move;
  spendResources(world, e, move);
  setCooldown(e, moveId, move.cooldown ?? 0);

  const aimDir = opts.dir ?? { x: Math.sin(e.facing), z: Math.cos(e.facing) };
  e.action = {
    moveId,
    move,
    t: 0,
    firedWindows: new Set(),
    hits: new Set(),
    targetId: opts.targetId ?? null,
    dir: norm(aimDir),
    origin: clone(e.pos),
  };
  world.bus?.emit('action.started', {
    id: e.id,
    moveId,
    telegraph: move.telegraph ?? null,
    duration: moveDuration(move),
    fx: move.fx ?? null,
  });
  return e.action;
}

export function cancelAction(world, e, reason = 'cancelled') {
  if (!e.action) return;
  const moveId = e.action.moveId;
  e.action = null;
  world.bus?.emit('action.ended', { id: e.id, moveId, reason });
}

/** Movement/turn restrictions imposed by the action currently running. */
export function actionMotion(e) {
  if (!e.action) return { speedMul: 1, turnSpeed: null, impulse: 0 };
  const m = e.action.move;
  const phase = movePhase(m, e.action.t);
  let impulse = 0;
  if (m.impulse && phase !== 'recovery' && e.action.t < (m.invuln?.[1] ?? m.startup)) {
    impulse = m.impulse;
  }
  if (m.lungeSpeed && phase === 'startup') impulse = m.lungeSpeed;
  return { speedMul: m.moveSpeedMul ?? 1, turnSpeed: m.turnSpeed ?? null, impulse };
}

export function updateAction(world, e, dt) {
  const a = e.action;
  if (!a) return;
  const move = a.move;
  const prevT = a.t;
  a.t += dt;

  e.invulnT = isInvulnerable(move, a.t) ? Math.max(e.invulnT, dt) : Math.max(0, e.invulnT - dt);

  const windows = move.windows ?? [];
  for (let i = 0; i < windows.length; i++) {
    const [from] = windows[i];
    if (prevT < from && a.t >= from && !a.firedWindows.has(i)) {
      a.firedWindows.add(i);
      fireContact(world, e, a, i);
    }
  }

  if (a.t >= moveDuration(move)) {
    if (move.onComplete === 'reload') doReload(world, e);
    const moveId = a.moveId;
    e.action = null;
    world.bus?.emit('action.ended', { id: e.id, moveId, reason: 'completed' });
  }
}

function doReload(world, e) {
  const needed = e.magSize - e.mag;
  const taken = Math.min(needed, e.reserve);
  e.mag += taken;
  e.reserve -= taken;
  world.bus?.emit('ammo.changed', { id: e.id, mag: e.mag, reserve: e.reserve, reloaded: true });
}

// ----------------------------------------------------------------- contact

function fireContact(world, e, action, windowIndex) {
  const contact = action.move.contact;
  if (!contact) return;
  if (contact.type === 'hitscan') return resolveHitscan(world, e, action, windowIndex);
  if (contact.type === 'arc') return resolveArc(world, e, action, windowIndex);
  if (contact.type === 'projectile') return spawnProjectile(world, e, action);
}

/** Everything that modifies a shot's chance to land, in one auditable place. */
export function hitChance(world, shooter, target, contact) {
  let acc = contact.accuracy ?? 1;
  const d = dist(shooter.pos, target.pos);

  if (contact.falloffStart != null && d > contact.falloffStart) {
    const t = clamp((d - contact.falloffStart) / Math.max(0.001, contact.range - contact.falloffStart), 0, 1);
    acc *= lerp(1, contact.falloffMul ?? 1, t);
  }

  const cover = contact.ignoresCover
    ? { inCover: false }
    : coverAgainst(world.level, target.pos, shooter.pos);
  if (cover.inCover) acc *= COVER_HIT_MULTIPLIER;

  if (hasStatus(shooter, 'suppressed')) acc *= 0.62;
  if (len(target.vel) > 2.5) acc *= 0.86;
  if (shooter.accuracyMul != null) acc *= shooter.accuracyMul;

  return {
    chance: clamp(acc, MIN_HIT_CHANCE, MAX_HIT_CHANCE),
    inCover: !!cover.inCover,
    distance: d,
  };
}

/** Targets inside a cone, sorted by how central they are to the aim direction. */
export function coneTargets(world, shooter, action, contact, { requireLos = true } = {}) {
  const half = ((contact.coneDeg ?? 360) * Math.PI) / 360;
  const aim = angleOf(action.dir);
  const out = [];
  for (const other of world.entities) {
    if (other === shooter || !other.alive) continue;
    if (other.kind === 'civilian') continue; // civilians are never auto-targeted
    if (!isHostile(shooter, other)) continue;
    const to = sub(other.pos, shooter.pos);
    const d = len(to);
    if (d > contact.range + other.radius) continue;
    const off = Math.abs(angleDelta(aim, angleOf(to)));
    // Wide bodies are forgiving at close range, as they look on screen.
    const slack = Math.atan2(other.radius, Math.max(0.5, d));
    if (off > half + slack) continue;
    if (requireLos && !hasLineOfSight(world.level, shooter.pos, other.pos, -0.15)) continue;
    out.push({ entity: other, distance: d, offAxis: off });
  }
  out.sort((a, b) => a.offAxis - b.offAxis || a.distance - b.distance);
  return out;
}

function resolveHitscan(world, shooter, action, windowIndex) {
  const contact = action.move.contact;
  const explicit = action.targetId ? world.byId.get(action.targetId) : null;
  let target = null;

  if (explicit && explicit.alive && dist(shooter.pos, explicit.pos) <= contact.range) {
    if (hasLineOfSight(world.level, shooter.pos, explicit.pos, -0.15)) target = explicit;
  }
  if (!target) target = coneTargets(world, shooter, action, contact)[0]?.entity ?? null;

  const from = socketPos(shooter, 'muzzle');
  // A rifle is loud whether or not it hits anything.
  emitNoise(world, shooter.pos, { sourceId: shooter.id });

  if (!target) {
    world.bus?.emit('shot.fired', {
      id: shooter.id,
      moveId: action.moveId,
      from,
      to: add(shooter.pos, scale(action.dir, contact.range)),
      hit: false,
      reason: 'no-target',
    });
    return;
  }

  const key = `${windowIndex}:${target.id}`;
  if (action.hits.has(key)) return;
  action.hits.add(key);

  const { chance, inCover } = hitChance(world, shooter, target, contact);
  const roll = world.rng.next();
  const hit = roll < chance;

  world.bus?.emit('shot.fired', {
    id: shooter.id,
    targetId: target.id,
    moveId: action.moveId,
    from,
    to: clone(target.pos),
    hit,
    chance,
    inCover,
  });

  if (!hit) {
    world.bus?.emit('shot.missed', { id: shooter.id, targetId: target.id, inCover });
    if (contact.status) applyStatus(world, target, { ...contact.status });
    return;
  }

  const damageMul = inCover ? COVER_DAMAGE_MULTIPLIER : 1;
  applyDamage(world, target, {
    amount: contact.damage * damageMul,
    posture: contact.posture ?? 0,
    sourceId: shooter.id,
    moveId: action.moveId,
    status: contact.status,
    dir: norm(sub(target.pos, shooter.pos)),
  });
}

function resolveArc(world, attacker, action, windowIndex) {
  const contact = action.move.contact;
  const targets = coneTargets(world, attacker, action, contact, {
    requireLos: !contact.ignoresCover,
  });
  let applied = 0;
  for (const { entity: target } of targets) {
    if (applied >= (contact.maxTargets ?? 1)) break;
    const key = `${windowIndex}:${target.id}`;
    if (action.hits.has(key)) continue;
    action.hits.add(key);
    applied++;

    const cover = contact.ignoresCover
      ? { inCover: false }
      : coverAgainst(world.level, target.pos, attacker.pos);
    applyDamage(world, target, {
      amount: contact.damage * (cover.inCover ? COVER_DAMAGE_MULTIPLIER : 1),
      posture: contact.posture ?? 0,
      sourceId: attacker.id,
      moveId: action.moveId,
      knockback: contact.knockback ?? 0,
      status: contact.status,
      dir: norm(sub(target.pos, attacker.pos)),
    });
  }
  world.bus?.emit('arc.swung', {
    id: attacker.id,
    moveId: action.moveId,
    origin: clone(attacker.pos),
    dir: clone(action.dir),
    range: contact.range,
    coneDeg: contact.coneDeg,
    hits: applied,
  });
}

// ------------------------------------------------------------- projectiles

function spawnProjectile(world, thrower, action) {
  const spec = action.move.contact.projectile;
  const target = action.targetId ? world.byId.get(action.targetId) : null;
  // Thrown at where you are when the arm comes forward — moving is the answer.
  const aimPoint = target ? clone(target.pos) : add(thrower.pos, scale(action.dir, 12));

  const p = {
    id: world.nextId++,
    ownerId: thrower.id,
    kind: 'grenade',
    pos: clone(thrower.pos),
    target: aimPoint,
    t: 0,
    flightTime: Math.max(0.25, dist(thrower.pos, aimPoint) / spec.speed),
    fuse: spec.fuse,
    spec,
    landed: false,
  };
  world.projectiles.push(p);
  world.bus?.emit('projectile.spawned', {
    projectileId: p.id,
    ownerId: thrower.id,
    from: clone(thrower.pos),
    to: clone(aimPoint),
    flightTime: p.flightTime,
    fuse: spec.fuse,
    blastRadius: spec.blastRadius,
  });
  return p;
}

export function updateProjectiles(world, dt) {
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    p.t += dt;
    if (!p.landed) {
      const k = clamp(p.t / p.flightTime, 0, 1);
      p.pos = {
        x: lerp(p.pos.x, p.target.x, k),
        z: lerp(p.pos.z, p.target.z, k),
      };
      if (p.t >= p.flightTime) {
        p.landed = true;
        p.pos = clone(p.target);
        p.fuseT = 0;
        world.bus?.emit('projectile.landed', {
          projectileId: p.id,
          pos: clone(p.pos),
          fuse: p.fuse,
          blastRadius: p.spec.blastRadius,
        });
      }
      continue;
    }

    p.fuseT += dt;
    if (p.fuseT >= p.fuse) {
      detonate(world, p);
      world.projectiles.splice(i, 1);
    }
  }
}

function detonate(world, p) {
  const spec = p.spec;
  emitNoise(world, p.pos, { radius: 60, sourceId: p.ownerId });
  world.bus?.emit('projectile.detonated', {
    projectileId: p.id,
    pos: clone(p.pos),
    blastRadius: spec.blastRadius,
  });
  const caught = entitiesInRadius(world, p.pos, spec.blastRadius, (e) => e.alive);
  for (const e of caught) {
    if (e.id === p.ownerId) continue;
    const d = dist(e.pos, p.pos);
    // Falls off to a third at the rim, so the edge of the ring is survivable.
    const falloff = lerp(1, 0.33, clamp(d / spec.blastRadius, 0, 1));
    applyDamage(world, e, {
      amount: spec.damage * falloff,
      posture: (spec.posture ?? 0) * falloff,
      sourceId: p.ownerId,
      moveId: 'kald.lob',
      knockback: 2.5 * falloff,
      dir: norm(sub(e.pos, p.pos)),
      ignoresCover: true,
      viaBlast: true,
    });
  }
}

// ------------------------------------------------------------------ damage

export function applyDamage(world, target, opts) {
  if (!target.alive) return { applied: 0, avoided: true };
  if (target.invulnT > 0 && !opts.viaBlast) {
    world.bus?.emit('damage.avoided', {
      id: target.id,
      sourceId: opts.sourceId,
      reason: 'invulnerable',
    });
    return { applied: 0, avoided: true };
  }

  const amount = Math.max(0, opts.amount ?? 0);
  target.hp = Math.max(0, target.hp - amount);
  target.lastHitTime = world.time;

  if (opts.posture) {
    target.posture -= opts.posture;
    if (target.posture <= 0) stagger(world, target, opts);
  }
  if (opts.status) applyStatus(world, target, { ...opts.status });
  if (opts.knockback && opts.dir) {
    target.pos = add(target.pos, scale(opts.dir, opts.knockback * 0.35));
  }

  world.bus?.emit('entity.damaged', {
    id: target.id,
    sourceId: opts.sourceId,
    moveId: opts.moveId,
    amount,
    hp: target.hp,
    maxHp: target.maxHp,
    kind: target.kind,
    viaBlast: !!opts.viaBlast,
  });

  if (target.hp <= 0) defeat(world, target, opts);
  return { applied: amount, avoided: false };
}

export function stagger(world, e, opts = {}) {
  const time = e.def.ai?.staggerTime ?? 0.8;
  e.posture = e.maxPosture;
  e.staggerT = time;
  if (e.action) cancelAction(world, e, 'staggered');
  world.bus?.emit('entity.staggered', { id: e.id, sourceId: opts.sourceId, duration: time });
}

function defeat(world, e, opts) {
  // Allies go down rather than die, so losing one is a decision, not an event.
  if (e.kind === 'ally' && !e.downed) {
    e.downed = true;
    e.downedT = 0;
    e.hp = 0;
    if (e.action) cancelAction(world, e, 'downed');
    world.bus?.emit('ally.downed', { id: e.id, name: e.name });
    return;
  }

  e.alive = false;
  e.hp = 0;
  if (e.action) cancelAction(world, e, 'defeated');
  if (e.ai) e.ai.state = 'defeated';

  world.bus?.emit('entity.killed', {
    id: e.id,
    defId: e.defId,
    kind: e.kind,
    faction: e.faction,
    sourceId: opts?.sourceId,
    viaBlast: !!opts?.viaBlast,
    pos: clone(e.pos),
  });

  if (e.kind === 'civilian') {
    world.flags.civiliansAlive = Math.max(0, world.flags.civiliansAlive - 1);
    world.bus?.emit('civilian.killed', { id: e.id, sourceId: opts?.sourceId });
    return;
  }

  if (e.kind === 'enemy') {
    world.flags.kills++;
    const reward = e.def.reward ?? {};
    const player = world.player;
    if (reward.relicCharge && player?.relic) {
      player.relic.pending = (player.relic.pending ?? 0) + reward.relicCharge;
      while (player.relic.pending >= 1 && player.relic.charges < player.relic.max) {
        player.relic.pending -= 1;
        player.relic.charges++;
        world.bus?.emit('relic.charged', { charges: player.relic.charges });
      }
    }
    world.bus?.emit('enemy.defeated', { id: e.id, defId: e.defId, reward });
  }
}

/** Per-step upkeep that is not tied to any single move. */
export function updateCombatTimers(world, e, dt) {
  if (e.staggerT > 0) {
    e.staggerT = Math.max(0, e.staggerT - dt);
    if (e.staggerT === 0) world.bus?.emit('entity.recovered', { id: e.id });
  }
  if (e.invulnT > 0 && !e.action) e.invulnT = Math.max(0, e.invulnT - dt);

  // Posture recovers only when nothing has touched you for a moment.
  const calm = world.time - e.lastHitTime > 1.6;
  if (calm && e.posture < e.maxPosture && e.staggerT === 0) {
    const regen = e.def.postureRegen ?? 12;
    e.posture = Math.min(e.maxPosture, e.posture + regen * dt);
  }
}

export const relicOf = (e) => (e.relic ? RELICS[e.relic.id] : null);
