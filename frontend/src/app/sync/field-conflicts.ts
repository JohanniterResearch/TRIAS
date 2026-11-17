import { Injectable, signal } from '@angular/core';
import type { components } from '../api/openapi-types';

export type FieldResult = components['schemas']['FieldWriteResult'];
const labels: Record<string, string> = {
  'assessment_primary.angen_notfallzeit.zeit': 'Angenommene Notfallzeit',
  'assessment_primary.angen_notfallzeit.gt24h': 'Notfallzeit länger als 24 Stunden',
  'assessment_primary.angen_notfallzeit.unbekannt': 'Notfallzeit unbekannt',
  'vitals.schmerz': 'Schmerzstärke',
  'vitals.schmerz_nicht_beurteilbar': 'Schmerz nicht beurteilbar',
  'vitals.gcs_augenoeffnen': 'GCS Augenöffnen',
  'vitals.gcs_verbale_reaktion': 'GCS verbale Reaktion',
  'vitals.gcs_motorische_reaktion': 'GCS motorische Reaktion',
  'vitals.gcs_summe': 'GCS Summe',
  'vitals.keine': 'Keine Messwerte',
  triagefarbe: 'Triagefarbe',
  atmung: 'Atmung',
  blutung: 'Blutung',
  radialispuls: 'Radialispuls',
  transport: 'Transport',
  dringend: 'Dringend',
  kontaminiert: 'Kontaminiert',
  location: 'Patientenstandort',
  'assessment_secondary.bodymap': 'Körperkarte im Protokoll',
  medications_administered: 'Akutmedikation',
  'signatures.entlass_san_na': 'Unterschrift',
  'incident.ambulanzort': 'Ambulanzort',
  'incident.pls_nummer': 'Protokoll- / PLS-Nummer',
  'incident.datum': 'Datum',
  'incident.uhrzeit_beginn': 'Uhrzeit-Beginn',
  'incident.dnr_san_1': 'DNr. - San.',
  'incident.dnr_na': 'DNr. - NA',
  'incident.dnr_san_2': 'DNr. - San. 2',
  'incident.dnr_san_3': 'DNr. - San. 3',
  'incident.funkrufname': 'Funkrufname',
  'patient.familienname': 'Patient - Familienname',
  'patient.vorname': 'Vorname',
  'patient.vers_nr': 'Vers.-Nr.',
  'patient.geburtsdatum': 'Geb.-Datum',
  'patient.adresse': 'Adresse',
  'patient.telefon': 'Telefon',
  'patient.staat': 'Staat',
  'patient.arbeitgeber': 'Arbeitgeber',
  'patient.versicherungstraeger': 'Versicherungsträger',
  'patient.familienstand': 'Familienstand',
  'assessment_secondary.anamnese_text': 'ANAMNESE / UNTERSUCHUNG',
  'history.allergien': 'Allergien',
  'history.medikamente': 'Medikamente',
  'history.patientengeschichte_vorerkrankungen': 'Patientengeschichte / Vorerkrankungen',
  'history.letzte_orale_aufnahme': 'Letzte orale Aufnahme',
  'history.ereignisse_zuvor': 'Ereignisse zuvor',
  'history.risikofaktoren': 'Risikofaktoren',
  'disposition.uhrzeit_ende': 'Uhrzeit-Ende',
  'disposition.org': 'Org.',
  'disposition.typ': 'Typ',
  'disposition.kennung': 'Kennung',
  'disposition.kontaktdaten': 'Kontaktdaten',
  'patient.geschlecht': 'Geschlecht',
  'assessment_primary.naca': 'NACA',
  'assessment_primary.atemweg': 'Atemweg',
  'assessment_primary.atmung': 'Atmung',
  'assessment_primary.kreislauf': 'Kreislauf',
  'assessment_primary.bewusstsein': 'Bewusstsein',
  'vitals.pupillen.R': 'Pupille R',
  'vitals.pupillen.L': 'Pupille L',
  'vitals.puls_rhythmus': 'Pulsrhythmus',
  'measures.herz_kreislauf.massnahmen': 'Herz / Kreislauf',
  'measures.atmung.massnahmen': 'Atmung',
  'measures.weitere_massnahmen.massnahmen': 'Weitere Maßnahmen',
  'disposition.abschlussart': 'Abschlussart',
  'disposition.klinischer_zustand': 'Klinischer Zustand',
  'disposition.angehoerige_in_kenntnis': 'Angehörige in Kenntnis',
  'measures.herz_kreislauf.dnr': 'DNr.',
  'measures.herz_kreislauf.anzahl': 'Anzahl',
  'measures.herz_kreislauf.letzte_joule': 'letzte Joule',
  'measures.herz_kreislauf.freq': 'Freq.',
  'measures.herz_kreislauf.mv': 'mV',
  'measures.atmung.dnr': 'DNr.',
  'measures.atmung.af': 'AF',
  'measures.atmung.amv': 'AMV',
  'measures.atmung.peep': 'PEEP',
  'measures.weitere_massnahmen.abbinden_zeit': 'Abbinden Zeit',
  'measures.weitere_massnahmen.lagerung_art': 'Lagerung Art',
  'vitals.rr': 'RR',
  'vitals.puls': 'Puls',
  'vitals.af': 'AF',
  'vitals.temp': 'Temp.',
  'vitals.bz': 'BZ',
  'vitals.etco2': 'etCO2',
  'vitals.spo2': 'SpO2',
  'vitals.o2_l_min': 'O2 l/min',
  'vitals.o2_beatmung_l_min': 'O2 Beatmung l/min',
};
export function fieldLabel(field: string): string {
  return (
    labels[field] ??
    field
      .split('.')
      .at(-1)!
      .replaceAll('_', ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function displayServerValue(value: unknown): string {
  if (value === null || value === undefined) return 'nicht angegeben';
  if (value === false) return 'Nein';
  if (value === true) return 'Ja';
  if (typeof value === 'object' && !Array.isArray(value) && 'lat' in value) {
    const location = value as Record<string, unknown>;
    const source =
      location['source'] === 'manual'
        ? 'manuell'
        : location['source'] === 'gps'
          ? 'GPS'
          : 'nicht angegeben';
    return (
      displayServerValue(location['lat']) +
      ', ' +
      displayServerValue(location['lng']) +
      '; Quelle: ' +
      source +
      '; Genauigkeit: ' +
      displayServerValue(location['accuracyMeters']) +
      (location['accuracyMeters'] == null ? '' : ' m') +
      '; Innenstandort: ' +
      displayServerValue(location['indoorLocation'])
    );
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
@Injectable({ providedIn: 'root' })
export class FieldConflicts {
  readonly notices = signal<Array<{ key: string; patientId: number; message: string }>>([]);
  report(patientId: number, writeId: string, results: FieldResult[] | null | undefined): void {
    const rejected = results?.filter((r) => r.outcome === 'rejected') ?? [];
    if (!rejected.length) return;
    const partial = results?.some((r) => r.outcome === 'applied');
    const message =
      (partial
        ? 'Nur ein Teil der Änderungen wurde übernommen. '
        : 'Änderungen wurden nicht übernommen. ') +
      rejected
        .map(
          (r) =>
            fieldLabel(r.field) +
            ': Neuere Eingabe am Server. Gültiger Wert: ' +
            displayServerValue(r.serverValue),
        )
        .join('; ');
    this.notices.update((items) => [
      ...items.filter((item) => item.key !== writeId),
      { key: writeId, patientId, message },
    ]);
  }
  dismiss(key: string): void {
    this.notices.update((items) => items.filter((item) => item.key !== key));
  }
}
