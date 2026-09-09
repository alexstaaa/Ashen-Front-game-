/**
 * Authored faction data. Reputation is a signed -100..100 scale per faction;
 * there is no "good" pole, only who currently tolerates you.
 */
export const FACTIONS = {
  kaldreich: {
    id: 'kaldreich',
    name: 'Kaldreich Empire',
    short: 'KALD',
    blurb: 'Industrial war machine. Rail-fed artillery, gas doctrine, no retreat orders.',
    color: '#8d5b3a',
    accent: '#c2703f',
  },
  coalition: {
    id: 'coalition',
    name: 'Free Marches Coalition',
    short: 'FMC',
    blurb: 'Guerrilla levies and village militias. Fights for ground it also lives on.',
    color: '#6f7a52',
    accent: '#9fb066',
  },
  ashborn: {
    id: 'ashborn',
    name: 'The Ashborn',
    short: 'ASH',
    blurb: 'Relic-bearers out of the pre-war silence. Their help is never only help.',
    color: '#3c5c74',
    accent: '#63b7e6',
  },
};

export const FACTION_IDS = Object.keys(FACTIONS);

export const REP_TIERS = [
  { min: 60, label: 'Sworn' },
  { min: 25, label: 'Trusted' },
  { min: 5, label: 'Tolerated' },
  { min: -5, label: 'Unknown' },
  { min: -25, label: 'Watched' },
  { min: -60, label: 'Marked' },
  { min: -101, label: 'Hunted' },
];

export function repTier(value) {
  return REP_TIERS.find((t) => value >= t.min)?.label ?? 'Unknown';
}

/**
 * Cross-faction spillover. Helping one side is read by the others; the matrix
 * is what turns a single mission decision into a shifting diplomatic map.
 */
export const REP_SPILLOVER = {
  kaldreich: { coalition: -0.35, ashborn: -0.1 },
  coalition: { kaldreich: -0.4, ashborn: -0.1 },
  ashborn: { kaldreich: -0.25, coalition: -0.25 },
};
