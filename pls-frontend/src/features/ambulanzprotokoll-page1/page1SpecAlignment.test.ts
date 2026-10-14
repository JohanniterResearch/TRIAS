import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  page1BodyMapLegend,
  page1FooterGroups,
  page1GcsSections,
  page1GenderOptions,
  page1HistorySections,
  page1MeasureSections,
  page1MedicationColumns,
  page1NacaOptions,
  page1PrimaryAssessmentGroups,
  page1PulseRhythmOptions,
  page1PupillenRows,
  page1StateTemplate,
  page1ZoneRects,
} from './page1LayoutSpec';

type Field = {
  id: string;
  label?: string;
  bind?: string;
  options?: Array<{ value: string | number; label: string }>;
  fields?: Field[];
  subgroups?: Field[];
  rows?: string[];
};

type Zone = {
  id: string;
  rectPct: { x: number; y: number; w: number; h: number };
  fields?: Field[];
  rows?: Array<{ fields: Field[] }>;
  subgroups?: Field[];
  right?: { legend?: Array<{ value: string; label: string }>; sections?: Field[] };
  left?: { sections?: Array<{ label: string; fields: Field[] }> };
  columns?: Array<{ key: string; label: string }>;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(currentDir, '../../../docs/specs/ambulanzprotokoll_page1.json');
const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as { stateSchema: unknown; zones: Zone[] };
const zone = (id: string) => spec.zones.find((candidate) => candidate.id === id)!;

describe('page1 canonical spec alignment', () => {
  it('keeps the live default state and fixed zone order/rectangles aligned', () => {
    expect(page1StateTemplate).toEqual(spec.stateSchema);
    expect(Object.entries(page1ZoneRects)).toEqual(
      spec.zones.map(({ id, rectPct }) => [id, rectPct]),
    );
  });

  it('keeps live renderer option labels and checkbox ordering aligned', () => {
    const patientFields = zone('patient_block').rows!.flatMap((row) => row.fields);
    const primaryGroups = zone('erstdiagnose_allgemein').subgroups ?? [];
    const generalImpression = primaryGroups.find(({ id }) => id === 'allgemeiner_eindruck')!;
    const findings = zone('erst_endbefund').subgroups ?? [];
    const gcs = findings.find(({ id }) => id === 'gcs')!;
    const measurements = findings.find(({ id }) => id === 'messwerte')!;
    const measures = zone('massnahmen_ample');
    const footerFields = zone('footer_disposition').fields ?? [];

    expect(page1GenderOptions).toEqual(patientFields.find(({ id }) => id === 'geschlecht')!.options);
    expect(page1NacaOptions).toEqual(primaryGroups.find(({ id }) => id === 'naca')!.options);
    expect(page1BodyMapLegend).toEqual(zone('anamnese_bodymap').right!.legend);
    expect(page1PrimaryAssessmentGroups).toEqual(
      generalImpression.subgroups!.filter(({ options }) => options).map(({ label, bind, options }) => ({ label, bind, options })),
    );
    expect(page1PupillenRows).toEqual(findings.find(({ id }) => id === 'pupillen')!.rows);
    expect(page1PulseRhythmOptions).toEqual(measurements.fields!.find(({ id }) => id === 'puls_rhythmus')!.options);
    expect(page1GcsSections).toEqual(
      gcs.fields!.filter(({ options }) => options).map(({ label, bind, options }) => ({
        label,
        bind,
        options: options!.map(({ value, label: optionLabel }) => ({ value: String(value), label: optionLabel })),
      })),
    );
    expect(page1MedicationColumns).toEqual(
      zone('akutmedikation').columns!.map(({ key, label }) => ({ key, label })),
    );
    expect(page1MeasureSections).toEqual(
      measures.left!.sections!.map(({ label, fields }) => ({
        key: fields[0].bind!.split('.')[1],
        label,
        bind: fields[0].bind,
        options: fields[0].options,
      })),
    );
    expect(page1HistorySections).toEqual(
      measures.right!.sections!.map(({ label, bind }) => ({ label, bind })),
    );
    expect(page1FooterGroups).toEqual({
      abschlussart: footerFields.find(({ id }) => id === 'abschlussart')!.options,
      klinischer_zustand: footerFields.find(({ id }) => id === 'klinischer_zustand')!.options,
      angehoerige_in_kenntnis: footerFields.find(({ id }) => id === 'angehoerige_in_kenntnis')!.options,
    });
  });
});
