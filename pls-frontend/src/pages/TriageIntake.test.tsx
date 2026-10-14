import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanPatient from './ScanPatient';
import ClinicalFlagsPanel from '../components/ClinicalFlagsPanel';
import TriageHistoryPanel from '../components/TriageHistoryPanel';
import { useWorkContextStore } from '../stores/workContextStore';
import { clearOfflineQueueForTests, offlineQueue } from '../offline/offlineQueue';
import { signIn } from '../test/session';
import type { Patient } from '../api/endpoints';

const api = {
  createManualPatient: vi.fn(),
  reassignPatientQrCode: vi.fn(),
  verifyPatientQrCode: vi.fn(),
  getPersons: vi.fn(),
  updateTriageColor: vi.fn(),
  updateRespiration: vi.fn(),
  getTriageHistory: vi.fn(),
};

vi.mock('../api/endpoints', () => ({
  createManualPatient: (...a: unknown[]) => api.createManualPatient(...a),
  reassignPatientQrCode: (...a: unknown[]) => api.reassignPatientQrCode(...a),
  verifyPatientQrCode: (...a: unknown[]) => api.verifyPatientQrCode(...a),
  getPersons: (...a: unknown[]) => api.getPersons(...a),
  updateTriageColor: (...a: unknown[]) => api.updateTriageColor(...a),
  updateRespiration: (...a: unknown[]) => api.updateRespiration(...a),
  getTriageHistory: (...a: unknown[]) => api.getTriageHistory(...a),
}));

vi.mock('../stores/patientLocationStore', () => ({
  usePatientLocationStore: (selector: (state: { ensurePatientLocation: () => Promise<void> }) => unknown) =>
    selector({ ensurePatientLocation: async () => undefined }),
}));

let scan: ((text: string) => void) | undefined;
vi.mock('../hooks/useQrScanner', () => ({
  useQrScanner: ({ onSuccess }: { onSuccess: (text: string) => void }) => {
    scan = onSuccess;
    return { cameraBlocked: false, stopScanner: vi.fn(), scannerRef: { current: null } };
  },
}));

const patient = (extra: Partial<Patient> = {}): Patient => ({
  id: 41, operationSceneId: 7, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  atmung: true, blutung: false, radialispuls: null, transport: null, dringend: null, kontaminiert: null, qrCodeBound: true, ...extra,
});
const httpError = (status: number, message = '') => Object.assign(new Error(String(status)), { isAxiosError: true, response: { status, data: { message } } });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname} {JSON.stringify(location.state)}</p>;
}

beforeEach(async () => {
  await clearOfflineQueueForTests();
  for (const mock of Object.values(api)) mock.mockReset();
  window.localStorage.clear();
  signIn('qr', '1');
  useWorkContextStore.setState({ operationSceneId: 7, patientId: null, patientLabel: null });
});

afterEach(cleanup);

describe('WP 3.1 patient without QR', () => {
  const renderScan = () =>
    render(
      <MemoryRouter initialEntries={['/ScanPatient']}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

  it('opens the created patient with its number', async () => {
    api.createManualPatient.mockResolvedValueOnce({ data: patient({ humanReadableId: 'M-0003', qrCodeBound: false }) });
    renderScan();
    fireEvent.click(screen.getByRole('button', { name: 'Patient ohne QR' }));
    await screen.findByTestId('where');

    expect(api.createManualPatient.mock.calls[0][0].clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(useWorkContextStore.getState()).toMatchObject({ patientId: 41, patientLabel: 'M-0003' });
  });

  it('offline (or a lost answer): a local patient with the same client id, sent later by the queue (WP 6.4)', async () => {
    api.createManualPatient.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true }));
    renderScan();
    fireEvent.click(screen.getByRole('button', { name: 'Patient ohne QR' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/TriagePage1');

    const { patientId, patientLabel } = useWorkContextStore.getState();
    expect(patientId).toBeLessThan(0);
    expect(patientLabel).toMatch(/^Lokal-\d{6}$/);
    const [queued] = (await offlineQueue.pendingFor(patientId!)) as Array<{ body: { clientGeneratedId: string } }>;
    expect(queued.body.clientGeneratedId).toBe(api.createManualPatient.mock.calls[0][0].clientGeneratedId);
  });

  it('a gateway error (proxy up, backend down) also creates the local patient with the same id (review 4, M5)', async () => {
    api.createManualPatient.mockRejectedValueOnce(httpError(502));
    renderScan();
    fireEvent.click(screen.getByRole('button', { name: 'Patient ohne QR' }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/TriagePage1');
    const { patientId } = useWorkContextStore.getState();
    const [queued] = (await offlineQueue.pendingFor(patientId!)) as Array<{ body: { clientGeneratedId: string } }>;
    expect(queued.body.clientGeneratedId).toBe(api.createManualPatient.mock.calls[0][0].clientGeneratedId);
  });

  it('a server refusal is shown and nothing is queued', async () => {
    api.createManualPatient.mockRejectedValueOnce(httpError(403, 'Kein Zugriff.'));
    renderScan();
    fireEvent.click(screen.getByRole('button', { name: 'Patient ohne QR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kein Zugriff.');
    expect(offlineQueue.getStatus().pendingCount).toBe(0);
  });
});

describe('WP 3.2 reassign QR', () => {
  const renderReassign = () =>
    render(
      <MemoryRouter initialEntries={[{ pathname: '/ScanPatient', state: { reassignReturnTo: '/TriagePage3', triageResult: 'gelb' } }]}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

  it('binds the scanned code to the current patient and returns to the result', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.reassignPatientQrCode.mockResolvedValue({ data: patient() });
    renderReassign();
    expect(screen.getByRole('heading')).toHaveTextContent('Neuen QR-Code für Patient:In 41 scannen');
    expect(screen.queryByRole('button', { name: 'Patient ohne QR' })).not.toBeInTheDocument();

    scan!('new-tag');

    expect(await screen.findByTestId('where')).toHaveTextContent('/TriagePage3 {"qrReassigned":true,"triageResult":"gelb"}');
    expect(api.reassignPatientQrCode).toHaveBeenCalledWith(41, 'new-tag');
    expect(api.verifyPatientQrCode).not.toHaveBeenCalled();
  });

  it('Back after a reassign does not re-enter reassign mode (security review 3, L5)', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.reassignPatientQrCode.mockResolvedValue({ data: patient() });
    function Back() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(-1)}>Zurück</button>;
    }
    render(
      <MemoryRouter initialEntries={['/TriagePage2', { pathname: '/ScanPatient', state: { reassignReturnTo: '/TriagePage3' } }]} initialIndex={1}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
          <Route path="*" element={<><Where /><Back /></>} />
        </Routes>
      </MemoryRouter>,
    );
    scan!('new-tag');
    fireEvent.click(await screen.findByRole('button', { name: 'Zurück' }));

    expect(await screen.findByTestId('where')).toHaveTextContent('/TriagePage2');
  });

  it('shows the server conflict for a code bound to another patient', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.reassignPatientQrCode.mockRejectedValue(httpError(409, 'QR code is already bound to another patient.'));
    renderReassign();
    scan!('used-tag');

    expect(await screen.findByRole('alert')).toHaveTextContent('QR code is already bound to another patient.');
  });
});

describe('WP 3.3 clinical flags', () => {
  it('pre-fills Atmung and Blutung from the wizard and writes one flag per change', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.getPersons.mockResolvedValue({ data: [patient()] });
    api.updateTriageColor.mockResolvedValue({ data: {} });
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('Atmung suffizient')).toBeChecked();
    expect(screen.getByLabelText('Blutung stillbar')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Transport'));

    await waitFor(() => expect(screen.getByLabelText('Transport')).toBeChecked());
    expect(api.updateTriageColor).toHaveBeenCalledTimes(1);
    expect(api.updateTriageColor.mock.calls[0][1]).toEqual({ transport: true, clientUpdatedAt: expect.any(String) });
  });

  it('a flag still queued on this device wins over the server value (final review L4)', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.getPersons.mockResolvedValue({ data: [patient({ kontaminiert: false })] });
    await offlineQueue.queueTriage(41, { kontaminiert: true, clientUpdatedAt: '2026-01-01T00:00:00Z' } as never);
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Kontaminiert')).toBeChecked();
    expect(screen.getByLabelText('Atmung suffizient')).toBeChecked(); // server value, nothing queued
  });

  it('keeps the box unchanged when the write fails', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.getPersons.mockResolvedValue({ data: [patient()] });
    api.updateTriageColor.mockRejectedValue(httpError(400, 'Ungültig.'));
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText('Dringend'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ungültig.');
    expect(screen.getByLabelText('Dringend')).not.toBeChecked();
  });

  it('offers to bind a QR code to a manual patient', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.getPersons.mockResolvedValue({ data: [patient({ qrCodeBound: false })] });
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'QR-Code zuordnen' })).toBeInTheDocument();
  });

  it('a patient only on this device: queued answers pre-filled, no server read, no QR binding (WP 6.4)', async () => {
    const local = await offlineQueue.createProvisionalPatient({ operationSceneId: 7 } as never);
    await offlineQueue.queueTriage(local.id, { triageColor: 'gelb', respiration: true, clientUpdatedAt: '2026-01-01T00:00:00Z' } as never);
    useWorkContextStore.setState({ patientId: local.id });
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('checkbox', { name: 'Atmung suffizient' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Blutung stillbar' })).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Offline');
    expect(api.getPersons).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /QR-Code/ })).not.toBeInTheDocument();
  });

  it('says so when the patient is no longer in the scene (security review 3, L7)', async () => {
    useWorkContextStore.setState({ patientId: 41 });
    api.getPersons.mockResolvedValue({ data: [patient({ id: 99 })] });
    render(
      <MemoryRouter>
        <ClinicalFlagsPanel triageResult="gelb" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('nicht (mehr) diesem Einsatzort zugeordnet');
  });
});

describe('WP 3.5 triage history', () => {
  it('lists the audited changes of the chosen patient', async () => {
    api.getTriageHistory.mockResolvedValue({
      data: [{ timestamp: '2026-10-09T10:00:00Z', actorId: 3, actorRole: 'qr', field: 'triagefarbe', before: null, after: 'gelb' }],
    });
    render(<TriageHistoryPanel persons={[patient({ humanReadableId: 'M-0003' })]} />);
    fireEvent.change(screen.getByLabelText('Triage-Verlauf für Patient:In'), { target: { value: '41' } });

    const table = await screen.findByRole('table', { name: 'Triage-Verlauf Patient 41' });
    expect(table).toHaveTextContent('Triagefarbe');
    expect(table).toHaveTextContent('gelb');
    expect(table).toHaveTextContent('QR-Zugang #3');
    expect(screen.getByRole('option', { name: '41 (M-0003)' })).toBeInTheDocument();
  });
});
