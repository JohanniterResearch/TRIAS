import { Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import bodyRegions from '../../../../../contract/body-regions.json';
import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { BodyPartResponse, OfflineQueueService } from '../../sync/offline-queue.service';
import { ResponderStateStore } from '../services/responder-state';

@Component({
  selector: 'app-body-map-page',
  imports: [MyAccess, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <p class="eyebrow">Körperkarte</p>
      <h1>{{ view() === 'front' ? 'Vorne' : 'Hinten' }}</h1>

      @if (!state.patient()) {
        <p class="form-error" role="alert" aria-live="assertive">Kein Patient ausgewählt.</p>
        <a routerLink="/scan-patient">Patient aufnehmen</a>
      } @else {
        @if (error()) {
          <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
        }
        @for (message of conflictMessages(); track message) {
          <p class="form-error" role="alert" aria-live="assertive">{{ message }}</p>
        }

        <div
          class="body-region-map"
          [attr.aria-label]="view() === 'front' ? 'Körper Vorderseite' : 'Körper Rückseite'"
        >
          <svg
            viewBox="0 0 240 560"
            role="img"
            [attr.aria-label]="
              view() === 'front' ? 'Körpersilhouette vorne' : 'Körpersilhouette hinten'
            "
          >
            <circle cx="120" cy="48" r="30" />
            <path
              d="M91 82 Q120 70 149 82 L164 225 Q150 260 148 300 L158 510 L132 510 L120 312 L108 510 L82 510 L92 300 Q90 260 76 225 Z"
            />
            <path d="M82 95 L42 250 L62 256 L100 142 M158 95 L198 250 L178 256 L140 142" />
          </svg>
          @for (region of regionList(); track region) {
            <button
              type="button"
              [class.marked]="isMarked(region)"
              [style.left.%]="position(region).x"
              [style.top.%]="position(region).y"
              [attr.aria-pressed]="isMarked(region)"
              [attr.aria-label]="label(region)"
              [title]="label(region)"
              (click)="toggle(region)"
            >
              <span class="visually-hidden">{{ label(region) }}</span>
            </button>
          }
        </div>

        @if (markedLabels().length) {
          <p><strong>Markiert:</strong> {{ markedLabels().join(', ') }}</p>
        }

        <div class="row-actions">
          <a routerLink="/triage">Zurück zur Triage</a>
          <a [routerLink]="view() === 'front' ? '/body/back' : '/body/front'">Ansicht wechseln</a>
        </div>
      }
    </section>
  `,
})
export class BodyMapPage {
  protected readonly state = inject(ResponderStateStore);
  protected readonly bodyParts = signal<Record<string, number>>({});
  protected readonly error = signal('');
  protected readonly conflictMessages = signal<string[]>([]);
  private readonly conflicts = new Map<string, string>();
  private readonly completedWrites = new Set<string>();
  private readonly supersededLocalWrites = new Set<string>();

  private readonly api = inject(ApiClient);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly route = inject(ActivatedRoute);
  private readonly latestIntent = new Map<
    string,
    { isClicked: boolean; generation: number; writeId: string }
  >();
  private confirmedBodyParts: Record<string, number> = {};
  private intentGeneration = 0;
  private bodyPartsRevision = 0;

  constructor() {
    effect(() => {
      const patientId = this.state.patient()?.id;
      for (const result of this.offlineQueue.bodyPartResults()) {
        if (
          (result.patientId === patientId || result.sourcePatientId === patientId) &&
          !this.completedWrites.has(result.writeId)
        ) {
          this.applyWriteResult(result.region, result.writeId, result.record, result.superseded);
        }
      }
      // Restore persisted optimistic values after reload and react to queue replacement/removal.
      this.updateDisplay();
    });
    this.load();
  }

  private async queueIntent(intent: {
    patientId: number;
    region: string;
    isClicked: boolean;
    writeId: string;
    clientUpdatedAt: string;
  }): Promise<void> {
    this.error.set('');
    try {
      await this.offlineQueue.queueBodyPart(
        intent.patientId,
        {
          idpatient: intent.patientId,
          bodyPartId: intent.region,
          isClicked: intent.isClicked,
          clientUpdatedAt: intent.clientUpdatedAt,
        },
        intent.writeId,
      );
      await this.offlineQueue.flush(true);
    } catch {
      this.error.set(
        'Körpermarkierung konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.',
      );
    }
  }

  protected view(): 'front' | 'back' {
    return this.route.snapshot.routeConfig?.path === 'body/back' ? 'back' : 'front';
  }

  protected regionList(): string[] {
    return bodyRegions[this.view()];
  }

  protected isMarked(region: string): boolean {
    return Boolean(this.bodyParts()[region]);
  }

  protected toggle(region: string): void {
    const patient = this.state.patient();
    if (!patient) {
      return;
    }

    const isClicked = !this.isMarked(region);
    // A fresh click supersedes older local intents even if they remain queued/in flight.
    // Their acknowledgement may explain a conflict, but cannot restore their display.
    const previous = this.latestIntent.get(region);
    if (previous) this.supersededLocalWrites.add(previous.writeId);
    for (const pending of this.pendingForPatient()) {
      if (pending.body.bodyPartId === region && pending.writeId)
        this.supersededLocalWrites.add(pending.writeId);
    }
    const generation = ++this.intentGeneration;
    const writeId = crypto.randomUUID();
    this.latestIntent.set(region, { isClicked, generation, writeId });
    this.updateDisplay();
    void this.queueIntent({
      patientId: patient.id,
      region,
      isClicked,
      writeId,
      clientUpdatedAt: new Date().toISOString(),
    });
  }

  protected label(region: string): string {
    return region.replace(/_(vorne|hinten)$/, '').replace(/_/g, ' ');
  }

  protected markedLabels(): string[] {
    return this.regionList()
      .filter((region) => this.isMarked(region))
      .map((region) => this.label(region));
  }

  protected position(region: string): { x: number; y: number } {
    const part = region.replace(/_(links|rechts)?_?(vorne|hinten)$/, '');
    const y: Record<string, number> = {
      kopf: 8,
      gesicht: 13,
      auge: 14,
      nacken: 18,
      hals: 19,
      schulter: 24,
      brust: 32,
      ruecken_oben: 31,
      ruecken_mitte: 40,
      ruecken_unten: 49,
      oberarm: 34,
      ellenbogen: 44,
      unterarm: 53,
      hand: 62,
      bauch: 43,
      becken: 53,
      genitalbereich: 59,
      gesaess: 58,
      oberschenkel: 69,
      knie: 79,
      kniekehle: 79,
      unterschenkel: 88,
      ferse: 95,
      fuss: 97,
    };
    const isLeft = region.includes('_links_');
    const isRight = region.includes('_rechts_');
    const limb = /arm|ellenbogen|hand|schulter/.test(part);
    const x = isLeft ? (limb ? 25 : 42) : isRight ? (limb ? 75 : 58) : 50;
    return { x, y: y[part] ?? 50 };
  }

  private load(): void {
    const patient = this.state.patient();
    if (!patient) {
      return;
    }

    const revision = this.bodyPartsRevision;
    this.api.getBodyParts(patient.id).subscribe({
      next: (body) => {
        if (this.bodyPartsRevision === revision) {
          this.applyServerBody(body.bodyParts);
        }
      },
      error: (error: unknown) => {
        if (this.bodyPartsRevision !== revision) {
          return;
        }
        this.confirmedBodyParts = Object.fromEntries(
          this.regionList().map((region) => [region, 0]),
        );
        this.updateDisplay();
        this.error.set(apiErrorMessage(error, 'Körperkarte konnte nicht geladen werden.'));
      },
    });
  }

  private applyServerBody(bodyParts: Record<string, number>): void {
    this.confirmedBodyParts = bodyParts;
    this.updateDisplay();
  }

  private pendingForPatient() {
    const patientId = this.state.patient()?.id;
    return this.offlineQueue
      .bodyPartPending()
      .filter((item) => item.patientId === patientId || item.sourcePatientId === patientId);
  }

  private applyWriteResult(
    region: string,
    writeId: string,
    record: BodyPartResponse,
    superseded = false,
  ): void {
    const local = this.latestIntent.get(region);
    const newerLocal =
      superseded ||
      this.supersededLocalWrites.has(writeId) ||
      (local && local.writeId !== writeId) ||
      this.pendingForPatient().some(
        (item) =>
          item.body.bodyPartId === region &&
          item.writeId !== writeId &&
          !this.supersededLocalWrites.has(item.writeId ?? '') &&
          !this.completedWrites.has(item.writeId ?? ''),
      );
    this.completedWrites.add(writeId);
    this.bodyPartsRevision++;
    if (local?.writeId === writeId) this.latestIntent.delete(region);
    if (!newerLocal) {
      this.error.set('');
      const value = record.writeResult?.serverValue ?? record.bodyParts[region];
      this.confirmedBodyParts = { ...this.confirmedBodyParts, [region]: value };
    }
    if (
      record.writeResult?.outcome === 'rejected' &&
      record.writeResult.conflictReason === 'older_edit'
    ) {
      const side = region.endsWith('_hinten') ? 'hinten' : 'vorne';
      this.conflicts.set(
        region,
        `${this.label(region)} (${side}): Deine Änderung wurde nicht übernommen, weil bereits eine neuere Änderung vorliegt.`,
      );
    } else if (!newerLocal) {
      this.conflicts.delete(region);
    }
    this.conflictMessages.set([...this.conflicts.values()]);
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const queued = Object.fromEntries(
      this.pendingForPatient()
        .filter(
          (item) =>
            !this.completedWrites.has(item.writeId ?? '') &&
            !this.supersededLocalWrites.has(item.writeId ?? ''),
        )
        .map((item) => [item.body.bodyPartId, item.body.isClicked ? 1 : 0]),
    );
    const pending = Object.fromEntries(
      [...this.latestIntent].map(([region, intent]) => [region, intent.isClicked ? 1 : 0]),
    );
    this.bodyParts.set({ ...this.confirmedBodyParts, ...queued, ...pending });
  }
}
