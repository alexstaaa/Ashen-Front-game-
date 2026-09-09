import { describe, it, expect } from 'vitest';
import { LEVEL } from '../src/content/level-trenchfront.js';
import { coverAgainst, hasLineOfSight, findCoverSpots } from '../src/sim/cover.js';

// sb_1 is a low sandbag line at x=4, z=-4, 4.4 x 1.2
const SB1 = LEVEL.obstacles.find((o) => o.id === 'sb_1');
// truck is a high wall at x=-7, z=2, 5.4 x 2.6
const TRUCK = LEVEL.obstacles.find((o) => o.id === 'truck');

describe('line of sight', () => {
  it('is blocked by high obstacles', () => {
    const a = { x: -7, z: -4 };
    const b = { x: -7, z: 8 };
    expect(hasLineOfSight(LEVEL, a, b)).toBe(false);
  });

  it('is not blocked by low obstacles', () => {
    const a = { x: 4, z: -8 };
    const b = { x: 4, z: 0 };
    expect(hasLineOfSight(LEVEL, a, b)).toBe(true);
  });

  it('is clear across open ground', () => {
    expect(hasLineOfSight(LEVEL, { x: 0, z: -20 }, { x: 0, z: -12 })).toBe(true);
  });
});

describe('cover', () => {
  it('protects an actor tucked behind a low obstacle', () => {
    const behind = { x: SB1.x, z: SB1.z + SB1.d / 2 + 0.6 };
    const threat = { x: SB1.x, z: SB1.z - 8 };
    expect(coverAgainst(LEVEL, behind, threat).inCover).toBe(true);
  });

  it('does not protect the same actor from the other side', () => {
    const behind = { x: SB1.x, z: SB1.z + SB1.d / 2 + 0.6 };
    const flanker = { x: SB1.x, z: SB1.z + 10 };
    expect(coverAgainst(LEVEL, behind, flanker).inCover).toBe(false);
  });

  it('does not protect an actor standing away from the obstacle', () => {
    const open = { x: SB1.x, z: SB1.z + 4 };
    const threat = { x: SB1.x, z: SB1.z - 8 };
    expect(coverAgainst(LEVEL, open, threat).inCover).toBe(false);
  });

  it('never treats a high wall as cover to hug', () => {
    const beside = { x: TRUCK.x, z: TRUCK.z + TRUCK.d / 2 + 0.5 };
    const threat = { x: TRUCK.x, z: TRUCK.z - 10 };
    // Sight is blocked outright, and the truck is not offered as low cover.
    expect(hasLineOfSight(LEVEL, threat, beside)).toBe(false);
    expect(coverAgainst(LEVEL, beside, threat).obstacle?.id).not.toBe('truck');
  });

  it('offers cover spots that are actually in cover', () => {
    const threat = { x: 0, z: -14 };
    const spots = findCoverSpots(LEVEL, { x: 2, z: -2 }, threat, { maxRange: 16 });
    expect(spots.length).toBeGreaterThan(0);
    for (const s of spots) {
      expect(coverAgainst(LEVEL, s.pos, threat).inCover).toBe(true);
    }
  });
});
