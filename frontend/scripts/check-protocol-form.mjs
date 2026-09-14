import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const defaultState = JSON.parse(
  readFileSync(join(root, 'contract/schemas/ambulanzprotokoll-page1-default.json'), 'utf8'),
);
const schema = JSON.parse(
  readFileSync(join(root, 'contract/schemas/ambulanzprotokoll-page1.schema.json'), 'utf8'),
);
const source = readFileSync(
  join(root, 'frontend/src/app/protokoll/pages/ambulanzprotokoll-page.ts'),
  'utf8',
);

function leafPaths(value, prefix = '') {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function enumValues(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return [
    ...(Array.isArray(value.enum) ? value.enum.filter((item) => typeof item === 'string') : []),
    ...Object.values(value).flatMap(enumValues),
  ];
}

for (const path of leafPaths(defaultState)) {
  const represented =
    source.includes(path) ||
    (path.startsWith('medications_administered.') && source.includes(path.split('.').at(-1)));
  assert.equal(represented, true, `protocol UI is missing canonical path: ${path}`);
}

for (const option of new Set(enumValues(schema))) {
  assert.equal(source.includes(option), true, `protocol UI is missing canonical option: ${option}`);
}

console.log('protocol UI covers canonical default-state paths and schema options');
