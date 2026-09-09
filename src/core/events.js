/**
 * One-way event bus. The simulation emits resolved facts; rendering, VFX,
 * audio and HUD are downstream consumers only. Nothing subscribed here is
 * allowed to mutate simulation state.
 */
export function makeBus() {
  const handlers = new Map();
  /** events emitted during the current sim step, drained by the presentation layer */
  let queue = [];

  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    emit(type, payload = {}) {
      const evt = { type, ...payload };
      queue.push(evt);
      const set = handlers.get(type);
      if (set) for (const fn of set) fn(evt);
      const all = handlers.get('*');
      if (all) for (const fn of all) fn(evt);
      return evt;
    },
    /** returns and clears the events emitted since the last drain */
    drain() {
      const out = queue;
      queue = [];
      return out;
    },
    clear() {
      handlers.clear();
      queue = [];
    },
  };
}
