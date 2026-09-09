/**
 * Authored move table. Every combat verb in the game — player, ally and enemy
 * alike — is one of these records. Nothing else is allowed to invent timing.
 *
 * Timing fields are seconds and are read against the single simulation clock:
 *   startup   telegraph; the move is committed but cannot yet cause contact
 *   windows   [[from,to], ...] active windows measured from move start
 *   recovery  after the last window; movement and turning are restricted
 *   cooldown  measured from move start
 *   minCommit earliest point the move may be cancelled by anything at all
 *
 * `contact` describes the authoritative shape used to resolve outcomes. The
 * renderer never decides whether something was hit.
 */

export const MOVES = {
  // ---------------------------------------------------------------- player
  'rifle.fire': {
    id: 'rifle.fire',
    label: 'Rifle',
    tags: ['ranged', 'primary'],
    startup: 0.07,
    windows: [[0.07, 0.09]],
    recovery: 0.21,
    cooldown: 0.28,
    minCommit: 0.07,
    cost: { ammo: 1 },
    moveSpeedMul: 0.45,
    turnSpeed: 6.0,
    cancelableBy: ['move.dive'],
    contact: {
      type: 'hitscan',
      range: 38,
      coneDeg: 4,
      accuracy: 0.88,
      damage: 24,
      posture: 12,
      falloffStart: 22,
      falloffMul: 0.6,
    },
    fx: { muzzle: 'muzzle.rifle', sound: 'sfx.rifle' },
  },

  'rifle.reload': {
    id: 'rifle.reload',
    label: 'Reload',
    tags: ['utility'],
    startup: 0.15,
    windows: [],
    recovery: 1.75,
    cooldown: 0,
    minCommit: 0.15,
    moveSpeedMul: 0.7,
    turnSpeed: 4.0,
    cancelableBy: ['move.dive'],
    onComplete: 'reload',
    fx: { sound: 'sfx.reload' },
  },

  'melee.bayonet': {
    id: 'melee.bayonet',
    label: 'Bayonet',
    tags: ['melee'],
    startup: 0.2,
    windows: [[0.2, 0.33]],
    recovery: 0.46,
    cooldown: 0.7,
    minCommit: 0.2,
    moveSpeedMul: 0.25,
    turnSpeed: 2.2,
    lungeSpeed: 4.2,
    contact: {
      type: 'arc',
      range: 2.4,
      coneDeg: 90,
      damage: 34,
      posture: 48,
      knockback: 2.4,
      maxTargets: 2,
    },
    fx: { sound: 'sfx.bayonet' },
  },

  'move.dive': {
    id: 'move.dive',
    label: 'Dive',
    tags: ['defense', 'mobility'],
    startup: 0.05,
    windows: [],
    invuln: [0.05, 0.32],
    recovery: 0.26,
    cooldown: 0.85,
    minCommit: 0.05,
    moveSpeedMul: 0,
    turnSpeed: 0,
    impulse: 9.6,
    breaksCover: true,
    fx: { sound: 'sfx.dive' },
  },

  'relic.emberlash': {
    id: 'relic.emberlash',
    label: 'Emberlash',
    tags: ['relic', 'arcane'],
    startup: 0.35,
    windows: [[0.35, 0.46]],
    recovery: 0.62,
    cooldown: 3.5,
    minCommit: 0.35,
    cost: { relic: 1 },
    moveSpeedMul: 0.15,
    turnSpeed: 3.0,
    attunement: 1,
    contact: {
      type: 'arc',
      range: 9.5,
      coneDeg: 64,
      damage: 30,
      posture: 75,
      ignoresCover: true,
      status: { id: 'burning', duration: 3, dps: 6 },
      maxTargets: 6,
    },
    fx: { sound: 'sfx.relic', flash: 'relic.flash' },
  },

  // ---------------------------------------------------------------- ally
  'vela.aimed': {
    id: 'vela.aimed',
    label: 'Aimed shot',
    tags: ['ranged'],
    startup: 0.55,
    windows: [[0.55, 0.57]],
    recovery: 0.6,
    cooldown: 2.1,
    minCommit: 0.3,
    moveSpeedMul: 0,
    turnSpeed: 3.5,
    ai: { minRange: 2, maxRange: 30, weight: 1, requiresLos: true },
    contact: {
      type: 'hitscan',
      range: 32,
      coneDeg: 6,
      accuracy: 0.74,
      damage: 18,
      posture: 10,
      falloffStart: 20,
      falloffMul: 0.7,
    },
    fx: { muzzle: 'muzzle.rifle', sound: 'sfx.rifle' },
  },

  // ---------------------------------------------------------------- enemy
  'kald.snapshot': {
    id: 'kald.snapshot',
    label: 'Snap shot',
    tags: ['ranged'],
    startup: 0.62, // long enough to read the shoulder-up telegraph and break line
    windows: [[0.62, 0.64]],
    recovery: 0.75,
    cooldown: 1.7,
    minCommit: 0.35,
    moveSpeedMul: 0,
    turnSpeed: 2.4,
    telegraph: 'aim',
    ai: { minRange: 2.6, maxRange: 28, weight: 1, requiresLos: true },
    contact: {
      type: 'hitscan',
      range: 30,
      coneDeg: 5,
      accuracy: 0.6,
      damage: 11,
      posture: 7,
      falloffStart: 16,
      falloffMul: 0.55,
    },
    fx: { muzzle: 'muzzle.rifle', sound: 'sfx.rifle' },
  },

  'kald.suppress': {
    id: 'kald.suppress',
    label: 'Suppressing fire',
    tags: ['ranged', 'control'],
    startup: 0.7,
    windows: [
      [0.7, 0.72],
      [1.0, 1.02],
      [1.3, 1.32],
    ],
    recovery: 0.85,
    cooldown: 6.5,
    minCommit: 0.7,
    moveSpeedMul: 0,
    turnSpeed: 1.4,
    telegraph: 'aim',
    ai: { minRange: 6, maxRange: 28, weight: 0.8, requiresLos: true, preferTargetInCover: true },
    contact: {
      type: 'hitscan',
      range: 30,
      coneDeg: 8,
      accuracy: 0.34,
      damage: 6,
      posture: 4,
      status: { id: 'suppressed', duration: 2.2 },
      falloffStart: 18,
      falloffMul: 0.6,
    },
    fx: { muzzle: 'muzzle.rifle', sound: 'sfx.rifle' },
  },

  'kald.lob': {
    id: 'kald.lob',
    label: 'Stick grenade',
    tags: ['ranged', 'flush'],
    startup: 1.1, // deliberately slow: this is the "get out of cover" siren
    windows: [[1.1, 1.14]],
    recovery: 0.9,
    cooldown: 8.5,
    minCommit: 0.6,
    moveSpeedMul: 0.2,
    turnSpeed: 2.0,
    telegraph: 'lob',
    ai: { minRange: 6, maxRange: 22, weight: 1.1, requiresLos: false, preferTargetInCover: true },
    contact: {
      type: 'projectile',
      projectile: {
        speed: 13,
        fuse: 1.7,
        blastRadius: 4.6,
        damage: 46,
        posture: 60,
        ignoresCover: true,
        markerRadius: 4.6,
      },
    },
    fx: { sound: 'sfx.lob' },
  },

  'kald.bash': {
    id: 'kald.bash',
    label: 'Rifle butt',
    tags: ['melee'],
    startup: 0.38,
    windows: [[0.38, 0.48]],
    recovery: 0.62,
    cooldown: 2.0,
    minCommit: 0.38,
    moveSpeedMul: 0.3,
    turnSpeed: 2.6,
    telegraph: 'bash',
    ai: { minRange: 0, maxRange: 2.3, weight: 2.2, requiresLos: true },
    contact: {
      type: 'arc',
      range: 2.6,
      coneDeg: 80,
      damage: 18,
      posture: 42,
      knockback: 2.0,
      maxTargets: 1,
    },
    fx: { sound: 'sfx.bayonet' },
  },
};

/** Total duration of a move, from start to the end of recovery. */
export function moveDuration(move) {
  const lastWindow = move.windows?.length ? move.windows[move.windows.length - 1][1] : move.startup;
  return Math.max(lastWindow, move.startup) + move.recovery;
}

/** Phase name at time `t` since the move started. */
export function movePhase(move, t) {
  if (t < move.startup) return 'startup';
  for (const [from, to] of move.windows ?? []) {
    if (t >= from && t < to) return 'active';
  }
  if (t < moveDuration(move)) return 'recovery';
  return 'done';
}

/** Index of the active window at time `t`, or -1. */
export function activeWindowIndex(move, t) {
  const windows = move.windows ?? [];
  for (let i = 0; i < windows.length; i++) {
    if (t >= windows[i][0] && t < windows[i][1]) return i;
  }
  return -1;
}

export function isInvulnerable(move, t) {
  if (!move.invuln) return false;
  return t >= move.invuln[0] && t < move.invuln[1];
}
