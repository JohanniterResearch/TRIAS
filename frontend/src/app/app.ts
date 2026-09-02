import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { SyncIndicator } from './sync/sync-indicator';
import { OfflineQueueService } from './sync/offline-queue.service';
import { SessionRefreshService } from './auth/session-refresh.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, SyncIndicator],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('Ambulanzsystem');
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly sessionRefresh = inject(SessionRefreshService);
}
