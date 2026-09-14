import { homeRouteForToken } from './auth.rules';

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
