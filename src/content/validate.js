/**
 * Content validation. Authored data is checked before it can reach the
 * runtime: duplicate IDs, dangling references, impossible timings and any
 * level geometry that would break the single-gameplay-plane rule are errors,
 * not surprises discovered mid-playthrough.
 */
import { MOVES, moveDuration } from './moves.js';
import { ACTORS } from './actors.js';
import { RELICS } from './relics.js';
import { LEVEL } from './level-trenchfront.js';
import { MISSION } from './mission-cut-the-wire.js';
import { FACTIONS } from './factions.js';
import { rectContains, dist, segmentIntersectsRect } from '../core/math2.js';

const PLANE_TOLERANCE = 1e-6;

export function validateContent() {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  // ---------------------------------------------------------------- moves
  for (const [key, mv] of Object.entries(MOVES)) {
    if (mv.id !== key) err(`move "${key}" has mismatched id "${mv.id}"`);
    if (mv.startup < 0) err(`move ${key}: negative startup`);
    if (mv.recovery < 0) err(`move ${key}: negative recovery`);
    let prevEnd = -Infinity;
    for (const [from, to] of mv.windows ?? []) {
      if (to <= from) err(`move ${key}: window [${from},${to}] is empty or inverted`);
      if (from < mv.startup - PLANE_TOLERANCE) {
        err(`move ${key}: active window starts at ${from}s, before startup ends at ${mv.startup}s`);
      }
      if (from < prevEnd) err(`move ${key}: overlapping active windows`);
      prevEnd = to;
    }
    if ((mv.windows?.length ?? 0) > 0 && !mv.contact) {
      err(`move ${key}: has active windows but no contact shape`);
    }
    if (mv.minCommit != null && mv.minCommit > moveDuration(mv)) {
      err(`move ${key}: minCommit exceeds total duration`);
    }
    if (mv.cooldown != null && mv.cooldown < 0) err(`move ${key}: negative cooldown`);
    if (mv.contact?.type === 'hitscan' && !(mv.contact.accuracy > 0)) {
      err(`move ${key}: hitscan contact needs a positive accuracy`);
    }
  }

  // --------------------------------------------------------------- actors
  const seenActorIds = new Set();
  for (const [key, def] of Object.entries(ACTORS)) {
    if (def.id !== key) err(`actor "${key}" has mismatched id "${def.id}"`);
    if (seenActorIds.has(def.id)) err(`duplicate actor id ${def.id}`);
    seenActorIds.add(def.id);
    for (const id of def.moves ?? []) {
      if (!MOVES[id]) err(`actor ${key} references unknown move ${id}`);
    }
    if (!(def.radius > 0)) err(`actor ${key}: collider radius must be positive`);
    if (!(def.height > 0)) err(`actor ${key}: visual height must be positive`);
    if (def.pivot !== 'ground') err(`actor ${key}: pivot must be 'ground'`);
    if (def.forwardAxis !== '+Z') err(`actor ${key}: forwardAxis must be '+Z'`);
    if (def.metersPerUnit !== 1) err(`actor ${key}: metersPerUnit must be 1`);
    for (const socket of ['muzzle', 'chest', 'head']) {
      if (!def.sockets?.[socket]) err(`actor ${key}: missing required socket "${socket}"`);
    }
    if (def.faction !== 'none' && !FACTIONS[def.faction] && def.faction !== 'none') {
      err(`actor ${key}: unknown faction ${def.faction}`);
    }
  }

  // --------------------------------------------------------------- relics
  for (const [key, relic] of Object.entries(RELICS)) {
    if (!MOVES[relic.move]) err(`relic ${key} references unknown move ${relic.move}`);
    if (relic.startCharges > relic.maxCharges) err(`relic ${key}: startCharges exceeds maxCharges`);
  }

  // ---------------------------------------------------------------- level
  const seenObstacleIds = new Set();
  const highObstacles = [];
  for (const o of LEVEL.obstacles) {
    if (seenObstacleIds.has(o.id)) err(`duplicate obstacle id ${o.id}`);
    seenObstacleIds.add(o.id);
    if (!(o.w > 0 && o.d > 0)) err(`obstacle ${o.id}: non-positive footprint`);
    if (o.height !== 'low' && o.height !== 'high') {
      err(`obstacle ${o.id}: height must be 'low' or 'high'`);
    }
    if ('y' in o || 'elevation' in o || 'slope' in o) {
      err(`obstacle ${o.id}: elevation data is forbidden on the gameplay plane`);
    }
    if (!rectContains(LEVEL.bounds, { x: o.x, z: o.z }, Math.max(o.w, o.d))) {
      warn(`obstacle ${o.id} sits outside the level bounds`);
    }
    if (o.height === 'high') highObstacles.push(o);
  }

  if (LEVEL.planeY !== 0) err('level planeY must be 0');

  // Anchors must be standable: on the plane, inside bounds, not inside geometry.
  const playerRadius = ACTORS.player.radius;
  for (const [id, a] of Object.entries(LEVEL.anchors)) {
    if ('y' in a) err(`anchor ${id}: anchors may not carry a y value`);
    if (!Number.isFinite(a.x) || !Number.isFinite(a.z)) err(`anchor ${id}: non-finite position`);
    if (!rectContains(LEVEL.bounds, a, -1)) err(`anchor ${id} is outside the level bounds`);
    for (const o of LEVEL.obstacles) {
      if (rectContains(o, a, playerRadius * 0.9)) {
        err(`anchor ${id} (${a.x},${a.z}) is inside obstacle ${o.id}`);
      }
    }
  }

  // Zones must be on the plane, inside bounds, and reference real content.
  const seenZoneIds = new Set();
  for (const z of LEVEL.zones) {
    if (seenZoneIds.has(z.id)) err(`duplicate zone id ${z.id}`);
    seenZoneIds.add(z.id);
    if ('y' in z) err(`zone ${z.id}: zones may not carry a y value`);
    if (!rectContains(LEVEL.bounds, { x: z.x, z: z.z }, Math.max(z.w, z.d))) {
      warn(`zone ${z.id} extends past the level bounds`);
    }
    if (z.encounter && !MISSION.encounters[z.encounter]) {
      err(`zone ${z.id} references unknown encounter ${z.encounter}`);
    }
    if (z.requires && !MISSION.encounters[z.requires]) {
      err(`zone ${z.id} requires unknown encounter ${z.requires}`);
    }
    if (z.objective && !MISSION.objectives.some((o) => o.id === z.objective)) {
      err(`zone ${z.id} references unknown objective ${z.objective}`);
    }
  }

  // Critical path: every leg must be walkable, or the mission is unfinishable.
  const clearance = playerRadius * 0.9;
  for (let i = 1; i < LEVEL.route.length; i++) {
    const a = LEVEL.route[i - 1];
    const b = LEVEL.route[i];
    if ('y' in a || 'y' in b) err(`route leg ${a.id}->${b.id}: waypoints may not carry a y value`);
    for (const o of LEVEL.obstacles) {
      if (segmentIntersectsRect(a, b, o, clearance)) {
        err(`route leg ${a.id} -> ${b.id} is blocked by obstacle ${o.id}`);
      }
    }
  }

  // Source-to-light inventory: no unexplained lights, ever.
  const seenLightIds = new Set();
  for (const l of LEVEL.lights.local) {
    if (seenLightIds.has(l.id)) err(`duplicate light id ${l.id}`);
    seenLightIds.add(l.id);
    if (!l.emitterId) err(`light ${l.id} has no emitterId`);
    if (!l.emitter) err(`light ${l.id} declares no visible emitter`);
    if (!l.attach) err(`light ${l.id} has no attachment transform`);
    if (!(l.range > 0)) err(`light ${l.id}: range must be positive`);
    if (!(l.intensity >= 0)) err(`light ${l.id}: intensity must be non-negative`);
    if (l.emitter && l.emitter.height > l.range) {
      warn(`light ${l.id}: emitter is taller than the light's range`);
    }
  }
  for (const l of LEVEL.lights.runtime) {
    if (!l.emitterId) err(`runtime light ${l.id} has no emitterId`);
    if (!(l.lifetime > 0)) err(`runtime light ${l.id} must declare a finite lifetime`);
    if (!l.movesWithEmitter) {
      err(`runtime light ${l.id} must move with its emitter`);
    }
  }

  // Dressing is background only.
  for (const d of LEVEL.dressing) {
    if (d.collides || d.walkable || d.blocksSight) {
      err(`dressing ${d.kind} at (${d.x},${d.z}) claims gameplay behaviour`);
    }
  }

  // -------------------------------------------------------------- mission
  for (const obj of MISSION.objectives) {
    if (obj.anchor && !LEVEL.anchors[obj.anchor]) {
      err(`objective ${obj.id} references unknown anchor ${obj.anchor}`);
    }
    if (obj.encounter && !MISSION.encounters[obj.encounter]) {
      err(`objective ${obj.id} references unknown encounter ${obj.encounter}`);
    }
    if (obj.choice && !MISSION.choices[obj.choice]) {
      err(`objective ${obj.id} references unknown choice ${obj.choice}`);
    }
  }

  for (const enc of Object.values(MISSION.encounters)) {
    if (!LEVEL.anchors[enc.arena]) err(`encounter ${enc.id}: unknown arena anchor ${enc.arena}`);
    if (!(enc.maxCommitted >= 1)) err(`encounter ${enc.id}: maxCommitted must be at least 1`);
    for (const wave of enc.waves) {
      if (!wave.spawns.length) err(`encounter ${enc.id} wave ${wave.id}: no spawns`);
      for (const s of wave.spawns) {
        if (!ACTORS[s.def]) err(`encounter ${enc.id}: unknown actor def ${s.def}`);
        if (!LEVEL.anchors[s.anchor]) err(`encounter ${enc.id}: unknown anchor ${s.anchor}`);
      }
    }
  }

  for (const choice of Object.values(MISSION.choices)) {
    if (choice.options.length < 2) err(`choice ${choice.id}: needs at least two options`);
    const seen = new Set();
    for (const opt of choice.options) {
      if (seen.has(opt.id)) err(`choice ${choice.id}: duplicate option ${opt.id}`);
      seen.add(opt.id);
      if (opt.resolves === 'encounter' && !MISSION.encounters[opt.encounter]) {
        err(`choice option ${opt.id} references unknown encounter ${opt.encounter}`);
      }
      for (const f of Object.keys(opt.consequences.rep ?? {})) {
        if (!FACTIONS[f]) err(`choice option ${opt.id}: unknown faction ${f}`);
      }
      if (!opt.epilogue) err(`choice option ${opt.id}: missing epilogue text`);
    }
    // Every option must actually differ in outcome, or it is not a choice.
    const signatures = choice.options.map((o) => JSON.stringify(o.consequences));
    if (new Set(signatures).size !== signatures.length) {
      err(`choice ${choice.id}: two options resolve identically`);
    }
  }

  // Route sanity: consecutive objective anchors must not be absurdly far apart,
  // which would mean the level and mission drifted out of agreement.
  const route = MISSION.objectives.filter((o) => o.anchor).map((o) => LEVEL.anchors[o.anchor]);
  for (let i = 1; i < route.length; i++) {
    if (dist(route[i - 1], route[i]) > 90) {
      warn(`objective route leg ${i} is longer than 90m`);
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}

/** Throws on invalid content. Called once at boot. */
export function assertContentValid() {
  const { errors, warnings, ok } = validateContent();
  for (const w of warnings) console.warn('[content]', w);
  if (!ok) {
    console.error('[content] validation failed:\n' + errors.map((e) => ' - ' + e).join('\n'));
    throw new Error(`Content validation failed with ${errors.length} error(s)`);
  }
  return true;
}
