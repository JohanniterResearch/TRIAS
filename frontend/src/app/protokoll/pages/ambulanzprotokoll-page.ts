import { JsonPipe } from '@angular/common';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { ProtokollDraftRecord, ProtokollDraftStore } from '../services/protokoll-draft-store';

type Status = 'draft' | 'finalized';
type MarkerType = 'wunde' | 'fraktur' | 'schmerz' | 'prellung' | 'amputation' | 'verbrennung' | 'luxation';
type FormState = ReturnType<typeof defaultState>;

interface FieldConfig {
  path: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type?: 'text' | 'date' | 'time' | 'textarea';
}

const fields: FieldConfig[] = [
  { path: 'incident.ambulanzort', label: 'Ambulanzort', x: 24, y: 1, w: 18, h: 3 },
  { path: 'incident.pls_nummer', label: 'Protokoll- / PLS-Nummer', x: 43, y: 1, w: 16, h: 3 },
  { path: 'incident.datum', label: 'Datum', x: 60, y: 1, w: 10, h: 3, type: 'date' },
  { path: 'incident.uhrzeit_beginn', label: 'Uhrzeit-Beginn', x: 71, y: 1, w: 10, h: 3, type: 'time' },
  { path: 'incident.dnr_san_1', label: 'DNr. - San.', x: 82, y: 1, w: 8, h: 3 },
  { path: 'incident.dnr_na', label: 'DNr. - NA', x: 91, y: 1, w: 7, h: 3 },
  { path: 'patient.familienname', label: 'Patient - Familienname', x: 2, y: 8, w: 21, h: 3 },
  { path: 'patient.vorname', label: 'Vorname', x: 24, y: 8, w: 16, h: 3 },
  { path: 'patient.vers_nr', label: 'Vers.-Nr.', x: 50, y: 8, w: 15, h: 3 },
  { path: 'patient.geburtsdatum', label: 'Geb.-Datum', x: 66, y: 8, w: 13, h: 3, type: 'date' },
  { path: 'patient.adresse', label: 'Adresse', x: 2, y: 12, w: 38, h: 3 },
  { path: 'patient.telefon', label: 'Telefon', x: 66, y: 12, w: 15, h: 3 },
  { path: 'assessment_secondary.anamnese_text', label: 'ANAMNESE / UNTERSUCHUNG', x: 3, y: 29, w: 50, h: 18, type: 'textarea' },
  { path: 'history.allergien', label: 'Allergien', x: 53, y: 80, w: 20, h: 3 },
  { path: 'history.medikamente', label: 'Medikamente', x: 74, y: 80, w: 20, h: 3 },
  { path: 'history.patientengeschichte_vorerkrankungen', label: 'Patientengeschichte / Vorerkrankungen', x: 53, y: 84, w: 41, h: 4, type: 'textarea' },
  { path: 'disposition.uhrzeit_ende', label: 'Uhrzeit-Ende', x: 32, y: 95, w: 10, h: 3, type: 'time' },
  { path: 'disposition.kontaktdaten', label: 'Kontaktdaten', x: 62, y: 95, w: 20, h: 3 },
];

const zones = [
  ['brand_header', 0, 0, 23, 6, 'JOHANNITER · AMBULANZPROTOKOLL'],
  ['incident_header', 23, 0, 77, 6, 'Einsatzdaten'],
  ['patient_block', 0, 6, 100, 10, 'Patient'],
  ['erstdiagnose_allgemein', 0, 16, 100, 9, 'ERST.-DIAGN. / ALLG. EINDRUCK'],
  ['anamnese_bodymap', 0, 25, 100, 27, 'ANAMNESE / UNTERSUCHUNG'],
  ['akutmedikation', 0, 52, 100, 8, 'Akutmedikation Durch RD'],
  ['erst_endbefund', 0, 60, 100, 17, 'ERST- / ENDBEFUND'],
  ['massnahmen_ample', 0, 77, 100, 17, 'MASSNAHMEN / AMPLE-SCHEMA'],
  ['footer_disposition', 0, 94, 100, 6, 'Disposition / Unterschrift'],
] as const;

@Component({
  selector: 'app-ambulanzprotokoll-page',
  imports: [JsonPipe, MyAccess, RouterLink],
  template: `
    <section class="protocol-workspace">
      <app-my-access />
      <div class="protocol-toolbar">
        <strong>Patient {{ patientId() }}</strong>
        <span>{{ saveState() }}</span>
        <button type="button" (click)="save('draft')">Speichern</button>
        <button type="button" (click)="save('finalized')">Finalisieren</button>
        <button type="button" (click)="downloadExport()">JSON Export</button>
        <button type="button" (click)="print()">Drucken</button>
        <a routerLink="/triage">Zurück</a>
      </div>

      @if (warnings().length) {
        <ul class="form-error">
          @for (warning of warnings(); track warning) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      <div class="protocol-scale">
        <div class="protocol-page">
          @for (zone of zones; track zone[0]) {
            <section class="protocol-zone" [style.left.%]="zone[1]" [style.top.%]="zone[2]" [style.width.%]="zone[3]" [style.height.%]="zone[4]">
              <span>{{ zone[5] }}</span>
            </section>
          }

          @for (field of fields; track field.path) {
            <label class="protocol-field" [style.left.%]="field.x" [style.top.%]="field.y" [style.width.%]="field.w" [style.height.%]="field.h">
              <span>{{ field.label }}</span>
              @if (field.type === 'textarea') {
                <textarea [value]="value(field.path)" (input)="setValue(field.path, $any($event.target).value)"></textarea>
              } @else {
                <input [type]="field.type || 'text'" [value]="value(field.path)" (input)="setValue(field.path, $any($event.target).value)">
              }
            </label>
          }

          <div class="protocol-checks naca">
            <strong>NACA</strong>
            @for (item of naca; track item) {
              <label><input type="checkbox" [checked]="has('assessment_primary.naca', item)" (change)="setSingle('assessment_primary.naca', item, $any($event.target).checked)"> {{ item }}</label>
            }
          </div>

          <div class="protocol-checks vitals">
            <strong>GCS / Messwerte</strong>
            <label>Augen <input type="number" min="1" max="4" [value]="value('vitals.gcs_augenoeffnen')" (input)="setNumber('vitals.gcs_augenoeffnen', $any($event.target).value)"></label>
            <label>Verbal <input type="number" min="1" max="5" [value]="value('vitals.gcs_verbale_reaktion')" (input)="setNumber('vitals.gcs_verbale_reaktion', $any($event.target).value)"></label>
            <label>Motorik <input type="number" min="1" max="6" [value]="value('vitals.gcs_motorische_reaktion')" (input)="setNumber('vitals.gcs_motorische_reaktion', $any($event.target).value)"></label>
            <span>GCS-Summe: {{ value('vitals.gcs_summe') || '-' }}</span>
            <label>RR <input [value]="value('vitals.rr')" (input)="setValue('vitals.rr', $any($event.target).value)"></label>
            <label>Puls <input [value]="value('vitals.puls')" (input)="setValue('vitals.puls', $any($event.target).value)"></label>
            <label>SpO2 <input [value]="value('vitals.spo2')" (input)="setValue('vitals.spo2', $any($event.target).value)"></label>
          </div>

          <div class="medication-grid">
            <strong>Akutmedikation</strong>
            @for (row of medicationRows; track row) {
              <input placeholder="Medikament" [value]="med(row, 'medikament')" (input)="setMed(row, 'medikament', $any($event.target).value)">
              <input placeholder="Dosis" [value]="med(row, 'dosis')" (input)="setMed(row, 'dosis', $any($event.target).value)">
              <input placeholder="Art" [value]="med(row, 'art')" (input)="setMed(row, 'art', $any($event.target).value)">
              <input placeholder="Uhrzeit" [value]="med(row, 'uhrzeit')" (input)="setMed(row, 'uhrzeit', $any($event.target).value)">
            }
          </div>

          <div class="protocol-bodymap" (click)="addMarker($event)">
            <div class="body-silhouette">Körperkarte</div>
            @for (marker of form().assessment_secondary.bodymap; track marker.x + '-' + marker.y + '-' + marker.marker) {
              <button type="button" class="body-marker" [style.left.%]="marker.x" [style.top.%]="marker.y" (click)="removeMarker(marker); $event.stopPropagation()">{{ marker.marker[0].toUpperCase() }}</button>
            }
            <select [value]="markerType()" (change)="markerType.set($any($event.target).value)">
              @for (type of markerTypes; track type) {
                <option [value]="type">{{ type }}</option>
              }
            </select>
          </div>

          <div class="signature-box">
            <span>Unterschrift - Entlass. San/NA</span>
            <canvas #signatureCanvas width="300" height="90" (pointerdown)="drawSignature($event)" (pointermove)="drawSignature($event)"></canvas>
            <button type="button" (click)="clearSignature()">Löschen</button>
          </div>
        </div>
      </div>

      <details>
        <summary>FormState JSON</summary>
        <pre>{{ form() | json }}</pre>
      </details>
    </section>
  `,
})
export class AmbulanzprotokollPage {
  protected readonly fields = fields;
  protected readonly zones = zones;
  protected readonly naca = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  protected readonly medicationRows = Array.from({ length: 8 }, (_, index) => index);
  protected readonly markerTypes: MarkerType[] = ['wunde', 'fraktur', 'schmerz', 'prellung', 'amputation', 'verbrennung', 'luxation'];
  protected readonly markerType = signal<MarkerType>('wunde');
  protected readonly form = signal<FormState>(defaultState());
  protected readonly status = signal<Status>('draft');
  protected readonly saveState = signal('lokal bereit');
  protected readonly warnings = signal<string[]>([]);

  private readonly api = inject(ApiClient);
  private readonly drafts = inject(ProtokollDraftStore);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly route = inject(ActivatedRoute);
  private readonly responderState = inject(ResponderStateStore);
  private readonly signatureCanvas = viewChild<ElementRef<HTMLCanvasElement>>('signatureCanvas');
  private autosaveTimer = 0;

  constructor() {
    this.load();
  }

  protected patientId(): number {
    return Number(this.route.snapshot.paramMap.get('patientId') ?? this.responderState.patient()?.id ?? 0);
  }

  protected value(path: string): string | number {
    return getPath(this.form(), path) ?? '';
  }

  protected setValue(path: string, value: unknown): void {
    this.form.update((current) => setPath(current, path, value));
    this.queueAutosave();
  }

  protected setNumber(path: string, value: string): void {
    this.setValue(path, value ? Number(value) : null);
    this.computeGcs();
  }

  protected has(path: string, item: string): boolean {
    return Array.isArray(getPath(this.form(), path)) && getPath(this.form(), path).includes(item);
  }

  protected setSingle(path: string, item: string, checked: boolean): void {
    this.setValue(path, checked ? [item] : []);
  }

  protected med(index: number, key: 'medikament' | 'dosis' | 'art' | 'uhrzeit'): string {
    return this.form().medications_administered[index]?.[key] ?? '';
  }

  protected setMed(index: number, key: 'medikament' | 'dosis' | 'art' | 'uhrzeit', value: string): void {
    this.form.update((current) => {
      const rows = [...current.medications_administered];
      const row = rows[index] ?? { medikament: '', dosis: '', art: '', uhrzeit: null };
      rows[index] = { ...row, [key]: value || (key === 'uhrzeit' ? null : '') };
      return { ...current, medications_administered: rows };
    });
    this.queueAutosave();
  }

  protected addMarker(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;
    this.form.update((current) => ({
      ...current,
      assessment_secondary: {
        ...current.assessment_secondary,
        bodymap: [...current.assessment_secondary.bodymap, { view: 'front', marker: this.markerType(), x, y }],
      },
    }));
    this.queueAutosave();
  }

  protected removeMarker(marker: FormState['assessment_secondary']['bodymap'][number]): void {
    this.form.update((current) => ({
      ...current,
      assessment_secondary: {
        ...current.assessment_secondary,
        bodymap: current.assessment_secondary.bodymap.filter((item) => item !== marker),
      },
    }));
    this.queueAutosave();
  }

  protected drawSignature(event: PointerEvent): void {
    if (event.buttons !== 1) {
      return;
    }

    const canvas = this.signatureCanvas()?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const box = canvas.getBoundingClientRect();
    context.fillStyle = '#111111';
    context.beginPath();
    context.arc(event.clientX - box.left, event.clientY - box.top, 2, 0, Math.PI * 2);
    context.fill();
    this.setValue('signatures.entlass_san_na', canvas.toDataURL('image/png'));
  }

  protected clearSignature(): void {
    const canvas = this.signatureCanvas()?.nativeElement;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.setValue('signatures.entlass_san_na', null);
  }

  protected save(status: Status): void {
    const warnings = this.collectWarnings();
    this.warnings.set(warnings);
    this.status.set(status);
    const patientId = this.patientId();
    const formState = this.form();
    const body = { status, formState: formState as unknown as Record<string, never>, clientUpdatedAt: new Date().toISOString() };
    this.saveLocal(status, formState);
    this.api.saveProtokollPage1(patientId, body).subscribe({
      next: (record) => {
        this.status.set(record.status);
        this.saveState.set(`server ${new Date(record.updatedAt).toLocaleTimeString()}`);
      },
      error: () => {
        this.offlineQueue.queueProtocol(patientId, body);
        this.saveState.set('local-only, sync pending');
      },
    });
  }

  protected downloadExport(): void {
    this.api.exportProtokollPage1(this.patientId()).subscribe({
      next: (data) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `ambulanzprotokoll-${this.patientId()}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.warnings.set(['JSON Export konnte nicht geladen werden.']),
    });
  }

  protected print(): void {
    window.print();
  }

  private async load(): Promise<void> {
    const patientId = this.patientId();
    const local = await this.drafts.get(patientId);
    if (local) {
      this.form.set(local.formState as FormState);
      this.status.set(local.status);
      this.saveState.set(`lokal ${new Date(local.updatedAt).toLocaleTimeString()}`);
    }

    this.api.getProtokollPage1(patientId).subscribe({
      next: (record) => {
        const serverTime = Date.parse(record.updatedAt);
        const localTime = local ? Date.parse(local.updatedAt) : 0;
        if (!local || serverTime >= localTime) {
          this.form.set(mergeState(defaultState(), record.formState as Partial<FormState>));
          this.status.set(record.status);
          this.saveState.set(`server ${new Date(record.updatedAt).toLocaleTimeString()}`);
        }
      },
      error: () => undefined,
    });
  }

  private queueAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.saveLocal(this.status(), this.form()), 350);
  }

  private saveLocal(status: Status, formState: FormState): void {
    const record: ProtokollDraftRecord = {
      patientId: this.patientId(),
      sceneId: this.responderState.scene()?.id,
      status,
      updatedAt: new Date().toISOString(),
      finalizedAt: status === 'finalized' ? new Date().toISOString() : null,
      formState,
    };
    this.drafts.put(record).then(() => this.saveState.set(`lokal ${new Date(record.updatedAt).toLocaleTimeString()}`));
  }

  private computeGcs(): void {
    const vitals = this.form().vitals;
    const values = [vitals.gcs_augenoeffnen, vitals.gcs_verbale_reaktion, vitals.gcs_motorische_reaktion];
    this.setValue('vitals.gcs_summe', values.every((value) => typeof value === 'number') ? values.reduce((sum, value) => sum + Number(value), 0) : null);
  }

  private collectWarnings(): string[] {
    const warnings: string[] = [];
    if (!this.form().patient.familienname && !this.form().patient.vorname) {
      warnings.push('Patientenname ist leer.');
    }
    return warnings;
  }
}

function defaultState() {
  return {
    incident: { ambulanzort: '', datum: null as string | null, uhrzeit_beginn: null as string | null, dnr_san_1: '', dnr_san_2: '', dnr_san_3: '', dnr_na: '', pls_nummer: '', funkrufname: '' },
    patient: { familienname: '', vorname: '', geschlecht: null as 'd' | 'm' | 'w' | null, vers_nr: '', geburtsdatum: null as string | null, adresse: '', staat: '', telefon: '', arbeitgeber: '', versicherungstraeger: '', familienstand: '' },
    assessment_primary: { naca: [] as string[], atemweg: [] as string[], atmung: [] as string[], kreislauf: [] as string[], bewusstsein: [] as string[], angen_notfallzeit: { zeit: null as string | null, gt24h: false, unbekannt: false } },
    assessment_secondary: { anamnese_text: '', bodymap: [] as Array<{ view: 'front' | 'back'; marker: MarkerType; x: number; y: number }> },
    medications_administered: [] as Array<{ medikament: string; dosis: string; art: string; uhrzeit: string | null }>,
    vitals: { pupillen: { R: [] as string[], L: [] as string[] }, schmerz: null as number | null, schmerz_nicht_beurteilbar: false, gcs_augenoeffnen: null as number | null, gcs_verbale_reaktion: null as number | null, gcs_motorische_reaktion: null as number | null, gcs_summe: null as number | null, keine: false, rr: '', puls: '', puls_rhythmus: [] as string[], af: '', temp: '', bz: '', etco2: '', spo2: '', o2_l_min: '', o2_beatmung_l_min: '' },
    measures: { herz_kreislauf: { massnahmen: [] as string[], dnr: '', anzahl: '', letzte_joule: '', freq: '', mv: '' }, atmung: { massnahmen: [] as string[], dnr: '', af: '', amv: '', peep: '' }, weitere_massnahmen: { massnahmen: [] as string[], abbinden_zeit: null as string | null, lagerung_art: '' } },
    history: { allergien: '', medikamente: '', patientengeschichte_vorerkrankungen: '', letzte_orale_aufnahme: '', ereignisse_zuvor: '', risikofaktoren: '' },
    disposition: { abschlussart: [] as string[], klinischer_zustand: [] as string[], uhrzeit_ende: null as string | null, org: '', typ: '', kennung: '', angehoerige_in_kenntnis: [] as string[], kontaktdaten: '' },
    signatures: { entlass_san_na: null as string | null },
  };
}

function getPath(source: Record<string, unknown>, path: string): any {
  return path.split('.').reduce<any>((value, key) => value?.[key], source);
}

function setPath<T>(source: T, path: string, value: unknown): T {
  const clone: any = structuredClone(source);
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce((node, key) => node[key], clone);
  target[last] = value === '' ? '' : value;
  return clone;
}

function mergeState<T>(base: T, partial: Partial<T>): T {
  return { ...base, ...partial };
}
