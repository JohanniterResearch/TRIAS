import { logout, selfCancel } from '../api/endpoints';
import { httpStatus, persistedRefreshToken, rotate, settleRefresh, withSessionLock } from '../api/client';
import { purgeSyncedPage1Drafts } from '../features/ambulanzprotokoll-page1/page1Storage';
import { queueUnsyncedPage1Drafts } from '../features/ambulanzprotokoll-page1/page1Queue';
import { offlineQueue } from '../offline/offlineQueue';
import { sessionOwner, useAuthStore, type Session } from '../stores/authStore';
import { usePatientLocationStore } from '../stores/patientLocationStore';
import { useWorkContextStore } from '../stores/workContextStore';

/**
 * Starts a new session; scene and patient context of a previous session never carry over, and
 * protocol drafts another account left on this device are removed once the server has them.
 * Unsent ones stay, hidden, until their owner signs in again (security review M3 and 2.3).
 */
export function startSession(session: Session) {
  useWorkContextStore.getState().clear();
  purgeSyncedPage1Drafts(sessionOwner(session.token));
  useAuthStore.getState().setSession(session);
  // Work this account left unsent on this device earlier goes out now (D11).
  // A storage failure here is shown by the sync status; it must not become an unhandled rejection.
  void queueUnsyncedPage1Drafts()
    .then(() => offlineQueue.flush(true))
    .catch(() => offlineQueue.refresh());
}

/** Self-cancel refused because this account still has unsent work on the device. */
export class PendingWorkError extends Error {
  constructor() {
    super('Zugang nicht beendet: es gibt noch ungesendete Einträge. Bitte erst senden oder im Sync-Bereich klären.');
    this.name = 'PendingWorkError';
  }
}

/** How long logout waits for the last send before it goes ahead regardless (D11). */
export const LOGOUT_SEND_TIMEOUT_MS = 5_000;

/**
 * Last send before the session ends (D11): unsent drafts are handed to the queue and everything
 * of this session is sent now, drafts flagged `sentAtLogout`. Logout is never blocked: what does
 * not go out in time stays on the device for this account's next sign-in.
 */
async function sendUnsentWork(): Promise<void> {
  try {
    await queueUnsyncedPage1Drafts();
    await Promise.race([offlineQueue.flushAtLogout(), new Promise((resolve) => setTimeout(resolve, LOGOUT_SEND_TIMEOUT_MS))]);
  } catch {
    // Storage or network trouble: the work stays queued; logout goes ahead.
  }
}

/**
 * Ends the session on the server (refresh token revoked) and locally (parity plan WP 1.3).
 * QR and dev sessions have no refresh token; they end locally and expire on the server.
 */
export async function endSession({ sendFirst = true } = {}) {
  if (sendFirst) await sendUnsentWork();
  await settleRefresh();
  // Under the same cross-tab lock as rotation, so no other tab rotates the token while it is
  // being revoked, and with the persisted (newest) token, not this tab's copy.
  await withSessionLock(async () => {
    await useAuthStore.persist.rehydrate();
    const refreshToken = persistedRefreshToken();
    if (refreshToken) {
      try {
        await logout(refreshToken);
      } catch (error) {
        // Logout needs a live access token. After 15 idle minutes it has expired: rotate once and
        // revoke the new refresh token, or the old one would stay valid (security review M1).
        if (httpStatus(error) === 401) {
          try {
            await rotate(refreshToken);
            const rotated = persistedRefreshToken();
            if (rotated && rotated !== refreshToken) await logout(rotated);
          } catch {
            // The local session ends regardless; an unrevoked refresh token expires on its own.
          }
        }
      }
    }
    useAuthStore.getState().clearSession();
  });
  useWorkContextStore.getState().clear();
  usePatientLocationStore.getState().clearJobs();
  // Like the Ambulanzsystem client, an ended session leaves no synced protocol drafts behind.
  // Unsent ones stay hidden under their owner until the server has them (no data loss).
  purgeSyncedPage1Drafts(null);
}

/**
 * Ends the caller's own access on the server first (parity plan WP 2.4); only a confirmed cancel
 * clears the local session, so a failed request leaves the user signed in and able to retry.
 */
export async function cancelOwnAccess() {
  // Sent while the access still exists; after the cancel nothing could be sent any more. Whatever
  // is still unsent then (refused, too slow) stops the cancel (security review 4, M2).
  await sendUnsentWork();
  await offlineQueue.refresh();
  if (offlineQueue.getStatus().pendingCount > 0) {
    throw new PendingWorkError();
  }
  await selfCancel();
  await endSession({ sendFirst: false });
}
