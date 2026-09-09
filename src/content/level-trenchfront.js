/**
 * Authored level: "Vaunt Salient" — the trench front the slice takes place on.
 *
 * ONE GAMEPLAY PLANE
 * All collision, navigation, spawns, zones and pickups live at y = 0. Trenches
 * are read vertically as *parapets built up* rather than ground dug down, so
 * the fiction reads as trench warfare while the walkable surface stays flat.
 * `dressing` entries are background only: they never collide, block sight or
 * change navigation. src/content/validate.js enforces all of this.
 *
 * OBSTACLES
 *   height 'high'  full wall — blocks movement and line of sight
 *   height 'low'   waist-high — blocks movement, does NOT block sight,
 *                  and grants cover to whoever is tucked behind it
 */

export const PLANE_Y = 0;
export const BOUNDS = { x: 0, z: 0, w: 62, d: 104 };

const wall = (id, x, z, w, d, kind = 'parapet') => ({ id, x, z, w, d, height: 'high', kind });
const low = (id, x, z, w, d, kind = 'sandbag') => ({ id, x, z, w, d, height: 'low', kind });

export const LEVEL = {
  id: 'vaunt_salient',
  name: 'Vaunt Salient',
  planeY: PLANE_Y,
  bounds: BOUNDS,
  fog: { color: '#5b5c55', near: 16, far: 88 },
  sky: { top: '#3a4048', bottom: '#5b5c55' },
  ground: { color: '#39352c', mud: '#231f19' },

  obstacles: [
    // --- friendly start trench -------------------------------------------
    wall('parapet_w', -11, -39, 1.2, 14),
    wall('parapet_e', 11, -39, 1.2, 14),
    wall('parapet_s', 0, -46, 23, 1.2),
    low('firestep_l', -5.5, -34.5, 9, 1.0),
    low('firestep_r', 5.5, -34.5, 9, 1.0),

    // --- no man's land ----------------------------------------------------
    // Flanking parapets close the salient laterally: the route through the
    // wire is meant to be a decision, not something you can walk around.
    wall('nml_w', -19, -22, 1.2, 24),
    wall('nml_e', 19, -22, 1.2, 24),
    wall('nml_s_w', -15, -34, 8, 1.2),
    wall('nml_s_e', 15, -34, 8, 1.2),
    low('wire_1', -6, -28, 14, 0.8, 'wire'),
    low('wire_2', 8, -24, 12, 0.8, 'wire'),
    low('rubble_a', -3, -22, 3.2, 2.4, 'rubble'),
    low('rubble_b', 6, -18, 3.6, 2.6, 'rubble'),
    low('rubble_c', -9, -15, 3.0, 3.0, 'rubble'),

    // --- junction arena ---------------------------------------------------
    wall('arena_w', -19, 0, 1.2, 26),
    wall('arena_e', 19, 0, 1.2, 26),
    wall('arena_n_w', -13.5, 12.5, 11, 1.2),
    wall('arena_n_e', 13.5, 12.5, 11, 1.2),
    wall('truck', -7, 2, 5.4, 2.6, 'truck'),
    low('sb_1', 4, -4, 4.4, 1.2),
    low('sb_2', 10, 4, 1.2, 5.0),
    low('sb_3', -4, 8, 5.0, 1.2),
    low('mg_nest', 0, 11, 4.0, 1.6, 'nest'),

    // --- approach corridor -------------------------------------------------
    wall('corr_w', -8.5, 19, 1.2, 16),
    wall('corr_e', 8.5, 19, 1.2, 16),
    low('sb_4', -3, 17, 3.4, 1.2),
    low('sb_5', 3.5, 22, 3.0, 1.2),

    // --- bunker plaza ------------------------------------------------------
    wall('plaza_w', -20, 35, 1.2, 20),
    wall('plaza_e', 20, 35, 1.2, 20),
    wall('plaza_n', 0, 45, 42, 1.2),
    wall('plaza_s_w', -14.5, 26.5, 11, 1.2),
    wall('plaza_s_e', 14.5, 26.5, 11, 1.2),
    wall('bunker', -2, 40, 12, 6, 'bunker'),
    wall('shelter', 13, 33, 7, 6, 'shelter'),
    low('sb_6', -8, 30, 4, 1.2),
    low('sb_7', 4, 31, 4, 1.2),
  ],

  /** Stable anchors shared by spawns, objectives, camera hints and fixtures. */
  anchors: {
    player_start: { x: 0, z: -41 },
    vela_start: { x: -2.2, z: -41.5 },
    wire_center: { x: 0, z: -26 },
    junction_center: { x: 0, z: 1 },
    nest: { x: 0, z: 9 },
    approach_mid: { x: 0, z: 19 },
    plaza_center: { x: 0, z: 32 },
    bunker_door: { x: -2, z: 36 },
    shelter_door: { x: 13, z: 29.2 },

    e1_a: { x: -5, z: -19 },
    e1_b: { x: 7, z: -15 },
    e2_a: { x: 4, z: -1 },
    e2_b: { x: -5, z: 6 },
    e2_c: { x: 10, z: 7 },
    e2_d: { x: -9, z: 4 },
    e3_a: { x: -7, z: 33 },
    e3_b: { x: 5, z: 34 },
    e3_c: { x: -1, z: 36 },
    civ_1: { x: 11.2, z: 28.8 },
    civ_2: { x: 14.6, z: 29.0 },
    civ_3: { x: 12.8, z: 28.2 },
  },

  /**
   * The authored critical path, start to bunker. Every consecutive leg must be
   * walkable for a player-radius actor — the wire belts and the MG nest are
   * meant to redirect the route, never to block it. Validated in content
   * validation and asserted in tests/mission.test.js.
   */
  route: [
    { id: 'start', x: 0, z: -41 },
    { id: 'trench_gap', x: 0, z: -33.2 },
    { id: 'wire_gap_east', x: 3.5, z: -29 },
    { id: 'wire_pocket', x: 3.5, z: -26 },
    { id: 'wire_gap_west', x: 0, z: -25.5 },
    { id: 'nml_mid', x: 0, z: -21 },
    { id: 'nml_north', x: 0, z: -12 },
    { id: 'junction_south', x: 0, z: -6 },
    { id: 'junction_mid', x: 0, z: 2 },
    { id: 'nest_flank', x: 4, z: 9 },
    { id: 'corridor_mouth', x: 4, z: 13 },
    { id: 'corridor', x: 0, z: 19 },
    { id: 'plaza_south', x: 0, z: 26 },
    { id: 'plaza', x: 0, z: 30 },
  ],

  /** Encounter / gate / objective volumes. Entering one is an authored event. */
  zones: [
    { id: 'z_start', kind: 'safe', x: 0, z: -40, w: 21, d: 12 },
    { id: 'z_wire', kind: 'encounter', x: 0, z: -25, w: 30, d: 10, encounter: 'e1_wire' },
    { id: 'z_junction', kind: 'encounter', x: 0, z: -6, w: 36, d: 8, encounter: 'e2_junction' },
    { id: 'z_gate_approach', kind: 'gate', x: 0, z: 12.5, w: 16, d: 3, requires: 'e2_junction' },
    { id: 'z_bunker', kind: 'objective', x: 0, z: 29.5, w: 18, d: 5, objective: 'reach_bunker' },
    { id: 'z_shelter', kind: 'marker', x: 13, z: 30.5, w: 8, d: 4 },
  ],

  /**
   * SOURCE-TO-LIGHT INVENTORY
   * Every local light is attached to a prop the player can see. There are no
   * unexplained floating lights; disabling an emitter removes its light.
   */
  lights: {
    ambient: {
      // Overcast skies bounce a lot of flat light; this is what keeps soldiers
      // readable in shadow without inventing a local source to light them.
      hemisphere: { sky: '#8d939c', ground: '#4a443a', intensity: 0.95 },
      sun: { color: '#c4bda6', intensity: 1.05, direction: { x: -0.4, y: -0.8, z: 0.45 } },
      note: 'Overcast dusk. Global only — never used to fake a local emitter.',
    },
    local: [
      {
        id: 'lt_brazier',
        emitterId: 'em_brazier',
        emitter: { kind: 'brazier', x: -4, z: -37, radius: 0.5, height: 0.9 },
        attach: { x: 0, y: 1.0, z: 0 },
        type: 'point',
        color: '#ff9a4d',
        intensity: 3.2,
        range: 9,
        flicker: 0.18,
        castShadow: false,
        enabled: true,
      },
      {
        id: 'lt_truck_fire',
        emitterId: 'em_truck_fire',
        emitter: { kind: 'wreck_fire', x: -7, z: 2, radius: 1.4, height: 1.6, attachedTo: 'truck' },
        attach: { x: 0, y: 1.4, z: 0 },
        type: 'point',
        color: '#ff7a33',
        intensity: 5.0,
        range: 15,
        flicker: 0.32,
        castShadow: false,
        enabled: true,
      },
      {
        id: 'lt_bunker_lamp',
        emitterId: 'em_bunker_lamp',
        emitter: { kind: 'lamp', x: -2, z: 36.9, radius: 0.22, height: 2.4, attachedTo: 'bunker' },
        attach: { x: 0, y: 2.4, z: 0 },
        type: 'point',
        color: '#cbb27a',
        intensity: 2.6,
        range: 11,
        flicker: 0.04,
        castShadow: false,
        enabled: true,
      },
      {
        id: 'lt_shelter_lamp',
        emitterId: 'em_shelter_lamp',
        emitter: { kind: 'lamp', x: 13, z: 29.9, radius: 0.2, height: 2.2, attachedTo: 'shelter' },
        attach: { x: 0, y: 2.2, z: 0 },
        type: 'point',
        color: '#d8b57a',
        intensity: 1.8,
        range: 8,
        flicker: 0.05,
        castShadow: false,
        enabled: true,
      },
    ],
    /**
     * Runtime emitters: spawned with their own visible source and destroyed
     * together with it. The flare's light moves with the flare and is removed
     * when the flare burns out — never left detached.
     */
    runtime: [
      {
        id: 'lt_flare',
        emitterId: 'em_flare',
        type: 'point',
        color: '#e8f0ff',
        intensity: 6,
        range: 26,
        lifetime: 9,
        movesWithEmitter: true,
      },
    ],
  },

  /**
   * Background dressing. Non-walkable, non-colliding, never sight-blocking.
   * Nothing here may imply traversal or height change.
   */
  dressing: [
    { kind: 'crater', x: -12, z: -30, r: 3.4 },
    { kind: 'crater', x: 9, z: -33, r: 2.6 },
    { kind: 'crater', x: 2, z: -12, r: 4.2 },
    { kind: 'crater', x: -14, z: 6, r: 3.0 },
    { kind: 'crater', x: 6, z: 24, r: 2.4 },
    { kind: 'duckboard', x: 0, z: -37, w: 3, d: 6 },
    { kind: 'duckboard', x: 0, z: 19, w: 3, d: 12 },
    { kind: 'deadtree', x: -16, z: -20, h: 5.5 },
    { kind: 'deadtree', x: 15, z: -8, h: 4.2 },
    { kind: 'deadtree', x: -17, z: 22, h: 6.1 },
    { kind: 'post', x: -6, z: -28, h: 1.6 },
    { kind: 'post', x: 8, z: -24, h: 1.6 },
    { kind: 'ridge', x: 0, z: 62, w: 160, h: 14, note: 'far silhouette, background only' },
    { kind: 'ridge', x: 0, z: -66, w: 160, h: 11, note: 'far silhouette, background only' },
    { kind: 'graves', x: -15, z: -44, count: 9 },
    { kind: 'letters', x: 3.4, z: -21.2 },
    { kind: 'letters', x: -6.2, z: 9.4 },
  ],
};

export default LEVEL;
