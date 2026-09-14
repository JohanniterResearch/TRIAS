import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, '../src/app/auth/auth.rules.ts'), 'utf8');
const body = source
  .replace(/export type .+\n/g, '')
  .replace(/export function /g, 'function ')
  .replace(/: TokenType/g, '')
  .replace(/: GuardRequirement/g, '')
  .replace(/\): (boolean|string)/g, ')');

const { tokenMatchesRequirement, homeRouteForToken } = eval(
  `(() => { ${body}; return { tokenMatchesRequirement, homeRouteForToken }; })()`,
);

assert.equal(tokenMatchesRequirement('admin', 'admin'), true);
assert.equal(tokenMatchesRequirement('leitstelle', 'admin'), false);
assert.equal(tokenMatchesRequirement('admin', 'leitstelle'), true);
assert.equal(tokenMatchesRequirement('leitstelle', 'leitstelle'), true);
assert.equal(tokenMatchesRequirement('user', 'leitstelle'), false);
assert.equal(tokenMatchesRequirement('user', 'responder-or-qr'), true);
assert.equal(tokenMatchesRequirement('qr', 'responder-or-qr'), true);
assert.equal(tokenMatchesRequirement('admin', 'responder-or-qr'), false);
assert.equal(tokenMatchesRequirement('leitstelle', 'responder-or-qr'), false);
assert.equal(tokenMatchesRequirement('admin', 'authenticated'), true);
assert.equal(tokenMatchesRequirement('leitstelle', 'authenticated'), true);
assert.equal(tokenMatchesRequirement('user', 'authenticated'), true);
assert.equal(tokenMatchesRequirement('qr', 'authenticated'), true);
assert.equal(homeRouteForToken('admin'), '/admin');
assert.equal(homeRouteForToken('leitstelle'), '/teams');
assert.equal(homeRouteForToken('user'), '/role-selection');
assert.equal(homeRouteForToken('qr'), '/role-selection');
assert.equal(homeRouteForToken('leitstelle', true), '/change-password');

console.log('auth role matrix ok');
