import { offlineQueue } from '../../offline/offlineQueue';
import { page1RequestBody } from './page1Api';
import { currentDraftOwner, markPage1DraftSynced, unsyncedPage1Drafts } from './page1Storage';
import type { Page1PersistedRecord, Page1State } from './page1State';

// The protocol's side of the offline queue (parity plan WP 6.3). A draft handed to the queue is
// marked synced: from then on the queue, not the local cache, owns the unsent work.

/**
 * Queues a protocol save; returns its write id, or null when nobody is signed in. With `base`
 * only the leaves changed from it are queued (a newer save of the same page replaces this item
 * and carries every change made since the same base).
 */
export async function queuePage1(record: Page1PersistedRecord, owner: string, base?: Page1State | null): Promise<string | null> {
  if (currentDraftOwner() !== owner) return null;
  const writeId = await offlineQueue.queueProtocol(
    record.patientId,
    page1RequestBody({ formState: record.formState, status: record.status, clientUpdatedAt: record.updatedAt ?? undefined, baseFormState: base ?? undefined }),
    record.operationSceneId,
  );
  markPage1DraftSynced(record.patientId, owner, record.updatedAt);
  return writeId;
}

/**
 * Drafts the session saved locally but never handed over (closed tab, crash, logout during the
 * autosave delay) go into the queue: at start and before logout, with the time they were made.
 * Their base is not known any more, so the whole draft is sent; the server's per-field merge
 * keeps a value another device changed after that time.
 */
export async function queueUnsyncedPage1Drafts(): Promise<void> {
  const owner = currentDraftOwner();
  if (!owner) return;
  // An unsynced draft is the newest local state (every change is cached unsynced first), so it
  // replaces a queued older save of the same patient.
  for (const draft of unsyncedPage1Drafts(owner)) await queuePage1(draft, owner);
}
