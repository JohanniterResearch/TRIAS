import { AxiosError, type AxiosAdapter } from 'axios';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import client from '../api/client';
import Appbar from './Appbar';
import SyncStatus from './SyncStatus';
import { clearOfflineQueueForTests, offlineQueue } from '../offline/offlineQueue';
import { signIn } from '../test/session';

// WP 6.5: sync indicator, issues panel (retry, backup, discard only after backup), and self-cancel
// unavailable while this account has unsent work. Logout stays available (D11).

let status = 400;
const adapter: AxiosAdapter = async (config) => {
  const response = { status, statusText: '', headers: {}, config, data: { message: 'Ungültige Triagefarbe.' } };
  if (status >= 400) throw new AxiosError('fail', 'ERR_BAD_REQUEST', config, null, response);
  return response;
};

beforeEach(async () => {
  window.localStorage.clear();
  signIn('qr', '1');
  await clearOfflineQueueForTests();
  client.defaults.adapter = adapter;
  status = 400;
});
afterEach(cleanup);

const renderBar = () => render(<MemoryRouter><SyncStatus /><Appbar /></MemoryRouter>);

it('shows a refused item with retry, backup and discard; discard needs the backup first', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  await offlineQueue.queueTriage(5, { triageColor: 'rot' } as never);
  await offlineQueue.flush(true);
  renderBar();

  fireEvent.click(screen.getByRole('button', { name: /Sync: 1 ungesendet/ }));
  const panel = screen.getByRole('region', { name: 'Synchronisation' });
  expect(within(panel).getByText(/Triage, Patient 5: Ungültige Triagefarbe\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zugang beenden' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Abmelden' })).toBeEnabled();

  fireEvent.click(within(panel).getByRole('button', { name: 'Verwerfen' }));
  expect(await within(panel).findByText('Eintrag zuerst als Datei sichern.')).toBeInTheDocument();

  fireEvent.click(within(panel).getByRole('button', { name: 'Als Datei sichern' }));
  expect(await within(panel).findByText('Als Datei gesichert.')).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: 'Verwerfen' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Sync: Alles gesendet/ })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Zugang beenden' })).toBeEnabled();
});

it('retry sends the refused item again', async () => {
  await offlineQueue.queueTriage(5, { triageColor: 'rot' } as never);
  await offlineQueue.flush(true);
  renderBar();
  status = 200;
  fireEvent.click(screen.getByRole('button', { name: /Sync: 1 ungesendet/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Erneut senden' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Sync: Alles gesendet/ })).toBeInTheDocument());
});

it('other sessions\' items: counted for everyone, backup and discard only for staff', async () => {
  await offlineQueue.queueTriage(5, { triageColor: 'rot' } as never);
  signIn('qr', '2');
  await offlineQueue.refresh();
  const { unmount } = renderBar();
  fireEvent.click(screen.getByRole('button', { name: /Sync:/ }));
  expect(screen.getByText(/1 ungesendete Einträge anderer Anmeldungen/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Alle als Datei sichern' })).not.toBeInTheDocument();
  unmount();

  signIn('leitstelle', '3');
  await offlineQueue.refresh();
  renderBar();
  fireEvent.click(screen.getByRole('button', { name: /Sync:/ }));
  expect(screen.getByRole('button', { name: 'Alle als Datei sichern' })).toBeInTheDocument();
});
