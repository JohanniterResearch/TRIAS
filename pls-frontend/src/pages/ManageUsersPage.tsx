import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Appbar from '../components/Appbar';
import {
  getOperationScenes,
  listUsers,
  reactivateAdminUser,
  resetAdminUserPassword,
  revokeUser,
  searchAdminUsers,
  updateAdminUser,
  type OperationScene,
  type User,
} from '../api/endpoints';
import { apiErrorMessage, httpStatus } from '../api/client';

type Filters = { search: string; role: '' | 'responder' | 'leitstelle'; accountType: '' | 'permanent' | 'event'; status: '' | 'active' | 'revoked' };
type Edit = { id: number; username: string; role: 'responder' | 'leitstelle'; accountType: 'permanent' | 'event'; eventSceneId: string };
type PasswordAction = { id: number; kind: 'reset' | 'reactivate'; password: string };

const PAGE_SIZE = 25;
const ROLE_LABEL: Record<string, string> = { admin: 'Admin', leitstelle: 'Leitstelle', responder: 'Einsatzkraft' };

// WP 2.2: the Admin directory of Leitstelle and responder accounts (search, edit, revoke, reset
// password, reactivate) plus the Admin accounts, which /api/admin/users never lists. The temporary
// password is typed by the Admin, as in the Ambulanzsystem client, so nothing is shown back.
export default function ManageUsersPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({ search: '', role: '', accountType: '', status: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; items: User[] }>({ total: 0, items: [] });
  const [admins, setAdmins] = useState<User[]>([]);
  const [events, setEvents] = useState<OperationScene[]>([]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [passwordAction, setPasswordAction] = useState<PasswordAction | null>(null);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [directory, all] = await Promise.all([
        searchAdminUsers({
          search: filters.search || undefined,
          role: filters.role || undefined,
          accountType: filters.accountType || undefined,
          status: filters.status || undefined,
          page,
          pageSize: PAGE_SIZE,
        }),
        listUsers(),
      ]);
      setResult(directory.data);
      setAdmins(all.data.filter((user) => user.role === 'admin'));
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Benutzer konnten nicht geladen werden.'));
    } finally {
      setIsLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getOperationScenes()
      .then(({ data }) => setEvents(data.filter((scene) => scene.parentSceneId == null)))
      .catch(() => setEvents([]));
  }, []);

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    setMessage('');
    setErrorMessage('');
    try {
      await action();
      setMessage(success);
      await load();
      return true;
    } catch (error) {
      setErrorMessage(httpStatus(error) === 409 ? apiErrorMessage(error, 'Konflikt: Aktion nicht möglich.') : apiErrorMessage(error, fallback));
      return false;
    }
  };

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleRevoke = (user: User) => {
    if (!window.confirm(`Zugang von "${user.username}" beenden?`)) return;
    void run(() => revokeUser(user.id), `Zugang von ${user.username} wurde beendet.`, 'Zugang konnte nicht beendet werden.');
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!edit) return;
    const isEvent = edit.accountType === 'event';
    const saved = await run(
      () => updateAdminUser(edit.id, {
        username: edit.username,
        role: edit.role,
        accountType: edit.accountType,
        eventSceneId: isEvent ? Number(edit.eventSceneId) : null,
      }),
      'Benutzer wurde gespeichert. Bei geänderter Rolle oder Veranstaltung muss sich die Person neu anmelden.',
      'Benutzer konnte nicht gespeichert werden.',
    );
    if (saved) setEdit(null);
  };

  const handlePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordAction) return;
    const { id, kind, password } = passwordAction;
    const saved = await run(
      () => (kind === 'reset' ? resetAdminUserPassword(id, password) : reactivateAdminUser(id, password)),
      kind === 'reset'
        ? 'Passwort wurde zurückgesetzt. Bei der nächsten Anmeldung muss es geändert werden.'
        : 'Benutzer wurde reaktiviert. Bei der nächsten Anmeldung muss das Passwort geändert werden.',
      'Aktion fehlgeschlagen.',
    );
    if (saved) setPasswordAction(null);
  };

  const eventName = (id: number | null | undefined) => (id == null ? '' : events.find((scene) => scene.id === id)?.name ?? `Veranstaltung ${id}`);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <>
      <Appbar />
      <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
        <h2>Benutzerverwaltung</h2>
        <button onClick={() => navigate('/AdminSettingsPage')} style={{ marginBottom: '15px' }}>
          Zurück zu den Einstellungen
        </button>

        {message && <p className="msg-success" role="status">{message}</p>}
        {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

        <fieldset style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
          <legend>Suche</legend>
          <label>
            Name <input type="search" value={filters.search} onChange={(e) => updateFilter('search', e.target.value)} />
          </label>
          <label>
            Rolle{' '}
            <select value={filters.role} onChange={(e) => updateFilter('role', e.target.value as Filters['role'])}>
              <option value="">Alle</option>
              <option value="responder">Einsatzkraft</option>
              <option value="leitstelle">Leitstelle</option>
            </select>
          </label>
          <label>
            Kontotyp{' '}
            <select value={filters.accountType} onChange={(e) => updateFilter('accountType', e.target.value as Filters['accountType'])}>
              <option value="">Alle</option>
              <option value="permanent">Dauerhaft</option>
              <option value="event">Veranstaltung</option>
            </select>
          </label>
          <label>
            Status{' '}
            <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value as Filters['status'])}>
              <option value="">Alle</option>
              <option value="active">Aktiv</option>
              <option value="revoked">Beendet</option>
            </select>
          </label>
        </fieldset>

        {isLoading ? (
          <p role="status">Lade Benutzer...</p>
        ) : (
          <>
            <table border={1} style={{ width: '100%' }} aria-label="Leitstelle und Einsatzkräfte">
              <thead>
                <tr>
                  <th>Benutzername</th>
                  <th>Rolle</th>
                  <th>Kontotyp</th>
                  <th>Status</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {result.items.length === 0 && (
                  <tr>
                    <td colSpan={5}>Keine Benutzer gefunden.</td>
                  </tr>
                )}
                {result.items.map((user) => (
                  <tr key={user.id}>
                    <td>{user.username}</td>
                    <td>{ROLE_LABEL[user.role]}</td>
                    <td>{user.accountType === 'event' ? `Veranstaltung: ${eventName(user.eventSceneId)}` : 'Dauerhaft'}</td>
                    <td>{user.revokedAt ? 'beendet' : user.requiresPasswordChange ? 'aktiv (Passwortänderung offen)' : 'aktiv'}</td>
                    <td>
                      {user.revokedAt ? (
                        <button type="button" onClick={() => setPasswordAction({ id: user.id, kind: 'reactivate', password: '' })}>
                          Reaktivieren
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setEdit({
                                id: user.id,
                                username: user.username,
                                role: user.role === 'leitstelle' ? 'leitstelle' : 'responder',
                                accountType: user.accountType,
                                eventSceneId: user.eventSceneId == null ? '' : String(user.eventSceneId),
                              })
                            }
                          >
                            Bearbeiten
                          </button>{' '}
                          <button type="button" onClick={() => setPasswordAction({ id: user.id, kind: 'reset', password: '' })}>
                            Passwort zurücksetzen
                          </button>{' '}
                          <button type="button" onClick={() => handleRevoke(user)}>Zugang beenden</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Zurück</button>{' '}
              Seite {page} von {pages} ({result.total} Benutzer){' '}
              <button type="button" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Weiter</button>
            </p>
          </>
        )}

        {edit && (
          <form onSubmit={(e) => void handleSaveEdit(e)} aria-label="Benutzer bearbeiten" className="settings-section">
            <h3>Benutzer bearbeiten</h3>
            <div className="form-group">
              <label htmlFor="edit-username">Benutzername</label>
              <input id="edit-username" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} required />
            </div>
            <div className="form-group">
              <label htmlFor="edit-role">Rolle</label>
              <select id="edit-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Edit['role'] })}>
                <option value="responder">Einsatzkraft</option>
                <option value="leitstelle">Leitstelle</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="edit-account-type">Kontotyp</label>
              <select id="edit-account-type" value={edit.accountType} onChange={(e) => setEdit({ ...edit, accountType: e.target.value as Edit['accountType'] })}>
                <option value="permanent">Dauerhaft</option>
                <option value="event">Veranstaltung</option>
              </select>
            </div>
            {edit.accountType === 'event' && (
              <div className="form-group">
                <label htmlFor="edit-event">Veranstaltung</label>
                <select id="edit-event" value={edit.eventSceneId} onChange={(e) => setEdit({ ...edit, eventSceneId: e.target.value })} required>
                  <option value="">Veranstaltung auswählen</option>
                  {events.map((scene) => (
                    <option key={scene.id} value={scene.id}>{scene.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button type="submit" className="btn-primary">Speichern</button>{' '}
            <button type="button" onClick={() => setEdit(null)}>Abbrechen</button>
          </form>
        )}

        {passwordAction && (
          <form
            onSubmit={(e) => void handlePassword(e)}
            aria-label={passwordAction.kind === 'reset' ? 'Passwort zurücksetzen' : 'Benutzer reaktivieren'}
            className="settings-section"
          >
            <h3>{passwordAction.kind === 'reset' ? 'Passwort zurücksetzen' : 'Benutzer reaktivieren'}</h3>
            <div className="form-group">
              <label htmlFor="temporary-password">Temporäres Passwort</label>
              <input
                id="temporary-password"
                type="password"
                autoComplete="new-password"
                value={passwordAction.password}
                onChange={(e) => setPasswordAction({ ...passwordAction, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="btn-primary">Bestätigen</button>{' '}
            <button type="button" onClick={() => setPasswordAction(null)}>Abbrechen</button>
          </form>
        )}

        <h3 style={{ marginTop: '24px' }}>Admin-Konten</h3>
        <table border={1} style={{ width: '100%' }} aria-label="Admin-Konten">
          <thead>
            <tr>
              <th>Benutzername</th>
              <th>Status</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((user) => (
              <tr key={user.id}>
                <td>{user.username}</td>
                <td>{user.revokedAt ? 'beendet' : 'aktiv'}</td>
                <td>
                  {/* The server refuses (409) to revoke the last active Admin and (403) oneself. */}
                  {!user.revokedAt && <button type="button" onClick={() => handleRevoke(user)}>Zugang beenden</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
