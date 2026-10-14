import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShowBodyBack from './ShowBodyBack';
import ShowBodyFront from './ShowBodyFront';
import { useWorkContextStore } from '../stores/workContextStore';
import { signIn } from '../test/session';
import { clearOfflineQueueForTests, offlineQueue } from '../offline/offlineQueue';

const navigateMock = vi.fn();
const getBodyPartsMock = vi.fn();
const saveBodyPartMock = vi.fn();

vi.mock('../api/endpoints', () => ({
  getBodyParts: (...args: unknown[]) => getBodyPartsMock(...args),
  saveBodyPart: (...args: unknown[]) => saveBodyPartMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderAt(path: string, element: ReactElement, state = { returnTo: '/TriagePage2', triageResult: 'rot' }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>
  );
}

function serverBody(marked: string[] = []) {
  return { data: { idpatient: 12, bodyParts: Object.fromEntries(['kopf_vorne', 'bauch_vorne', 'becken_vorne', 'ferse_links_hinten'].map((k) => [k, marked.includes(k) ? 1 : 0])) } };
}

beforeEach(() => {
  signIn('qr', '1');
  cleanup();
  window.localStorage.clear();
  navigateMock.mockReset();
  saveBodyPartMock.mockReset();
  getBodyPartsMock.mockReset().mockResolvedValue(serverBody());
  useWorkContextStore.setState({ patientId: 12, operationSceneId: 77 });
});

describe('ShowBody pages preserve triage return state', () => {
  it('front page returns to the originating triage page and preserves state when switching views', async () => {
    renderAt('/ShowBodyFront', <ShowBodyFront />);
    await screen.findByRole('heading', { name: /front/i });

    fireEvent.click(screen.getByRole('button', { name: /zurück zur triage/i }));
    expect(navigateMock).toHaveBeenCalledWith('/TriagePage2', { state: { triageResult: 'rot' } });

    navigateMock.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /rückseite anzeigen/i }));
    expect(navigateMock).toHaveBeenCalledWith('/ShowBodyBack', { state: { returnTo: '/TriagePage2', triageResult: 'rot' } });
  });

  it('back page returns to the originating triage page and preserves state when switching views', async () => {
    renderAt('/ShowBodyBack', <ShowBodyBack />, { returnTo: '/TriagePage3', triageResult: 'gelb' });
    await screen.findByRole('heading', { name: /back/i });

    fireEvent.click(screen.getByRole('button', { name: /zurück zur triage/i }));
    expect(navigateMock).toHaveBeenCalledWith('/TriagePage3', { state: { triageResult: 'gelb' } });

    navigateMock.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /vorderseite anzeigen/i }));
    expect(navigateMock).toHaveBeenCalledWith('/ShowBodyFront', { state: { returnTo: '/TriagePage3', triageResult: 'gelb' } });
  });
});

describe('body map goes through the region codec (D4, D10)', () => {
  it('saves leiste as bauch_vorne and marks the whole group, with a one-time hint', async () => {
    saveBodyPartMock.mockResolvedValue(serverBody(['bauch_vorne']));
    const { container } = renderAt('/ShowBodyFront', <ShowBodyFront />);
    await screen.findByRole('heading', { name: /front/i });

    await act(async () => {
      fireEvent.click(container.querySelector('#leiste_links_vorne')!);
    });

    expect(saveBodyPartMock).toHaveBeenCalledWith(12, 'bauch_vorne', true, { expectedOwner: 'qr:1' });
    expect(container.querySelector('#leiste_links_vorne')).toHaveStyle({ fill: 'red' });
    expect(container.querySelector('#leiste_rechts_vorne')).toHaveStyle({ fill: 'red' });
    expect(container.querySelector('#huefte_links_vorne')).toHaveStyle({ fill: '#808080' });
    expect(screen.getByRole('status')).toHaveTextContent('leiste_links_vorne, leiste_rechts_vorne');
  });

  it('lists marked regions the drawing cannot show', async () => {
    getBodyPartsMock.mockResolvedValue(serverBody(['ferse_links_hinten']));
    renderAt('/ShowBodyBack', <ShowBodyBack />);
    expect(await screen.findByText(/nicht darstellbar\): ferse_links_hinten/)).toBeInTheDocument();
  });

  it('shows a failed save instead of pretending it worked', async () => {
    saveBodyPartMock.mockRejectedValue({ response: { status: 400, data: { status: 'error', message: 'Unknown bodyPartId.' } } });
    const { container } = renderAt('/ShowBodyFront', <ShowBodyFront />);
    await screen.findByRole('heading', { name: /front/i });

    await act(async () => {
      fireEvent.click(container.querySelector('#kopf_vorne')!);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Unknown bodyPartId.');
    expect(container.querySelector('#kopf_vorne')).toHaveStyle({ fill: '#808080' });
  });
});

describe('body map keyboard operation (WP 7.4)', () => {
  it('each region is a named checkbox that Enter and Space toggle', async () => {
    getBodyPartsMock.mockResolvedValue(serverBody(['kopf_vorne']));
    saveBodyPartMock.mockResolvedValue(serverBody([]));
    renderAt('/ShowBodyFront', <ShowBodyFront />);

    const head = await screen.findByRole('checkbox', { name: 'kopf vorne' });
    expect(head).toHaveAttribute('tabindex', '0');
    expect(head).toBeChecked();
    fireEvent.keyDown(head, { key: 'Enter' });
    await waitFor(() => expect(saveBodyPartMock).toHaveBeenCalledWith(12, 'kopf_vorne', false, { expectedOwner: 'qr:1' }));

    saveBodyPartMock.mockClear();
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'hals vorne' }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'hals vorne' }), { key: ' ' });
    await waitFor(() => expect(saveBodyPartMock).toHaveBeenCalledWith(12, 'hals_vorne', true, { expectedOwner: 'qr:1' }));
    expect(saveBodyPartMock).toHaveBeenCalledTimes(1);
  });
});

describe('body map with work queued on this device (final review M3)', () => {
  it('shows a mark queued for a local patient, so it can be cleared again', async () => {
    await clearOfflineQueueForTests();
    await offlineQueue.queueBodyPart(-1700000000000, { idpatient: -1700000000000, bodyPartId: 'kopf_vorne', isClicked: true });
    useWorkContextStore.setState({ patientId: -1700000000000, operationSceneId: 77 });
    renderAt('/ShowBodyFront', <ShowBodyFront />);

    expect(await screen.findByRole('checkbox', { name: 'kopf vorne' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'hals vorne' })).not.toBeChecked();
    expect(getBodyPartsMock).not.toHaveBeenCalled();
    await clearOfflineQueueForTests();
  });
});

describe('overlapping taps (final review L3)', () => {
  it('a late answer to an earlier tap does not hide a later mark', async () => {
    getBodyPartsMock.mockResolvedValue(serverBody([]));
    let answerFirst!: (value: unknown) => void;
    saveBodyPartMock
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(serverBody(['kopf_vorne', 'bauch_vorne']));
    renderAt('/ShowBodyFront', <ShowBodyFront />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'kopf vorne' }));
    await waitFor(() => expect(saveBodyPartMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('checkbox', { name: 'leiste links vorne' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'leiste links vorne' })).toBeChecked());
    await act(async () => answerFirst(serverBody(['kopf_vorne'])));
    expect(screen.getByRole('checkbox', { name: 'leiste links vorne' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'kopf vorne' })).toBeChecked();
  });
});
