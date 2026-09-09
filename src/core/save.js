/**
 * Run persistence. Saves are small, versioned and atomic: a write either
 * replaces the whole record or leaves the previous one untouched, so a crash
 * mid-write cannot produce a half-migrated run.
 */
const KEY = 'ashen-front.save.v1';
const VERSION = 1;

const storage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function hasSave() {
  return !!loadRun();
}

export function loadRun() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return migrate(data);
  } catch (err) {
    console.warn('[save] could not read save, ignoring it', err);
    return null;
  }
}

export function saveRun(run) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify({ ...run, version: VERSION, savedAt: Date.now() }));
    return true;
  } catch (err) {
    console.warn('[save] could not write save', err);
    return false;
  }
}

export function clearRun() {
  storage()?.removeItem(KEY);
}

/** Forward-only migration. Unknown future versions are discarded, not guessed. */
function migrate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version > VERSION) return null;
  if (data.version === VERSION) return data;
  return { ...data, version: VERSION };
}
