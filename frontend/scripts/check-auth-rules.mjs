import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '../src/app/auth/auth.rules.ts'), 'utf8');
const body = source
  .replace(/export type .+\n/g, '')
  .replace('export function tokenMatchesRequirement', 'function tokenMatchesRequirement')
  .replace(/: TokenType/g, '')
  .replace(/: GuardRequirement/g, '')
  .replace(/\): boolean/g, ')');

const tokenMatchesRequirement = eval(`${body}; tokenMatchesRequirement`);

assert.equal(tokenMatchesRequirement('admin', 'admin'), true);
assert.equal(tokenMatchesRequirement('leitstelle', 'admin'), false);
assert.equal(tokenMatchesRequirement('admin', 'leitstelle'), true);
assert.equal(tokenMatchesRequirement('leitstelle', 'leitstelle'), true);
assert.equal(tokenMatchesRequirement('user', 'leitstelle'), false);
assert.equal(tokenMatchesRequirement('user', 'responder-or-qr'), true);
assert.equal(tokenMatchesRequirement('qr', 'responder-or-qr'), true);
assert.equal(tokenMatchesRequirement('admin', 'responder-or-qr'), false);
assert.equal(tokenMatchesRequirement('leitstelle', 'responder-or-qr'), false);

console.log('auth role matrix ok');
