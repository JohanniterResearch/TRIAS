// Triage vocabulary between PLS and the Ambulanzsystem API (parity plan WP 0.4, Section 5.1).
// Writes send the PLS value unchanged: the server accepts `grün` as an input alias and stores the
// canonical `gruen`. Reads map `gruen` back to `grün` for display and colour; any other unknown
// value is returned unchanged so the UI can flag it.

import type { TriageColor } from '../../types/triageColor';

export function encodeTriageColor(color: TriageColor): TriageColor {
  return color;
}

export function decodeTriageColor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'gruen' ? 'grün' : normalized;
}
