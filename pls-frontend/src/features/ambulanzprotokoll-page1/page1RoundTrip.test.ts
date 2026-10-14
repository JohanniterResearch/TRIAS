import { describe, expect, it } from 'vitest';
import { PROTOCOL_VALUE_MAP } from './ambulanzValueMap';
import { decodePage1, encodePage1 } from './ambulanzValueMap';
import { createPage1Template, normalizePage1State } from './page1State';
import { leafPaths, protocolVariant, VARIANT_COUNT } from '../../test/protocolVariants';

const get = (node: unknown, path: string) => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], node);

describe('protocol codec round trip (WP 4.1)', () => {
  const variants = Array.from({ length: VARIANT_COUNT }, (_, index) => protocolVariant(index));

  it('covers all 79 leaves with non-default values', () => {
    const template = createPage1Template();
    const paths = leafPaths(template);
    expect(paths).toHaveLength(79);
    for (const path of paths) {
      expect(JSON.stringify(get(variants[1], path)), path).not.toBe(JSON.stringify(get(template, path)));
    }
  });

  it('uses every PLS option of every enum field', () => {
    for (const [field, map] of Object.entries(PROTOCOL_VALUE_MAP)) {
      const used = new Set(variants.flatMap((variant) => [get(variant, field)].flat()));
      expect([...Object.keys(map)].filter((option) => !used.has(option)), field).toEqual([]);
    }
  });

  it('decode(encode(state)) is lossless for every variant', () => {
    for (const variant of variants) {
      expect(normalizePage1State(decodePage1(encodePage1(variant)))).toEqual(variant);
    }
  });
});
