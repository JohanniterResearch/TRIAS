import { homeRouteForToken, tokenMatchesRequirement } from './auth.rules';

describe('homeRouteForToken', () => {
  it.each([
    ['admin', false, '/admin'],
    ['leitstelle', false, '/teams'],
    ['user', false, '/role-selection'],
    ['qr', false, '/role-selection'],
    ['leitstelle', true, '/change-password'],
  ] as const)('maps %s to its start route', (tokenType, requiresPasswordChange, expected) => {
    expect(homeRouteForToken(tokenType, requiresPasswordChange)).toBe(expected);
  });
});

describe('tokenMatchesRequirement', () => {
  it.each([
    ['admin', 'admin', true],
    ['leitstelle', 'admin', false],
    ['admin', 'leitstelle', true],
    ['leitstelle', 'leitstelle', true],
    ['user', 'leitstelle', false],
    ['user', 'responder-or-qr', true],
    ['qr', 'responder-or-qr', true],
    ['admin', 'responder-or-qr', false],
    ['leitstelle', 'responder-or-qr', false],
    ['admin', 'authenticated', true],
    ['leitstelle', 'authenticated', true],
    ['user', 'authenticated', true],
    ['qr', 'authenticated', true],
  ] as const)('%s against %s is %s', (tokenType, requirement, expected) => {
    expect(tokenMatchesRequirement(tokenType, requirement)).toBe(expected);
  });
});
