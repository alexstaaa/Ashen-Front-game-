import { describe, it, expect } from 'vitest';
import { validateContent } from '../src/content/validate.js';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { MOVES, moveDuration, movePhase, activeWindowIndex } from '../src/content/moves.js';
import { ACTORS } from '../src/content/actors.js';

describe('authored content', () => {
  it('validates with no errors', () => {
    const { errors, warnings } = validateContent();
    expect(errors, errors.join('\n')).toEqual([]);
    // Warnings are allowed but should be visible if they appear.
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('keeps every gameplay element on the single plane', () => {
    for (const o of LEVEL.obstacles) expect('y' in o).toBe(false);
    for (const a of Object.values(LEVEL.anchors)) expect('y' in a).toBe(false);
    for (const z of LEVEL.zones) expect('y' in z).toBe(false);
    expect(LEVEL.planeY).toBe(0);
  });

  it('attaches every local light to a visible emitter', () => {
    for (const l of LEVEL.lights.local) {
      expect(l.emitterId).toBeTruthy();
      expect(l.emitter).toBeTruthy();
      expect(l.emitter.x).toBeTypeOf('number');
      expect(l.emitter.z).toBeTypeOf('number');
    }
    for (const l of LEVEL.lights.runtime) {
      expect(l.movesWithEmitter).toBe(true);
      expect(l.lifetime).toBeGreaterThan(0);
    }
  });

  it('labels placeholder visuals honestly', () => {
    for (const def of Object.values(ACTORS)) {
      expect(def.placeholder).toBe(true);
      expect(def.provenance).toMatch(/placeholder/);
    }
  });
});

describe('facing convention', () => {
  // The renderer applies `rotation.y = facing` to geometry authored facing
  // local +Z. If either side of that contract flips, characters render
  // backwards, so pin the shared maths here.
  it('places the muzzle socket ahead of the actor', async () => {
    const { createWorld, spawnActor, socketPos } = await import('../src/sim/world.js');
    const { LEVEL } = await import('../src/content/level-trenchfront.js');
    const { MISSION } = await import('../src/content/mission-cut-the-wire.js');
    const world = createWorld({ level: LEVEL, mission: MISSION, seed: 1 });
    const e = spawnActor(world, 'player', { x: 0, z: 0 });

    e.facing = 0; // forward is +Z
    let m = socketPos(e, 'muzzle');
    expect(m.z).toBeGreaterThan(0.5);
    expect(Math.abs(m.x)).toBeLessThan(0.2);

    e.facing = Math.PI / 2; // forward is +X
    m = socketPos(e, 'muzzle');
    expect(m.x).toBeGreaterThan(0.5);
    expect(Math.abs(m.z)).toBeLessThan(0.2);
  });

  it('agrees with math2 forward()', async () => {
    const { forward, angleOf } = await import('../src/core/math2.js');
    for (const a of [0, 0.7, Math.PI / 2, 2.6, -1.4]) {
      const f = forward(a);
      expect(angleOf(f)).toBeCloseTo(a, 6);
      expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 6);
    }
  });
});

describe('move timing', () => {
  it('computes phases across the whole timeline', () => {
    const m = MOVES['rifle.fire'];
    expect(movePhase(m, 0)).toBe('startup');
    expect(movePhase(m, 0.075)).toBe('active');
    expect(movePhase(m, 0.15)).toBe('recovery');
    expect(movePhase(m, moveDuration(m) + 0.01)).toBe('done');
  });

  it('reports each active window of a multi-window move', () => {
    const m = MOVES['kald.suppress'];
    expect(activeWindowIndex(m, 0.71)).toBe(0);
    expect(activeWindowIndex(m, 0.85)).toBe(-1);
    expect(activeWindowIndex(m, 1.01)).toBe(1);
    expect(activeWindowIndex(m, 1.31)).toBe(2);
  });

  it('never opens an active window before startup completes', () => {
    for (const m of Object.values(MOVES)) {
      for (const [from] of m.windows ?? []) expect(from).toBeGreaterThanOrEqual(m.startup);
    }
  });

  it('gives every enemy attack a readable telegraph', () => {
    for (const id of ['kald.snapshot', 'kald.suppress', 'kald.lob', 'kald.bash']) {
      expect(MOVES[id].startup).toBeGreaterThanOrEqual(0.35);
      expect(MOVES[id].telegraph).toBeTruthy();
    }
  });
});
