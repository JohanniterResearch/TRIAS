import type { components } from '../api/openapi-types';

export type TriageColor = components['schemas']['TriageColor'];

export const TRIAGE_COLORS: ReadonlyArray<{ value: TriageColor; label: string; hex: string }> = [
  { value: 'rot', label: 'Rot', hex: '#b3261e' },
  { value: 'gelb', label: 'Gelb', hex: '#b77900' },
  { value: 'gruen', label: 'Grün', hex: '#188038' },
  { value: 'schwarz', label: 'Schwarz', hex: '#1f2933' },
];
