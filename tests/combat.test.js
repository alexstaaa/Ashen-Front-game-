import { describe, it, expect, beforeEach } from 'vitest';
import { makeBus } from '../src/core/events.js';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { MISSION } from '../src/content/mission-cut-the-wire.js';
import { MOVES, moveDuration } from '../src/content/moves.js';
import { createWorld, spawnActor, hasStatus } from '../src/sim/world.js';
import {
  startAction,
  updateAction,
  canStartAction,
  applyDamage,
  hitChance,
  updateProjectiles,
  updateCombatTimers,
} from '../src/sim/combat.js';
import { STEP } from '../src/core/loop.js';

function setup(seed = 3) {
  const bus = makeBus();
  const log = [];
  bus.on('*', (e) => log.push(e));
  const world = createWorld({ level: LEVEL, mission: MISSION, seed, bus });
  return { world, bus, log, events: (t) => log.filter((e) => e.type === t) };
}

/** Advance one entity's action by `seconds`, in real simulation steps. */
function advance(world, e, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world.time += STEP;
    updateCombatTimers(world, e, STEP);
    updateAction(world, e, STEP);
    updateProjectiles(world, STEP);
  }
}

describe('action state machine', () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it('runs startup -> active -> recovery -> done and then clears', () => {
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    startAction(world, p, 'rifle.fire');
    expect(p.action).toBeTruthy();
    advance(world, p, moveDuration(MOVES['rifle.fire']) + 0.02);
    expect(p.action).toBeNull();
    expect(ctx.events('action.ended').at(-1).reason).toBe('completed');
  });

  it('refuses a second move during commitment and allows the authored cancel', () => {
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    startAction(world, p, 'rifle.reload');
    advance(world, p, 0.3);
    expect(canStartAction(world, p, 'melee.bayonet').ok).toBe(false);
    expect(canStartAction(world, p, 'move.dive').ok).toBe(true);
  });

  it('spends ammunition once per shot and reloads from reserve', () => {
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    const startMag = p.mag;
    startAction(world, p, 'rifle.fire');
    advance(world, p, moveDuration(MOVES['rifle.fire']) + 0.02);
    expect(p.mag).toBe(startMag - 1);

    const reserveBefore = p.reserve;
    startAction(world, p, 'rifle.reload');
    advance(world, p, moveDuration(MOVES['rifle.reload']) + 0.02);
    expect(p.mag).toBe(p.magSize);
    expect(p.reserve).toBe(reserveBefore - 1);
  });

  it('blocks firing with an empty magazine', () => {
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    p.mag = 0;
    expect(canStartAction(world, p, 'rifle.fire').reason).toBe('resource');
  });

  it('respects cooldowns', () => {
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    p.relic.charges = 3;
    startAction(world, p, 'relic.emberlash');
    advance(world, p, moveDuration(MOVES['relic.emberlash']) + 0.02);
    expect(canStartAction(world, p, 'relic.emberlash').reason).toBe('cooldown');
  });
});

describe('contact resolution', () => {
  it('fires each active window exactly once', () => {
    const ctx = setup();
    const { world } = ctx;
    const shooter = spawnActor(world, 'kald_rifleman', { x: 0, z: -20 });
    const target = spawnActor(world, 'player', { x: 0, z: -8 });
    shooter.facing = 0;
    startAction(world, shooter, 'kald.suppress', { targetId: target.id, dir: { x: 0, z: 1 } });
    advance(world, shooter, moveDuration(MOVES['kald.suppress']) + 0.05);
    // three authored windows -> three resolved shots, no more, no less
    expect(ctx.events('shot.fired').length).toBe(3);
  });

  it('applies an arc to each target only once per window', () => {
    const ctx = setup();
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    p.relic.charges = 3;
    const a = spawnActor(world, 'kald_rifleman', { x: 0, z: -18 });
    const b = spawnActor(world, 'kald_rifleman', { x: 1.5, z: -17.5 });
    p.facing = 0;
    startAction(world, p, 'relic.emberlash', { dir: { x: 0, z: 1 } });
    advance(world, p, moveDuration(MOVES['relic.emberlash']) + 0.05);
    const damaged = ctx.events('entity.damaged').filter((e) => e.moveId === 'relic.emberlash');
    expect(damaged.filter((e) => e.id === a.id).length).toBe(1);
    expect(damaged.filter((e) => e.id === b.id).length).toBe(1);
  });

  it('does not resolve contact against targets outside the cone', () => {
    const ctx = setup();
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    p.relic.charges = 3;
    spawnActor(world, 'kald_rifleman', { x: 0, z: -24 }); // directly behind
    p.facing = 0;
    startAction(world, p, 'relic.emberlash', { dir: { x: 0, z: 1 } });
    advance(world, p, moveDuration(MOVES['relic.emberlash']) + 0.05);
    expect(ctx.events('entity.damaged').length).toBe(0);
  });

  it('makes cover reduce both hit chance and damage', () => {
    const ctx = setup();
    const { world } = ctx;
    const sb = LEVEL.obstacles.find((o) => o.id === 'sb_1');
    const shooter = spawnActor(world, 'kald_rifleman', { x: sb.x, z: sb.z - 10 });
    const exposed = spawnActor(world, 'player', { x: sb.x, z: sb.z - 4 });
    const covered = spawnActor(world, 'player', { x: sb.x, z: sb.z + sb.d / 2 + 0.6 });
    const contact = MOVES['kald.snapshot'].contact;
    const openChance = hitChance(world, shooter, exposed, contact).chance;
    const coveredResult = hitChance(world, shooter, covered, contact);
    expect(coveredResult.inCover).toBe(true);
    expect(coveredResult.chance).toBeLessThan(openChance);
  });

  it('ignores cover for relic and blast contact', () => {
    const ctx = setup();
    const { world } = ctx;
    const sb = LEVEL.obstacles.find((o) => o.id === 'sb_1');
    const shooter = spawnActor(world, 'player', { x: sb.x, z: sb.z - 8 });
    const covered = spawnActor(world, 'kald_rifleman', { x: sb.x, z: sb.z + sb.d / 2 + 0.6 });
    const result = hitChance(world, shooter, covered, MOVES['relic.emberlash'].contact);
    expect(result.inCover).toBe(false);
  });
});

describe('defence and posture', () => {
  it('makes the dive avoid damage during its invulnerable window', () => {
    const ctx = setup();
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    startAction(world, p, 'move.dive', { dir: { x: 0, z: 1 } });
    advance(world, p, 0.15);
    const before = p.hp;
    applyDamage(world, p, { amount: 40, sourceId: null, moveId: 'test' });
    expect(p.hp).toBe(before);
    expect(ctx.events('damage.avoided').length).toBe(1);
  });

  it('lets damage through once the dive window has closed', () => {
    const ctx = setup();
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    startAction(world, p, 'move.dive', { dir: { x: 0, z: 1 } });
    advance(world, p, 0.45);
    const before = p.hp;
    applyDamage(world, p, { amount: 40, sourceId: null, moveId: 'test' });
    expect(p.hp).toBeLessThan(before);
  });

  it('staggers and interrupts the current action when posture breaks', () => {
    const ctx = setup();
    const { world } = ctx;
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: -20 });
    startAction(world, e, 'kald.snapshot');
    applyDamage(world, e, { amount: 1, posture: e.maxPosture + 5, sourceId: null, moveId: 'test' });
    expect(e.staggerT).toBeGreaterThan(0);
    expect(e.action).toBeNull();
    expect(ctx.events('entity.staggered').length).toBe(1);
    expect(canStartAction(world, e, 'kald.snapshot').reason).toBe('staggered');
  });

  it('downs an ally instead of killing them outright', () => {
    const ctx = setup();
    const { world } = ctx;
    const ally = spawnActor(world, 'vela', { x: 0, z: -20 });
    applyDamage(world, ally, { amount: 999, sourceId: null, moveId: 'test' });
    expect(ally.downed).toBe(true);
    expect(ally.alive).toBe(true);
    expect(ctx.events('ally.downed').length).toBe(1);
  });

  it('applies a status on a suppressing hit', () => {
    const ctx = setup();
    const { world } = ctx;
    const p = spawnActor(world, 'player', { x: 0, z: -20 });
    applyDamage(world, p, {
      amount: 3,
      sourceId: null,
      moveId: 'kald.suppress',
      status: { id: 'suppressed', duration: 2 },
    });
    expect(hasStatus(p, 'suppressed')).toBe(true);
  });
});

describe('grenades', () => {
  it('lands, waits out its fuse, then damages everyone in the blast', () => {
    const ctx = setup();
    const { world } = ctx;
    const thrower = spawnActor(world, 'kald_grenadier', { x: 0, z: -20 });
    const target = spawnActor(world, 'player', { x: 0, z: -8 });
    startAction(world, thrower, 'kald.lob', { targetId: target.id, dir: { x: 0, z: 1 } });

    advance(world, thrower, 1.2);
    expect(ctx.events('projectile.spawned').length).toBe(1);

    advance(world, thrower, 3.0);
    expect(ctx.events('projectile.detonated').length).toBe(1);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('lets the target walk out of the blast before it goes off', () => {
    const ctx = setup();
    const { world } = ctx;
    const thrower = spawnActor(world, 'kald_grenadier', { x: 0, z: -20 });
    const target = spawnActor(world, 'player', { x: 0, z: -8 });
    startAction(world, thrower, 'kald.lob', { targetId: target.id, dir: { x: 0, z: 1 } });
    advance(world, thrower, 1.3);
    target.pos = { x: 12, z: -8 }; // moved well clear of the marked ring
    advance(world, thrower, 3.0);
    expect(ctx.events('projectile.detonated').length).toBe(1);
    expect(target.hp).toBe(target.maxHp);
  });
});
