import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PLS_BACK_KEYS,
  PLS_BODY_KEYS,
  PLS_FRONT_KEYS,
  decodeBodyParts,
  isSharedRegion,
  markedWithoutPlsRegion,
  plsKeysFor,
  toAmbulanzRegion,
} from './bodyMap';

const here = dirname(fileURLToPath(import.meta.url));
const regions = JSON.parse(readFileSync(resolve(here, '../../../../contract/body-regions.json'), 'utf-8')) as {
  front: string[];
  back: string[];
};
const ambulanzKeys = [...regions.front, ...regions.back];

function drawnKeys(file: string) {
  const source = readFileSync(resolve(here, '../../components', file), 'utf-8');
  return [...source.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('body-map codec', () => {
  it('lists exactly the regions the PLS drawings render', () => {
    expect([...PLS_FRONT_KEYS].sort()).toEqual(drawnKeys('BodyPartsFront.tsx'));
    expect([...PLS_BACK_KEYS].sort()).toEqual(drawnKeys('BodyPartsBack.tsx'));
    expect(PLS_BODY_KEYS).toHaveLength(59);
  });

  it('maps every PLS region onto a canonical Ambulanzsystem region of the same side', () => {
    for (const key of PLS_FRONT_KEYS) expect(regions.front, key).toContain(toAmbulanzRegion(key));
    for (const key of PLS_BACK_KEYS) expect(regions.back, key).toContain(toAmbulanzRegion(key));
  });

  it('keeps 33 shared keys 1:1 and translates the 26 PLS-only keys', () => {
    const shared = PLS_BODY_KEYS.filter((key) => ambulanzKeys.includes(key));
    expect(shared).toHaveLength(33);
    for (const key of shared) expect(toAmbulanzRegion(key)).toBe(key);
    expect(PLS_BODY_KEYS.filter((key) => !ambulanzKeys.includes(key))).toHaveLength(26);
  });

  it('leaves only ferse_* without a PLS region', () => {
    expect(ambulanzKeys.filter((key) => plsKeysFor(key).length === 0).sort()).toEqual([
      'ferse_links_hinten',
      'ferse_rechts_hinten',
    ]);
  });

  it('maps leiste to bauch_vorne and huefte to becken_vorne (D10)', () => {
    expect(plsKeysFor('bauch_vorne').sort()).toEqual(['leiste_links_vorne', 'leiste_rechts_vorne']);
    expect(plsKeysFor('becken_vorne').sort()).toEqual(['huefte_links_vorne', 'huefte_rechts_vorne']);
    expect(plsKeysFor('gesaess_hinten')).toHaveLength(5);
    expect(isSharedRegion('ruecken_links')).toBe(true);
    expect(isSharedRegion('kopf_vorne')).toBe(false);
  });

  it('highlights every PLS region of a marked group and lists undrawable regions as text', () => {
    const server = Object.fromEntries(ambulanzKeys.map((key) => [key, 0]));
    server.bauch_vorne = 1;
    server.ferse_links_hinten = 1;
    const decoded = decodeBodyParts(server);
    expect(decoded.leiste_links_vorne).toBe(true);
    expect(decoded.leiste_rechts_vorne).toBe(true);
    expect(decoded.huefte_links_vorne).toBe(false);
    expect(Object.values(decoded).filter(Boolean)).toHaveLength(2);
    expect(markedWithoutPlsRegion(server)).toEqual(['ferse_links_hinten']);
  });
});
