import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TRIAGE_COLORS } from '../../types/triageColor';
import { decodeTriageColor, encodeTriageColor } from './triage';

const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(resolve(here, '../../../../contract/openapi.yaml'), 'utf-8');
const inputEnum = /TriageColorInput:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/.exec(openapi)![1].split(',').map((v) => v.trim());

describe('triage codec', () => {
  it('only writes values the server accepts', () => {
    for (const color of TRIAGE_COLORS) expect(inputEnum).toContain(encodeTriageColor(color));
    expect(TRIAGE_COLORS).not.toContain('blau');
  });

  it('decodes the canonical gruen to grün and leaves the rest', () => {
    expect(decodeTriageColor('gruen')).toBe('grün');
    expect(decodeTriageColor('rot')).toBe('rot');
    expect(decodeTriageColor(' Gelb ')).toBe('gelb');
    expect(decodeTriageColor('blau')).toBe('blau');
    expect(decodeTriageColor(null)).toBeNull();
  });
});
