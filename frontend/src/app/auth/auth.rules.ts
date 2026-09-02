export type TokenType = 'admin' | 'leitstelle' | 'user' | 'qr';
export type GuardRequirement = 'admin' | 'leitstelle' | 'responder-or-qr' | 'authenticated';

export function homeRouteForToken(tokenType: TokenType, requiresPasswordChange = false): string {
  if (requiresPasswordChange) {
    return '/change-password';
  }
  if (tokenType === 'admin') {
    return '/admin';
  }
  return tokenType === 'leitstelle' ? '/teams' : '/role-selection';
}

export function tokenMatchesRequirement(
  tokenType: TokenType,
  requirement: GuardRequirement,
): boolean {
  if (requirement === 'authenticated') {
    return true;
  }

  if (requirement === 'admin') {
    return tokenType === 'admin';
  }

  if (requirement === 'leitstelle') {
    return tokenType === 'admin' || tokenType === 'leitstelle';
  }

  return tokenType === 'user' || tokenType === 'qr';
}
