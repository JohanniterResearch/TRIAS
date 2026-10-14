import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreateNewAdminUserPage from './CreateNewAdminUserPage';
import ManageUsersPage from './ManageUsersPage';
import OrganisationsPage from './OrganisationsPage';
import EditOperationScene from './EditOperationScene';
import RoleSelectionPage from './RoleSelectionPage';
import Appbar from '../components/Appbar';
import { draftToBody, sceneDraftError, EMPTY_SCENE } from '../utils/sceneDraft';
import { useAuthStore } from '../stores/authStore';

const api = {
  createUser: vi.fn(),
  getOperationScenes: vi.fn(),
  listUsers: vi.fn(),
  searchAdminUsers: vi.fn(),
  updateAdminUser: vi.fn(),
  resetAdminUserPassword: vi.fn(),
  reactivateAdminUser: vi.fn(),
  revokeUser: vi.fn(),
  getOrganisations: vi.fn(),
  createOrganisation: vi.fn(),
  saveOperationScene: vi.fn(),
  deleteOperationScene: vi.fn(),
  selfCancel: vi.fn(),
  logout: vi.fn(),
};

vi.mock('../api/endpoints', () =>
  Object.fromEntries(Object.keys({
    createUser: 0, getOperationScenes: 0, listUsers: 0, searchAdminUsers: 0, updateAdminUser: 0, resetAdminUserPassword: 0,
    reactivateAdminUser: 0, revokeUser: 0, getOrganisations: 0, createOrganisation: 0, saveOperationScene: 0,
    deleteOperationScene: 0, selfCancel: 0, logout: 0,
  }).map((name) => [name, (...args: unknown[]) => (api as Record<string, (...a: unknown[]) => unknown>)[name](...args)])),
);

const scene = (id: number, name: string, parentSceneId: number | null = null, extra = {}) => ({
  id, name, parentSceneId, active: true, description: null, organisationId: null, accessWindowStart: null, accessWindowEnd: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
});
const user = (id: number, username: string, role: string, extra = {}) => ({
  id, username, role, accountType: 'permanent', eventSceneId: null, revokedAt: null, requiresPasswordChange: false,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
});
const conflict = (message: string) => Object.assign(new Error('409'), { isAxiosError: true, response: { status: 409, data: { message } } });

const renderPage = (element: React.ReactElement) => render(<MemoryRouter>{element}</MemoryRouter>);

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getOperationScenes.mockResolvedValue({ data: [scene(1, 'Donauinselfest'), scene(2, 'Bühne Nord', 1), scene(3, 'Marathon')] });
  api.getOrganisations.mockResolvedValue({ data: [{ id: 5, name: 'JUH Wien' }] });
  api.listUsers.mockResolvedValue({ data: [user(1, 'root', 'admin'), user(9, 'leit', 'leitstelle')] });
  api.searchAdminUsers.mockResolvedValue({ data: { total: 2, items: [user(9, 'leit', 'leitstelle'), user(10, 'alt', 'responder', { revokedAt: '2026-01-02T00:00:00Z' })] } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  useAuthStore.setState({ session: { token: 't', role: 'admin' } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WP 2.1 create user', () => {
  it('creates an event responder scoped to the chosen event', async () => {
    api.createUser.mockResolvedValue({ data: user(11, 'helfer', 'responder') });
    renderPage(<CreateNewAdminUserPage />);
    fireEvent.change(screen.getByLabelText('Rolle:'), { target: { value: 'responder' } });
    fireEvent.change(screen.getByLabelText('Kontotyp:'), { target: { value: 'event' } });
    await screen.findByRole('option', { name: 'Donauinselfest' });
    expect(screen.queryByRole('option', { name: 'Bühne Nord' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Veranstaltung:'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Benutzername:'), { target: { value: 'helfer' } });
    fireEvent.change(screen.getByLabelText('Passwort:'), { target: { value: 'geheim123' } });
    fireEvent.change(screen.getByLabelText('Passwort bestätigen:'), { target: { value: 'geheim123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer erstellen' }));

    await screen.findByText('Einsatzkraft-Benutzer wurde erfolgreich erstellt.');
    expect(api.createUser).toHaveBeenCalledWith({ username: 'helfer', password: 'geheim123', role: 'responder', accountType: 'event', eventSceneId: 1 });
  });

  it('shows the password policy error from the server', async () => {
    api.createUser.mockRejectedValue(Object.assign(new Error('400'), { isAxiosError: true, response: { status: 400, data: { message: 'Password must be at least 8 characters.' } } }));
    renderPage(<CreateNewAdminUserPage />);
    fireEvent.change(screen.getByLabelText('Rolle:'), { target: { value: 'admin' } });
    expect(screen.queryByLabelText('Kontotyp:')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Benutzername:'), { target: { value: 'chef' } });
    fireEvent.change(screen.getByLabelText('Passwort:'), { target: { value: 'kurz' } });
    fireEvent.change(screen.getByLabelText('Passwort bestätigen:'), { target: { value: 'kurz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Password must be at least 8 characters.');
    expect(api.createUser).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin', accountType: 'permanent', eventSceneId: undefined }));
  });
});

describe('WP 2.2 manage users', () => {
  it('searches with filters and pages from the first page', async () => {
    api.searchAdminUsers.mockResolvedValue({ data: { total: 60, items: [user(9, 'leit', 'leitstelle')] } });
    renderPage(<ManageUsersPage />);
    await screen.findByText('leit');
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await waitFor(() => expect(api.searchAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
    await screen.findByText(/Seite 2 von 3/);
    fireEvent.change(screen.getByLabelText('Rolle'), { target: { value: 'leitstelle' } });
    await waitFor(() => expect(api.searchAdminUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'leitstelle', page: 1, pageSize: 25 })));
  });

  it('edits an account into an event account', async () => {
    api.updateAdminUser.mockResolvedValue({ data: user(9, 'leit2', 'responder') });
    renderPage(<ManageUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: 'leit2' } });
    fireEvent.change(screen.getByLabelText('Rolle', { selector: '#edit-role' }), { target: { value: 'responder' } });
    fireEvent.change(screen.getByLabelText('Kontotyp', { selector: '#edit-account-type' }), { target: { value: 'event' } });
    fireEvent.change(screen.getByLabelText('Veranstaltung'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(api.updateAdminUser).toHaveBeenCalledWith(9, { username: 'leit2', role: 'responder', accountType: 'event', eventSceneId: 3 }));
  });

  it('resets a password and reactivates a revoked account with a typed temporary password', async () => {
    api.resetAdminUserPassword.mockResolvedValue({});
    api.reactivateAdminUser.mockResolvedValue({});
    renderPage(<ManageUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Passwort zurücksetzen' }));
    fireEvent.change(screen.getByLabelText('Temporäres Passwort'), { target: { value: 'Temp12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(api.resetAdminUserPassword).toHaveBeenCalledWith(9, 'Temp12345'));

    fireEvent.click(await screen.findByRole('button', { name: 'Reaktivieren' }));
    fireEvent.change(screen.getByLabelText('Temporäres Passwort'), { target: { value: 'Temp67890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(api.reactivateAdminUser).toHaveBeenCalledWith(10, 'Temp67890'));
  });

  it('shows the server conflict when the last Admin is revoked', async () => {
    api.revokeUser.mockRejectedValue(conflict('The final active Admin cannot be revoked.'));
    renderPage(<ManageUsersPage />);
    const adminTable = await screen.findByRole('table', { name: 'Admin-Konten' });
    await waitFor(() => expect(adminTable).toHaveTextContent('root'));
    fireEvent.click(adminTable.querySelector('button')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('The final active Admin cannot be revoked.');
    expect(api.revokeUser).toHaveBeenCalledWith(1);
  });
});

describe('WP 2.3 organisations', () => {
  it('lists and creates organisations', async () => {
    api.createOrganisation.mockResolvedValue({ data: { id: 6, name: 'ASB' } });
    renderPage(<OrganisationsPage />);
    await screen.findByText('JUH Wien');
    fireEvent.change(screen.getByLabelText('Neue Organisation'), { target: { value: ' ASB ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Organisation erstellen' }));

    await screen.findByText('ASB');
    expect(api.createOrganisation).toHaveBeenCalledWith('ASB');
  });
});

describe('WP 2.5 scene hierarchy and access windows', () => {
  it('sends every field of the upsert, including parent, organisation and window', async () => {
    api.saveOperationScene.mockImplementation(async (body: { id: number }) => ({ data: scene(body.id, 'Bühne Nord', 3) }));
    renderPage(<EditOperationScene />);
    fireEvent.change(await screen.findByLabelText('Einsatzort auswählen:'), { target: { value: '2' } });
    await screen.findByRole('option', { name: 'JUH Wien' });
    fireEvent.change(screen.getByLabelText('Übergeordnete Veranstaltung:'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Organisation:'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Zugriff ab:'), { target: { value: '2026-07-01T08:00' } });
    fireEvent.change(screen.getByLabelText('Zugriff bis:'), { target: { value: '2026-07-01T20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einsatzort aktualisieren' }));

    await waitFor(() => expect(api.saveOperationScene).toHaveBeenCalled());
    expect(api.saveOperationScene.mock.calls[0][0]).toEqual({
      id: 2,
      name: 'Bühne Nord',
      description: '',
      organisationId: 5,
      parentSceneId: 3,
      accessWindowStart: new Date('2026-07-01T08:00').toISOString(),
      accessWindowEnd: new Date('2026-07-01T20:00').toISOString(),
      active: true,
    });
  });

  it('keeps an event with sub-sites top-level and shows the server conflict on delete', async () => {
    api.deleteOperationScene.mockRejectedValue(conflict('Scene has sub-sites.'));
    renderPage(<EditOperationScene />);
    fireEvent.change(await screen.findByLabelText('Einsatzort auswählen:'), { target: { value: '1' } });
    expect(screen.getByLabelText('Übergeordnete Veranstaltung:')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Einsatzort löschen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Scene has sub-sites.');
  });

  it('rejects an access window that ends before it starts', () => {
    expect(sceneDraftError({ ...EMPTY_SCENE, name: 'X', accessWindowStart: '2026-07-02T08:00', accessWindowEnd: '2026-07-01T08:00' })).toMatch(/Ende/);
    expect(draftToBody({ ...EMPTY_SCENE, name: ' X ' })).toMatchObject({ name: 'X', parentSceneId: undefined, active: true });
  });

  it('groups each event with its sub-sites in the role selection', async () => {
    renderPage(<RoleSelectionPage />);
    const group = await screen.findByRole('group', { name: 'Donauinselfest' });
    expect(Array.from(group.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['Donauinselfest (Veranstaltung)', 'Bühne Nord']);
    expect(screen.getByRole('group', { name: 'Marathon' })).toBeInTheDocument();
  });
});

describe('WP 2.4 self-cancel', () => {
  it('ends the own access on the server, then locally', async () => {
    api.selfCancel.mockResolvedValue({});
    useAuthStore.setState({ session: { token: 't', role: 'qr' } });
    renderPage(<Appbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Zugang beenden' }));

    await waitFor(() => expect(useAuthStore.getState().session).toBeNull());
    expect(api.selfCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the server cannot be reached', async () => {
    api.selfCancel.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    useAuthStore.setState({ session: { token: 't', role: 'user', refreshToken: 'r' } });
    renderPage(<Appbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Zugang beenden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Zugang konnte nicht beendet werden');
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('is not offered to staff', () => {
    renderPage(<Appbar />);
    expect(screen.queryByRole('button', { name: 'Zugang beenden' })).not.toBeInTheDocument();
  });
});
