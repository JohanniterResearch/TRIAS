import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminPatientsPage from './AdminPatientsPage';

const api = {
  searchAdminPatients: vi.fn(),
  getAdminPatientDetails: vi.fn(),
  getAvailablePatientQrCodes: vi.fn(),
  getOperationScenes: vi.fn(),
  updateAdminPatient: vi.fn(),
  updateAdminPatientBodyParts: vi.fn(),
  assignAdminPatientQrCode: vi.fn(),
};
vi.mock('../api/endpoints', () =>
  Object.fromEntries(Object.keys({ searchAdminPatients: 0, getAdminPatientDetails: 0, getAvailablePatientQrCodes: 0, getOperationScenes: 0, updateAdminPatient: 0, updateAdminPatientBodyParts: 0, assignAdminPatientQrCode: 0 })
    .map((name) => [name, (...args: unknown[]) => (api as Record<string, (...a: unknown[]) => unknown>)[name](...args)])),
);

const patient = { editReference: 'ref-1', humanReadableId: 'M-0001', name: 'Muster', triagefarbe: 'gelb', atmung: true, blutung: false, operationSceneId: 1, protocolStatus: 'draft', createdAt: '', updatedAt: '' };
const body = Object.fromEntries(['bauch_vorne', 'becken_vorne', 'kopf_vorne', 'ferse_links_hinten'].map((key) => [key, 0]));

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.getOperationScenes.mockResolvedValue({ data: [{ id: 1, name: 'Demo' }] });
  api.searchAdminPatients.mockResolvedValue({ data: { total: 1, items: [patient] } });
  api.getAdminPatientDetails.mockResolvedValue({ data: { patient, bodyParts: body, protocol: {}, qrCodeBound: false, auditEntries: [] } });
  api.getAvailablePatientQrCodes.mockResolvedValue({ data: { total: 0, items: [] } });
});
afterEach(cleanup);

async function openPatient() {
  render(<MemoryRouter><AdminPatientsPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('ID, Nummer oder Name'), { target: { value: 'M-0001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Suchen' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Öffnen' }));
  await screen.findByRole('region', { name: 'Korrektur' });
}

it('requires a reason and sends only the corrected fields (WP 5.3)', async () => {
  api.updateAdminPatient.mockResolvedValue({ data: patient });
  await openPatient();
  fireEvent.change(screen.getByLabelText('Triagefarbe'), { target: { value: 'rot' } });
  expect(screen.getByRole('button', { name: 'Angaben korrigieren' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)'), { target: { value: 'Nachtriage' } });
  fireEvent.click(screen.getByRole('button', { name: 'Angaben korrigieren' }));

  await waitFor(() => expect(api.updateAdminPatient).toHaveBeenCalledWith('ref-1', { triagefarbe: 'rot', correctionReason: 'Nachtriage' }));
});

it('corrects body regions through the codec with every key sent (WP 5.3)', async () => {
  api.updateAdminPatientBodyParts.mockResolvedValue({ data: {} });
  await openPatient();
  fireEvent.change(screen.getByLabelText('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)'), { target: { value: 'Bauch vergessen' } });
  fireEvent.click(document.querySelector('#leiste_links_vorne')!);
  fireEvent.click(screen.getByRole('button', { name: 'Körperregionen korrigieren' }));

  await waitFor(() => expect(api.updateAdminPatientBodyParts).toHaveBeenCalledWith('ref-1', {
    bodyParts: { ...body, bauch_vorne: 1 },
    correctionReason: 'Bauch vergessen',
  }));
});

it('keeps a region marked in the field meanwhile: only the toggled regions are applied (security review 3, M3)', async () => {
  api.updateAdminPatientBodyParts.mockResolvedValue({ data: {} });
  await openPatient();
  // A responder marks the head after the admin opened the patient.
  api.getAdminPatientDetails.mockResolvedValue({ data: { patient, bodyParts: { ...body, kopf_vorne: 1 }, protocol: {}, qrCodeBound: false, auditEntries: [] } });
  fireEvent.change(screen.getByLabelText('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)'), { target: { value: 'Bauch vergessen' } });
  fireEvent.click(document.querySelector('#leiste_links_vorne')!);
  fireEvent.click(screen.getByRole('button', { name: 'Körperregionen korrigieren' }));

  await waitFor(() => expect(api.updateAdminPatientBodyParts).toHaveBeenCalledWith('ref-1', {
    bodyParts: { ...body, kopf_vorne: 1, bauch_vorne: 1 },
    correctionReason: 'Bauch vergessen',
  }));
});

it('does not overwrite a region changed meanwhile by someone else; it asks to check', async () => {
  await openPatient();
  api.getAdminPatientDetails.mockResolvedValue({ data: { patient, bodyParts: { ...body, bauch_vorne: 1 }, protocol: {}, qrCodeBound: false, auditEntries: [] } });
  fireEvent.change(screen.getByLabelText('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)'), { target: { value: 'Bauch vergessen' } });
  fireEvent.click(document.querySelector('#leiste_links_vorne')!);
  fireEvent.click(screen.getByRole('button', { name: 'Körperregionen korrigieren' }));

  expect(await screen.findByText(/Inzwischen anderweitig geändert: bauch_vorne/)).toBeInTheDocument();
  expect(api.updateAdminPatientBodyParts).not.toHaveBeenCalled();
});
