/**
 * Third-person game camera.
 *
 * Readability first: the player, the nearest threat and the objective marker
 * have to stay framed at the intended distance. Lock-on, shake and scripted
 * framing are temporary modifiers layered over that base — never replacements
 * for it. Occlusion pulls the camera in rather than making geometry vanish.
 */
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/math2.js';

export const PITCH_MIN = -0.5;
export const PITCH_MAX = 0.95;
export const DIST_MIN = 3.2;
export const DIST_MAX = 8.5;

export function createGameCamera(camera, { obstacleGroup, reducedMotion = false } = {}) {
  const state = {
    yaw: 0,
    pitch: 0.28,
    distance: 5.4,
    desiredDistance: 5.4,
    shoulder: 0.75,
    height: 1.45,
    shake: 0,
    lockBlend: 0,
  };

  const raycaster = new THREE.Raycaster();
  const smoothedTarget = new THREE.Vector3();
  const smoothedPos = new THREE.Vector3();
  let initialised = false;

  function look(dx, dy, sensitivity = 0.0026) {
    // Screen-right is world -X at yaw 0, so a rightward drag decreases yaw.
    state.yaw -= dx * sensitivity;
    state.pitch = clamp(state.pitch + dy * sensitivity, PITCH_MIN, PITCH_MAX);
  }

  function zoom(delta) {
    state.desiredDistance = clamp(state.desiredDistance + delta * 0.0022, DIST_MIN, DIST_MAX);
  }

  function shake(amount) {
    if (reducedMotion) return;
    state.shake = Math.min(1.2, state.shake + amount);
  }

  function update(dt, ctx) {
    const target = ctx.targetPos;
    const lockPos = ctx.lockPos ?? null;

    // Lock-on biases the camera behind the player toward the locked threat,
    // but the player keeps manual authority over pitch and zoom.
    state.lockBlend = lerp(state.lockBlend, lockPos ? 1 : 0, damp(6, dt));
    if (lockPos) {
      const desiredYaw = Math.atan2(lockPos.x - target.x, lockPos.z - target.z);
      let d = (desiredYaw - state.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d <= -Math.PI) d += Math.PI * 2;
      state.yaw += d * damp(5, dt);
    }

    state.distance = lerp(state.distance, state.desiredDistance, damp(7, dt));

    const fwd = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
    const right = { x: -fwd.z, z: fwd.x };
    const horizontal = Math.cos(state.pitch) * state.distance;
    const vertical = Math.sin(state.pitch) * state.distance;

    const focus = new THREE.Vector3(
      target.x + right.x * state.shoulder * 0.4,
      state.height,
      target.z + right.z * state.shoulder * 0.4,
    );
    // Frame slightly toward the locked threat so both stay on screen.
    if (lockPos && state.lockBlend > 0.01) {
      focus.x = lerp(focus.x, (focus.x + lockPos.x) / 2, state.lockBlend * 0.35);
      focus.z = lerp(focus.z, (focus.z + lockPos.z) / 2, state.lockBlend * 0.35);
    }

    const desired = new THREE.Vector3(
      focus.x - fwd.x * horizontal + right.x * state.shoulder,
      state.height + vertical + 0.5,
      focus.z - fwd.z * horizontal + right.z * state.shoulder,
    );

    // Occlusion: pull in along the same ray instead of hiding walls.
    if (obstacleGroup) {
      const origin = new THREE.Vector3(focus.x, state.height + 0.2, focus.z);
      const toCam = desired.clone().sub(origin);
      const len = toCam.length();
      raycaster.set(origin, toCam.normalize());
      raycaster.far = len;
      const hits = raycaster.intersectObject(obstacleGroup, true);
      if (hits.length && hits[0].distance < len) {
        desired.copy(origin).addScaledVector(toCam, Math.max(1.1, hits[0].distance - 0.35));
      }
    }

    if (!initialised) {
      smoothedPos.copy(desired);
      smoothedTarget.copy(focus);
      initialised = true;
    } else {
      // Position and look-at are smoothed independently so a jittery actor
      // never drags the aim point around with it.
      smoothedPos.lerp(desired, damp(reducedMotion ? 30 : 12, dt));
      smoothedTarget.lerp(focus, damp(reducedMotion ? 30 : 16, dt));
    }

    camera.position.copy(smoothedPos);
    if (state.shake > 0.001) {
      const s = state.shake;
      camera.position.x += (Math.random() - 0.5) * s * 0.35;
      camera.position.y += (Math.random() - 0.5) * s * 0.3;
      camera.position.z += (Math.random() - 0.5) * s * 0.35;
      state.shake = Math.max(0, state.shake - dt * 2.4);
    }
    camera.lookAt(smoothedTarget.x, smoothedTarget.y + 0.35, smoothedTarget.z);
  }

  return {
    state,
    look,
    zoom,
    shake,
    update,
    get yaw() {
      return state.yaw;
    },
    setYaw(v) {
      state.yaw = v;
    },
    /** Return to a neutral, readable framing — used by the touch reset button. */
    reset() {
      state.pitch = 0.28;
      state.desiredDistance = 5.4;
      state.shake = 0;
    },
  };
}
