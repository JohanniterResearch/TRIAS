import type { Page1PersistedRecord } from './page1State';
import { PAGE1_DRAFT_PREFIX, STORAGE_KEYS } from '../../storage/keys';
import { sessionOwner, useAuthStore } from '../../stores/authStore';

// Drafts hold patient data, so each is tagged with the session that opened it and only that
// session sees or sends it (security reviews M3 and 2.1). `synced` marks a draft the server
// already holds; only those are ever deleted for privacy, unsent work is kept.
type StoredDraft = Page1PersistedRecord & { owner?: string | null; synced?: boolean };

export const currentDraftOwner = () => sessionOwner(useAuthStore.getState().session?.token);

export function page1StorageKey(patientId: number, owner: string) {
  return STORAGE_KEYS.page1Draft(patientId, owner);
}

function readStored(patientId: number, owner: string | null): StoredDraft | null {
  if (owner === null) return null;
  try {
    const draft = JSON.parse(window.localStorage.getItem(page1StorageKey(patientId, owner)) ?? 'null') as StoredDraft | null;
    return draft && draft.owner === owner ? draft : null;
  } catch {
    return null;
  }
}

export function readPage1Draft(patientId: number): Page1PersistedRecord | null {
  const draft = readStored(patientId, currentDraftOwner());
  if (!draft) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { owner, synced, ...record } = draft;
  return record;
}

/**
 * Stores the draft for `owner`, the session that opened the protocol. Returns false (and writes
 * nothing) when the device meanwhile belongs to another session: a late response of the previous
 * user must not land under the new one.
 */
export function writePage1Draft(record: Page1PersistedRecord, owner: string | null, synced: boolean): boolean {
  if (owner === null || owner !== currentDraftOwner()) return false;
  const stored: StoredDraft = { ...record, owner, synced };
  window.localStorage.setItem(page1StorageKey(record.patientId, owner), JSON.stringify(stored));
  return true;
}

/** Drafts of `owner` that neither the server nor the offline queue holds yet. */
export function unsyncedPage1Drafts(owner: string, storage: Storage = window.localStorage): Page1PersistedRecord[] {
  const drafts: Page1PersistedRecord[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PAGE1_DRAFT_PREFIX) || !key.endsWith(`@${owner}`)) continue;
    try {
      const draft = JSON.parse(storage.getItem(key) ?? 'null') as StoredDraft | null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      if (draft?.owner === owner && draft.synced !== true) drafts.push((({ owner: _o, synced: _s, ...record }) => record)(draft));
    } catch {
      // unreadable drafts are left for the purge
    }
  }
  return drafts;
}

/**
 * Marks a draft as handed over (to the server or the offline queue), but only the version that was
 * handed over: a newer edit cached meanwhile stays unsynced (security review 4, M4).
 */
export function markPage1DraftSynced(patientId: number, owner: string, updatedAt: string | null): void {
  const draft = readStored(patientId, owner);
  if (draft && draft.updatedAt === updatedAt) window.localStorage.setItem(page1StorageKey(patientId, owner), JSON.stringify({ ...draft, synced: true }));
}

/** A provisional patient got its server id (WP 6.4): the draft moves to the real id. */
export function rekeyPage1Draft(provisionalId: number, realId: number, owner: string): void {
  const draft = readStored(provisionalId, owner);
  if (!draft) return;
  window.localStorage.setItem(page1StorageKey(realId, owner), JSON.stringify({ ...draft, patientId: realId }));
  window.localStorage.removeItem(page1StorageKey(provisionalId, owner));
}

/**
 * Removes drafts the server already holds, except those of `keepOwner` (all owners when null).
 * Unsent drafts are never removed; they stay hidden from every other session.
 */
export function purgeSyncedPage1Drafts(keepOwner: string | null, storage: Storage = window.localStorage) {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(PAGE1_DRAFT_PREFIX)) continue;
    let draft: StoredDraft | null = null;
    try {
      draft = JSON.parse(storage.getItem(key) ?? 'null') as StoredDraft | null;
    } catch {
      // unreadable: removed below
    }
    if (!draft) doomed.push(key);
    else if (draft.synced === true && (keepOwner === null || draft.owner !== keepOwner)) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

export function clearPage1Draft(patientId: number) {
  const owner = currentDraftOwner();
  if (owner !== null) window.localStorage.removeItem(page1StorageKey(patientId, owner));
}

export function comparePage1UpdatedAt(left: string | null, right: string | null) {
  const leftTime = left === null ? Number.NaN : Date.parse(left);
  const rightTime = right === null ? Number.NaN : Date.parse(right);

  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return -1;
  if (Number.isNaN(rightTime)) return 1;
  return leftTime - rightTime;
}
