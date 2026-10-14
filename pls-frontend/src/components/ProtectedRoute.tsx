import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { validateToken } from '../api/endpoints';
import { httpStatus, isUnavailable } from '../api/client';
import { loginPathFor, sessionOwner, useAuthStore, type SessionRole } from '../stores/authStore';
import { STAFF_ROLES } from '../auth/roles';
import SyncStatus from './SyncStatus';

interface Props {
  element: ReactElement;
  roles: readonly SessionRole[];
  /** Reachable while the server requires a password change (the change-password page). */
  allowPendingPasswordChange?: boolean;
  /**
   * Responder routes (WP 6.1): when the server is unreachable they open with the stored role, show
   * that the sign-in is unchecked and recheck with backoff. Staff routes stay closed.
   */
  offlineTolerant?: boolean;
}

type Check = { token: string; result: 'valid' | 'unavailable' | 'degraded'; role?: SessionRole };

/** Recheck delay while degraded: 30 s, doubling, at most 5 min. */
const degradedRetryMs = (attempt: number) => Math.min(300_000, 30_000 * 2 ** attempt);

// Role-aware guard (parity plan WP 1.4). The role comes from the server's validate-token answer,
// never only from local storage. A 401 is handled by the API client (refresh, then login).
const ProtectedRoute = ({ element, roles, allowPendingPasswordChange = false, offlineTolerant = false }: Props) => {
  const session = useAuthStore((state) => state.session);
  const [check, setCheck] = useState<Check | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [degradedRetries, setDegradedRetries] = useState(0);
  const token = session?.token;

  useEffect(() => {
    if (!token) return;
    let active = true;
    validateToken()
      .then(({ data }) => {
        if (active) setCheck({ token, result: 'valid', role: data.role });
      })
      .catch((error) => {
        // A 401 the client answered by ending the session redirects through the store. Otherwise
        // (refresh unreachable or rate-limited) it is "cannot check now", with a retry.
        if (!active) return;
        if (offlineTolerant && isUnavailable(error) && useAuthStore.getState().session) setCheck({ token, result: 'degraded' });
        else if (httpStatus(error) !== 401 || useAuthStore.getState().session) setCheck({ token, result: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, [token, attempt, offlineTolerant]);

  const degraded = check?.result === 'degraded';
  useEffect(() => {
    if (!degraded) return;
    const timer = window.setTimeout(() => {
      setDegradedRetries((n) => n + 1);
      setAttempt((n) => n + 1);
    }, degradedRetryMs(degradedRetries));
    return () => window.clearTimeout(timer);
  }, [degraded, degradedRetries]);

  if (!session) return <Navigate to={loginPathFor(roles.every((r) => STAFF_ROLES.includes(r)) ? 'admin' : 'qr')} replace />;
  if (session.requiresPasswordChange && !allowPendingPasswordChange) return <Navigate to="/ChangeAdminPasswordPage" replace />;

  // The token may have been refreshed while checking: a check of an older token still counts,
  // unless the session meanwhile belongs to someone else (a login in another tab).
  if (!check || (check.token !== session.token && sessionOwner(check.token) !== sessionOwner(session.token))) return null;

  if (check.result === 'unavailable') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="msg-error" role="alert">Anmeldung konnte nicht geprüft werden. Server nicht erreichbar.</p>
          <button type="button" className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Erneut versuchen</button>
        </div>
      </div>
    );
  }

  // Degraded: the stored role, never more than the route allows; the server still checks every
  // request, so nothing is unlocked that the server would refuse.
  const role = check.result === 'degraded' ? session.role : (check.role ?? session.role);
  if (!roles.includes(role)) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="msg-error" role="alert">Keine Berechtigung für diese Seite.</p>
          <Link to="/">Zur Startseite</Link>
        </div>
      </div>
    );
  }

  // Every signed-in page shows what is still on this device (WP 6.5).
  return (
    <>
      <div className="sync-bar">
        <SyncStatus />
        {check.result === 'degraded' && (
          <p className="sync-note" role="status">
            Offline: Anmeldung derzeit nicht geprüft. Eingaben werden auf diesem Gerät gespeichert und später gesendet.
          </p>
        )}
      </div>
      {element}
    </>
  );
};

export default ProtectedRoute;
