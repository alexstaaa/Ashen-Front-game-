import { describe, it, expect } from 'vitest';
import { makeHarness } from './helpers.js';
import { makeRng, hashSeed } from '../src/core/rng.js';
import { snapshotWorld } from '../src/sim/world.js';

const SCRIPT = [
  { seconds: 3.0, input: { axisZ: 1, yaw: 0 } },
  { seconds: 1.2, input: { axisZ: 1, yaw: 0, fire: true } },
  { seconds: 0.8, input: { axisX: 1, yaw: 0, dive: true } },
  { seconds: 2.5, input: { axisZ: 1, yaw: 0, fire: true } },
  { seconds: 2.0, input: { yaw: 0, relic: true } },
  { seconds: 3.0, input: { axisZ: 1, yaw: 0, fire: true } },
];

function playScript(seed) {
  const h = makeHarness({ seed });
  for (const beat of SCRIPT) h.run(beat.seconds, beat.input);
  return h;
}

describe('determinism', () => {
  it('produces identical worlds for identical seeds and inputs', () => {
    const a = snapshotWorld(playScript(1234).world);
    const b = snapshotWorld(playScript(1234).world);
    expect(b).toEqual(a);
  });

  it('produces different worlds for different seeds', () => {
    const a = snapshotWorld(playScript(1234).world);
    const b = snapshotWorld(playScript(99).world);
    expect(b).not.toEqual(a);
  });

  it('replays the same event stream for the same seed', () => {
    const a = playScript(77).log.map((e) => e.type).join('|');
    const b = playScript(77).log.map((e) => e.type).join('|');
    expect(b).toBe(a);
  });

  it('gives a reproducible rng from a saved state', () => {
    const rng = makeRng(hashSeed('vaunt-salient'));
    for (let i = 0; i < 50; i++) rng.next();
    const state = rng.getState();
    const expected = [rng.next(), rng.next(), rng.next()];
    rng.setState(state);
    expect([rng.next(), rng.next(), rng.next()]).toEqual(expected);
  });

  it('snapshots enough state to describe the run', () => {
    const snap = snapshotWorld(playScript(5).world);
    expect(snap.entities.length).toBeGreaterThan(2);
    expect(snap.entities[0]).toHaveProperty('hp');
    expect(snap.entities[0]).toHaveProperty('pos');
    expect(snap).toHaveProperty('rngState');
    expect(snap).toHaveProperty('flags');
  });
});
