import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_ROWS,
  PROTOCOL_VALUE_MAP,
  ProtocolCodecError,
  decodePage1,
  encodePage1,
  type ProtocolEnumField,
} from './ambulanzValueMap';
import {
  page1FooterGroups,
  page1GenderOptions,
  page1MeasureSections,
  page1NacaOptions,
  page1PrimaryAssessmentGroups,
  page1PulseRhythmOptions,
  page1PupillenRows,
} from './page1LayoutSpec';
import { createPage1Template, type Page1State } from './page1State';

const here = dirname(fileURLToPath(import.meta.url));
const contractDir = resolve(here, '../../../../contract/schemas');
type SchemaNode = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, SchemaNode>; items?: SchemaNode; $ref?: string };
const schema = JSON.parse(readFileSync(resolve(contractDir, 'ambulanzprotokoll-page1.schema.json'), 'utf-8')) as SchemaNode & {
  $defs?: Record<string, SchemaNode>;
};
const serverDefault = JSON.parse(readFileSync(resolve(contractDir, 'ambulanzprotokoll-page1-default.json'), 'utf-8')) as Record<string, unknown>;

function deref(node: SchemaNode): SchemaNode {
  return node.$ref ? schema.$defs![node.$ref.split('/').pop()!] : node;
}

function schemaAt(path: string): SchemaNode {
  return path.split('.').reduce<SchemaNode>((node, key) => deref(deref(node).properties![key]), schema);
}

function enumAt(path: string): string[] {
  const node = deref(schemaAt(path));
  const values = node.enum ?? deref(node.items!).enum!;
  return values.filter((v): v is string => typeof v === 'string');
}

// Every PLS option per field, read from the layout spec the UI renders.
const plsOptions: Record<ProtocolEnumField, string[]> = {
  'patient.geschlecht': page1GenderOptions.map((o) => o.value),
  'assessment_primary.naca': page1NacaOptions.map((o) => o.value),
  ...Object.fromEntries(page1PrimaryAssessmentGroups.map((g) => [g.bind, g.options.map((o) => o.value)])),
  'vitals.pupillen.R': [...page1PupillenRows],
  'vitals.pupillen.L': [...page1PupillenRows],
  'vitals.puls_rhythmus': page1PulseRhythmOptions.map((o) => o.value),
  ...Object.fromEntries(page1MeasureSections.map((s) => [s.bind, s.options.map((o) => o.value)])),
  'disposition.abschlussart': page1FooterGroups.abschlussart.map((o) => o.value),
  'disposition.klinischer_zustand': page1FooterGroups.klinischer_zustand.map((o) => o.value),
  'disposition.angehoerige_in_kenntnis': page1FooterGroups.angehoerige_in_kenntnis.map((o) => o.value),
} as Record<ProtocolEnumField, string[]>;

function leaves(node: unknown, prefix = ''): Record<string, unknown> {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    return Object.assign({}, ...Object.entries(node).map(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)));
  }
  return { [prefix]: node };
}

function kind(value: unknown) {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

describe('ambulanzValueMap', () => {
  it('covers exactly the PLS options of every enum field', () => {
    for (const field of Object.keys(PROTOCOL_VALUE_MAP) as ProtocolEnumField[]) {
      expect(Object.keys(PROTOCOL_VALUE_MAP[field]).sort(), field).toEqual([...plsOptions[field]].sort());
    }
  });

  it('maps every PLS option onto an enum value of the same field, one to one and onto', () => {
    for (const field of Object.keys(PROTOCOL_VALUE_MAP) as ProtocolEnumField[]) {
      const targets = Object.values(PROTOCOL_VALUE_MAP[field] as Record<string, string>);
      expect(new Set(targets).size, `${field} is not one to one`).toBe(targets.length);
      expect([...targets].sort(), field).toEqual(enumAt(field).sort());
    }
  });

  it('has every schema enum field in the table', () => {
    const enumFields = Object.keys(leaves(serverDefault)).filter((path) => {
      const node = deref(schemaAt(path));
      return Boolean(node.enum ?? (node.items && deref(node.items).enum));
    });
    expect(enumFields.sort()).toEqual(Object.keys(PROTOCOL_VALUE_MAP).sort());
  });

  it('keeps the 79 field paths and their default types identical to the server default', () => {
    const pls = leaves(createPage1Template());
    const amb = leaves(serverDefault);
    expect(Object.keys(pls).sort()).toEqual(Object.keys(amb).sort());
    expect(Object.keys(pls)).toHaveLength(79);
    for (const path of Object.keys(amb)) {
      expect(kind(pls[path]), path).toBe(kind(amb[path]));
    }
  });

  it('has no ambiguous rows left unreviewed', () => {
    expect(AMBIGUOUS_ROWS).toEqual([]);
  });

  it('round-trips every option losslessly', () => {
    const state = createPage1Template();
    state.patient.geschlecht = 'w';
    state.assessment_primary.atmung = [...plsOptions['assessment_primary.atmung']];
    state.assessment_primary.kreislauf = [...plsOptions['assessment_primary.kreislauf']];
    state.vitals.pupillen = { R: ['eng', 'lichtstarr'], L: ['weit'] };
    state.vitals.puls_rhythmus = ['arrhy'];
    state.measures.weitere_massnahmen.massnahmen = ['12_abl_ekg', 'extremitaet'];
    state.disposition.abschlussart = ['uebergabe'];

    const encoded = encodePage1(state);
    expect(encoded.assessment_primary.atmung).toContain('andere Atemstoerungen');
    expect(encoded.vitals.puls_rhythmus).toEqual(['arrhy.']);
    expect(encoded.measures.weitere_massnahmen.massnahmen).toEqual(['12-Abl.-EKG', 'Extremitaet']);
    expect(encoded.disposition.abschlussart).toEqual(['Uebergabe:']);
    expect(decodePage1(encoded)).toEqual(state);
    expect(state.vitals.puls_rhythmus).toEqual(['arrhy']); // input not mutated
  });

  it('refuses to encode an unknown value instead of dropping it', () => {
    const state: Page1State = createPage1Template();
    state.assessment_primary.atmung = ['apnoe', 'unbekannt'];
    expect(() => encodePage1(state)).toThrow(ProtocolCodecError);
  });

  it('keeps a server value without a PLS code verbatim through decode and encode', () => {
    const server = createPage1Template();
    server.assessment_primary.atmung = ['Apnoe'];
    const decoded = decodePage1(server);
    expect(decoded.assessment_primary.atmung).toEqual(['apnoe']);
    const odd = createPage1Template();
    odd.assessment_primary.atemweg = ['frei'];
    expect(encodePage1(decodePage1(odd)).assessment_primary.atemweg).toEqual(['frei']);
  });
});
