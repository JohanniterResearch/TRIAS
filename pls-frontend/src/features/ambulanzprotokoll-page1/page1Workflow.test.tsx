import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAmbulanzprotokollPage1Workflow } from './page1Workflow';
import { markPage1DraftSynced } from './page1Storage';
import type { Page1PersistedRecord } from './page1State';
import { signIn } from '../../test/session';
import { clearOfflineQueueForTests, offlineQueue } from '../../offline/offlineQueue';

const getPage1Mock = vi.fn();
const putPage1Mock = vi.fn();

vi.mock('./page1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./page1Api')>()),
  getPage1: (...args: unknown[]) => getPage1Mock(...args),
  putPage1: (...args: unknown[]) => putPage1Mock(...args),
}));

function buildRecord(overrides: Partial<Page1PersistedRecord>): Page1PersistedRecord {
  return {
    patientId: 7,
    operationSceneId: 11,
    status: 'draft',
    updatedAt: '2026-01-01T10:00:00.000Z',
    finalizedAt: null,
    formState: {
      incident: {
        ambulanzort: '',
        datum: null,
        uhrzeit_beginn: null,
        dnr_san_1: '',
        dnr_san_2: '',
        dnr_san_3: '',
        dnr_na: '',
        pls_nummer: '',
        funkrufname: '',
      },
      patient: {
        familienname: '',
        vorname: '',
        geschlecht: null,
        vers_nr: '',
        geburtsdatum: null,
        adresse: '',
        staat: '',
        telefon: '',
        arbeitgeber: '',
        versicherungstraeger: '',
        familienstand: '',
      },
      assessment_primary: {
        naca: [],
        atemweg: [],
        atmung: [],
        kreislauf: [],
        bewusstsein: [],
        angen_notfallzeit: { zeit: null, gt24h: false, unbekannt: false },
      },
      assessment_secondary: {
        anamnese_text: '',
        bodymap: [],
      },
      medications_administered: [],
      vitals: {
        pupillen: { R: [], L: [] },
        schmerz: null,
        schmerz_nicht_beurteilbar: false,
        gcs_augenoeffnen: null,
        gcs_verbale_reaktion: null,
        gcs_motorische_reaktion: null,
        gcs_summe: null,
        keine: false,
        rr: '',
        puls: '',
        puls_rhythmus: [],
        af: '',
        temp: '',
        bz: '',
        etco2: '',
        spo2: '',
        o2_l_min: '',
        o2_beatmung_l_min: '',
      },
      measures: {
        herz_kreislauf: { massnahmen: [], dnr: '', anzahl: '', letzte_joule: '', freq: '', mv: '' },
        atmung: { massnahmen: [], dnr: '', af: '', amv: '', peep: '' },
        weitere_massnahmen: { massnahmen: [], abbinden_zeit: null, lagerung_art: '' },
      },
      history: {
        allergien: '',
        medikamente: '',
        patientengeschichte_vorerkrankungen: '',
        letzte_orale_aufnahme: '',
        ereignisse_zuvor: '',
        risikofaktoren: '',
      },
      disposition: {
        abschlussart: [],
        klinischer_zustand: [],
        uhrzeit_ende: null,
        org: '',
        typ: '',
        kennung: '',
        angehoerige_in_kenntnis: [],
        kontaktdaten: '',
      },
      signatures: { entlass_san_na: null },
    },
    ...overrides,
  };
}

let owner = '';

beforeEach(async () => {
  // A hook unmounted by the previous test's cleanup queues its last change asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearOfflineQueueForTests();
  vi.useRealTimers();
  window.localStorage.clear();
  owner = signIn('qr', '1');
  getPage1Mock.mockReset();
  putPage1Mock.mockReset();
});

afterEach(() => {
  // No automatic cleanup in this setup: a hook left mounted would keep autosaving into the next test.
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('restores the newer local draft and autosaves updates', async () => {
  const localRecord = buildRecord({
    updatedAt: '2026-01-02T10:00:00.000Z',
    formState: { ...buildRecord({}).formState, incident: { ...buildRecord({}).formState.incident, ambulanzort: 'Lokal' } },
  });
  window.localStorage.setItem(`pls:ambulanz-v1:page1:patient:7@${owner}`, JSON.stringify({ ...localRecord, owner }));
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '2026-01-01T10:00:00.000Z' }));
  putPage1Mock.mockResolvedValueOnce(localRecord).mockResolvedValue(buildRecord({
      updatedAt: '2026-01-03T10:00:00.000Z',
      formState: {
        ...buildRecord({}).formState,
        incident: { ...buildRecord({}).formState.incident, ambulanzort: 'Neu' },
      },
    }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.form.getValues().incident.ambulanzort).toBe('Lokal');
  // The newer local draft is handed over at once, stamped with the time it was made, not now
  // (final review H1), and only with what differs from the server.
  await waitFor(() => expect(putPage1Mock).toHaveBeenCalledTimes(1));
  expect(putPage1Mock.mock.calls[0][1]).toMatchObject({ status: 'draft', clientUpdatedAt: '2026-01-02T10:00:00.000Z' });
  expect(putPage1Mock.mock.calls[0][1].baseFormState.incident.ambulanzort).not.toBe('Lokal');
  putPage1Mock.mockClear();

  vi.useFakeTimers();
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Neu');
  });
  act(() => {
    vi.advanceTimersByTime(900);
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(putPage1Mock).toHaveBeenCalled();
  expect(putPage1Mock.mock.calls[0][1]).toEqual(
    expect.objectContaining({
      status: 'draft',
      formState: expect.objectContaining({
        incident: expect.objectContaining({
          ambulanzort: 'Neu',
        }),
      }),
    })
  );
  expect(putPage1Mock.mock.calls[0][1]).not.toHaveProperty('updatedAt');
  expect(putPage1Mock.mock.calls[0][1]).not.toHaveProperty('finalizedAt');
  expect(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`)).toContain('"Neu"');
});

it('hydrates the default server record when updatedAt is null', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: null }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(result.current.source).toBe('server');
  expect(result.current.lastSavedAt).toBeNull();
  expect(result.current.form.getValues().incident.ambulanzort).toBe('');
});

it('finalizes and clears the local draft', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));
  putPage1Mock.mockResolvedValue(buildRecord({
      status: 'finalized',
      finalizedAt: '2026-01-02T12:00:00.000Z',
      updatedAt: '2026-01-02T12:00:00.000Z',
    }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await result.current.finalize();
  });

  expect(putPage1Mock).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'finalized' }));
  expect(putPage1Mock.mock.calls[0][1]).not.toHaveProperty('updatedAt');
  expect(putPage1Mock.mock.calls[0][1]).not.toHaveProperty('finalizedAt');
  expect(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`)).toBeNull();
});

it('shows validation warnings without blocking finalization', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));
  putPage1Mock.mockResolvedValue(buildRecord({ status: 'finalized', finalizedAt: '2026-01-02T12:00:00.000Z' }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  act(() => {
    result.current.form.setValue('medications_administered', [
      { medikament: 'A', dosis: '1', art: 'iv', uhrzeit: '25:99' },
    ]);
  });
  await act(async () => {
    await result.current.finalize();
  });

  expect(result.current.status).toBe('finalized');
  expect(result.current.validationWarnings).toEqual([
    'medications_administered.0.uhrzeit: Expected HH:mm or null',
  ]);
});

it('autosaves a programmatically captured signature', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));
  putPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));
  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  vi.useFakeTimers();
  act(() => {
    result.current.setSignature('data:image/png;base64,c2lnbmF0dXJl');
  });
  act(() => {
    vi.advanceTimersByTime(900);
  });
  await act(async () => {
    await Promise.resolve();
  });

  expect(putPage1Mock.mock.calls[0][1].formState.signatures.entlass_san_na)
    .toBe('data:image/png;base64,c2lnbmF0dXJl');
});

it('queues a finalization the server could not receive and keeps it shown as finalized (WP 6.3)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));
  putPage1Mock.mockRejectedValueOnce(Object.assign(new Error('offline'), { isAxiosError: true }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  await act(async () => {
    await result.current.finalize();
  });

  const locallySaved = JSON.parse(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`) ?? 'null');
  expect(locallySaved).toMatchObject({ status: 'finalized', synced: true });
  expect(result.current.status).toBe('finalized');
  expect(result.current.syncState).toBe('saved-local');
  // The queue owns the retry now (sent on reconnect, every 30 s and at start).
  const queued = await offlineQueue.pendingProtocol(7);
  expect(queued?.body).toMatchObject({ status: 'finalized' });
  expect(queued?.body).not.toHaveProperty('finalizedAt');
});

it('a server refusal of the finalization keeps the protocol a draft', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  putPage1Mock.mockRejectedValueOnce(Object.assign(new Error('bad'), { isAxiosError: true, response: { status: 400, data: { message: 'invalid' } } }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  await act(async () => {
    await result.current.finalize();
  });

  expect(result.current.status).toBe('draft');
  expect(result.current.syncState).toBe('error');
  expect(await offlineQueue.pendingProtocol(7)).toBeNull();
});

it('normalizes medication rows from hydrated data to the canonical 8-row shape', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({
      formState: {
        ...buildRecord({}).formState,
        medications_administered: [
          { medikament: 'A', dosis: '1', art: 'iv', uhrzeit: '08:00', extra: 'x' } as never,
          { medikament: 'B', dosis: '2', art: 'po', uhrzeit: '' } as never,
          ...Array.from({ length: 8 }, (_, index) => ({
            medikament: `X${index}`,
            dosis: `${index}`,
            art: 'x',
            uhrzeit: null,
          })),
        ],
      },
    }));
  putPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '1970-01-01T00:00:00.000Z' }));

  const { result } = renderHook(() =>
    useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 })
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const meds = result.current.form.getValues().medications_administered;
  expect(meds).toHaveLength(8);
  expect(meds[0]).toEqual({ medikament: 'A', dosis: '1', art: 'iv', uhrzeit: '08:00' });
  expect(meds[1]).toEqual({ medikament: 'B', dosis: '2', art: 'po', uhrzeit: null });
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

it('never autosaves a finalized protocol (corrections are explicit)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ status: 'finalized', finalizedAt: '2026-01-02T12:00:00.000Z' }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await settle();
  expect(result.current.status).toBe('finalized');

  vi.useFakeTimers();
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Geändert');
  });
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(putPage1Mock).not.toHaveBeenCalled();
});

it('does not PUT an unchanged server record after loading', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await settle();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(putPage1Mock).not.toHaveBeenCalled();
});

it('shows a codec error and keeps the local draft instead of dropping values', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  const { ProtocolCodecError } = await import('./ambulanzValueMap');
  putPage1Mock.mockRejectedValue(new ProtocolCodecError([{ field: 'assessment_primary.atmung', value: 'unbekannt' }]));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await settle();

  vi.useFakeTimers();
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Lokal');
  });
  act(() => {
    vi.advanceTimersByTime(900);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(result.current.errorMessage).toContain('assessment_primary.atmung');
  expect(result.current.syncState).toBe('error');
  expect(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`)).toContain('"Lokal"');
});

it('keeps the protocol a draft when the server refuses finalization', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  putPage1Mock.mockRejectedValue({ response: { status: 400, data: { status: 'error', message: 'formState must conform to ambulanzprotokoll-page1.schema.json.' } } });
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await settle();
  await act(async () => {
    await result.current.finalize();
  });
  expect(result.current.status).toBe('draft');
  expect(result.current.errorMessage).toBe('formState must conform to ambulanzprotokoll-page1.schema.json.');
});

it('shows the server finalize warnings next to the client checks', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  putPage1Mock.mockResolvedValue({ ...buildRecord({ status: 'finalized', finalizedAt: '2026-01-02T12:00:00.000Z' }), warnings: ['Patient name is empty.'] });
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await settle();
  await act(async () => {
    await result.current.finalize();
  });
  expect(result.current.validationWarnings).toEqual(['Patient name is empty.']);
});

it('never shows a draft another account left on the device (review M3)', async () => {
  const foreign = buildRecord({
    updatedAt: '2026-01-02T10:00:00.000Z',
    formState: { ...buildRecord({}).formState, incident: { ...buildRecord({}).formState.incident, ambulanzort: 'Fremd' } },
  });
  window.localStorage.setItem('pls:ambulanz-v1:page1:patient:7@user:99', JSON.stringify({ ...foreign, owner: 'user:99' }));
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '2026-01-01T10:00:00.000Z' }));

  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.syncState).not.toBe('loading'));

  expect(result.current.form.getValues().incident.ambulanzort).toBe('');
  expect(result.current.source).toBe('server');
});

it('shows no local copy when the server refuses access (review M3)', async () => {
  const local = buildRecord({
    formState: { ...buildRecord({}).formState, incident: { ...buildRecord({}).formState.incident, ambulanzort: 'Lokal' } },
  });
  window.localStorage.setItem(`pls:ambulanz-v1:page1:patient:7@${owner}`, JSON.stringify({ ...local, owner }));
  getPage1Mock.mockRejectedValue(Object.assign(new Error('forbidden'), { isAxiosError: true, response: { status: 403, data: {} } }));

  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.syncState).toBe('error'));

  expect(result.current.isHydrated).toBe(false);
  expect(result.current.form.getValues().incident.ambulanzort).toBe('');
  expect(putPage1Mock).not.toHaveBeenCalled();
});

it('drops a late save response once another account signed in (review 2, finding 1)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  let resolvePut: (value: unknown) => void = () => undefined;
  putPage1Mock.mockImplementation(() => new Promise((resolve) => { resolvePut = resolve; }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  vi.useFakeTimers();
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Von A');
  });
  act(() => {
    vi.advanceTimersByTime(900);
  });
  vi.useRealTimers();
  await vi.waitFor(() => expect(putPage1Mock).toHaveBeenCalledTimes(1));

  signIn('user', '2'); // the next person on this device
  await act(async () => {
    resolvePut(buildRecord({ updatedAt: '2026-01-05T10:00:00.000Z' }));
    await Promise.resolve();
  });

  const stored = JSON.parse(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`) ?? 'null');
  expect(stored.owner).toBe('qr:1');
  expect(stored.synced).toBe(false);
});

it('takes the server-computed GCS sum into the form, with no extra save (WP 4.2)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  const serverState = buildRecord({}).formState;
  putPage1Mock.mockResolvedValue({
    ...buildRecord({ updatedAt: '2026-01-05T10:00:00.000Z' }),
    formState: { ...serverState, vitals: { ...serverState.vitals, gcs_augenoeffnen: 4, gcs_verbale_reaktion: 5, gcs_motorische_reaktion: 6, gcs_summe: 15 } },
  });
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  act(() => {
    result.current.form.setValue('vitals.gcs_augenoeffnen', 4);
    result.current.form.setValue('vitals.gcs_verbale_reaktion', 5);
    result.current.form.setValue('vitals.gcs_motorische_reaktion', 6);
  });
  await vi.waitFor(() => expect(result.current.form.getValues('vitals.gcs_summe')).toBe(15), { timeout: 3000 });
  // Longer than the autosave debounce: taking the server value must not trigger another save.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  });

  expect(putPage1Mock).toHaveBeenCalledTimes(1);
});

it('saves a correction of a finalized protocol with its reason (WP 4.3)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ status: 'finalized', finalizedAt: '2026-01-01T10:00:00.000Z' }));
  putPage1Mock.mockImplementation(async (_id: number, payload: { formState: Page1PersistedRecord['formState'] }) => ({
    ...buildRecord({ status: 'finalized', updatedAt: '2026-01-06T10:00:00.000Z' }),
    formState: payload.formState,
    warnings: [],
  }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.status).toBe('finalized'));

  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Korrigiert');
  });
  let ok = false;
  await act(async () => {
    ok = await result.current.saveCorrection('Ort falsch erfasst');
  });

  expect(ok).toBe(true);
  expect(putPage1Mock).toHaveBeenCalledTimes(1);
  expect(putPage1Mock.mock.calls[0][1]).toMatchObject({
    status: 'finalized',
    correctionReason: 'Ort falsch erfasst',
    formState: expect.objectContaining({ incident: expect.objectContaining({ ambulanzort: 'Korrigiert' }) }),
    // The loaded version goes along, so only the changed leaves are sent (security review 3, M2).
    baseFormState: expect.objectContaining({ incident: expect.objectContaining({ ambulanzort: buildRecord({}).formState.incident.ambulanzort }) }),
  });
});

it('a correction without a change is not sent', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ status: 'finalized', finalizedAt: '2026-01-01T10:00:00.000Z' }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.status).toBe('finalized'));
  let ok = true;
  await act(async () => {
    ok = await result.current.saveCorrection('nichts');
  });
  expect(ok).toBe(false);
  expect(putPage1Mock).not.toHaveBeenCalled();
  expect(result.current.errorMessage).toBe('Keine Änderung zum Speichern.');
});

it('a cleared field the server keeps is shown again, with a warning (security review 3, M1)', async () => {
  const finalized = buildRecord({ status: 'finalized', finalizedAt: '2026-01-01T10:00:00.000Z' });
  finalized.formState.incident.ambulanzort = 'Bühne Nord';
  getPage1Mock.mockResolvedValue(finalized);
  // The server merge never lets an empty value replace a recorded one.
  putPage1Mock.mockResolvedValue({ ...finalized, updatedAt: '2026-01-06T10:00:00.000Z', warnings: [] });
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.status).toBe('finalized'));

  act(() => {
    result.current.form.setValue('incident.ambulanzort', '');
  });
  await act(async () => {
    await result.current.saveCorrection('falsch erfasst');
  });

  expect(result.current.form.getValues('incident.ambulanzort')).toBe('Bühne Nord');
  expect(result.current.validationWarnings).toEqual([expect.stringContaining('incident.ambulanzort')]);
});

it('a provisional patient opens without the server and queues its saves (WP 6.4)', async () => {
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: -1700000000000, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));
  expect(getPage1Mock).not.toHaveBeenCalled();

  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Zelt 4');
  });
  await vi.waitFor(async () => expect(await offlineQueue.pendingProtocol(-1700000000000)).not.toBeNull(), { timeout: 3000 });
  expect(putPage1Mock).not.toHaveBeenCalled();
  // The item is stored just before the page reports it.
  await vi.waitFor(() => expect(result.current.syncState).toBe('saved-local'));
});

it('leaving during the typing pause queues the last change instead of dropping it', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  const { result, unmount } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Letzte Eingabe');
  });
  unmount();

  await vi.waitFor(async () => {
    const queued = await offlineQueue.pendingProtocol(7);
    expect(JSON.stringify(queued?.body)).toContain('Letzte Eingabe');
  });
  expect(putPage1Mock).not.toHaveBeenCalled();
});

it('opens with a queued save when its cached copy is gone (after logout and sign-in)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({ updatedAt: '2026-01-01T10:00:00.000Z' }));
  const { result: first, unmount } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(first.current.isHydrated).toBe(true));
  act(() => {
    first.current.form.setValue('incident.ambulanzort', 'Ungesendet');
  });
  unmount();
  await vi.waitFor(async () => expect(await offlineQueue.pendingProtocol(7)).not.toBeNull());
  window.localStorage.removeItem(`pls:ambulanz-v1:page1:patient:7@${owner}`); // purged at logout

  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));
  expect(result.current.form.getValues().incident.ambulanzort).toBe('Ungesendet');
  expect(result.current.source).toBe('local');
});

it('typing during a save in flight: the answer does not replace the newer cached draft (review 4, M4)', async () => {
  getPage1Mock.mockResolvedValue(buildRecord({}));
  let resolvePut: (value: unknown) => void = () => undefined;
  putPage1Mock.mockImplementation(() => new Promise((resolve) => { resolvePut = resolve; }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Erste');
  });
  await vi.waitFor(() => expect(putPage1Mock).toHaveBeenCalledTimes(1), { timeout: 3000 });
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Zweite');
  });
  await act(async () => {
    resolvePut(buildRecord({ updatedAt: '2026-01-05T10:00:00.000Z' }));
    await Promise.resolve();
  });

  const stored = JSON.parse(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`) ?? 'null');
  expect(stored.formState.incident.ambulanzort).toBe('Zweite');
  expect(stored.synced).toBe(false);
});

it('marks only the handed-over version of a draft as synced (review 4, M4)', async () => {
  const record = { ...buildRecord({ updatedAt: '2026-01-02T10:00:00.000Z' }) };
  window.localStorage.setItem(`pls:ambulanz-v1:page1:patient:7@${owner}`, JSON.stringify({ ...record, updatedAt: '2026-01-02T10:00:05.000Z', owner, synced: false }));
  markPage1DraftSynced(7, owner, record.updatedAt);
  expect(JSON.parse(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`)!).synced).toBe(false);
  markPage1DraftSynced(7, owner, '2026-01-02T10:00:05.000Z');
  expect(JSON.parse(window.localStorage.getItem(`pls:ambulanz-v1:page1:patient:7@${owner}`)!).synced).toBe(true);
});

it('opening offline queues nothing; an edit then queues only the changed field (final review H1, M1)', async () => {
  getPage1Mock.mockRejectedValue(Object.assign(new Error('offline'), { isAxiosError: true }));
  putPage1Mock.mockRejectedValue(Object.assign(new Error('offline'), { isAxiosError: true }));
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 1200)); // past the typing pause
  expect(putPage1Mock).not.toHaveBeenCalled();
  expect(await offlineQueue.pendingProtocol(7)).toBeNull();
  act(() => {
    result.current.form.setValue('incident.ambulanzort', 'Zelt 9');
  });
  await vi.waitFor(async () => expect(await offlineQueue.pendingProtocol(7)).not.toBeNull(), { timeout: 3000 });
  const queued = await offlineQueue.pendingProtocol(7);
  expect(queued?.body.formState).toEqual({ incident: { ambulanzort: 'Zelt 9' } });
});

it('a finalization shows what the server holds and names a cleared field it kept (final review M2)', async () => {
  const held = buildRecord({ updatedAt: '2026-01-01T10:00:00.000Z', formState: { ...buildRecord({}).formState, incident: { ...buildRecord({}).formState.incident, ambulanzort: 'Zelt 1' } } });
  getPage1Mock.mockResolvedValue(held);
  putPage1Mock.mockResolvedValue({ ...held, status: 'finalized', finalizedAt: '2026-01-02T12:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z' });
  const { result } = renderHook(() => useAmbulanzprotokollPage1Workflow({ patientId: 7, operationSceneId: 11 }));
  await vi.waitFor(() => expect(result.current.isHydrated).toBe(true));

  act(() => {
    result.current.form.setValue('incident.ambulanzort', '');
  });
  await act(async () => {
    await result.current.finalize();
  });
  expect(result.current.form.getValues().incident.ambulanzort).toBe('Zelt 1');
  expect(result.current.validationWarnings.join(' ')).toMatch(/incident\.ambulanzort/);
});
