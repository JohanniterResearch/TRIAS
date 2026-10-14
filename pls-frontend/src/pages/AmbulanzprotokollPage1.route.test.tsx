import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signIn } from '../test/session';
import AmbulanzprotokollPage1 from './AmbulanzprotokollPage1';
import { useWorkContextStore } from '../stores/workContextStore';

vi.mock('../features/ambulanzprotokoll-page1/page1Api', async () => {
  const { createPage1Template } = await import('../features/ambulanzprotokoll-page1/page1State');
  const record = () => ({ patientId: 123, status: 'draft', updatedAt: '1970-01-01T00:00:00.000Z', finalizedAt: null, formState: createPage1Template() });
  return {
    getPage1: vi.fn().mockImplementation(async () => record()),
    putPage1: vi.fn().mockImplementation(async () => record()),
  };
});

let drawImage: ReturnType<typeof vi.fn>;
let clearRect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  drawImage = vi.fn();
  clearRect = vi.fn();
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      clearRect,
      drawImage,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    }),
  });
  class FakeImage {
    onload: null | (() => void) = null;

    set src(_: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  window.localStorage.clear();
  signIn('qr', '1');
  useWorkContextStore.setState({ operationSceneId: 77, patientId: 123 });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
});

it('enters the page-1 route with the patient and operation scene context', async () => {
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/AmbulanzprotokollPage1/123',
          state: { operationSceneId: 77 },
        },
      ]}
    >
      <Routes>
        <Route path="/AmbulanzprotokollPage1/:patientId" element={<AmbulanzprotokollPage1 />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByText(/patientId: 123/)).toBeInTheDocument();
  expect(screen.getByText(/operationSceneId: 77/)).toBeInTheDocument();
});

it('replays a persisted signature after hydration', async () => {
  window.localStorage.setItem(
    'pls:ambulanz-v1:page1:patient:123@qr:1',
    JSON.stringify({
      owner: 'qr:1',
      patientId: 123,
      operationSceneId: 77,
      status: 'draft',
      updatedAt: '2026-01-02T10:00:00.000Z',
      finalizedAt: null,
      formState: {
        incident: { ambulanzort: '', datum: null, uhrzeit_beginn: null, dnr_san_1: '', dnr_san_2: '', dnr_san_3: '', dnr_na: '', pls_nummer: '', funkrufname: '' },
        patient: { familienname: '', vorname: '', geschlecht: null, vers_nr: '', geburtsdatum: null, adresse: '', staat: '', telefon: '', arbeitgeber: '', versicherungstraeger: '', familienstand: '' },
        assessment_primary: { naca: [], atemweg: [], atmung: [], kreislauf: [], bewusstsein: [], angen_notfallzeit: { zeit: null, gt24h: false, unbekannt: false } },
        assessment_secondary: { anamnese_text: '', bodymap: [] },
        medications_administered: [],
        vitals: { pupillen: { R: [], L: [] }, schmerz: null, schmerz_nicht_beurteilbar: false, gcs_augenoeffnen: null, gcs_verbale_reaktion: null, gcs_motorische_reaktion: null, gcs_summe: null, keine: false, rr: '', puls: '', puls_rhythmus: [], af: '', temp: '', bz: '', etco2: '', spo2: '', o2_l_min: '', o2_beatmung_l_min: '' },
        measures: {
          herz_kreislauf: { massnahmen: [], dnr: '', anzahl: '', letzte_joule: '', freq: '', mv: '' },
          atmung: { massnahmen: [], dnr: '', af: '', amv: '', peep: '' },
          weitere_massnahmen: { massnahmen: [], abbinden_zeit: null, lagerung_art: '' },
        },
        history: { allergien: '', medikamente: '', patientengeschichte_vorerkrankungen: '', letzte_orale_aufnahme: '', ereignisse_zuvor: '', risikofaktoren: '' },
        disposition: { abschlussart: [], klinischer_zustand: [], uhrzeit_ende: null, org: '', typ: '', kennung: '', angehoerige_in_kenntnis: [], kontaktdaten: '' },
        signatures: { entlass_san_na: 'data:image/png;base64,test-signature' },
      },
    })
  );

  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/AmbulanzprotokollPage1/123',
          state: { operationSceneId: 77 },
        },
      ]}
    >
      <Routes>
        <Route path="/AmbulanzprotokollPage1/:patientId" element={<AmbulanzprotokollPage1 />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(drawImage).toHaveBeenCalled());
});
