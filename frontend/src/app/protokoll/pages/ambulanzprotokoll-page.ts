import { JsonPipe } from '@angular/common';
import { Component, ElementRef, inject, OnDestroy, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { ProtokollDraftStore } from '../services/protokoll-draft-store';

type Status = 'draft' | 'finalized';
type MarkerType =
  'wunde' | 'fraktur' | 'schmerz' | 'prellung' | 'amputation' | 'verbrennung' | 'luxation';
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
  {
    path: 'incident.uhrzeit_beginn',
    label: 'Uhrzeit-Beginn',
    x: 71,
    y: 1,
    w: 10,
    h: 3,
    type: 'time',
  },
  { path: 'incident.dnr_san_1', label: 'DNr. - San.', x: 82, y: 1, w: 8, h: 3 },
  { path: 'incident.dnr_na', label: 'DNr. - NA', x: 91, y: 1, w: 7, h: 3 },
  { path: 'incident.dnr_san_2', label: 'DNr. - San. 2', x: 82, y: 4, w: 8, h: 2 },
  { path: 'incident.dnr_san_3', label: 'DNr. - San. 3', x: 91, y: 4, w: 7, h: 2 },
  { path: 'incident.funkrufname', label: 'Funkrufname', x: 24, y: 4, w: 18, h: 2 },
  { path: 'patient.familienname', label: 'Patient - Familienname', x: 2, y: 8, w: 21, h: 3 },
  { path: 'patient.vorname', label: 'Vorname', x: 24, y: 8, w: 16, h: 3 },
  { path: 'patient.vers_nr', label: 'Vers.-Nr.', x: 50, y: 8, w: 15, h: 3 },
  { path: 'patient.geburtsdatum', label: 'Geb.-Datum', x: 66, y: 8, w: 13, h: 3, type: 'date' },
  { path: 'patient.adresse', label: 'Adresse', x: 2, y: 12, w: 38, h: 3 },
  { path: 'patient.telefon', label: 'Telefon', x: 66, y: 12, w: 15, h: 3 },
  { path: 'patient.staat', label: 'Staat', x: 41, y: 12, w: 10, h: 3 },
  { path: 'patient.arbeitgeber', label: 'Arbeitgeber', x: 2, y: 15, w: 25, h: 2 },
  { path: 'patient.versicherungstraeger', label: 'Versicherungsträger', x: 28, y: 15, w: 25, h: 2 },
  { path: 'patient.familienstand', label: 'Familienstand', x: 82, y: 14, w: 16, h: 2 },
  {
    path: 'assessment_secondary.anamnese_text',
    label: 'ANAMNESE / UNTERSUCHUNG',
    x: 3,
    y: 29,
    w: 50,
    h: 18,
    type: 'textarea',
  },
  { path: 'history.allergien', label: 'Allergien', x: 72, y: 79, w: 26, h: 2.5 },
  { path: 'history.medikamente', label: 'Medikamente', x: 72, y: 82, w: 26, h: 2.5 },
  {
    path: 'history.patientengeschichte_vorerkrankungen',
    label: 'Patientengeschichte / Vorerkrankungen',
    x: 72,
    y: 85,
    w: 26,
    h: 3,
    type: 'textarea',
  },
  {
    path: 'history.letzte_orale_aufnahme',
    label: 'Letzte orale Aufnahme',
    x: 72,
    y: 88.5,
    w: 12.5,
    h: 2.5,
  },
  {
    path: 'history.ereignisse_zuvor',
    label: 'Ereignisse zuvor',
    x: 85.5,
    y: 88.5,
    w: 12.5,
    h: 2.5,
  },
  { path: 'history.risikofaktoren', label: 'Risikofaktoren', x: 72, y: 91.5, w: 26, h: 2 },
  {
    path: 'disposition.uhrzeit_ende',
    label: 'Uhrzeit-Ende',
    x: 28,
    y: 96,
    w: 10,
    h: 2,
    type: 'time',
  },
  { path: 'disposition.org', label: 'Org.', x: 39, y: 96, w: 5, h: 2 },
  { path: 'disposition.typ', label: 'Typ', x: 45, y: 96, w: 5, h: 2 },
  { path: 'disposition.kennung', label: 'Kennung', x: 51, y: 96, w: 8, h: 2 },
  { path: 'disposition.kontaktdaten', label: 'Kontaktdaten', x: 60, y: 96, w: 12, h: 2 },
];

interface OptionGroup {
  path: string;
  label: string;
  options: string[];
  x: number;
  y: number;
  w: number;
  single?: boolean;
}

const optionGroups: OptionGroup[] = [
  {
    path: 'patient.geschlecht',
    label: 'Geschlecht',
    options: ['d', 'm', 'w'],
    x: 80,
    y: 8,
    w: 18,
    single: true,
  },
  {
    path: 'assessment_primary.naca',
    label: 'NACA',
    options: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'],
    x: 2,
    y: 18,
    w: 18,
    single: true,
  },
  {
    path: 'assessment_primary.atemweg',
    label: 'Atemweg',
    options: ['frei', 'gefaehrdet', 'verlegt'],
    x: 21,
    y: 18,
    w: 18,
  },
  {
    path: 'assessment_primary.atmung',
    label: 'Atmung',
    options: [
      'Apnoe',
      'Schnappatmung',
      'Zyanose',
      'unauffaellig',
      'Dyspnoe',
      'Atemgeraeusche',
      'andere Atemstoerungen',
    ],
    x: 40,
    y: 18,
    w: 20,
  },
  {
    path: 'assessment_primary.kreislauf',
    label: 'Kreislauf',
    options: [
      'Puls peripher tastbar',
      'Tachykardie',
      'Bradykardie',
      'blass',
      'kalt',
      'unauffaellig',
      'Starke Blutung',
      'geroetet',
      'schweissig',
      'erwaermt',
    ],
    x: 61,
    y: 18,
    w: 22,
  },
  {
    path: 'assessment_primary.bewusstsein',
    label: 'Bewusstsein',
    options: ['Wach', 'Getruebt', 'Bewusstlos', 'Agitiert'],
    x: 84,
    y: 18,
    w: 14,
  },
  {
    path: 'vitals.pupillen.R',
    label: 'Pupille R',
    options: [
      'eng',
      'mittel',
      'weit',
      'entrundet',
      'prompte Lichtreflexe',
      'verlangsamte Lichtreflexe',
      'lichtstarr',
    ],
    x: 2,
    y: 61.5,
    w: 14,
  },
  {
    path: 'vitals.pupillen.L',
    label: 'Pupille L',
    options: [
      'eng',
      'mittel',
      'weit',
      'entrundet',
      'prompte Lichtreflexe',
      'verlangsamte Lichtreflexe',
      'lichtstarr',
    ],
    x: 17,
    y: 61.5,
    w: 14,
  },
  {
    path: 'vitals.puls_rhythmus',
    label: 'Pulsrhythmus',
    options: ['rhy.', 'arrhy.'],
    x: 32,
    y: 70,
    w: 14,
    single: true,
  },
  {
    path: 'measures.herz_kreislauf.massnahmen',
    label: 'Herz / Kreislauf',
    options: [
      'peripherven. Zugang / IO Zugang',
      'Herzdruckmassage',
      'Defibrillation/Kardiov.',
      'Schrittmacher extern',
    ],
    x: 2,
    y: 78,
    w: 22,
  },
  {
    path: 'measures.atmung.massnahmen',
    label: 'Atmung',
    options: [
      'Absaugen',
      'oral',
      'nasal',
      'endotracheal',
      'Intubation',
      'Wendltubus',
      'Guedeltubus',
      'Larynxtubus',
      'endotracheal (oral)',
      'endotracheal (nasal)',
      'Beatmung',
      'assistiert',
      'kontrolliert',
      'manuell',
      'maschinell',
    ],
    x: 25,
    y: 78,
    w: 26,
  },
  {
    path: 'measures.weitere_massnahmen.massnahmen',
    label: 'Weitere Maßnahmen',
    options: [
      'Verband',
      'Blutstillung',
      'Abbinden',
      'Lagerung',
      '12-Abl.-EKG',
      'Monitoring',
      'HF',
      'RR',
      'SpO2',
      '4-Abl.-EKG',
      'etCO2',
      'Schienung',
      'HWS',
      'Spineboard',
      'Vakuummatratze',
      'Extremitaet',
    ],
    x: 52,
    y: 78,
    w: 18,
  },
  {
    path: 'disposition.abschlussart',
    label: 'Abschlussart',
    options: ['Uebergabe:', 'Revers (Ruecks.)', 'Belassung', 'Entf. selbstst. o. Revers'],
    x: 2,
    y: 94.5,
    w: 25,
    single: true,
  },
  {
    path: 'disposition.klinischer_zustand',
    label: 'Klinischer Zustand',
    options: ['verbessert', 'gleich', 'verschlechtert'],
    x: 73,
    y: 94.5,
    w: 9,
    single: true,
  },
  {
    path: 'disposition.angehoerige_in_kenntnis',
    label: 'Angehörige in Kenntnis',
    options: ['durch RD', 'durch Polizei', 'durch Pat/andere'],
    x: 73,
    y: 97,
    w: 9,
    single: true,
  },
];

const measureFields: FieldConfig[] = [
  { path: 'measures.herz_kreislauf.dnr', label: 'DNr.', x: 2, y: 90.5, w: 4, h: 2 },
  { path: 'measures.herz_kreislauf.anzahl', label: 'Anzahl', x: 6.5, y: 90.5, w: 4, h: 2 },
  {
    path: 'measures.herz_kreislauf.letzte_joule',
    label: 'letzte Joule',
    x: 11,
    y: 90.5,
    w: 5,
    h: 2,
  },
  { path: 'measures.herz_kreislauf.freq', label: 'Freq.', x: 16.5, y: 90.5, w: 4, h: 2 },
  { path: 'measures.herz_kreislauf.mv', label: 'mV', x: 21, y: 90.5, w: 3, h: 2 },
  { path: 'measures.atmung.dnr', label: 'DNr.', x: 25, y: 90.5, w: 5, h: 2 },
  { path: 'measures.atmung.af', label: 'AF', x: 30.5, y: 90.5, w: 5, h: 2 },
  { path: 'measures.atmung.amv', label: 'AMV', x: 36, y: 90.5, w: 6, h: 2 },
  { path: 'measures.atmung.peep', label: 'PEEP', x: 42.5, y: 90.5, w: 7, h: 2 },
  {
    path: 'measures.weitere_massnahmen.abbinden_zeit',
    label: 'Abbinden Zeit',
    x: 52,
    y: 91.5,
    w: 8,
    h: 2,
    type: 'time',
  },
  {
    path: 'measures.weitere_massnahmen.lagerung_art',
    label: 'Lagerung Art',
    x: 61,
    y: 91.5,
    w: 9,
    h: 2,
  },
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
  imports: [JsonPipe, MyAccess],
  template: `
    <section class="protocol-workspace">
      <app-my-access />
      <div class="protocol-toolbar">
        <strong>Patient {{ patientId() }}</strong>
        <span>{{ status() === 'finalized' ? 'Finalisiert' : 'Entwurf' }}</span>
        <span role="status" aria-live="polite">{{ saveState() }}</span>
        <button type="button" (click)="save('draft')">Speichern</button>
        <button type="button" (click)="save('finalized')">Finalisieren</button>
        <button type="button" (click)="downloadExport()">JSON Export</button>
        <button type="button" (click)="print()">Drucken</button>
        <button type="button" (click)="back()">Zurück</button>
      </div>

      @if (warnings().length) {
        <ul class="form-error" role="alert" aria-live="assertive">
          @for (warning of warnings(); track warning) {
            <li>{{ warning }}</li>
          }
        </ul>
      }

      <div class="protocol-scale">
        <div class="protocol-page">
          @for (zone of zones; track zone[0]) {
            <section
              class="protocol-zone"
              [style.left.%]="zone[1]"
              [style.top.%]="zone[2]"
              [style.width.%]="zone[3]"
              [style.height.%]="zone[4]"
            >
              <span>{{ zone[5] }}</span>
            </section>
          }

          @for (field of fields; track field.path) {
            <label
              class="protocol-field"
              [style.left.%]="field.x"
              [style.top.%]="field.y"
              [style.width.%]="field.w"
              [style.height.%]="field.h"
            >
              <span>{{ field.label }}</span>
              @if (field.type === 'textarea') {
                <textarea
                  [value]="value(field.path)"
                  (input)="setValue(field.path, $any($event.target).value)"
                ></textarea>
              } @else {
                <input
                  [type]="field.type || 'text'"
                  [value]="value(field.path)"
                  (input)="setValue(field.path, $any($event.target).value)"
                />
              }
            </label>
          }

          @for (group of optionGroups; track group.path) {
            <fieldset
              class="protocol-checks protocol-option-group"
              [class.primary-options]="group.path.startsWith('assessment_primary')"
              [class.footer-options]="group.path.startsWith('disposition')"
              [style.left.%]="group.x"
              [style.top.%]="group.y"
              [style.width.%]="group.w"
            >
              <legend>{{ group.label }}</legend>
              @for (item of group.options; track item) {
                <label>
                  <input
                    [type]="group.single ? 'radio' : 'checkbox'"
                    [name]="group.path"
                    [checked]="has(group.path, item) || value(group.path) === item"
                    (change)="toggleOption(group, item, $any($event.target).checked)"
                  />
                  {{ displayOption(item) }}
                </label>
              }
            </fieldset>
          }

          @for (field of measureFields; track field.path) {
            <label
              class="protocol-field"
              [style.left.%]="field.x"
              [style.top.%]="field.y"
              [style.width.%]="field.w"
              [style.height.%]="field.h"
            >
              <span>{{ field.label }}</span>
              <input
                [type]="field.type || 'text'"
                [value]="value(field.path)"
                (input)="setValue(field.path, $any($event.target).value)"
              />
            </label>
          }

          <div class="protocol-emergency-time">
            <strong>Angen. Notfallzeit</strong>
            <input
              type="time"
              [value]="value('assessment_primary.angen_notfallzeit.zeit')"
              (input)="
                setValue('assessment_primary.angen_notfallzeit.zeit', $any($event.target).value)
              "
            />
            <label
              ><input
                type="checkbox"
                [checked]="value('assessment_primary.angen_notfallzeit.gt24h')"
                (change)="
                  setValue(
                    'assessment_primary.angen_notfallzeit.gt24h',
                    $any($event.target).checked
                  )
                "
              />
              &gt;24h</label
            >
            <label
              ><input
                type="checkbox"
                [checked]="value('assessment_primary.angen_notfallzeit.unbekannt')"
                (change)="
                  setValue(
                    'assessment_primary.angen_notfallzeit.unbekannt',
                    $any($event.target).checked
                  )
                "
              />
              unbekannt</label
            >
          </div>

          <div class="protocol-checks vitals">
            <strong>GCS / Messwerte</strong>
            <label
              >Augen
              <select
                [value]="value('vitals.gcs_augenoeffnen')"
                (change)="setNumber('vitals.gcs_augenoeffnen', $any($event.target).value)"
              >
                <option value="">-</option>
                <option value="4">4 spontan</option>
                <option value="3">3 auf Ansprache</option>
                <option value="2">2 auf Schmerz</option>
                <option value="1">1 keine</option>
              </select>
            </label>
            <label
              >Verbal
              <select
                [value]="value('vitals.gcs_verbale_reaktion')"
                (change)="setNumber('vitals.gcs_verbale_reaktion', $any($event.target).value)"
              >
                <option value="">-</option>
                <option value="5">5 orientiert</option>
                <option value="4">4 verwirrt</option>
                <option value="3">3 Worte</option>
                <option value="2">2 Laute</option>
                <option value="1">1 keine</option>
              </select>
            </label>
            <label
              >Motorik
              <select
                [value]="value('vitals.gcs_motorische_reaktion')"
                (change)="setNumber('vitals.gcs_motorische_reaktion', $any($event.target).value)"
              >
                <option value="">-</option>
                <option value="6">6 befolgt</option>
                <option value="5">5 lokalisiert</option>
                <option value="4">4 Abwehr</option>
                <option value="3">3 Beugung</option>
                <option value="2">2 Streckung</option>
                <option value="1">1 keine</option>
              </select>
            </label>
            <span>GCS-Summe: {{ value('vitals.gcs_summe') || '-' }}</span>
            <label
              >Schmerz
              <input
                type="number"
                min="0"
                max="10"
                [value]="value('vitals.schmerz')"
                (input)="setNumber('vitals.schmerz', $any($event.target).value)"
            /></label>
            <label
              ><input
                type="checkbox"
                [checked]="value('vitals.schmerz_nicht_beurteilbar')"
                (change)="setValue('vitals.schmerz_nicht_beurteilbar', $any($event.target).checked)"
              />
              nicht beurteilbar</label
            >
            <label
              ><input
                type="checkbox"
                [checked]="value('vitals.keine')"
                (change)="setValue('vitals.keine', $any($event.target).checked)"
              />
              keine Messwerte</label
            >
            @for (vital of vitalFields; track vital.path) {
              <label
                >{{ vital.label }}
                <input
                  [value]="value(vital.path)"
                  (input)="setValue(vital.path, $any($event.target).value)"
              /></label>
            }
          </div>

          <div class="medication-grid">
            <strong>Akutmedikation</strong>
            @for (row of medicationRows; track row) {
              <div class="medication-entry">
                <span>{{ row + 1 }}</span>
                <input
                  aria-label="Medikament"
                  placeholder="Medikament"
                  [value]="med(row, 'medikament')"
                  (input)="setMed(row, 'medikament', $any($event.target).value)"
                />
                <input
                  aria-label="Dosis"
                  placeholder="Dosis"
                  [value]="med(row, 'dosis')"
                  (input)="setMed(row, 'dosis', $any($event.target).value)"
                />
                <input
                  aria-label="Art"
                  placeholder="Art"
                  [value]="med(row, 'art')"
                  (input)="setMed(row, 'art', $any($event.target).value)"
                />
                <input
                  aria-label="Uhrzeit"
                  type="time"
                  [value]="med(row, 'uhrzeit')"
                  (input)="setMed(row, 'uhrzeit', $any($event.target).value)"
                />
              </div>
            }
          </div>

          <div class="protocol-bodymap" (click)="addMarker($event)">
            <div class="protocol-bodymap-toolbar" (click)="$event.stopPropagation()">
              <button
                type="button"
                [class.active]="bodyView() === 'front'"
                (click)="bodyView.set('front')"
              >
                Vorne
              </button>
              <button
                type="button"
                [class.active]="bodyView() === 'back'"
                (click)="bodyView.set('back')"
              >
                Hinten
              </button>
              <select
                aria-label="Markertyp"
                [value]="markerType()"
                (change)="markerType.set($any($event.target).value)"
              >
                @for (type of markerTypes; track type) {
                  <option [value]="type">{{ displayOption(type) }}</option>
                }
              </select>
            </div>
            <svg
              class="protocol-silhouette"
              viewBox="0 0 240 560"
              role="img"
              [attr.aria-label]="bodyView() === 'front' ? 'Körper vorne' : 'Körper hinten'"
            >
              <circle cx="120" cy="48" r="30" />
              <path
                d="M91 82 Q120 70 149 82 L164 225 Q150 260 148 300 L158 510 L132 510 L120 312 L108 510 L82 510 L92 300 Q90 260 76 225 Z"
              />
              <path d="M82 95 L42 250 L62 256 L100 142 M158 95 L198 250 L178 256 L140 142" />
            </svg>
            @for (marker of visibleMarkers(); track $index) {
              <button
                type="button"
                class="body-marker"
                [style.left.%]="marker.x"
                [style.top.%]="marker.y"
                [attr.aria-label]="displayOption(marker.marker) + ' entfernen'"
                (click)="removeMarker(marker); $event.stopPropagation()"
              >
                {{ marker.marker[0].toUpperCase() }}
              </button>
            }
          </div>

          <div class="signature-box">
            <span>Unterschrift - Entlass. San/NA</span>
            <canvas
              #signatureCanvas
              width="300"
              height="90"
              (pointerdown)="startSignature($event)"
              (pointermove)="drawSignature($event)"
              (pointerup)="endSignature()"
              (pointerleave)="endSignature()"
            ></canvas>
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
export class AmbulanzprotokollPage implements OnDestroy {
  protected readonly fields = fields;
  protected readonly measureFields = measureFields;
  protected readonly optionGroups = optionGroups;
  protected readonly zones = zones;
  protected readonly medicationRows = Array.from({ length: 8 }, (_, index) => index);
  protected readonly vitalFields = [
    { path: 'vitals.rr', label: 'RR' },
    { path: 'vitals.puls', label: 'Puls' },
    { path: 'vitals.af', label: 'AF' },
    { path: 'vitals.temp', label: 'Temp.' },
    { path: 'vitals.bz', label: 'BZ' },
    { path: 'vitals.etco2', label: 'etCO2' },
    { path: 'vitals.spo2', label: 'SpO2' },
    { path: 'vitals.o2_l_min', label: 'O2 l/min' },
    { path: 'vitals.o2_beatmung_l_min', label: 'O2 Beatmung l/min' },
  ];
  protected readonly markerTypes: MarkerType[] = [
    'wunde',
    'fraktur',
    'schmerz',
    'prellung',
    'amputation',
    'verbrennung',
    'luxation',
  ];
  protected readonly markerType = signal<MarkerType>('wunde');
  protected readonly bodyView = signal<'front' | 'back'>('front');
  protected readonly form = signal<FormState>(defaultState());
  protected readonly status = signal<Status>('draft');
  protected readonly finalizedAt = signal<string | null>(null);
  protected readonly saveState = signal('lokal bereit');
  protected readonly warnings = signal<string[]>([]);

  private readonly api = inject(ApiClient);
  private readonly drafts = inject(ProtokollDraftStore);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly responderState = inject(ResponderStateStore);
  private readonly signatureCanvas = viewChild<ElementRef<HTMLCanvasElement>>('signatureCanvas');
  private readonly currentPatientId = signal(0);
  private editVersion = 0;
  private currentWriteId: string | undefined;
  private readonly savedSub: Subscription;
  private loadGeneration = 0;
  private loadSub: Subscription | null = null;
  private readonly routeSub: Subscription;
  private signaturePoint: { x: number; y: number } | null = null;

  constructor() {
    this.savedSub = this.offlineQueue.protocolSaved.subscribe(
      ({ patientId, sourcePatientId, writeId, record }) => {
        if (
          (patientId !== this.patientId() && sourcePatientId !== this.patientId()) ||
          writeId !== this.currentWriteId
        )
          return;
        this.status.set(record.status);
        this.finalizedAt.set(record.finalizedAt ?? null);
        this.warnings.set(record.warnings);
        this.saveState.set(`server ${new Date(record.updatedAt).toLocaleTimeString()}`);
      },
    );
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const patientId = Number(params.get('patientId') ?? this.responderState.patient()?.id ?? 0);
      if (!patientId || patientId === this.currentPatientId()) return;
      this.currentWriteId = undefined;
      this.editVersion++;
      this.loadSub?.unsubscribe();
      this.currentPatientId.set(patientId);
      const generation = ++this.loadGeneration;
      this.form.set(defaultState());
      this.status.set('draft');
      this.finalizedAt.set(null);
      this.saveState.set('lokal bereit');
      this.warnings.set([]);
      this.load(patientId, generation);
    });
  }

  ngOnDestroy(): void {
    this.savedSub.unsubscribe();
    this.loadGeneration++;
    this.loadSub?.unsubscribe();
    this.routeSub.unsubscribe();
  }

  protected patientId(): number {
    return this.currentPatientId();
  }

  protected back(): void {
    const returnTo =
      typeof history.state.returnTo === 'string'
        ? history.state.returnTo
        : `/patient/${this.patientId()}`;
    this.router.navigateByUrl(returnTo, { state: { sceneId: history.state.sceneId } });
  }

  protected value(path: string): any {
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
    const value = getPath(this.form(), path);
    return Array.isArray(value) && value.includes(item);
  }

  protected toggleOption(group: OptionGroup, item: string, checked: boolean): void {
    if (group.single) {
      this.setValue(
        group.path,
        group.path === 'patient.geschlecht' ? (checked ? item : null) : checked ? [item] : [],
      );
      return;
    }
    const current = Array.isArray(getPath(this.form(), group.path))
      ? (getPath(this.form(), group.path) as string[])
      : [];
    this.setValue(
      group.path,
      checked ? [...new Set([...current, item])] : current.filter((value) => value !== item),
    );
  }

  protected displayOption(value: string): string {
    const labels: Record<string, string> = {
      d: 'divers',
      m: 'männlich',
      w: 'weiblich',
      gefaehrdet: 'gefährdet',
      unauffaellig: 'unauffällig',
      Atemgeraeusche: 'Atemgeräusche',
      Getruebt: 'Getrübt',
      geroetet: 'gerötet',
      schweissig: 'schweißig',
      erwaermt: 'erwärmt',
      Extremitaet: 'Extremität',
      Uebergabe: 'Übergabe',
      Ruecks: 'Rücks.',
    };
    return Object.entries(labels).reduce(
      (label, [source, replacement]) => label.replace(source, replacement),
      value,
    );
  }

  protected med(index: number, key: 'medikament' | 'dosis' | 'art' | 'uhrzeit'): string {
    return this.form().medications_administered[index]?.[key] ?? '';
  }

  protected setMed(
    index: number,
    key: 'medikament' | 'dosis' | 'art' | 'uhrzeit',
    value: string,
  ): void {
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
        bodymap: [
          ...current.assessment_secondary.bodymap,
          { view: this.bodyView(), marker: this.markerType(), x, y },
        ],
      },
    }));
    this.queueAutosave();
  }

  protected visibleMarkers(): FormState['assessment_secondary']['bodymap'] {
    return this.form().assessment_secondary.bodymap.filter(
      (marker) => marker.view === this.bodyView(),
    );
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

  protected startSignature(event: PointerEvent): void {
    const canvas = this.signatureCanvas()?.nativeElement;
    if (!canvas) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    this.signaturePoint = this.signatureCoordinates(event, canvas);
  }

  protected drawSignature(event: PointerEvent): void {
    if (event.buttons !== 1 || !this.signaturePoint) {
      return;
    }

    const canvas = this.signatureCanvas()?.nativeElement;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }

    const point = this.signatureCoordinates(event, canvas);
    context.strokeStyle = '#111111';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(this.signaturePoint.x, this.signaturePoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    this.signaturePoint = point;
    this.setValue('signatures.entlass_san_na', canvas.toDataURL('image/png'));
  }

  protected endSignature(): void {
    this.signaturePoint = null;
  }

  protected clearSignature(): void {
    const canvas = this.signatureCanvas()?.nativeElement;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.setValue('signatures.entlass_san_na', null);
  }

  protected save(status: Status): void {
    this.warnings.set(status === 'finalized' ? this.collectWarnings() : []);
    this.status.set(status);
    if (status === 'finalized' && !this.finalizedAt()) {
      this.finalizedAt.set(new Date().toISOString());
    }
    this.persistSnapshot(true);
  }

  private persistSnapshot(flush = false): void {
    const patientId = this.patientId();
    const generation = this.loadGeneration;
    const version = ++this.editVersion;
    this.currentWriteId = undefined;
    const body = {
      status: this.status(),
      formState: this.form() as unknown as Record<string, never>,
      clientUpdatedAt: new Date().toISOString(),
    };
    this.saveState.set('lokal wird gespeichert');
    this.offlineQueue
      .queueProtocol(patientId, body, {
        sceneId: this.responderState.scene()?.id,
        finalizedAt: body.status === 'finalized' ? this.finalizedAt() : null,
      })
      .then((writeId) => {
        if (
          generation === this.loadGeneration &&
          patientId === this.patientId() &&
          version === this.editVersion
        ) {
          this.currentWriteId = writeId;
          this.saveState.set('local-only, sync pending');
        }
        if (flush) void this.offlineQueue.flush(true).catch(() => undefined);
      })
      .catch(() => {
        if (
          generation !== this.loadGeneration ||
          patientId !== this.patientId() ||
          version !== this.editVersion
        )
          return;
        this.saveState.set('local-only, queue failed');
        this.warnings.set(['Lokale Sync-Warteschlange konnte nicht gespeichert werden.']);
      });
  }

  protected downloadExport(): void {
    this.api.exportProtokollPage1(this.patientId()).subscribe({
      next: (data) => {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `ambulanzprotokoll-${this.patientId()}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: (error: unknown) =>
        this.warnings.set([apiErrorMessage(error, 'JSON Export konnte nicht geladen werden.')]),
    });
  }

  protected print(): void {
    window.print();
  }

  private async load(patientId: number, generation: number): Promise<void> {
    // Legacy provisional-ID mappings are reconciled during app startup. Wait for that atomic
    // rekey before selecting this patient's local draft, otherwise the page can permanently load
    // the older real-ID draft a few milliseconds before the newer provisional draft moves over.
    await this.offlineQueue.whenReady();
    if (generation !== this.loadGeneration || patientId !== this.patientId()) return;
    const version = this.editVersion;
    const [cached, pending] = await Promise.all([
      this.drafts.get(patientId).catch(() => null),
      this.offlineQueue.pendingProtocol(patientId),
    ]);
    if (version !== this.editVersion) return;
    // An older upload can be acknowledged after a newer edit; server time cannot order intent.
    const local = pending ?? cached;
    this.currentWriteId = pending?.writeId;
    if (generation !== this.loadGeneration || patientId !== this.patientId()) return;
    if (local) {
      this.form.set(mergeState(defaultState(), local.formState as Partial<FormState>));
      this.warnings.set(local.warnings ?? []);
      this.status.set(local.status);
      this.finalizedAt.set(local.finalizedAt ?? null);
      this.saveState.set(`lokal ${new Date(local.updatedAt).toLocaleTimeString()}`);
      this.restoreSignature();
    }

    this.loadSub = this.api.getProtokollPage1(patientId).subscribe({
      next: (record) => {
        if (
          generation !== this.loadGeneration ||
          patientId !== this.patientId() ||
          version !== this.editVersion ||
          pending
        )
          return;
        const serverTime = Date.parse(record.updatedAt);
        const localTime = local ? Date.parse(local.updatedAt) : 0;
        if (!local || serverTime >= localTime) {
          this.form.set(mergeState(defaultState(), record.formState as Partial<FormState>));
          this.status.set(record.status);
          this.finalizedAt.set(record.finalizedAt ?? null);
          this.saveState.set(`server ${new Date(record.updatedAt).toLocaleTimeString()}`);
          this.restoreSignature();
        }
      },
      error: () => undefined,
    });
  }

  private queueAutosave(): void {
    this.persistSnapshot();
  }

  private computeGcs(): void {
    const vitals = this.form().vitals;
    const values = [
      vitals.gcs_augenoeffnen,
      vitals.gcs_verbale_reaktion,
      vitals.gcs_motorische_reaktion,
    ];
    this.setValue(
      'vitals.gcs_summe',
      values.every((value) => typeof value === 'number')
        ? values.reduce((sum, value) => sum + Number(value), 0)
        : null,
    );
  }

  private collectWarnings(): string[] {
    const warnings: string[] = [];
    if (!this.form().patient.familienname && !this.form().patient.vorname) {
      warnings.push('Patientenname ist leer.');
    }
    if (!this.form().incident.datum) {
      warnings.push('Datum ist leer.');
    }
    if (!this.form().incident.ambulanzort) {
      warnings.push('Ambulanzort ist leer.');
    }
    return warnings;
  }

  private signatureCoordinates(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number } {
    const box = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) * canvas.width) / box.width,
      y: ((event.clientY - box.top) * canvas.height) / box.height,
    };
  }

  private restoreSignature(): void {
    const source = this.form().signatures.entlass_san_na;
    const canvas = this.signatureCanvas()?.nativeElement;
    if (!source || !canvas) {
      return;
    }
    const image = new Image();
    image.onload = () =>
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = source;
  }
}

function defaultState() {
  return {
    incident: {
      ambulanzort: '',
      datum: null as string | null,
      uhrzeit_beginn: null as string | null,
      dnr_san_1: '',
      dnr_san_2: '',
      dnr_san_3: '',
      dnr_na: '',
      pls_nummer: '',
      funkrufname: '',
    },
    patient: {
      familienname: '',
      vorname: '',
      geschlecht: null as 'd' | 'm' | 'w' | null,
      vers_nr: '',
      geburtsdatum: null as string | null,
      adresse: '',
      staat: '',
      telefon: '',
      arbeitgeber: '',
      versicherungstraeger: '',
      familienstand: '',
    },
    assessment_primary: {
      naca: [] as string[],
      atemweg: [] as string[],
      atmung: [] as string[],
      kreislauf: [] as string[],
      bewusstsein: [] as string[],
      angen_notfallzeit: { zeit: null as string | null, gt24h: false, unbekannt: false },
    },
    assessment_secondary: {
      anamnese_text: '',
      bodymap: [] as Array<{ view: 'front' | 'back'; marker: MarkerType; x: number; y: number }>,
    },
    medications_administered: [] as Array<{
      medikament: string;
      dosis: string;
      art: string;
      uhrzeit: string | null;
    }>,
    vitals: {
      pupillen: { R: [] as string[], L: [] as string[] },
      schmerz: null as number | null,
      schmerz_nicht_beurteilbar: false,
      gcs_augenoeffnen: null as number | null,
      gcs_verbale_reaktion: null as number | null,
      gcs_motorische_reaktion: null as number | null,
      gcs_summe: null as number | null,
      keine: false,
      rr: '',
      puls: '',
      puls_rhythmus: [] as string[],
      af: '',
      temp: '',
      bz: '',
      etco2: '',
      spo2: '',
      o2_l_min: '',
      o2_beatmung_l_min: '',
    },
    measures: {
      herz_kreislauf: {
        massnahmen: [] as string[],
        dnr: '',
        anzahl: '',
        letzte_joule: '',
        freq: '',
        mv: '',
      },
      atmung: { massnahmen: [] as string[], dnr: '', af: '', amv: '', peep: '' },
      weitere_massnahmen: {
        massnahmen: [] as string[],
        abbinden_zeit: null as string | null,
        lagerung_art: '',
      },
    },
    history: {
      allergien: '',
      medikamente: '',
      patientengeschichte_vorerkrankungen: '',
      letzte_orale_aufnahme: '',
      ereignisse_zuvor: '',
      risikofaktoren: '',
    },
    disposition: {
      abschlussart: [] as string[],
      klinischer_zustand: [] as string[],
      uhrzeit_ende: null as string | null,
      org: '',
      typ: '',
      kennung: '',
      angehoerige_in_kenntnis: [] as string[],
      kontaktdaten: '',
    },
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
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return (partial ?? base) as T;
  }
  const result: Record<string, unknown> = structuredClone(base as Record<string, unknown>);
  for (const [key, value] of Object.entries(partial)) {
    const existing = result[key];
    result[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? mergeState(existing ?? {}, value)
        : value;
  }
  return result as T;
}
