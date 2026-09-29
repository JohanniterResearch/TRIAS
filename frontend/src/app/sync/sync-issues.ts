import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';

import { BlockedItem, OfflineQueueService } from './offline-queue.service';

const typeLabels: Record<BlockedItem['type'], string> = {
  'manual-patient': 'Neuer Patient',
  triage: 'Triage',
  protocol: 'Ambulanzprotokoll',
  location: 'Position',
  'body-part': 'Körpermarkierung',
};

// Rejected writes stay on the device until someone decides what happens to them. Discarding
// requires a file export first so no patient data is lost by clearing the device.
@Component({
  selector: 'app-sync-issues',
  imports: [DatePipe],
  template: `
    @if (queue.blockedItems().length) {
      <section class="sync-issues" aria-label="Nicht übertragene Einträge">
        <p class="form-error" role="alert" aria-live="assertive">
          {{ queue.blockedItems().length }} Eintrag/Einträge wurden vom Server abgelehnt.
        </p>
        <ul>
          @for (item of queue.blockedItems(); track item.id) {
            <li>
              <span
                >{{ label(item) }} · Patient {{ item.patientId }} ·
                {{ item.createdAt | date: 'short' }}</span
              >
              <span class="form-error">{{
                item.errorStatus === 401
                  ? 'Anmeldung abgelaufen – nach erneuter Anmeldung wird automatisch gesendet.'
                  : item.lastError
              }}</span>
              <button type="button" (click)="retry(item)" [disabled]="busy()">
                Erneut versuchen
              </button>
              <button type="button" (click)="export(item)" [disabled]="busy()">
                Als Datei sichern
              </button>
              <button type="button" (click)="discard(item)" [disabled]="busy()">Verwerfen</button>
            </li>
          }
        </ul>
        @if (error()) {
          <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
        }
      </section>
    }
  `,
})
export class SyncIssues {
  protected readonly queue = inject(OfflineQueueService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected label(item: BlockedItem): string {
    return typeLabels[item.type];
  }

  protected retry(item: BlockedItem): Promise<void> {
    return this.run(() => this.queue.retry(item.id));
  }

  protected export(item: BlockedItem): Promise<void> {
    return this.run(async () => {
      const url = URL.createObjectURL(await this.queue.exportBlocked(item.id));
      const link = document.createElement('a');
      link.href = url;
      link.download = `ambulanzsystem-nicht-uebertragen-${item.patientId}-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  protected discard(item: BlockedItem): Promise<void> {
    if (!window.confirm('Eintrag endgültig von diesem Gerät löschen?')) return Promise.resolve();
    return this.run(() => this.queue.discard(item.id));
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await work();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.');
    } finally {
      this.busy.set(false);
    }
  }
}
