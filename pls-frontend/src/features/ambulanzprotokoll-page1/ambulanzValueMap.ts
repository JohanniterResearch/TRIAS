// PLS option code <-> Ambulanzsystem schema value for every enum field of the page-1 protocol
// (parity plan WP 0.4 / D5). This is the single place where the mapping lives (AGENTS.md:
// "Isolate the mapping in one schema file for later correction").
//
// Source of the right-hand side: contract/schemas/ambulanzprotokoll-page1.schema.json.
// Generated on 9 Oct 2026 by matching each PLS option against the schema enum of the same field
// path, then reviewed by hand. Rule observed for every row: the Ambulanzsystem value is either
// the PLS code itself or the PLS visible label with umlauts transliterated (ä→ae, ö→oe, ü→ue,
// ß→ss). Every row matched exactly, so AMBIGUOUS_ROWS is empty; a row that ever stops matching
// must be listed there for domain review instead of being guessed.
//
// Field paths and value types are identical in both schemas (79 leaves); only option values
// differ. ambulanzValueMap.test.ts enforces completeness in both directions.

import type { Page1State } from './page1State';

export const PROTOCOL_VALUE_MAP = {
  'patient.geschlecht': { d: 'd', m: 'm', w: 'w' },
  'assessment_primary.naca': { I: 'I', II: 'II', III: 'III', IV: 'IV', V: 'V', VI: 'VI', VII: 'VII' },
  'assessment_primary.atemweg': { frei: 'frei', gefaehrdet: 'gefaehrdet', verlegt: 'verlegt' },
  'assessment_primary.atmung': {
    apnoe: 'Apnoe',
    schnappatmung: 'Schnappatmung',
    zyanose: 'Zyanose',
    unauffaellig: 'unauffaellig',
    dyspnoe: 'Dyspnoe',
    atemgeraeusche: 'Atemgeraeusche',
    andere_atemstoerungen: 'andere Atemstoerungen',
  },
  'assessment_primary.kreislauf': {
    puls_peripher_tastbar: 'Puls peripher tastbar',
    tachykardie: 'Tachykardie',
    bradykardie: 'Bradykardie',
    blass: 'blass',
    kalt: 'kalt',
    unauffaellig: 'unauffaellig',
    starke_blutung: 'Starke Blutung',
    geroetet: 'geroetet',
    schweissig: 'schweissig',
    erwaermt: 'erwaermt',
  },
  'assessment_primary.bewusstsein': { wach: 'Wach', getruebt: 'Getruebt', bewusstlos: 'Bewusstlos', agitiert: 'Agitiert' },
  'vitals.pupillen.R': PUPILLEN(),
  'vitals.pupillen.L': PUPILLEN(),
  'vitals.puls_rhythmus': { rhy: 'rhy.', arrhy: 'arrhy.' },
  'measures.herz_kreislauf.massnahmen': {
    peripherven_zugang_io: 'peripherven. Zugang / IO Zugang',
    herzdruckmassage: 'Herzdruckmassage',
    defibrillation_kardiov: 'Defibrillation/Kardiov.',
    schrittmacher_extern: 'Schrittmacher extern',
  },
  'measures.atmung.massnahmen': {
    absaugen: 'Absaugen',
    oral: 'oral',
    nasal: 'nasal',
    endotracheal: 'endotracheal',
    intubation: 'Intubation',
    wendltubus: 'Wendltubus',
    guedeltubus: 'Guedeltubus',
    larynxtubus: 'Larynxtubus',
    endotracheal_oral: 'endotracheal (oral)',
    endotracheal_nasal: 'endotracheal (nasal)',
    beatmung: 'Beatmung',
    assistiert: 'assistiert',
    kontrolliert: 'kontrolliert',
    manuell: 'manuell',
    maschinell: 'maschinell',
  },
  'measures.weitere_massnahmen.massnahmen': {
    verband: 'Verband',
    blutstillung: 'Blutstillung',
    abbinden: 'Abbinden',
    lagerung: 'Lagerung',
    '12_abl_ekg': '12-Abl.-EKG',
    monitoring: 'Monitoring',
    hf: 'HF',
    rr: 'RR',
    spo2: 'SpO2',
    '4_abl_ekg': '4-Abl.-EKG',
    etco2: 'etCO2',
    schienung: 'Schienung',
    hws: 'HWS',
    spineboard: 'Spineboard',
    vakuummatratze: 'Vakuummatratze',
    extremitaet: 'Extremitaet',
  },
  'disposition.abschlussart': {
    uebergabe: 'Uebergabe:',
    revers: 'Revers (Ruecks.)',
    belassung: 'Belassung',
    entf_selbstst_o_revers: 'Entf. selbstst. o. Revers',
  },
  'disposition.klinischer_zustand': { verbessert: 'verbessert', gleich: 'gleich', verschlechtert: 'verschlechtert' },
  'disposition.angehoerige_in_kenntnis': {
    durch_rd: 'durch RD',
    durch_polizei: 'durch Polizei',
    durch_pat_andere: 'durch Pat/andere',
  },
} as const satisfies Record<string, Record<string, string>>;

// PLS stores the pupil rows by their visible text, which is already the schema value.
function PUPILLEN() {
  return {
    eng: 'eng',
    mittel: 'mittel',
    weit: 'weit',
    entrundet: 'entrundet',
    'prompte Lichtreflexe': 'prompte Lichtreflexe',
    'verlangsamte Lichtreflexe': 'verlangsamte Lichtreflexe',
    lichtstarr: 'lichtstarr',
  } as const;
}

export type ProtocolEnumField = keyof typeof PROTOCOL_VALUE_MAP;

// Rows awaiting domain-owner confirmation (`ambiguous: true` in the plan). Empty on 9 Oct 2026.
export const AMBIGUOUS_ROWS: ReadonlyArray<{ field: ProtocolEnumField; pls: string; ambulanz: string; note: string }> = [];

export class ProtocolCodecError extends Error {
  readonly unknownValues: ReadonlyArray<{ field: string; value: string }>;

  constructor(unknownValues: ReadonlyArray<{ field: string; value: string }>) {
    super(
      `Protokollwerte ohne Zuordnung: ${unknownValues.map((u) => `${u.field}=${JSON.stringify(u.value)}`).join(', ')}`,
    );
    this.name = 'ProtocolCodecError';
    this.unknownValues = unknownValues;
  }
}

const FIELDS = Object.keys(PROTOCOL_VALUE_MAP) as ProtocolEnumField[];

const REVERSE: Record<ProtocolEnumField, Record<string, string>> = Object.fromEntries(
  FIELDS.map((field) => [
    field,
    Object.fromEntries(Object.entries(PROTOCOL_VALUE_MAP[field]).map(([pls, amb]) => [amb, pls])),
  ]),
) as Record<ProtocolEnumField, Record<string, string>>;

function getAt(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), root);
}

function setAt(root: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let node = root;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== 'object') return; // branch absent: nothing to translate
    node = next as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
}

function translate(
  state: Record<string, unknown>,
  table: (field: ProtocolEnumField) => Record<string, string>,
  passthrough: (field: ProtocolEnumField) => Record<string, string>,
  unknown: Array<{ field: string; value: string }> | null,
) {
  const out = structuredClone(state);
  for (const field of FIELDS) {
    const current = getAt(out, field);
    if (current === undefined || current === null) continue;
    const map = table(field);
    const known = passthrough(field);
    const convert = (value: unknown) => {
      if (typeof value !== 'string') return value;
      if (value in map) return map[value];
      if (value in known) return value; // already in the target vocabulary
      if (unknown) unknown.push({ field, value });
      return value;
    };
    setAt(out, field, Array.isArray(current) ? current.map(convert) : convert(current));
  }
  return out;
}

/** PLS form state -> Ambulanzsystem formState. Throws ProtocolCodecError rather than dropping data. */
export function encodePage1(state: Page1State): Page1State {
  const unknown: Array<{ field: string; value: string }> = [];
  const out = translate(
    state as unknown as Record<string, unknown>,
    (f) => PROTOCOL_VALUE_MAP[f],
    (f) => REVERSE[f],
    unknown,
  );
  if (unknown.length > 0) throw new ProtocolCodecError(unknown);
  return out as unknown as Page1State;
}

/**
 * Ambulanzsystem formState -> PLS form state. A server value without a PLS code is kept verbatim,
 * so a later encode sends it back unchanged instead of losing it.
 */
export function decodePage1(state: Page1State): Page1State {
  return translate(
    state as unknown as Record<string, unknown>,
    (f) => REVERSE[f],
    (f) => PROTOCOL_VALUE_MAP[f],
    null,
  ) as unknown as Page1State;
}
