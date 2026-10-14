export interface Page1Option {
  value: string;
  label: string;
}

export interface Page1ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const page1ZoneRects = {
  brand_header: { x: 0, y: 0, w: 23, h: 6 },
  incident_header: { x: 23, y: 0, w: 77, h: 6 },
  patient_block: { x: 0, y: 6, w: 100, h: 10 },
  erstdiagnose_allgemein: { x: 0, y: 16, w: 100, h: 9 },
  anamnese_bodymap: { x: 0, y: 25, w: 100, h: 27 },
  akutmedikation: { x: 0, y: 52, w: 100, h: 8 },
  erst_endbefund: { x: 0, y: 60, w: 100, h: 17 },
  massnahmen_ample: { x: 0, y: 77, w: 100, h: 17 },
  footer_disposition: { x: 0, y: 94, w: 100, h: 6 },
} satisfies Record<string, Page1ZoneRect>;

export const page1StateTemplate = {
  incident: {
    ambulanzort: '',
    datum: null,
    uhrzeit_beginn: null,
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
    geschlecht: null,
    vers_nr: '',
    geburtsdatum: null,
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
    angen_notfallzeit: {
      zeit: null,
      gt24h: false,
      unbekannt: false,
    },
  },
  assessment_secondary: {
    anamnese_text: '',
    bodymap: [] as Array<{ view: 'front' | 'back'; marker: string; x: number; y: number }>,
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
    atmung: {
      massnahmen: [] as string[],
      dnr: '',
      af: '',
      amv: '',
      peep: '',
    },
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
  signatures: {
    entlass_san_na: null as string | null,
  },
};

export const page1GenderOptions = [
  { value: 'd', label: 'D' },
  { value: 'm', label: 'M' },
  { value: 'w', label: 'W' },
] satisfies Page1Option[];

export const page1NacaOptions = [
  { value: 'I', label: 'I geringfügige Störung' },
  { value: 'II', label: 'II ambulante Abklärung' },
  { value: 'III', label: 'III stationäre Behandlung' },
  { value: 'IV', label: 'IV akute Lebensgefahr möglich' },
  { value: 'V', label: 'V akute Lebensgefahr' },
  { value: 'VI', label: 'VI Reanimation' },
  { value: 'VII', label: 'VII Tod' },
] satisfies Page1Option[];

export const page1BodyMapLegend = [
  { value: 'wunde', label: 'Wunde' },
  { value: 'fraktur', label: '/ Fraktur' },
  { value: 'schmerz', label: 'Schmerz' },
  { value: 'prellung', label: 'Prellung' },
  { value: 'amputation', label: 'Amputation' },
  { value: 'verbrennung', label: 'Verbrennung' },
  { value: 'luxation', label: 'Luxation' },
] satisfies Page1Option[];

export const page1PrimaryAssessmentGroups = [
  {
    label: 'Atemweg',
    bind: 'assessment_primary.atemweg',
    options: [
      { value: 'frei', label: 'frei' },
      { value: 'gefaehrdet', label: 'gefährdet' },
      { value: 'verlegt', label: 'verlegt' },
    ],
  },
  {
    label: 'Atmung',
    bind: 'assessment_primary.atmung',
    options: [
      { value: 'apnoe', label: 'Apnoe' },
      { value: 'schnappatmung', label: 'Schnappatmung' },
      { value: 'zyanose', label: 'Zyanose' },
      { value: 'unauffaellig', label: 'unauffällig' },
      { value: 'dyspnoe', label: 'Dyspnoe' },
      { value: 'atemgeraeusche', label: 'Atemgeräusche' },
      { value: 'andere_atemstoerungen', label: 'andere Atemstörungen' },
    ],
  },
  {
    label: 'Kreislauf',
    bind: 'assessment_primary.kreislauf',
    options: [
      { value: 'puls_peripher_tastbar', label: 'Puls peripher tastbar' },
      { value: 'tachykardie', label: 'Tachykardie' },
      { value: 'bradykardie', label: 'Bradykardie' },
      { value: 'blass', label: 'blass' },
      { value: 'kalt', label: 'kalt' },
      { value: 'unauffaellig', label: 'unauffällig' },
      { value: 'starke_blutung', label: 'Starke Blutung' },
      { value: 'geroetet', label: 'gerötet' },
      { value: 'schweissig', label: 'schweißig' },
      { value: 'erwaermt', label: 'erwärmt' },
    ],
  },
  {
    label: 'Bewusstsein',
    bind: 'assessment_primary.bewusstsein',
    options: [
      { value: 'wach', label: 'Wach' },
      { value: 'getruebt', label: 'Getrübt' },
      { value: 'bewusstlos', label: 'Bewusstlos' },
      { value: 'agitiert', label: 'Agitiert' },
    ],
  },
] as const;

export const page1PupillenRows = [
  'eng',
  'mittel',
  'weit',
  'entrundet',
  'prompte Lichtreflexe',
  'verlangsamte Lichtreflexe',
  'lichtstarr',
] as const;

export const page1PulseRhythmOptions = [
  { value: 'rhy', label: 'rhy.' },
  { value: 'arrhy', label: 'arrhy.' },
] satisfies Page1Option[];

export const page1GcsSections = [
  {
    label: 'Augen öffnen',
    bind: 'vitals.gcs_augenoeffnen',
    options: [
      { value: '4', label: '4 spontan' },
      { value: '3', label: '3 auf Aufforderung' },
      { value: '2', label: '2 auf Schmerzreiz' },
      { value: '1', label: '1 nicht' },
    ],
  },
  {
    label: 'verbale Reaktion',
    bind: 'vitals.gcs_verbale_reaktion',
    options: [
      { value: '5', label: '5 orientiert' },
      { value: '4', label: '4 desorientiert' },
      { value: '3', label: '3 inadäquate Äußerung' },
      { value: '2', label: '2 unverständliche Laute' },
      { value: '1', label: '1 keine' },
    ],
  },
  {
    label: 'motorische Reaktion',
    bind: 'vitals.gcs_motorische_reaktion',
    options: [
      { value: '6', label: '6 auf Aufforderung' },
      { value: '5', label: '5 gezielt auf Schmerzreiz' },
      { value: '4', label: '4 ungezielt auf Schmerzreiz' },
      { value: '3', label: '3 abnorme Beugeabwehr' },
      { value: '2', label: '2 Streckneigung' },
      { value: '1', label: '1 keine' },
    ],
  },
] as const;

export const page1MedicationColumns = [
  { key: 'medikament', label: 'Medikament' },
  { key: 'dosis', label: 'Dosis' },
  { key: 'art', label: 'Art' },
  { key: 'uhrzeit', label: 'Uhrzeit' },
] as const;

export const page1MeasureSections = [
  {
    key: 'herz_kreislauf',
    label: 'Herz / Kreislauf',
    bind: 'measures.herz_kreislauf.massnahmen',
    options: [
      { value: 'peripherven_zugang_io', label: 'peripherven. Zugang / IO Zugang' },
      { value: 'herzdruckmassage', label: 'Herzdruckmassage' },
      { value: 'defibrillation_kardiov', label: 'Defibrillation/Kardiov.' },
      { value: 'schrittmacher_extern', label: 'Schrittmacher extern' },
    ],
  },
  {
    key: 'atmung',
    label: 'Atmung',
    bind: 'measures.atmung.massnahmen',
    options: [
      { value: 'absaugen', label: 'Absaugen' },
      { value: 'oral', label: 'oral' },
      { value: 'nasal', label: 'nasal' },
      { value: 'endotracheal', label: 'endotracheal' },
      { value: 'intubation', label: 'Intubation' },
      { value: 'wendltubus', label: 'Wendltubus' },
      { value: 'guedeltubus', label: 'Guedeltubus' },
      { value: 'larynxtubus', label: 'Larynxtubus' },
      { value: 'endotracheal_oral', label: 'endotracheal (oral)' },
      { value: 'endotracheal_nasal', label: 'endotracheal (nasal)' },
      { value: 'beatmung', label: 'Beatmung' },
      { value: 'assistiert', label: 'assistiert' },
      { value: 'kontrolliert', label: 'kontrolliert' },
      { value: 'manuell', label: 'manuell' },
      { value: 'maschinell', label: 'maschinell' },
    ],
  },
  {
    key: 'weitere_massnahmen',
    label: 'Weitere Maßnahmen',
    bind: 'measures.weitere_massnahmen.massnahmen',
    options: [
      { value: 'verband', label: 'Verband' },
      { value: 'blutstillung', label: 'Blutstillung' },
      { value: 'abbinden', label: 'Abbinden' },
      { value: 'lagerung', label: 'Lagerung' },
      { value: '12_abl_ekg', label: '12-Abl.-EKG' },
      { value: 'monitoring', label: 'Monitoring' },
      { value: 'hf', label: 'HF' },
      { value: 'rr', label: 'RR' },
      { value: 'spo2', label: 'SpO2' },
      { value: '4_abl_ekg', label: '4-Abl.-EKG' },
      { value: 'etco2', label: 'etCO2' },
      { value: 'schienung', label: 'Schienung' },
      { value: 'hws', label: 'HWS' },
      { value: 'spineboard', label: 'Spineboard' },
      { value: 'vakuummatratze', label: 'Vakuummatratze' },
      { value: 'extremitaet', label: 'Extremität' },
    ],
  },
] as const;

export const page1HistorySections = [
  { label: 'Allergien', bind: 'history.allergien' },
  { label: 'Medikamente', bind: 'history.medikamente' },
  {
    label: 'Patientengeschichte / Vorerkrankungen',
    bind: 'history.patientengeschichte_vorerkrankungen',
  },
  { label: 'Letzte orale Aufnahme', bind: 'history.letzte_orale_aufnahme' },
  { label: 'Ereignisse zuvor', bind: 'history.ereignisse_zuvor' },
  { label: 'Risikofaktoren', bind: 'history.risikofaktoren' },
] as const;

export const page1FooterGroups = {
  abschlussart: [
    { value: 'uebergabe', label: 'Übergabe:' },
    { value: 'revers', label: 'Revers (Rücks.)' },
    { value: 'belassung', label: 'Belassung' },
    { value: 'entf_selbstst_o_revers', label: 'Entf. selbstst. o. Revers' },
  ],
  klinischer_zustand: [
    { value: 'verbessert', label: 'verbessert' },
    { value: 'gleich', label: 'gleich' },
    { value: 'verschlechtert', label: 'verschlechtert' },
  ],
  angehoerige_in_kenntnis: [
    { value: 'durch_rd', label: 'durch RD' },
    { value: 'durch_polizei', label: 'durch Polizei' },
    { value: 'durch_pat_andere', label: 'durch Pat/andere' },
  ],
} as const;
