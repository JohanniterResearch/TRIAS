import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getPersons } from '../api/endpoints';
import SituationRoomTable from './SituationRoomTable';
import type { Patient } from '../types';
import { useWorkContextStore } from '../stores/workContextStore';

const navigateMock = vi.fn();


const patient = (overrides: Partial<Patient>): Patient => ({
  id: 9,
  operationSceneId: 55,
  atmung: true,
  blutung: false,
  triagefarbe: 'rot',
  transport: true,
  dringend: true,
  kontaminiert: false,
  name: 'Max',
  longitudePatient: 16.4,
  latitudePatient: 48.27,
  qrCodeBound: true,
  createdAt: '2026-03-26T10:00:00.000Z',
  updatedAt: '2026-03-26T10:01:00.000Z',
  ...overrides,
});

vi.mock('../api/endpoints', () => ({
  getPersons: vi.fn().mockImplementation(async () => ({
    data: [
      patient({}),
      // A value outside the vocabulary must stay visible as invalid, never hidden.
      patient({ id: 10, triagefarbe: 'orange' as Patient['triagefarbe'], name: 'Erika' }),
      // The canonical server value gruen is shown as grün.
      patient({ id: 11, triagefarbe: 'gruen', name: 'Anna' }),
    ],
  })),
  getTeams: vi.fn().mockResolvedValue({ data: [] }),
  getBodyParts: vi.fn().mockResolvedValue({ data: { bodyParts: {} } }),
}));

// No hub in unit tests: the page runs on polling.
vi.mock('../realtime/sceneRealtime', () => ({
  connectScene: (_scene: number, _token: () => string, handlers: { onState: (state: string) => void }) => {
    handlers.onState('polling');
    return () => undefined;
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(),
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

afterEach(cleanup);

beforeEach(() => {
  navigateMock.mockReset();
  useWorkContextStore.setState({ operationSceneId: 55, patientId: null });
});

it('navigates to page 1 on click and keyboard activation', async () => {
  render(
    <MemoryRouter initialEntries={['/SituationRoomTable']}>
      <Routes>
        <Route path="/SituationRoomTable" element={<SituationRoomTable />} />
      </Routes>
    </MemoryRouter>
  );

  // A real button (Tab, Enter, Space by the browser) inside an ordinary row, so the row's cells
  // stay readable as a table (final review L1); a mouse click anywhere on the row opens it too.
  const open = await screen.findByRole('button', { name: /ambulanzprotokoll für patient 9 öffnen/i });
  expect(open.tagName).toBe('BUTTON');
  fireEvent.click(open);
  expect(navigateMock).toHaveBeenCalledTimes(1);
  expect(navigateMock).toHaveBeenCalledWith('/AmbulanzprotokollPage1/9');

  navigateMock.mockReset();
  const row = screen.getAllByRole('row').find((candidate) => candidate.contains(open))!;
  expect(within(row).getAllByRole('cell').length).toBeGreaterThan(5);
  fireEvent.click(within(row).getByText('Max'));
  expect(navigateMock).toHaveBeenCalledWith('/AmbulanzprotokollPage1/9');
});

it('a failed poll keeps the last picture with a note (final review M4)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    render(
      <MemoryRouter initialEntries={['/SituationRoomTable']}>
        <Routes>
          <Route path="/SituationRoomTable" element={<SituationRoomTable />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByRole('button', { name: /ambulanzprotokoll für patient 9 öffnen/i });
    vi.mocked(getPersons).mockRejectedValueOnce(Object.assign(new Error('offline'), { isAxiosError: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(await screen.findByText(/Letzter Stand wird angezeigt/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ambulanzprotokoll für patient 9 öffnen/i })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it('an empty scene still offers the teams panel (final review M4)', async () => {
  vi.mocked(getPersons).mockResolvedValueOnce({ data: [] } as never);
  render(
    <MemoryRouter initialEntries={['/SituationRoomTable']}>
      <Routes>
        <Route path="/SituationRoomTable" element={<SituationRoomTable />} />
      </Routes>
    </MemoryRouter>
  );
  expect(await screen.findByText('Keine Personen gefunden.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Teams' })).toBeInTheDocument();
});

it('renders invalid triage values explicitly', async () => {
  render(
    <MemoryRouter initialEntries={['/SituationRoomTable']}>
      <Routes>
        <Route path="/SituationRoomTable" element={<SituationRoomTable />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByText('Ungültig: orange')).toBeInTheDocument();
  expect(screen.getAllByText('1 Ungültig').length).toBeGreaterThan(0);
  expect(screen.getAllByText('1 Grün').length).toBeGreaterThan(0);
});
