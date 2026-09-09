/**
 * Consequences: the layer that turns one mission's decisions into a persistent
 * diplomatic and territorial state. Nothing here is scored as good or bad — it
 * only records who now believes what about you, and where the line moved.
 */
import { FACTION_IDS, FACTIONS, REP_SPILLOVER, repTier } from '../content/factions.js';
import { ATTUNEMENT_THRESHOLDS } from '../content/relics.js';
import { clamp } from '../core/math2.js';

export const REP_MIN = -100;
export const REP_MAX = 100;

export function createRunState(mission) {
  return {
    version: 1,
    seed: 1,
    /** You walked off the Kaldreich line eleven days ago; they noticed. */
    rep: { kaldreich: -30, coalition: 8, ashborn: 0 },
    warfront: mission.warfront.start,
    warfrontLabel: mission.warfront.label,
    attunement: 0,
    squad: { morale: 70, loyalty: 50, velaLost: false },
    choices: [],
    missionsCompleted: [],
    civiliansSaved: 0,
    civiliansLost: 0,
  };
}

/**
 * Apply one outcome. Positive standing with a faction spills negatively onto
 * its rivals through the authored matrix, so you cannot be everybody's friend.
 */
export function applyConsequences(run, consequences, bus) {
  const before = { ...run.rep };
  const repDelta = Object.fromEntries(FACTION_IDS.map((f) => [f, 0]));

  for (const [faction, delta] of Object.entries(consequences.rep ?? {})) {
    if (!FACTIONS[faction]) continue;
    repDelta[faction] += delta;
    if (delta > 0) {
      for (const [other, mul] of Object.entries(REP_SPILLOVER[faction] ?? {})) {
        repDelta[other] += delta * mul;
      }
    }
  }

  for (const f of FACTION_IDS) {
    run.rep[f] = clamp(Math.round(run.rep[f] + repDelta[f]), REP_MIN, REP_MAX);
  }

  if (consequences.territory) {
    // `territory` is ground taken from Kaldreich control of the salient.
    run.warfront = clamp(run.warfront - consequences.territory, 0, 100);
  }
  if (consequences.attunement) run.attunement += consequences.attunement;
  if (consequences.morale) run.squad.morale = clamp(run.squad.morale + consequences.morale, 0, 100);
  if (consequences.loyalty) run.squad.loyalty = clamp(run.squad.loyalty + consequences.loyalty, 0, 100);

  if (consequences.civilians === 'killed') run.civiliansLost += 3;
  if (consequences.civilians === 'saved') run.civiliansSaved += 3;
  if (consequences.civilians === 'changed') run.civiliansSaved += 3;

  const crossed = ATTUNEMENT_THRESHOLDS.filter(
    (t) => run.attunement >= t.at && !run.attunementSeen?.includes(t.id),
  );
  if (crossed.length) {
    run.attunementSeen = [...(run.attunementSeen ?? []), ...crossed.map((c) => c.id)];
    for (const c of crossed) bus?.emit('attunement.threshold', { id: c.id, text: c.text });
  }

  const result = {
    repBefore: before,
    repAfter: { ...run.rep },
    repDelta: Object.fromEntries(FACTION_IDS.map((f) => [f, run.rep[f] - before[f]])),
    warfront: run.warfront,
    territory: consequences.territory ?? 0,
    civilians: consequences.civilians ?? 'untouched',
  };
  bus?.emit('consequences.applied', result);
  return result;
}

export function recordChoice(run, choiceId, optionId, consequences, bus) {
  run.choices.push({ choiceId, optionId, at: Date.now() });
  return applyConsequences(run, consequences, bus);
}

/** Frontline description used on the debrief map. */
export function warfrontSummary(run) {
  const kald = run.warfront;
  let posture;
  if (kald >= 75) posture = 'Kaldreich entrenched';
  else if (kald >= 55) posture = 'Kaldreich holding';
  else if (kald >= 45) posture = 'Line contested';
  else if (kald >= 25) posture = 'Coalition pressing';
  else posture = 'Salient collapsing';
  return { kald, coalition: 100 - kald, posture, label: run.warfrontLabel };
}

export function repSummary(run) {
  return FACTION_IDS.map((f) => ({
    id: f,
    name: FACTIONS[f].name,
    short: FACTIONS[f].short,
    color: FACTIONS[f].accent,
    value: run.rep[f],
    tier: repTier(run.rep[f]),
  }));
}
