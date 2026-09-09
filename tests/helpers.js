/**
 * Headless harness. The whole simulation runs without a renderer or a browser,
 * which is what makes deterministic fixtures possible.
 */
import { makeBus } from '../src/core/events.js';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { MISSION } from '../src/content/mission-cut-the-wire.js';
import { createWorld, spawnActor } from '../src/sim/world.js';
import { createMissionRuntime, populateMission, stepMission } from '../src/sim/mission.js';
import { createPlayerControl, updatePlayer } from '../src/sim/player.js';
import { STEP } from '../src/core/loop.js';

export { STEP };

export function makeHarness({ seed = 7, civilians = true } = {}) {
  const bus = makeBus();
  const log = [];
  bus.on('*', (e) => log.push(e));

  const world = createWorld({ level: LEVEL, mission: MISSION, seed, bus });
  const runtime = createMissionRuntime(world, MISSION);
  const { player, ally } = populateMission(world, runtime, { spawnCivilians: civilians });
  const control = createPlayerControl();

  const harness = {
    world,
    runtime,
    bus,
    log,
    player,
    ally,
    control,
    /** advance `seconds` of simulation with a constant input */
    run(seconds, input = {}) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) {
        updatePlayer(world, player, control, input, STEP);
        stepMission(world, runtime, STEP, {});
        // edge-triggered verbs fire once, like the real input layer
        input = { ...input, fire: false, dive: false, melee: false, relic: false, reload: false };
      }
      return harness;
    },
    /** advance without touching the player at all */
    idle(seconds) {
      const steps = Math.round(seconds / STEP);
      for (let i = 0; i < steps; i++) stepMission(world, runtime, STEP, {});
      return harness;
    },
    events(type) {
      return log.filter((e) => e.type === type);
    },
    lastEvent(type) {
      const all = harness.events(type);
      return all[all.length - 1] ?? null;
    },
    clearLog() {
      log.length = 0;
      return harness;
    },
  };
  return harness;
}

export function spawnEnemyAt(world, defId, pos) {
  return spawnActor(world, defId, pos, { team: 'kaldreich' });
}

/** Teleport an actor without going through movement resolution. */
export function place(entity, x, z, facing = 0) {
  entity.pos = { x, z };
  entity.facing = facing;
  return entity;
}
