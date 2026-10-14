import { PROTOCOL_VALUE_MAP, type ProtocolEnumField } from '../features/ambulanzprotokoll-page1/ambulanzValueMap';
import { createPage1Template, normalizePage1State, type Page1State } from '../features/ambulanzprotokoll-page1/page1State';

// Fully populated PLS protocol states for the codec round trip (parity plan WP 4.1). Together the
// variants use every PLS option of every enum field (variant 0 selects all options of each
// multi-select at once) and give every one of the 79 leaves a non-default value.

const MARKERS = ['wunde', 'fraktur', 'schmerz', 'prellung', 'amputation', 'verbrennung', 'luxation'] as const;
// Schema maxItems 1: one ticked box at most, also in variant 0.
const SINGLE_CHOICE = new Set(['assessment_primary.naca', 'disposition.klinischer_zustand']);
const DATE_FIELDS = new Set(['incident.datum', 'patient.geburtsdatum']);
const TIME_FIELDS = new Set(['incident.uhrzeit_beginn', 'assessment_primary.angen_notfallzeit.zeit', 'measures.weitere_massnahmen.abbinden_zeit', 'disposition.uhrzeit_ende']);
// 1x1 transparent PNG, the shape the signature canvas stores.
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const enumOptions = (field: string): string[] | undefined =>
  field in PROTOCOL_VALUE_MAP ? Object.keys(PROTOCOL_VALUE_MAP[field as ProtocolEnumField]) : undefined;

export const VARIANT_COUNT = Math.max(...Object.values(PROTOCOL_VALUE_MAP).map((map) => Object.keys(map).length)) + 1;

function leafValue(path: string, template: unknown, variant: number): unknown {
  const options = enumOptions(path);
  if (options) {
    if (Array.isArray(template)) {
      if (SINGLE_CHOICE.has(path)) return [options[variant % options.length]];
      return variant === 0 ? [...options] : [options[(variant - 1) % options.length]];
    }
    return options[variant % options.length];
  }
  switch (path) {
    case 'vitals.schmerz':
      return variant % 11;
    case 'vitals.gcs_augenoeffnen':
      return 1 + (variant % 4);
    case 'vitals.gcs_verbale_reaktion':
      return 1 + (variant % 5);
    case 'vitals.gcs_motorische_reaktion':
      return 1 + (variant % 6);
    case 'vitals.gcs_summe':
      return 3 + (variant % 4) + (variant % 5) + (variant % 6); // what the server computes
    case 'signatures.entlass_san_na':
      return SIGNATURE;
    case 'assessment_secondary.bodymap':
      return [
        { view: variant % 2 ? 'back' : 'front', marker: MARKERS[variant % MARKERS.length], x: 12.5, y: 40 },
        { view: 'front', marker: MARKERS[(variant + 3) % MARKERS.length], x: 99.75, y: 0 },
      ];
    case 'medications_administered':
      return [{ medikament: `Paracetamol ${variant}`, dosis: '1 g', art: 'i.v.', uhrzeit: '09:30' }];
  }
  if (DATE_FIELDS.has(path)) return `2026-10-${String(1 + (variant % 28)).padStart(2, '0')}`;
  if (TIME_FIELDS.has(path)) return `${String(variant % 24).padStart(2, '0')}:${String((variant * 7) % 60).padStart(2, '0')}`;
  if (typeof template === 'boolean') return variant % 2 === 1;
  if (typeof template === 'string' || template === null) return `${path} #${variant} – Ä ö ü ß "quote"`;
  throw new Error(`No round-trip value for ${path}`);
}

function fill(node: unknown, path: string, variant: number): unknown {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, fill(value, path ? `${path}.${key}` : key, variant)]));
  }
  return leafValue(path, node, variant);
}

export function protocolVariant(variant: number): Page1State {
  return normalizePage1State(fill(createPage1Template(), '', variant) as Page1State);
}

/** Leaf paths of a state; arrays count as one leaf. */
export function leafPaths(node: unknown, path = ''): string[] {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    return Object.entries(node).flatMap(([key, value]) => leafPaths(value, path ? `${path}.${key}` : key));
  }
  return [path];
}
