import { computed, Injectable, signal } from '@angular/core';

import { GuardRequirement, TokenType, tokenMatchesRequirement } from './auth.rules';

export type { GuardRequirement, TokenType };

export interface Session {
  token: string;
  refreshToken?: string;
  tokenType: TokenType;
  eventSceneId?: number;
  username?: string;
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
  readonly bearerToken = computed(() => this.state().responder?.token ?? this.state().admin?.token ?? null);

  setAdminSession(session: Omit<Session, 'savedAt'>): void {
    this.save({ admin: this.withSavedAt(session), responder: null });
  }

  setResponderSession(session: Omit<Session, 'savedAt'>): void {
    this.save({ admin: null, responder: this.withSavedAt(session) });
  }

  clear(): void {
    this.save(emptyState);
  }

  hasPersistedSession(requirement: GuardRequirement): boolean {
    return this.sessionMatches(this.activeSession(), requirement);
  }

  sessionMatches(session: Session | null, requirement: GuardRequirement): boolean {
    if (!session) {
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
