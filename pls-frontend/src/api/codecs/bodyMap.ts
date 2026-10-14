// PLS body-map drawing region <-> Ambulanzsystem canonical region (parity plan WP 0.4, D4, D10,
// Section 5.2). The PLS drawing is unchanged; every PLS region maps to its nearest Ambulanzsystem
// region (contract/body-regions.json). Rows that merge several PLS regions are lossy: setting the
// shared Ambulanzsystem key marks every PLS region of the group, and clearing any of them clears
// the whole group. The table awaits clinical sign-off of the laterality loss (plan Section 5.2).

export const PLS_FRONT_KEYS = [
  'kopf_vorne', 'hals_vorne', 'brust_links', 'brust_rechts', 'leiste_links_vorne', 'leiste_rechts_vorne',
  'schulter_links_vorne', 'schulter_rechts_vorne', 'huefte_links_vorne', 'huefte_rechts_vorne',
  'oberschenkel_rechts_vorne', 'unterschenkel_links_vorne', 'oberschenkel_links_vorne', 'unterschenkel_rechts_vorne',
  'knie_links_vorne', 'knie_rechts_vorne', 'oberarm_links_vorne', 'oberarm_rechts_vorne',
  'ellbogen_rechts_vorne', 'ellbogen_links_vorne', 'fuss_rechts_vorne', 'fuss_links_vorne',
  'auge_rechts', 'auge_links', 'mund', 'unterarm_links_vorne', 'unterarm_rechts_vorne',
  'hand_links_vorne', 'hand_rechts_vorne', 'genital_vorne',
] as const;

export const PLS_BACK_KEYS = [
  'kopf_hinten', 'hals_hinten', 'ruecken_links', 'ruecken_rechts', 'becken_links_hinten', 'becken_rechts_hinten',
  'genital_hinten', 'oberschenkel_links_hinten', 'oberschenkel_rechts_hinten', 'unterschenkel_links_hinten',
  'unterschenkel_rechts_hinten', 'oberarm_links_hinten', 'oberarm_rechts_hinten', 'unterarm_links_hinten',
  'unterarm_rechts_hinten', 'schulter_links_hinten', 'schulter_rechts_hinten', 'huefte_links_hinten',
  'huefte_rechts_hinten', 'knie_links_hinten', 'knie_rechts_hinten', 'ellbogen_links_hinten',
  'ellbogen_rechts_hinten', 'fuss_links_hinten', 'fuss_rechts_hinten', 'hand_links_hinten', 'hand_rechts_hinten',
  'brustwirbel', 'lendenwirbel',
] as const;

export type PlsBodyKey = (typeof PLS_FRONT_KEYS)[number] | (typeof PLS_BACK_KEYS)[number];

// The 26 PLS-only keys (Section 5.2). Every other PLS key is also an Ambulanzsystem key (1:1).
const RENAMED: Partial<Record<PlsBodyKey, string>> = {
  auge_links: 'auge_links_vorne',
  auge_rechts: 'auge_rechts_vorne',
  brust_links: 'brust_links_vorne',
  brust_rechts: 'brust_rechts_vorne',
  ellbogen_links_vorne: 'ellenbogen_links_vorne',
  ellbogen_rechts_vorne: 'ellenbogen_rechts_vorne',
  ellbogen_links_hinten: 'ellenbogen_links_hinten',
  ellbogen_rechts_hinten: 'ellenbogen_rechts_hinten',
  genital_vorne: 'genitalbereich_vorne',
  knie_links_hinten: 'kniekehle_links_hinten',
  knie_rechts_hinten: 'kniekehle_rechts_hinten',
  hals_hinten: 'nacken_hinten',
  mund: 'gesicht_vorne', // lossy
  huefte_links_vorne: 'becken_vorne', // lossy, 2 -> 1
  huefte_rechts_vorne: 'becken_vorne',
  leiste_links_vorne: 'bauch_vorne', // lossy, 2 -> 1 (D10: the rectangles cover the abdomen)
  leiste_rechts_vorne: 'bauch_vorne',
  huefte_links_hinten: 'gesaess_hinten', // lossy, 5 -> 1
  huefte_rechts_hinten: 'gesaess_hinten',
  becken_links_hinten: 'gesaess_hinten',
  becken_rechts_hinten: 'gesaess_hinten',
  genital_hinten: 'gesaess_hinten',
  brustwirbel: 'ruecken_oben_hinten', // lossy
  ruecken_links: 'ruecken_mitte_hinten', // lossy, 2 -> 1
  ruecken_rechts: 'ruecken_mitte_hinten',
  lendenwirbel: 'ruecken_unten_hinten', // lossy
};

export const PLS_BODY_KEYS: readonly PlsBodyKey[] = [...PLS_FRONT_KEYS, ...PLS_BACK_KEYS];

export function toAmbulanzRegion(plsKey: PlsBodyKey): string {
  return RENAMED[plsKey] ?? plsKey;
}

/** Every PLS region drawn for one Ambulanzsystem region (empty for e.g. ferse_*). */
export function plsKeysFor(ambulanzKey: string): PlsBodyKey[] {
  return PLS_BODY_KEYS.filter((key) => toAmbulanzRegion(key) === ambulanzKey);
}

/** True when tapping this PLS region also marks or clears other PLS regions. */
export function isSharedRegion(plsKey: PlsBodyKey): boolean {
  return plsKeysFor(toAmbulanzRegion(plsKey)).length > 1;
}

/** Server state (Ambulanzsystem keys, 0 = unmarked) -> marked state of every PLS region. */
export function decodeBodyParts(server: Record<string, number>): Record<PlsBodyKey, boolean> {
  return Object.fromEntries(PLS_BODY_KEYS.map((key) => [key, (server[toAmbulanzRegion(key)] ?? 0) !== 0])) as Record<
    PlsBodyKey,
    boolean
  >;
}

/** Marked Ambulanzsystem regions that the PLS drawing cannot show (listed as text instead). */
export function markedWithoutPlsRegion(server: Record<string, number>): string[] {
  return Object.entries(server)
    .filter(([key, value]) => value !== 0 && plsKeysFor(key).length === 0)
    .map(([key]) => key);
}
