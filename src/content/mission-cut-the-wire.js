/**
 * Authored mission content for the vertical slice.
 *
 * The mission is one complete loop: brief -> traverse -> two encounters ->
 * a decision with no clean answer -> debrief that writes reputation, squad
 * state and the frontline back into the run.
 */

export const MISSION = {
  id: 'cut_the_wire',
  name: 'Cut the Wire',
  level: 'vaunt_salient',
  sector: 'Vaunt Salient — 41st day of the Iron Thaw',

  brief: [
    'You deserted the Kaldreich line eleven days ago. The Coalition has not decided what you are yet.',
    'Their forward company is pinned under a battery firing from a bunker at the head of the salient. Cpl. Vela Ruhn is walking out with you because someone had to.',
    'Cross the wire, clear the junction, and end the battery. How you end it is the part nobody wants to write down.',
  ],

  objectives: [
    { id: 'cross_wire', text: 'Cross the wire into no man\'s land', kind: 'move', anchor: 'wire_center' },
    { id: 'clear_junction', text: 'Clear the junction', kind: 'encounter', encounter: 'e2_junction' },
    { id: 'reach_bunker', text: 'Reach the battery bunker', kind: 'move', anchor: 'plaza_center' },
    { id: 'resolve_battery', text: 'End the battery', kind: 'choice', choice: 'battery' },
  ],

  /**
   * Encounters are compositions, not head counts. Each archetype must demand a
   * different answer, and only `maxCommitted` enemies may be inside an attack
   * commitment at once so pressure stays readable.
   */
  encounters: {
    e1_wire: {
      id: 'e1_wire',
      name: 'Contact at the wire',
      arena: 'wire_center',
      maxCommitted: 1,
      waves: [
        {
          id: 'w1',
          delay: 0.6,
          spawns: [
            { def: 'kald_rifleman', anchor: 'e1_a' },
            { def: 'kald_rifleman', anchor: 'e1_b' },
          ],
        },
      ],
      reward: { ammo: 8, text: 'Ammunition recovered from the wire' },
    },

    e2_junction: {
      id: 'e2_junction',
      name: 'The junction',
      arena: 'junction_center',
      maxCommitted: 2,
      waves: [
        {
          id: 'w1',
          delay: 0.4,
          spawns: [
            { def: 'kald_rifleman', anchor: 'e2_a' },
            { def: 'kald_rifleman', anchor: 'e2_b' },
          ],
        },
        {
          // second pressure source arrives only once the first is understood
          id: 'w2',
          afterFraction: 0.5,
          delay: 2.2,
          spawns: [
            { def: 'kald_rifleman', anchor: 'e2_c' },
            { def: 'kald_grenadier', anchor: 'e2_d' },
          ],
          bark: 'Grenadier! He\'ll burn you out of that hole!',
        },
      ],
      reward: { ammo: 16, relicCharge: 1, text: 'Kaldreich supply cached at the nest' },
    },

    e3_breach: {
      id: 'e3_breach',
      name: 'Breach on foot',
      arena: 'plaza_center',
      maxCommitted: 2,
      waves: [
        {
          id: 'w1',
          delay: 0.5,
          spawns: [
            { def: 'kald_rifleman', anchor: 'e3_a' },
            { def: 'kald_rifleman', anchor: 'e3_b' },
          ],
        },
        {
          id: 'w2',
          afterFraction: 0.5,
          delay: 1.6,
          spawns: [{ def: 'kald_grenadier', anchor: 'e3_c' }],
          bark: 'Door gunner\'s pulling the pin — move!',
        },
      ],
      reward: { text: 'Battery silenced by hand' },
    },
  },

  /**
   * The decision. No option is clean, none is strictly dominant, and each one
   * trades a different currency: civilians, squad, or the thing in your pocket.
   */
  choices: {
    battery: {
      id: 'battery',
      prompt: 'The battery is firing on the Coalition line. There is a civilian shelter eleven metres from its wall.',
      detail:
        'Vela is watching you, not the bunker. Coalition guns are ranged in and waiting on your signal. ' +
        'The Emberlash is warm against your ribs.',
      options: [
        {
          id: 'barrage',
          label: 'Call the barrage',
          summary: 'Immediate. Total. The shelter is inside the pattern.',
          requires: null,
          resolves: 'immediate',
          consequences: {
            rep: { kaldreich: -18, coalition: -22 },
            territory: 14,
            morale: -30,
            loyalty: -22,
            civilians: 'killed',
            attunement: 0,
          },
          epilogue:
            'The pattern lands in nine seconds. The battery stops. So does the shelter. ' +
            'Vela does not speak on the walk back, and the Coalition writes your name down in a different column.',
          velaLine: 'You had the range on that shelter. You had it and you called it anyway.',
        },
        {
          id: 'breach',
          label: 'Breach on foot',
          summary: 'Slow, close, and expensive. The shelter survives if you do.',
          requires: null,
          resolves: 'encounter',
          encounter: 'e3_breach',
          consequences: {
            rep: { coalition: 26, kaldreich: -14 },
            territory: 6,
            morale: 8,
            loyalty: 20,
            civilians: 'saved',
            attunement: 0,
          },
          epilogue:
            'You take the battery room by room. It costs you most of a magazine and all of your margin. ' +
            'Eleven metres away, a shelter door opens and stays open.',
          velaLine: 'That was the hard way. I\'ll walk it with you again.',
        },
        {
          id: 'ashborn',
          label: 'Signal the Ashborn',
          summary: 'Burn the relic. Something else finishes the work.',
          requires: { relicCharges: 1 },
          requiresText: 'Requires 1 Emberlash charge',
          resolves: 'immediate',
          consequences: {
            rep: { ashborn: 30, kaldreich: -20, coalition: -12 },
            territory: 10,
            morale: -12,
            loyalty: -8,
            civilians: 'changed',
            attunement: 2,
          },
          epilogue:
            'You hold the core up and let it answer. The blue takes the bunker without sound. ' +
            'The shelter door opens later, and the people who come out are alive, and are quiet, and do not look at you.',
          velaLine: 'Whatever that was — it knew where the walls were. It knew where we were, too.',
        },
      ],
    },
  },

  /** Territory is a 0..100 Kaldreich-control figure for this salient. */
  warfront: { start: 68, label: 'Vaunt Salient' },
};

export default MISSION;
