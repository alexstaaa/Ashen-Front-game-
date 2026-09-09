/**
 * Input. Held state and edge-triggered actions are kept apart: held keys drive
 * movement and sustained fire, while one-shot verbs are queued and consumed by
 * exactly one simulation step so a single keypress can never fire twice.
 */
const MOVE_KEYS = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function createInput(canvas, { onPause, onDebug, onOrder, onLock } = {}) {
  const held = new Set();
  const pending = { dive: false, melee: false, relic: false, reload: false };
  const mouse = { dx: 0, dy: 0, wheel: 0, down: false };
  let pointerLocked = false;
  let enabled = true;

  const onKeyDown = (e) => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      onPause?.();
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      onDebug?.();
      return;
    }
    if (!enabled) return;
    held.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      pending.dive = true;
    }
    if (e.code === 'KeyF') pending.melee = true;
    if (e.code === 'KeyQ') pending.relic = true;
    if (e.code === 'KeyR') pending.reload = true;
    if (e.code === 'Tab') {
      e.preventDefault();
      onLock?.();
    }
    if (e.code === 'Digit1') onOrder?.('hold');
    if (e.code === 'Digit2') onOrder?.('advance');
    if (e.code === 'Digit3') onOrder?.('focus');
  };

  const onKeyUp = (e) => held.delete(e.code);
  const onBlur = () => {
    held.clear();
    mouse.down = false;
  };

  const onMouseDown = (e) => {
    if (!enabled) return;
    if (e.button === 0) mouse.down = true;
  };
  const onMouseUp = (e) => {
    if (e.button === 0) mouse.down = false;
  };
  const onMouseMove = (e) => {
    if (!pointerLocked || !enabled) return;
    mouse.dx += e.movementX;
    mouse.dy += e.movementY;
  };
  const onWheel = (e) => {
    if (!enabled) return;
    e.preventDefault();
    mouse.wheel += e.deltaY;
  };
  const onPointerLockChange = () => {
    pointerLocked = document.pointerLockElement === canvas;
  };
  const onCanvasClick = () => {
    if (enabled && !pointerLocked) canvas.requestPointerLock?.();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('click', onCanvasClick);
  document.addEventListener('pointerlockchange', onPointerLockChange);

  return {
    get pointerLocked() {
      return pointerLocked;
    },
    setEnabled(v) {
      enabled = v;
      if (!v) {
        held.clear();
        mouse.down = false;
        mouse.dx = mouse.dy = 0;
      }
    },
    releasePointer() {
      if (pointerLocked) document.exitPointerLock?.();
    },
    /** Best-effort pointer capture. Browsers only grant this from a gesture. */
    capturePointer() {
      if (!enabled || pointerLocked) return;
      try {
        canvas.requestPointerLock?.();
      } catch {
        /* the click-to-capture hint covers the fallback */
      }
    },

    /** Camera-space movement axes and sustained states. */
    axes() {
      let x = 0;
      let z = 0;
      for (const code of held) {
        const v = MOVE_KEYS[code];
        if (v) {
          x += v[0];
          z += v[1];
        }
      }
      return { x, z };
    },
    isHeld: (code) => held.has(code),
    get firing() {
      return mouse.down;
    },
    get sprinting() {
      return held.has('ShiftLeft') || held.has('ShiftRight');
    },
    get interacting() {
      return held.has('KeyE');
    },

    /** Mouse look accumulated since the last read. */
    takeLook() {
      const out = { dx: mouse.dx, dy: mouse.dy, wheel: mouse.wheel };
      mouse.dx = 0;
      mouse.dy = 0;
      mouse.wheel = 0;
      return out;
    },

    /** One-shot verbs; consumed exactly once. */
    takeEdges() {
      const out = { ...pending };
      pending.dive = pending.melee = pending.relic = pending.reload = false;
      return out;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onCanvasClick);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    },
  };
}
