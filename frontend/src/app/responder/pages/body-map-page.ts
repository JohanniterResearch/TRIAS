import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../services/responder-state';

interface BodyRegions {
  front: string[];
  back: string[];
}

@Component({
  selector: 'app-body-map-page',
  imports: [MyAccess, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <p class="eyebrow">Körperkarte</p>
      <h1>{{ view() === 'front' ? 'Vorne' : 'Hinten' }}</h1>

      @if (!state.patient()) {
        <p class="form-error">Kein Patient ausgewählt.</p>
        <a routerLink="/scan-patient">Patient aufnehmen</a>
      } @else {
        @if (error()) {
          <p class="form-error">{{ error() }}</p>
        }

        <div class="body-region-grid">
          @for (region of regionList(); track region) {
            <button type="button" [class.marked]="isMarked(region)" (click)="toggle(region)">
              {{ label(region) }}
            </button>
          }
        </div>

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
  protected readonly regions = signal<BodyRegions>({ front: [], back: [] });
  protected readonly bodyParts = signal<Record<string, number>>({});
  protected readonly error = signal('');

  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);

  constructor() {
    this.loadRegions();
    this.load();
  }

  protected view(): 'front' | 'back' {
    return this.route.snapshot.routeConfig?.path === 'body/back' ? 'back' : 'front';
  }

  protected regionList(): string[] {
    return this.regions()[this.view()];
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
    this.api.toggleBodyPart({ idpatient: patient.id, bodyPartId: region, isClicked }).subscribe({
      next: (body) => this.bodyParts.set(body.bodyParts),
      error: () => this.error.set('Körpermarkierung konnte nicht gespeichert werden.'),
    });
  }

  protected label(region: string): string {
    return region.replace(/_/g, ' ');
  }

  private load(): void {
    const patient = this.state.patient();
    if (!patient) {
      return;
    }

    this.api.getBodyParts(patient.id).subscribe({
      next: (body) => this.bodyParts.set(body.bodyParts),
      error: () => this.bodyParts.set(Object.fromEntries(this.regionList().map((region) => [region, 0]))),
    });
  }

  private loadRegions(): void {
    fetch('/body-regions.json')
      .then((response) => response.json())
      .then((regions: BodyRegions) => this.regions.set(regions))
      .catch(() => this.error.set('Körperregionen konnten nicht aus dem Vertrag geladen werden.'));
  }
}
