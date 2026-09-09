/**
 * War magic is scavenged, not learned. A relic gives you a real tactical answer
 * to entrenched cover, and every use pushes an "attunement" counter that the
 * Ashborn read as interest and your squad reads as something else.
 */
export const RELICS = {
  emberlash: {
    id: 'emberlash',
    name: 'Emberlash Core',
    move: 'relic.emberlash',
    maxCharges: 3,
    startCharges: 1,
    /** charges are earned from the dead, which is the point */
    chargePerKill: 0.5,
    attunementPerUse: 1,
    /** squad morale cost of each use — the crew does not like the blue light */
    moralePerUse: -2,
    description:
      'A rune-etched capacitor pulled from a pre-war walker. Vents arcane heat in a forward cone. ' +
      'Ignores earthworks. Leaves a residue the Ashborn can find.',
  },
};

export const ATTUNEMENT_THRESHOLDS = [
  { at: 3, id: 'noticed', text: 'Something out past the wire has started to keep count.' },
  { at: 6, id: 'marked', text: 'The Ashborn know your name now. They have not said it aloud.' },
];
