import { describe, it, expect } from 'vitest';
import { makeHarness, STEP } from './helpers.js';
import { toggleLockOn } from '../src/sim/player.js';
import { spawnActor, TEAMS } from '../src/sim/world.js';
import { applyDamage } from '../src/sim/combat.js';

/**
 * Control mapping is a regression surface: it is easy to invert a sign and
 * hard to notice in a diff. These lock the camera-relative convention down.
 *
 * At yaw 0 the camera looks along +Z, so its screen-right is world -X.
 */
describe('player controls', () => {
  it('moves forward along the camera direction', () => {
    const h = makeHarness({ seed: 2 });
    const start = { ...h.player.pos };
    h.run(0.5, { axisZ: 1, yaw: 0 });
    expect(h.player.pos.z).toBeGreaterThan(start.z + 1);
    expect(Math.abs(h.player.pos.x - start.x)).toBeLessThan(0.05);
  });

  it('strafes toward screen-right, which is world -X at yaw 0', () => {
    const h = makeHarness({ seed: 2 });
    const start = { ...h.player.pos };
    h.run(0.5, { axisX: 1, yaw: 0 });
    expect(h.player.pos.x).toBeLessThan(start.x - 1);
  });

  it('keeps movement camera-relative when the camera turns', () => {
    const h = makeHarness({ seed: 2 });
    const start = { ...h.player.pos };
    h.run(0.5, { axisZ: 1, yaw: Math.PI / 2 }); // forward is now +X
    expect(h.player.pos.x).toBeGreaterThan(start.x + 1);
    expect(Math.abs(h.player.pos.z - start.z)).toBeLessThan(0.15);
  });

  it('does not drift when no direction is held', () => {
    const h = makeHarness({ seed: 2 });
    const start = { ...h.player.pos };
    h.run(1.0, { yaw: 0 });
    expect(Math.hypot(h.player.pos.x - start.x, h.player.pos.z - start.z)).toBeLessThan(0.05);
  });

  it('fires on the fire input and spends a round', () => {
    const h = makeHarness({ seed: 2 });
    const before = h.player.mag;
    h.run(0.5, { yaw: 0, fire: true });
    expect(h.player.mag).toBe(before - 1);
  });

  it('reloads automatically when the magazine runs dry', () => {
    const h = makeHarness({ seed: 2 });
    h.player.mag = 0;
    h.run(0.2, { yaw: 0, fire: true });
    expect(h.player.action?.moveId).toBe('rifle.reload');
  });

  it('cannot dive twice inside the dive cooldown', () => {
    const h = makeHarness({ seed: 2 });
    h.run(0.1, { yaw: 0, dive: true });
    expect(h.player.action?.moveId).toBe('move.dive');
    h.run(0.7, { yaw: 0 });
    const rejectedBefore = h.events('action.rejected').length;
    h.run(0.05, { yaw: 0, dive: true });
    expect(h.events('action.rejected').length).toBeGreaterThan(rejectedBefore);
  });

  it('acquires and releases a lock-on target', () => {
    const h = makeHarness({ seed: 2 });
    const enemy = spawnActor(h.world, 'kald_rifleman', { x: 0, z: -30 }, { team: TEAMS.kaldreich });
    h.player.facing = Math.atan2(0, -1); // look down -Z, toward the enemy
    h.player.facing = Math.atan2(enemy.pos.x - h.player.pos.x, enemy.pos.z - h.player.pos.z);

    expect(toggleLockOn(h.world, h.player, h.control)).toBe(enemy.id);
    expect(toggleLockOn(h.world, h.player, h.control)).toBeNull();

    toggleLockOn(h.world, h.player, h.control);
    applyDamage(h.world, enemy, { amount: 999, sourceId: h.player.id, moveId: 'test' });
    h.run(STEP * 2, { yaw: 0 });
    expect(h.control.lockTargetId).toBeNull();
  });
});
