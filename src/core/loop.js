/**
 * Fixed-timestep clock. There is exactly one simulation clock in the game;
 * combat timing, AI dwell times, cooldowns and VFX lifetimes all read from the
 * step it produces, so nothing can drift against anything else.
 */
export const STEP = 1 / 60;
const MAX_SUBSTEPS = 5;

export function makeLoop({ step = STEP, onStep, onRender }) {
  let accumulator = 0;
  let last = 0;
  let running = false;
  let raf = 0;
  let simTime = 0;
  let paused = false;

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const rawDt = Math.min((now - last) / 1000, 0.25);
    last = now;

    if (!paused) {
      accumulator += rawDt;
      let steps = 0;
      while (accumulator >= step && steps < MAX_SUBSTEPS) {
        onStep(step, simTime);
        simTime += step;
        accumulator -= step;
        steps++;
      }
      // Dropped-frame guard: never let the accumulator spiral.
      if (steps === MAX_SUBSTEPS) accumulator = 0;
    }
    onRender(rawDt, accumulator / step);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    setPaused(v) {
      paused = v;
      if (!v) accumulator = 0;
    },
    isPaused: () => paused,
    /** advance exactly one simulation step while paused (frame-step debugging) */
    stepOnce() {
      onStep(step, simTime);
      simTime += step;
    },
    get time() {
      return simTime;
    },
  };
}
