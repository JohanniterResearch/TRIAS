// Every value PLS persists in the browser is namespaced by backend (parity plan WP 1.2). The old
// PLS (MySQL) backend and the Ambulanzsystem backend both use small integer patient ids, so a key
// written against the old backend must never be read against the new one.
export const STORAGE_PREFIX = 'pls:ambulanz-v1:';

export const STORAGE_KEYS = {
  auth: `${STORAGE_PREFIX}auth`,
  workContext: `${STORAGE_PREFIX}work-context`,
  patientLocation: `${STORAGE_PREFIX}patient-location`,
  bodyMapHintSeen: `${STORAGE_PREFIX}body-map-hint-seen`,
  /** One draft per patient and session: another account never replaces a session's copy. */
  page1Draft: (patientId: number, owner: string) => `${STORAGE_PREFIX}page1:patient:${patientId}@${owner}`,
} as const;

export const PAGE1_DRAFT_PREFIX = `${STORAGE_PREFIX}page1:patient:`;
// Keys of the old PLS client: auth tokens, GPS jobs that retry on their own, protocol drafts.
const LEGACY_EXACT_KEYS = ['auth-storage', 'patient-location-storage', 'Username'];
const LEGACY_PREFIXES = ['ambdoku:'];

export function isLegacyKey(key: string): boolean {
  return LEGACY_EXACT_KEYS.includes(key) || LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Removes every value the old PLS client left behind. Returns the removed keys. */
export function purgeLegacyStorage(storage: Storage = window.localStorage): string[] {
  const legacy: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null && isLegacyKey(key)) legacy.push(key);
  }
  for (const key of legacy) storage.removeItem(key);
  return legacy;
}
