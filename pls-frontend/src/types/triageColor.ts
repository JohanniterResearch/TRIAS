// `blau` is not part of the vocabulary: the Ambulanzsystem backend rejects it (FR-TRIAGE-06) and
// the START wizard never produces it. A stored value outside this list is shown flagged.
export const TRIAGE_COLOR = {
  ROT: 'rot',
  GELB: 'gelb',
  GRUEN: 'grün',
  SCHWARZ: 'schwarz',
} as const;

export const TRIAGE_COLORS = Object.values(TRIAGE_COLOR);

export type TriageColor = typeof TRIAGE_COLORS[number];

export const TRIAGE_COLOR_BACKGROUND: Record<TriageColor, string> = {
  rot: 'red',
  gelb: 'yellow',
  grün: 'green',
  schwarz: 'black',
};

export function isTriageColor(value: string | null | undefined): value is TriageColor {
  return value != null && (TRIAGE_COLORS as readonly string[]).includes(value);
}
