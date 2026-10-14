import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { ALL_ROLES, STAFF_ROLES } from '../auth/roles';
import { useAuthStore, type Session } from '../stores/authStore';

const validateTokenMock = vi.fn();

vi.mock('../api/endpoints', () => ({
  validateToken: () => validateTokenMock(),
}));

function renderGuard(session: Session | null, roles = ALL_ROLES, allowPendingPasswordChange = false, offlineTolerant = false) {
  useAuthStore.setState({ session });
  return render(
    <MemoryRouter initialEntries={['/guarded']}>
      <Routes>
        <Route
          path="/guarded"
          element={<ProtectedRoute roles={roles} allowPendingPasswordChange={allowPendingPasswordChange} offlineTolerant={offlineTolerant} element={<p>geschützt</p>} />}
        />
        <Route path="/qrAuthenticator" element={<p>qr-login</p>} />
        <Route path="/AdminLandingPage" element={<p>admin-login</p>} />
        <Route path="/ChangeAdminPasswordPage" element={<p>passwort</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  validateTokenMock.mockReset().mockResolvedValue({ data: { isValid: true, role: 'user' } });
});

describe('ProtectedRoute (WP 1.4)', () => {
  it('sends a missing session to the matching login', () => {
    renderGuard(null);
    expect(screen.getByText('qr-login')).toBeInTheDocument();
    cleanup();
    renderGuard(null, STAFF_ROLES);
    expect(screen.getByText('admin-login')).toBeInTheDocument();
  });

  it('renders the page when the server confirms an allowed role', async () => {
    validateTokenMock.mockResolvedValue({ data: { isValid: true, role: 'qr' } });
    renderGuard({ token: 't', role: 'qr' });
    expect(await screen.findByText('geschützt')).toBeInTheDocument();
  });

  it('trusts the server role over the stored one', async () => {
    validateTokenMock.mockResolvedValue({ data: { isValid: true, role: 'user' } });
    renderGuard({ token: 't', role: 'admin' }, STAFF_ROLES);
    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Berechtigung');
    expect(screen.queryByText('geschützt')).not.toBeInTheDocument();
  });

  it('keeps the session and offers a retry when the server is unreachable', async () => {
    validateTokenMock.mockRejectedValue(new Error('Network Error'));
    renderGuard({ token: 't', role: 'user' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('forces a pending password change first', () => {
    renderGuard({ token: 't', role: 'leitstelle', requiresPasswordChange: true }, STAFF_ROLES);
    expect(screen.getByText('passwort')).toBeInTheDocument();
  });

  it('lets the change-password page through while a change is pending', async () => {
    validateTokenMock.mockResolvedValue({ data: { isValid: true, role: 'leitstelle' } });
    renderGuard({ token: 't', role: 'leitstelle', requiresPasswordChange: true }, STAFF_ROLES, true);
    expect(await screen.findByText('geschützt')).toBeInTheDocument();
  });
});

describe('offline-tolerant responder routes (WP 6.1)', () => {
  afterEach(() => vi.useRealTimers());

  const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });

  it('opens with the stored role, says it is unchecked, and rechecks after 30 s', async () => {
    vi.useFakeTimers();
    validateTokenMock.mockRejectedValueOnce(offline()).mockResolvedValue({ data: { isValid: true, role: 'qr' } });
    renderGuard({ token: 't', role: 'qr' }, ALL_ROLES, false, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('geschützt')).toBeInTheDocument();
    expect(screen.getByText(/Anmeldung derzeit nicht geprüft/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(validateTokenMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Anmeldung derzeit nicht geprüft/)).not.toBeInTheDocument();
  });

  it('staff routes stay closed offline', async () => {
    validateTokenMock.mockRejectedValue(offline());
    renderGuard({ token: 't', role: 'leitstelle' }, STAFF_ROLES);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    expect(screen.queryByText('geschützt')).not.toBeInTheDocument();
  });

  it('a server error is not "offline": the responder route stays closed', async () => {
    validateTokenMock.mockRejectedValue(Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500 } }));
    renderGuard({ token: 't', role: 'qr' }, ALL_ROLES, false, true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server nicht erreichbar');
    expect(screen.queryByText('geschützt')).not.toBeInTheDocument();
  });

  it('never opens a route the stored role may not use', async () => {
    validateTokenMock.mockRejectedValue(offline());
    renderGuard({ token: 't', role: 'qr' }, STAFF_ROLES, false, true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Berechtigung');
  });
});
