import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { MISSION } from '../src/content/mission-cut-the-wire.js';
import { resolveChoice, presentChoice, stepMission } from '../src/sim/mission.js';
import { applyDamage } from '../src/sim/combat.js';
import { createRunState, applyConsequences, recordChoice, warfrontSummary } from '../src/sim/consequences.js';
import { validateContent } from '../src/content/validate.js';
import { STEP } from '../src/core/loop.js';

describe('mission flow', () => {
  it('starts the first encounter when the player crosses the wire', () => {
    const h = makeHarness({ seed: 5 });
    expect(h.runtime.encounters.e1_wire.state).toBe('idle');
    h.run(5.0, { axisZ: 1, yaw: 0 });
    expect(h.runtime.encounters.e1_wire.state).toBe('active');
    expect(h.events('wave.spawned').length).toBeGreaterThan(0);
    expect(h.events('objective.completed').some((e) => e.id === 'cross_wire')).toBe(true);
  });

  it('holds the approach gate shut until the junction is cleared', () => {
    const h = makeHarness({ seed: 5 });
    h.player.pos = { x: 0, z: 13 };
    stepMission(h.world, h.runtime, STEP, {});
    expect(h.player.pos.z).toBeLessThanOrEqual(11.01);
    expect(h.lastEvent('gate.blocked')).toBeTruthy();

    h.world.flags.clearedEncounters.push('e2_junction');
    h.player.pos = { x: 0, z: 13 };
    stepMission(h.world, h.runtime, STEP, {});
    expect(h.player.pos.z).toBeCloseTo(13, 3);
  });

  it('spawns the second wave only after the first is half down', () => {
    const h = makeHarness({ seed: 5 });
    const enc = h.runtime.encounters.e2_junction;
    h.runtime.triggeredZones.add('z_wire'); // skip the first contact
    h.player.pos = { x: 0, z: -6 };
    h.idle(1.0);
    expect(enc.waves[0].triggered).toBe(true);
    expect(enc.waves[1].triggered).toBe(false);

    h.idle(6.0);
    expect(enc.waves[1].triggered).toBe(false); // time alone is not enough

    applyDamage(h.world, enc.spawned[0], { amount: 999, sourceId: h.player.id, moveId: 'test' });
    h.idle(3.0);
    expect(enc.waves[1].triggered).toBe(true);
    expect(enc.spawned.some((e) => e.defId === 'kald_grenadier')).toBe(true);
  });

  it('clears an encounter and grants its reward', () => {
    const h = makeHarness({ seed: 5 });
    const enc = h.runtime.encounters.e1_wire;
    h.player.pos = { x: 0, z: -25 };
    h.idle(1.0);
    const reserveBefore = h.player.reserve;
    for (const e of enc.spawned) {
      applyDamage(h.world, e, { amount: 999, sourceId: h.player.id, moveId: 'test' });
    }
    h.idle(0.5);
    expect(enc.state).toBe('cleared');
    expect(h.player.reserve).toBe(reserveBefore + MISSION.encounters.e1_wire.reward.ammo);
  });

  it('presents the decision at the bunker with the relic option gated', () => {
    const h = makeHarness({ seed: 5 });
    h.world.flags.clearedEncounters.push('e2_junction');
    h.player.relic.charges = 0;
    h.player.pos = { x: 0, z: 30 };
    h.idle(STEP * 2);

    const presented = h.lastEvent('choice.presented');
    expect(presented).toBeTruthy();
    const ashborn = presented.choice.options.find((o) => o.id === 'ashborn');
    expect(ashborn.available).toBe(false);
    expect(presented.choice.options.find((o) => o.id === 'breach').available).toBe(true);
    expect(h.runtime.status).toBe('choice');
  });

  it('kills the civilians when the barrage is called, and completes the mission', () => {
    const h = makeHarness({ seed: 5 });
    h.world.flags.clearedEncounters.push('e2_junction');
    h.player.pos = { x: 0, z: 30 };
    h.idle(STEP * 2);

    expect(h.world.flags.civiliansAlive).toBe(3);
    resolveChoice(h.world, h.runtime, 'barrage');
    expect(h.world.flags.civiliansAlive).toBe(0);
    expect(h.events('civilian.killed').length).toBe(3);
    expect(h.lastEvent('mission.complete')).toBeTruthy();
    expect(h.ally.squad.morale).toBeLessThan(70);
  });

  it('runs a real fight when the player breaches on foot', () => {
    const h = makeHarness({ seed: 5 });
    h.world.flags.clearedEncounters.push('e2_junction');
    h.player.pos = { x: 0, z: 30 };
    h.idle(STEP * 2);

    resolveChoice(h.world, h.runtime, 'breach');
    expect(h.runtime.encounters.e3_breach.state).toBe('active');
    expect(h.lastEvent('mission.complete')).toBeNull();

    h.idle(1.0);
    const enc = h.runtime.encounters.e3_breach;
    // clear both waves the honest way: everything that spawns has to die
    for (let i = 0; i < 40; i++) {
      for (const e of enc.spawned) {
        if (e.alive) applyDamage(h.world, e, { amount: 999, sourceId: h.player.id, moveId: 'test' });
      }
      h.idle(0.25);
      if (enc.state === 'cleared') break;
    }
    expect(enc.state).toBe('cleared');
    expect(h.lastEvent('mission.complete')).toBeTruthy();
    expect(h.world.flags.civiliansAlive).toBe(3);
  });

  it('fails the mission when the player dies', () => {
    const h = makeHarness({ seed: 5 });
    applyDamage(h.world, h.player, { amount: 999, sourceId: null, moveId: 'test' });
    h.idle(STEP * 2);
    expect(h.lastEvent('mission.failed')?.reason).toBe('player-dead');
  });

  it('refuses an option whose requirement is not met', () => {
    const h = makeHarness({ seed: 5 });
    h.player.relic.charges = 0;
    presentChoice(h.world, h.runtime, 'battery');
    expect(resolveChoice(h.world, h.runtime, 'ashborn')).toBeNull();
    expect(h.runtime.pendingChoice).toBeTruthy();
  });
});

describe('consequences', () => {
  it('spills positive standing onto rivals', () => {
    const run = createRunState(MISSION);
    const before = { ...run.rep };
    applyConsequences(run, { rep: { coalition: 26, kaldreich: -14 } }, null);
    expect(run.rep.coalition).toBeGreaterThan(before.coalition);
    expect(run.rep.kaldreich).toBeLessThan(before.kaldreich - 10); // direct hit plus spillover
    expect(run.rep.ashborn).toBeLessThan(before.ashborn);
  });

  it('moves the frontline by the territory taken', () => {
    const run = createRunState(MISSION);
    const start = run.warfront;
    applyConsequences(run, { territory: 14 }, null);
    expect(run.warfront).toBe(start - 14);
    expect(warfrontSummary(run).coalition).toBe(100 - run.warfront);
  });

  it('records each choice against the run', () => {
    const run = createRunState(MISSION);
    const option = MISSION.choices.battery.options.find((o) => o.id === 'ashborn');
    recordChoice(run, 'battery', option.id, option.consequences, null);
    expect(run.choices).toHaveLength(1);
    expect(run.rep.ashborn).toBeGreaterThan(0);
    expect(run.attunement).toBe(2);
  });

  it('keeps reputation inside its bounds', () => {
    const run = createRunState(MISSION);
    for (let i = 0; i < 20; i++) applyConsequences(run, { rep: { ashborn: 30 } }, null);
    expect(run.rep.ashborn).toBeLessThanOrEqual(100);
    expect(run.rep.kaldreich).toBeGreaterThanOrEqual(-100);
  });

  it('gives every authored option a distinct outcome', () => {
    const outcomes = MISSION.choices.battery.options.map((o) => {
      const run = createRunState(MISSION);
      applyConsequences(run, o.consequences, null);
      return JSON.stringify({ rep: run.rep, warfront: run.warfront, civ: o.consequences.civilians });
    });
    expect(new Set(outcomes).size).toBe(outcomes.length);
  });
});

describe('level routes', () => {
  it('keeps every authored anchor inside the playable bounds', () => {
    for (const [id, a] of Object.entries(LEVEL.anchors)) {
      expect(Math.abs(a.x), id).toBeLessThan(LEVEL.bounds.w / 2);
      expect(Math.abs(a.z), id).toBeLessThan(LEVEL.bounds.d / 2);
    }
  });

  it('lets the player actually walk the critical path start to bunker', () => {
    const h = makeHarness({ seed: 3 });
    // Nothing shoots: this asserts the geometry is traversable, not the fight.
    for (const e of h.world.entities) {
      if (e.kind === 'enemy') e.alive = false;
    }
    h.world.flags.clearedEncounters.push('e1_wire', 'e2_junction');

    let waypoint = 1;
    let guard = 0;
    while (waypoint < LEVEL.route.length && guard < 4000) {
      guard++;
      const goal = LEVEL.route[waypoint];
      const p = h.player.pos;
      const yaw = Math.atan2(goal.x - p.x, goal.z - p.z);
      h.run(STEP, { axisZ: 1, yaw });
      // Any enemy that spawns from a zone trigger is removed; we are not
      // testing combat here, only that the route is physically walkable.
      for (const e of h.world.entities) if (e.kind === 'enemy') e.alive = false;
      if (Math.hypot(goal.x - p.x, goal.z - p.z) < 1.2) waypoint++;
    }

    expect(waypoint, `stalled at leg ${waypoint} (${LEVEL.route[waypoint]?.id})`).toBe(
      LEVEL.route.length,
    );
    expect(h.player.pos.z).toBeGreaterThan(28);
    expect(h.lastEvent('choice.presented')).toBeTruthy();
  });

  it('never blocks a critical-path leg with level geometry', () => {
    const { errors } = validateContent();
    expect(errors.filter((e) => e.includes('route leg'))).toEqual([]);
  });
});
