/**
 * Mission director. Owns zone triggers, encounter pacing, objective order and
 * the decision at the end. It reads authored mission content and writes only
 * runtime state — the mission data itself is never mutated.
 */
import { LEVEL } from '../content/level-trenchfront.js';
import { ACTORS } from '../content/actors.js';
import { clamp, clone, dist, rectContains } from '../core/math2.js';
import { applyCommitmentCap, initAi, updateEnemyAi } from './ai.js';
import { applyDamage, updateCombatTimers, updateProjectiles, updateAction } from './combat.js';
import {
  attachSquadReactions,
  initSquad,
  updateSquadmate,
  adjustMorale,
  adjustLoyalty,
} from './squad.js';
import {
  livingEntities,
  moveEntity,
  nudgeOntoPlane,
  spawnActor,
  updateCoverState,
  updateStatuses,
  tickCooldowns,
  TEAMS,
} from './world.js';

const ARENA_LEASH = 24;

export function createMissionRuntime(world, mission) {
  const runtime = {
    mission,
    objectiveIndex: 0,
    objectives: mission.objectives.map((o) => ({ ...o, state: 'pending' })),
    encounters: {},
    triggeredZones: new Set(),
    pendingChoice: null,
    resolvedChoice: null,
    status: 'active', // active | choice | resolving | complete | failed
    gateHintAt: -99,
    ally: null,
    civilians: [],
  };

  for (const enc of Object.values(mission.encounters)) {
    runtime.encounters[enc.id] = {
      id: enc.id,
      def: enc,
      state: 'idle',
      t: 0,
      waves: enc.waves.map((w) => ({ id: w.id, def: w, triggered: false, armedAt: null })),
      spawned: [],
    };
  }

  setObjectiveState(world, runtime, 0, 'active');
  return runtime;
}

function setObjectiveState(world, runtime, index, state) {
  const obj = runtime.objectives[index];
  if (!obj) return;
  obj.state = state;
  world.bus?.emit('objective.' + (state === 'active' ? 'current' : state), {
    id: obj.id,
    text: obj.text,
    index,
  });
}

function completeObjective(world, runtime, id) {
  const index = runtime.objectives.findIndex((o) => o.id === id);
  if (index < 0 || runtime.objectives[index].state === 'completed') return;
  runtime.objectives[index].state = 'completed';
  world.flags.completedObjectives.push(id);
  world.bus?.emit('objective.completed', { id, text: runtime.objectives[index].text });
  const next = runtime.objectives.findIndex((o) => o.state === 'pending');
  if (next >= 0) {
    runtime.objectiveIndex = next;
    setObjectiveState(world, runtime, next, 'active');
  }
}

// ------------------------------------------------------------------- setup

export function populateMission(world, runtime, { spawnCivilians = true } = {}) {
  const anchors = LEVEL.anchors;
  const player = spawnActor(world, 'player', nudgeOntoPlane(world, anchors.player_start, ACTORS.player.radius), {
    team: TEAMS.marches,
  });
  const ally = spawnActor(world, 'vela', nudgeOntoPlane(world, anchors.vela_start, ACTORS.vela.radius), {
    team: TEAMS.marches,
  });
  initSquad(ally);
  attachSquadReactions(world, ally);
  runtime.ally = ally;

  if (spawnCivilians) {
    for (const key of ['civ_1', 'civ_2', 'civ_3']) {
      const c = spawnActor(world, 'civilian', nudgeOntoPlane(world, anchors[key], ACTORS.civilian.radius), {
        team: TEAMS.neutral,
      });
      runtime.civilians.push(c);
    }
    world.flags.civiliansAlive = runtime.civilians.length;
  }
  return { player, ally };
}

// -------------------------------------------------------------- encounters

export function startEncounter(world, runtime, encounterId) {
  const enc = runtime.encounters[encounterId];
  if (!enc || enc.state !== 'idle') return enc;
  enc.state = 'active';
  enc.t = 0;
  world.bus?.emit('encounter.started', { id: enc.id, name: enc.def.name });
  return enc;
}

function spawnWave(world, runtime, enc, wave) {
  const arena = LEVEL.anchors[enc.def.arena];
  for (const spawn of wave.def.spawns) {
    const anchor = LEVEL.anchors[spawn.anchor];
    const def = ACTORS[spawn.def];
    const e = spawnActor(world, spawn.def, nudgeOntoPlane(world, anchor, def.radius), {
      team: TEAMS.kaldreich,
    });
    initAi(e, { leash: { center: clone(arena), radius: ARENA_LEASH } });
    enc.spawned.push(e);
  }
  wave.triggered = true;
  world.bus?.emit('wave.spawned', { encounter: enc.id, wave: wave.id, count: wave.def.spawns.length });
  if (wave.def.bark && runtime.ally?.alive && !runtime.ally.downed) {
    world.bus?.emit('squad.bark', {
      id: runtime.ally.id,
      speaker: runtime.ally.name,
      key: 'warning',
      line: wave.def.bark,
    });
  }
}

function updateEncounter(world, runtime, enc, dt) {
  if (enc.state !== 'active') return;
  enc.t += dt;

  const defeatedCount = enc.spawned.filter((e) => !e.alive).length;
  const spawnedCount = enc.spawned.length;

  for (let i = 0; i < enc.waves.length; i++) {
    const wave = enc.waves[i];
    if (wave.triggered) continue;
    const def = wave.def;
    if (i === 0) {
      if (enc.t >= (def.delay ?? 0)) spawnWave(world, runtime, enc, wave);
      break;
    }
    const fractionMet =
      def.afterFraction == null || (spawnedCount > 0 && defeatedCount / spawnedCount >= def.afterFraction);
    if (fractionMet) {
      if (wave.armedAt == null) wave.armedAt = enc.t;
      if (enc.t - wave.armedAt >= (def.delay ?? 0)) spawnWave(world, runtime, enc, wave);
    }
    break; // waves arrive in order; never skip ahead
  }

  const allWavesOut = enc.waves.every((w) => w.triggered);
  const allDown = enc.spawned.every((e) => !e.alive);
  if (allWavesOut && allDown) {
    enc.state = 'cleared';
    world.flags.clearedEncounters.push(enc.id);
    grantReward(world, enc.def.reward);
    world.bus?.emit('encounter.cleared', { id: enc.id, name: enc.def.name, reward: enc.def.reward });
  }

  // Only a bounded number of attackers may be committed at any moment.
  applyCommitmentCap(
    world,
    enc.spawned.filter((e) => e.alive),
    enc.def.maxCommitted,
  );
}

function grantReward(world, reward) {
  if (!reward) return;
  const player = world.player;
  if (!player) return;
  if (reward.ammo) {
    player.reserve += reward.ammo;
    world.bus?.emit('ammo.changed', { id: player.id, mag: player.mag, reserve: player.reserve });
  }
  if (reward.relicCharge && player.relic) {
    player.relic.charges = clamp(player.relic.charges + reward.relicCharge, 0, player.relic.max);
    world.bus?.emit('relic.charged', { charges: player.relic.charges });
  }
  if (reward.text) world.bus?.emit('reward.granted', { text: reward.text });
}

// ------------------------------------------------------------------ zones

function updateZones(world, runtime) {
  const player = world.player;
  if (!player?.alive) return;

  for (const zone of LEVEL.zones) {
    const inside = rectContains(zone, player.pos);

    if (zone.kind === 'gate') {
      const cleared = world.flags.clearedEncounters.includes(zone.requires);
      if (!cleared && player.pos.z > zone.z - zone.d / 2 && Math.abs(player.pos.x - zone.x) < zone.w / 2) {
        player.pos.z = zone.z - zone.d / 2;
        if (world.time - runtime.gateHintAt > 4) {
          runtime.gateHintAt = world.time;
          world.bus?.emit('gate.blocked', {
            id: zone.id,
            text: 'Not with the junction still firing on our backs.',
          });
        }
      }
      continue;
    }

    if (!inside || runtime.triggeredZones.has(zone.id)) continue;
    runtime.triggeredZones.add(zone.id);
    world.bus?.emit('zone.entered', { id: zone.id, kind: zone.kind });

    if (zone.kind === 'encounter' && zone.encounter) startEncounter(world, runtime, zone.encounter);
    if (zone.id === 'z_wire') completeObjective(world, runtime, 'cross_wire');
    if (zone.kind === 'objective' && zone.objective === 'reach_bunker') {
      completeObjective(world, runtime, 'reach_bunker');
      presentChoice(world, runtime, 'battery');
    }
  }
}

// ----------------------------------------------------------------- choices

export function presentChoice(world, runtime, choiceId) {
  if (runtime.pendingChoice || runtime.resolvedChoice) return;
  const choice = runtime.mission.choices[choiceId];
  if (!choice) return;
  const player = world.player;
  const options = choice.options.map((opt) => {
    const need = opt.requires;
    const available =
      !need || (need.relicCharges == null || (player?.relic?.charges ?? 0) >= need.relicCharges);
    return { ...opt, available };
  });
  runtime.pendingChoice = { ...choice, options };
  runtime.status = 'choice';
  world.bus?.emit('choice.presented', { choice: runtime.pendingChoice });
}

export function resolveChoice(world, runtime, optionId) {
  const choice = runtime.pendingChoice;
  if (!choice) return null;
  const option = choice.options.find((o) => o.id === optionId);
  if (!option || option.available === false) return null;

  runtime.pendingChoice = null;
  runtime.resolvedChoice = option;
  world.flags.choiceTaken = option.id;
  world.bus?.emit('choice.resolved', { choiceId: choice.id, option });

  // Spending the relic on the Ashborn signal is a real cost, paid immediately.
  if (option.id === 'ashborn' && world.player?.relic) {
    world.player.relic.charges = Math.max(0, world.player.relic.charges - 1);
    world.flags.attunement += option.consequences.attunement ?? 0;
    world.bus?.emit('relic.used', {
      id: world.player.id,
      charges: world.player.relic.charges,
      attunement: world.flags.attunement,
    });
  }

  if (option.consequences.civilians === 'killed') {
    for (const c of runtime.civilians) {
      if (c.alive) {
        applyDamage(world, c, {
          amount: c.maxHp * 2,
          sourceId: world.player?.id,
          moveId: 'barrage',
          viaBlast: true,
        });
      }
    }
  }

  if (runtime.ally?.squad) {
    adjustMorale(world, runtime.ally, option.consequences.morale ?? 0, 'choice');
    adjustLoyalty(world, runtime.ally, option.consequences.loyalty ?? 0, 'choice');
  }
  if (option.velaLine && runtime.ally?.alive) {
    world.bus?.emit('squad.bark', {
      id: runtime.ally.id,
      speaker: runtime.ally.name,
      key: 'choice',
      line: option.velaLine,
    });
  }

  if (option.resolves === 'encounter') {
    runtime.status = 'active';
    startEncounter(world, runtime, option.encounter);
  } else {
    runtime.status = 'resolving';
    completeMission(world, runtime);
  }
  return option;
}

function completeMission(world, runtime) {
  if (runtime.status === 'complete') return;
  runtime.status = 'complete';
  completeObjective(world, runtime, 'resolve_battery');
  world.bus?.emit('mission.complete', {
    missionId: runtime.mission.id,
    option: runtime.resolvedChoice,
    kills: world.flags.kills,
    civiliansAlive: world.flags.civiliansAlive,
    attunement: world.flags.attunement,
    ally: runtime.ally
      ? {
          alive: runtime.ally.alive,
          downed: runtime.ally.downed,
          morale: runtime.ally.squad?.morale ?? 0,
          loyalty: runtime.ally.squad?.loyalty ?? 0,
        }
      : null,
  });
}

function failMission(world, runtime, reason) {
  if (runtime.status === 'failed' || runtime.status === 'complete') return;
  runtime.status = 'failed';
  world.bus?.emit('mission.failed', { reason });
}

// ------------------------------------------------------------- step update

/**
 * One simulation step. Order matters: timers, then actions, then AI intent,
 * then cover state, then mission logic — so every consumer in a frame sees a
 * consistent world.
 */
export function stepMission(world, runtime, dt, input = {}) {
  world.time += dt;

  for (const e of world.entities) {
    if (!e.alive && e.kind !== 'ally') continue;
    tickCooldowns(e, dt);
    updateCombatTimers(world, e, dt);
    updateStatuses(world, e, dt, (amount, status) => {
      if (status.dps) {
        applyDamage(world, e, { amount, sourceId: null, moveId: status.id, viaBlast: true });
      }
    });
  }

  for (const e of world.entities) {
    if (e.action) updateAction(world, e, dt);
  }

  for (const e of world.entities) {
    if (!e.alive || e.downed) continue;
    if (e.kind === 'enemy' && e.ai) updateEnemyAi(world, e, dt);
  }

  if (runtime.ally) updateSquadmate(world, runtime.ally, dt, { focusId: input.focusId });

  updateProjectiles(world, dt);
  updateCoverState(world);

  for (const enc of Object.values(runtime.encounters)) updateEncounter(world, runtime, enc, dt);
  updateZones(world, runtime);

  // Objective: the junction is only done when its encounter is cleared.
  if (runtime.encounters.e2_junction.state === 'cleared') {
    completeObjective(world, runtime, 'clear_junction');
  }
  if (
    runtime.resolvedChoice?.resolves === 'encounter' &&
    runtime.encounters[runtime.resolvedChoice.encounter]?.state === 'cleared'
  ) {
    completeMission(world, runtime);
  }

  if (world.player && !world.player.alive) failMission(world, runtime, 'player-dead');
  if (runtime.ally && !runtime.ally.alive && runtime.ally.downed) {
    // she is gone for good; the run continues without her
  }

  return runtime.status;
}

/** Enemies currently alive in any active encounter — used by the HUD. */
export function activeEnemies(world) {
  return livingEntities(world, (e) => e.kind === 'enemy');
}

export { completeObjective };
