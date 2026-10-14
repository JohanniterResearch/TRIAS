import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../storage/keys';

// Token `type` claims of the Ambulanzsystem backend (contract/openapi.yaml).
export type SessionRole = 'admin' | 'leitstelle' | 'user' | 'qr';

export interface Session {
  token: string;
  /** Absent for QR and dev-login sessions, which cannot be refreshed. */
  refreshToken?: string;
  role: SessionRole;
  eventSceneId?: number | null;
  username?: string;
  requiresPasswordChange?: boolean;
}

interface AuthState {
  session: Session | null;
  setSession: (session: Session) => void;
  updateTokens: (token: string, refreshToken: string) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),
      updateTokens: (token, refreshToken) =>
        set((state) => (state.session ? { session: { ...state.session, token, refreshToken } } : state)),
      clearSession: () => set({ session: null }),
    }),
    {
      name: STORAGE_KEYS.auth,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ session: state.session }),
    },
  ),
);

// Refresh tokens are single-use and the server treats a spent one as theft, revoking every
// session of the account. Adopt a rotation or logout done in another tab instead of later
// presenting this tab's stale copy.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.auth) void useAuthStore.persist.rehydrate();
  });
}

/**
 * Stable identity of a session for tagging local data: token type plus subject (user id or QR
 * login id). Read from the JWT payload without verification; the server verifies every request,
 * this only decides which local drafts a session may see.
 */
export function sessionOwner(token: string | undefined): string | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown; type?: unknown };
    return typeof claims.sub === 'string' && typeof claims.type === 'string' ? `${claims.type}:${claims.sub}` : null;
  } catch {
    return null;
  }
}

export const isLeitstelleOrAdmin = (role: SessionRole | undefined) => role === 'admin' || role === 'leitstelle';

/** Where a session of this role signs in again. */
export function loginPathFor(role: SessionRole | undefined): string {
  return isLeitstelleOrAdmin(role) ? '/AdminLandingPage' : '/qrAuthenticator';
}
