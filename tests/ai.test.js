import { describe, it, expect } from 'vitest';
import { makeBus } from '../src/core/events.js';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { MISSION } from '../src/content/mission-cut-the-wire.js';
import { createWorld, spawnActor, emitNoise, TEAMS } from '../src/sim/world.js';
import { initAi, updateEnemyAi, applyCommitmentCap, legalMoves, AI_STATES } from '../src/sim/ai.js';
import { updateAction, updateCombatTimers, applyDamage } from '../src/sim/combat.js';
import { STEP } from '../src/core/loop.js';

function setup(seed = 11) {
  const bus = makeBus();
  const log = [];
  bus.on('*', (e) => log.push(e));
  const world = createWorld({ level: LEVEL, mission: MISSION, seed, bus });
  return { world, log, events: (t) => log.filter((e) => e.type === t) };
}

function tick(world, entities, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    world.time += STEP;
    for (const e of entities) {
      updateCombatTimers(world, e, STEP);
      for (const k of Object.keys(e.cooldowns)) {
        e.cooldowns[k] -= STEP;
        if (e.cooldowns[k] <= 0) delete e.cooldowns[k];
      }
      if (e.action) updateAction(world, e, STEP);
    }
    for (const e of entities) {
      if (e.ai && e.alive) updateEnemyAi(world, e, STEP);
    }
  }
}

describe('enemy ai', () => {
  it('idles with no target in sight', () => {
    const { world } = setup();
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: 0 }, { team: TEAMS.kaldreich });
    initAi(e);
    tick(world, [e], 1);
    expect(e.ai.state).toBe('idle');
    expect(AI_STATES).toContain(e.ai.state);
  });

  it('acquires a visible target and commits to a telegraphed attack', () => {
    const ctx = setup();
    const { world } = ctx;
    const player = spawnActor(world, 'player', { x: 0, z: -20 }, { team: TEAMS.marches });
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: -34 }, { team: TEAMS.kaldreich });
    initAi(e);
    tick(world, [e], 2.5);
    expect(ctx.events('ai.acquired').length).toBeGreaterThan(0);
    expect(ctx.events('action.started').length).toBeGreaterThan(0);
    const started = ctx.events('action.started')[0];
    expect(started.telegraph).toBeTruthy();
    expect(player.hp).toBeLessThanOrEqual(player.maxHp);
  });

  it('drops to the stagger state and starts nothing while staggered', () => {
    const ctx = setup();
    const { world } = ctx;
    spawnActor(world, 'player', { x: 0, z: -20 }, { team: TEAMS.marches });
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: -30 }, { team: TEAMS.kaldreich });
    initAi(e);
    tick(world, [e], 0.5);
    applyDamage(world, e, { amount: 1, posture: 999, sourceId: null, moveId: 'test' });
    const startedBefore = ctx.events('action.started').length;
    tick(world, [e], 0.4);
    expect(e.ai.state).toBe('stagger');
    expect(ctx.events('action.started').length).toBe(startedBefore);
  });

  it('offers only moves that are legal for the current range', () => {
    const { world } = setup();
    const player = spawnActor(world, 'player', { x: 0, z: -20 }, { team: TEAMS.marches });
    const e = spawnActor(world, 'kald_grenadier', { x: 0, z: -21.5 }, { team: TEAMS.kaldreich });
    initAi(e);
    const close = legalMoves(world, e, player).map((m) => m.id);
    expect(close).toContain('kald.bash');
    expect(close).not.toContain('kald.lob'); // too close to lob

    e.pos = { x: 0, z: -32 };
    const far = legalMoves(world, e, player).map((m) => m.id);
    expect(far).toContain('kald.lob');
    expect(far).not.toContain('kald.bash');
  });

  it('caps how many attackers may be committed at once', () => {
    const ctx = setup();
    const { world } = ctx;
    spawnActor(world, 'player', { x: 0, z: -20 }, { team: TEAMS.marches });
    const squad = [];
    for (let i = 0; i < 4; i++) {
      const e = spawnActor(world, 'kald_rifleman', { x: -6 + i * 4, z: -32 }, { team: TEAMS.kaldreich });
      initAi(e);
      squad.push(e);
    }
    const steps = Math.round(4 / STEP);
    let worstCase = 0;
    for (let i = 0; i < steps; i++) {
      applyCommitmentCap(world, squad, 1);
      tick(world, squad, STEP);
      const committed = squad.filter((e) => e.action && e.action.move.contact).length;
      worstCase = Math.max(worstCase, committed);
    }
    expect(worstCase).toBeLessThanOrEqual(1);
  });

  it('investigates gunfire it cannot see, instead of standing at its spawn', () => {
    const ctx = setup();
    const { world } = ctx;
    // The wrecked truck is a full-height wall; put the enemy behind it.
    const truck = LEVEL.obstacles.find((o) => o.id === 'truck');
    const player = spawnActor(world, 'player', { x: 4, z: -6 }, { team: TEAMS.marches });
    const e = spawnActor(
      world,
      'kald_rifleman',
      { x: truck.x - 2, z: truck.z + 2 },
      { team: TEAMS.kaldreich },
    );
    initAi(e, { leash: { center: { x: 0, z: 1 }, radius: 26 } });

    tick(world, [e], 1.0);
    expect(e.ai.state, 'starts blind and idle').toBe('idle');
    const startDistance = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);

    // Somebody fires near the player; the enemy should go and look.
    emitNoise(world, player.pos, { sourceId: player.id });
    tick(world, [e], 2.5);

    expect(ctx.events('ai.alerted').length).toBeGreaterThan(0);
    const endDistance = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
    expect(endDistance).toBeLessThan(startDistance - 1);
  });

  it('ignores noise outside its leash', () => {
    const ctx = setup();
    const { world } = ctx;
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: 0 }, { team: TEAMS.kaldreich });
    initAi(e, { leash: { center: { x: 0, z: 0 }, radius: 6 } });
    emitNoise(world, { x: 0, z: 25 }, { sourceId: 999 });
    tick(world, [e], 1.5);
    expect(ctx.events('ai.alerted').length).toBe(0);
  });

  it('does not chase beyond its leash', () => {
    const ctx = setup();
    const { world } = ctx;
    const player = spawnActor(world, 'player', { x: 0, z: -20 }, { team: TEAMS.marches });
    const e = spawnActor(world, 'kald_rifleman', { x: 0, z: 0 }, { team: TEAMS.kaldreich });
    initAi(e, { leash: { center: { x: 0, z: 0 }, radius: 6 } });
    tick(world, [e], 6);
    const drift = Math.hypot(e.pos.x - 0, e.pos.z - 0);
    expect(drift).toBeLessThanOrEqual(9); // leash radius plus a step of overshoot
    expect(player.alive).toBe(true);
  });
});
