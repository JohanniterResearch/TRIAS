import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScanPatient from './ScanPatient';
import { useWorkContextStore } from '../stores/workContextStore';

const navigateMock = vi.fn();
const stopScannerMock = vi.fn();
const verifyPatientQrCodeMock = vi.fn();
const ensurePatientLocationMock = vi.fn().mockResolvedValue(undefined);
let scannerSuccessHandler: ((decodedText: string) => void) | undefined;

vi.mock('../api/endpoints', () => ({
  verifyPatientQrCode: (...args: unknown[]) => verifyPatientQrCodeMock(...args),
}));

vi.mock('../stores/patientLocationStore', () => ({
  usePatientLocationStore: (selector: (state: { ensurePatientLocation: typeof ensurePatientLocationMock }) => unknown) =>
    selector({ ensurePatientLocation: ensurePatientLocationMock }),
}));

vi.mock('../hooks/useQrScanner', () => ({
  useQrScanner: ({ onSuccess }: { onSuccess: (decodedText: string) => void }) => {
    scannerSuccessHandler = onSuccess;
    return {
      cameraBlocked: false,
      stopScanner: stopScannerMock,
      scannerRef: { current: null },
    };
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('ScanPatient', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    navigateMock.mockReset();
    stopScannerMock.mockReset();
    verifyPatientQrCodeMock.mockReset();
    ensurePatientLocationMock.mockReset();
    scannerSuccessHandler = undefined;
    verifyPatientQrCodeMock.mockResolvedValue({ data: { patient: { id: 42 }, created: true } });
    useWorkContextStore.setState({ operationSceneId: 55, patientId: null });
  });

  it('starts patient geolocation before navigating to triage page 1', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/ScanPatient', state: { operationSceneId: 55 } }]}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
        </Routes>
      </MemoryRouter>
    );

    await scannerSuccessHandler?.('qr-code-123');
    await Promise.resolve();

    expect(verifyPatientQrCodeMock).toHaveBeenCalledWith('qr-code-123', 55);
    expect(ensurePatientLocationMock).toHaveBeenCalledWith(42);
    expect(stopScannerMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/TriagePage1');
    expect(useWorkContextStore.getState().patientId).toBe(42);
    expect(ensurePatientLocationMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0]
    );
  });

  it('shows an error instead of verifying when the operation scene is missing', async () => {
    useWorkContextStore.setState({ operationSceneId: null });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/ScanPatient' }]}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
        </Routes>
      </MemoryRouter>
    );

    await scannerSuccessHandler?.('qr-code-123');

    expect(verifyPatientQrCodeMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Bitte zuerst einen Einsatzort in der Rollenauswahl auswählen.')).toBeInTheDocument();
  });

  it('shows a clear message when the patient QR code is unknown', async () => {
    verifyPatientQrCodeMock.mockRejectedValue({
      response: {
        status: 404,
        data: { message: 'Ungültiger QR-Code' },
      },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/ScanPatient', state: { operationSceneId: 55 } }]}>
        <Routes>
          <Route path="/ScanPatient" element={<ScanPatient />} />
        </Routes>
      </MemoryRouter>
    );

    await scannerSuccessHandler?.('qr-code-123');

    expect(await screen.findByRole('alert')).toHaveTextContent('Ungültiger Patienten QR-Code.');
  });
});
