import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/title.css';
import { apiErrorMessage } from '../api/client';
import { cancelOwnAccess, endSession, PendingWorkError } from '../auth/session';
import { isLeitstelleOrAdmin, loginPathFor, useAuthStore } from '../stores/authStore';
import { useQueueStatus } from '../offline/offlineQueue';

export default function Appbar() {
  const session = useAuthStore((state) => state.session);
  const navigate = useNavigate();
  const [cancelError, setCancelError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const canSelfCancel = session?.role === 'user' || session?.role === 'qr';
  const { pendingCount } = useQueueStatus();

  // Never blocked (D11): unsent work is sent first, flagged; what cannot go out stays on the
  // device for this account's next sign-in.
  const handleLogout = async () => {
    const role = session?.role;
    setLeaving(true);
    try {
      await endSession();
    } finally {
      setLeaving(false);
    }
    navigate(loginPathFor(role), { replace: true });
  };

  // WP 2.4: responders and QR sessions can end their own access, but not while this account has
  // unsent work: after the cancel it could never sign in again to send it (WP 6.5).
  const handleSelfCancel = async () => {
    if (!window.confirm('Eigenen Zugang beenden? Eine erneute Anmeldung mit diesem Zugang ist danach nicht mehr möglich.')) return;
    const role = session?.role;
    setCancelError('');
    try {
      await cancelOwnAccess();
      navigate(loginPathFor(role), { replace: true });
    } catch (error) {
      setCancelError(error instanceof PendingWorkError ? error.message : apiErrorMessage(error, 'Zugang konnte nicht beendet werden. Bitte erneut versuchen.'));
    }
  };

  return (
    <div className="header">
      <div className="logo">
        <img src="/logo.png" alt="Logo" />
      </div>
      <div className="links">
        {(!session || isLeitstelleOrAdmin(session.role)) && <a href="/AdminSettingsPage" className="admin-text">Admin</a>}
        <a href="/" className="admin-text">Home</a>
        {session && (
          <button type="button" className="admin-text" disabled={leaving} onClick={() => void handleLogout()}>
            {leaving ? 'Abmelden… (sende Ungesendetes)' : 'Abmelden'}
          </button>
        )}
        {canSelfCancel && (
          <button
            type="button"
            className="admin-text"
            disabled={pendingCount > 0}
            title={pendingCount > 0 ? 'Erst möglich, wenn alle Einträge gesendet sind.' : undefined}
            onClick={() => void handleSelfCancel()}
          >
            Zugang beenden
          </button>
        )}
      </div>
      {canSelfCancel && pendingCount > 0 && <p className="sync-note">Zugang beenden ist erst möglich, wenn alle Einträge gesendet sind.</p>}
      {cancelError && <p className="msg-error" role="alert">{cancelError}</p>}
    </div>
  );
}
