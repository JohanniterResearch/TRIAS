import { computed, Injectable, signal } from '@angular/core';

import { GuardRequirement, TokenType, tokenMatchesRequirement } from './auth.rules';

export type { GuardRequirement, TokenType };

export interface Session {
  token: string;
  refreshToken?: string;
  tokenType: TokenType;
  eventSceneId?: number;
  username?: string;
  requiresPasswordChange?: boolean;
  expired?: boolean;
  savedAt: string;
}

interface AuthState {
  admin: Session | null;
  responder: Session | null;
}

const storageKey = 'ambulanzsystem.auth.v1';
const emptyState: AuthState = { admin: null, responder: null };

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly state = signal<AuthState>(this.load());

  readonly adminSession = computed(() => this.state().admin);
  readonly responderSession = computed(() => this.state().responder);
  readonly activeSession = computed(() => this.state().responder ?? this.state().admin);
  readonly bearerToken = computed(() => this.activeSession()?.expired ? null : this.activeSession()?.token ?? null);
  readonly requiresPasswordChange = computed(() => this.activeSession()?.requiresPasswordChange === true);

  tokenExpiresAt(): number | null {
    const token = this.bearerToken();
    if (!token) {
      return null;
    }

    try {
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  setAdminSession(session: Omit<Session, 'savedAt'>): void {
    this.save({ admin: this.withSavedAt(session), responder: null });
  }

  setResponderSession(session: Omit<Session, 'savedAt'>): void {
    this.save({ admin: null, responder: this.withSavedAt(session) });
  }

  clear(): void {
    this.save(emptyState);
  }

  markExpired(): void {
    const active = this.activeSession();
    if (!active) {
      return;
    }
    const expired = { ...active, expired: true };
    this.save(active.tokenType === 'admin' || active.tokenType === 'leitstelle'
      ? { admin: expired, responder: null }
      : { admin: null, responder: expired });
  }

  refreshTokens(token: string, refreshToken: string): void {
    const active = this.activeSession();
    if (!active) {
      return;
    }

    const refreshed = this.withSavedAt({ ...active, token, refreshToken });
    this.save(active.tokenType === 'admin' || active.tokenType === 'leitstelle'
      ? { admin: refreshed, responder: null }
      : { admin: null, responder: refreshed });
  }

  hasPersistedSession(requirement: GuardRequirement): boolean {
    return this.sessionMatches(this.activeSession(), requirement);
  }

  sessionMatches(session: Session | null, requirement: GuardRequirement): boolean {
    if (!session || session.expired) {
      return false;
    }

    return tokenMatchesRequirement(session.tokenType, requirement);
  }

  private withSavedAt(session: Omit<Session, 'savedAt'>): Session {
    return { ...session, savedAt: new Date().toISOString() };
  }

  private save(state: AuthState): void {
    this.state.set(state);
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  private load(): AuthState {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return emptyState;
    }

    try {
      return { ...emptyState, ...JSON.parse(raw) };
    } catch {
      localStorage.removeItem(storageKey);
      return emptyState;
    }
  }
}
