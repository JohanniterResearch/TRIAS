import { queueUnsyncedPage1Drafts } from '../features/ambulanzprotokoll-page1/page1Queue';
import { startOfflineQueue } from './offlineQueue';

// App start (parity plan WP 6.3): protocol drafts the session cached but never handed over
// (closed tab, crash) go into the queue, then the queue sends at start, on reconnect, every 30 s.
export function startOffline(): void {
  void queueUnsyncedPage1Drafts().finally(startOfflineQueue);
}
