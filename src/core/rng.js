/**
 * Seeded, serializable RNG. Every stochastic outcome in the simulation goes
 * through one of these so a `?seed=` run is byte-for-byte reproducible.
 */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const api = {
    /** float in [0,1) */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** float in [min,max) */
    range(min, max) {
      return min + api.next() * (max - min);
    },
    /** integer in [min,max] */
    int(min, max) {
      return Math.floor(api.range(min, max + 1));
    },
    /** true with probability p */
    chance(p) {
      return api.next() < p;
    },
    pick(arr) {
      return arr[api.int(0, arr.length - 1)];
    },
    /** current state, for saves and fixtures */
    getState() {
      return s;
    },
    setState(v) {
      s = v >>> 0 || 1;
    },
  };
  return api;
}

/** Deterministic 32-bit hash of a string, for turning names into seeds. */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
