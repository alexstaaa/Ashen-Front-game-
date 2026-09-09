/**
 * Authored actor definitions. These records are immutable content: no runtime
 * timer, health value or target ever lives here. Runtime instances reference a
 * definition by `id` (see sim/world.js).
 *
 * PRESENTATION CONTRACT
 * Every definition declares the same normalized presentation fields so the
 * renderer never needs per-actor special cases:
 *   factory        procedural builder id in render/actorViews.js
 *   provenance     where the visual comes from, honestly labelled
 *   placeholder    true = deliberate stand-in, drawn unmistakably as one
 *   metersPerUnit  1 (all authored geometry is already in metres)
 *   forwardAxis    '+Z' — matches math2's facing convention
 *   pivot          'ground' — origin sits on the gameplay plane
 *   radius         simple movement collider, independent of render geometry
 *   height         visual height, used for camera framing and HUD markers
 *   sockets        named contact/VFX origins in local space (x, y, z)
 */

const SOCKETS_INFANTRY = {
  muzzle: { x: 0.06, y: 1.3, z: 0.78 },
  chest: { x: 0, y: 1.15, z: 0.18 },
  head: { x: 0, y: 1.62, z: 0 },
  hand: { x: 0.3, y: 1.05, z: 0.35 },
  feet: { x: 0, y: 0.05, z: 0 },
};

const PRESENTATION_INFANTRY = {
  provenance: 'procedural placeholder (built in-engine, no imported mesh)',
  placeholder: true,
  metersPerUnit: 1,
  forwardAxis: '+Z',
  pivot: 'ground',
  radius: 0.45,
  height: 1.8,
  sockets: SOCKETS_INFANTRY,
};

export const ACTORS = {
  player: {
    id: 'player',
    name: 'Deserter',
    kind: 'player',
    faction: 'none',
    maxHp: 120,
    maxPosture: 100,
    postureRegen: 14, // per second, once out of combat pressure for a beat
    speed: 5.1,
    sprintMul: 1.55,
    turnSpeed: 9,
    magSize: 8,
    reserveAmmo: 56,
    moves: ['rifle.fire', 'rifle.reload', 'melee.bayonet', 'move.dive', 'relic.emberlash'],
    ...PRESENTATION_INFANTRY,
    factory: 'infantry',
    palette: { coat: '#4e5244', trim: '#7a715d', metal: '#9c9689', mask: '#35362f' },
  },

  vela: {
    id: 'vela',
    name: 'Cpl. Vela Ruhn',
    kind: 'ally',
    faction: 'coalition',
    maxHp: 90,
    maxPosture: 80,
    speed: 4.6,
    turnSpeed: 6,
    moves: ['vela.aimed'],
    ai: {
      preferredRange: [9, 22],
      coverSeekWeight: 0.9,
      downedTime: 22, // seconds bleeding out before she is lost for good
      reviveTime: 2.6,
    },
    morale: { start: 70, min: 0, max: 100 },
    loyalty: { start: 50, min: 0, max: 100 },
    ...PRESENTATION_INFANTRY,
    factory: 'infantry',
    palette: { coat: '#59614c', trim: '#93a06a', metal: '#a49d8b', mask: '#3a3f33' },
    barks: {
      advance: ['Moving! Cover the left.', 'On you.'],
      refuse: ["That's a killing field. I'm not walking into it.", 'No. Not for this.'],
      hurt: ['Hit! I\'m still up.', 'Bleeding, not done.'],
      down: ['Down — down! Get to me!'],
      revived: ['...Thanks. Let\'s finish it.'],
      kill: ['Target down.', 'Clear.'],
      lowMorale: ['We should not be here.', 'How many more, sir?'],
    },
  },

  kald_rifleman: {
    id: 'kald_rifleman',
    name: 'Kaldreich Rifleman',
    kind: 'enemy',
    faction: 'kaldreich',
    role: 'anchor', // holds cover and punishes standing still
    maxHp: 62,
    maxPosture: 60,
    speed: 3.7,
    turnSpeed: 3.2,
    moves: ['kald.snapshot', 'kald.suppress'],
    ai: {
      sightRange: 32,
      aggroRange: 26,
      hearRange: 34,
      preferredRange: [11, 24],
      coverSeekWeight: 1,
      repositionCooldown: 3.2,
      minStateDwell: 0.35,
      loseTargetTime: 4.5,
      staggerTime: 0.9,
    },
    reward: { relicCharge: 0.5, morale: 4 },
    ...PRESENTATION_INFANTRY,
    factory: 'infantry',
    palette: { coat: '#5d4832', trim: '#8d6038', metal: '#a29584', mask: '#2f2a23' },
  },

  kald_grenadier: {
    id: 'kald_grenadier',
    name: 'Kaldreich Grenadier',
    kind: 'enemy',
    faction: 'kaldreich',
    role: 'flusher', // exists to make cover temporary
    maxHp: 88,
    maxPosture: 85,
    speed: 4.1,
    turnSpeed: 3.6,
    moves: ['kald.lob', 'kald.bash'],
    ai: {
      sightRange: 30,
      aggroRange: 28,
      hearRange: 36,
      preferredRange: [8, 17],
      coverSeekWeight: 0.4,
      repositionCooldown: 2.4,
      minStateDwell: 0.4,
      loseTargetTime: 5.5,
      staggerTime: 1.1,
    },
    reward: { relicCharge: 1, morale: 7 },
    ...PRESENTATION_INFANTRY,
    radius: 0.52,
    height: 1.92,
    factory: 'infantry',
    palette: { coat: '#54402c', trim: '#a86a34', metal: '#a89a86', mask: '#211d18' },
  },

  civilian: {
    id: 'civilian',
    name: 'Marches civilian',
    kind: 'civilian',
    faction: 'coalition',
    maxHp: 30,
    maxPosture: 20,
    speed: 3.2,
    turnSpeed: 4,
    moves: [],
    ...PRESENTATION_INFANTRY,
    radius: 0.4,
    height: 1.7,
    factory: 'civilian',
    palette: { coat: '#5b5347', trim: '#7c6f5c', metal: '#6d6558', mask: '#3a352d' },
  },
};

export const ENEMY_IDS = Object.keys(ACTORS).filter((k) => ACTORS[k].kind === 'enemy');
