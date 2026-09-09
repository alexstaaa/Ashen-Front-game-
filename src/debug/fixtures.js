/**
 * Deterministic review states.
 *
 * Every awkward moment in the slice is reachable directly from a URL, so
 * testing a boss-pressure moment or the decision screen never means replaying
 * the mission. Combine with `?seed=` for a byte-identical run.
 *
 *   ?fixture=junction   drop straight into the junction fight
 *   ?fixture=grenadier  one grenadier, close, already hunting you
 *   ?fixture=lowhp      junction fight at 22 hp with one magazine
 *   ?fixture=choice     at the bunker with the decision armed
 *   ?fixture=breach     the decision already taken the hard way
 *   ?fixture=downed     Vela down and bleeding out next to you
 *   ?fixture=empty      out of ammunition, relic charged, enemies inbound
 */
import { LEVEL } from '../content/level-trenchfront.js';
import { ACTORS } from '../content/actors.js';
import { spawnActor, nudgeOntoPlane, TEAMS } from '../sim/world.js';
import { initAi } from '../sim/ai.js';
import { applyDamage } from '../sim/combat.js';
import { startEncounter, presentChoice, resolveChoice, completeObjective } from '../sim/mission.js';

export function readParams(search = window.location.search) {
  const q = new URLSearchParams(search);
  const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
  return {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    fixture: q.get('fixture'),
    quality: q.get('quality') ?? 'high',
    reducedMotion:
      q.get('reduced') === '1' ||
      (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
    skipTitle: q.has('fixture') || q.get('skipTitle') === '1',
    debug: q.get('debug') === '1',
  };
}

export const FIXTURES = {
  junction(world, runtime) {
    world.flags.clearedEncounters.push('e1_wire');
    runtime.encounters.e1_wire.state = 'cleared';
    runtime.triggeredZones.add('z_wire');
    completeObjective(world, runtime, 'cross_wire');
    place(world, world.player, LEVEL.anchors.junction_center, 0, -6);
    place(world, runtime.ally, LEVEL.anchors.junction_center, -2, -8);
    startEncounter(world, runtime, 'e2_junction');
    runtime.triggeredZones.add('z_junction');
  },

  grenadier(world, runtime) {
    place(world, world.player, LEVEL.anchors.junction_center, 0, -4);
    const e = spawnActor(
      world,
      'kald_grenadier',
      nudgeOntoPlane(world, { x: 6, z: 8 }, ACTORS.kald_grenadier.radius),
      { team: TEAMS.kaldreich },
    );
    initAi(e, { leash: { center: { x: 0, z: 1 }, radius: 26 } });
  },

  lowhp(world, runtime) {
    FIXTURES.junction(world, runtime);
    world.player.hp = 22;
    world.player.mag = world.player.magSize;
    world.player.reserve = 0;
    if (runtime.ally) runtime.ally.squad.morale = 24; // low enough to refuse Advance
  },

  choice(world, runtime) {
    world.flags.clearedEncounters.push('e1_wire', 'e2_junction');
    runtime.encounters.e1_wire.state = 'cleared';
    runtime.encounters.e2_junction.state = 'cleared';
    runtime.triggeredZones.add('z_wire');
    runtime.triggeredZones.add('z_junction');
    completeObjective(world, runtime, 'cross_wire');
    completeObjective(world, runtime, 'clear_junction');
    place(world, world.player, LEVEL.anchors.plaza_center, 0, -2);
    place(world, runtime.ally, LEVEL.anchors.plaza_center, -2.4, -3);
    world.player.relic.charges = 2;
    presentChoice(world, runtime, 'battery');
  },

  breach(world, runtime) {
    FIXTURES.choice(world, runtime);
    resolveChoice(world, runtime, 'breach');
  },

  downed(world, runtime) {
    FIXTURES.junction(world, runtime);
    applyDamage(world, runtime.ally, { amount: 999, sourceId: null, moveId: 'fixture' });
  },

  empty(world, runtime) {
    FIXTURES.junction(world, runtime);
    world.player.mag = 0;
    world.player.reserve = 0;
    world.player.relic.charges = world.player.relic.max;
  },
};

function place(world, entity, anchor, dx = 0, dz = 0) {
  if (!entity) return;
  entity.pos = nudgeOntoPlane(world, { x: anchor.x + dx, z: anchor.z + dz }, entity.radius);
}

export function applyFixture(name, world, runtime) {
  const fixture = FIXTURES[name];
  if (!fixture) {
    console.warn(`[fixture] unknown fixture "${name}" — starting normally`);
    return false;
  }
  fixture(world, runtime);
  console.info(`[fixture] applied "${name}" (seed ${world.seed})`);
  return true;
}
