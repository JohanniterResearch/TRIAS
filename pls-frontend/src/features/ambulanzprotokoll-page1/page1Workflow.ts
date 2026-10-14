import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { BodyMapMarker, Page1PersistedRecord, Page1RecordStatus, Page1State } from './page1State';
import {
  comparePage1UpdatedAt,
  clearPage1Draft,
  currentDraftOwner,
  readPage1Draft,
  writePage1Draft,
} from './page1Storage';
import { getPage1, page1FromServer, putPage1, type Page1ServerRecord } from './page1Api';
import { queuePage1 } from './page1Queue';
import { isProvisional, offlineQueue, onProtocolSaved, sendOrQueue } from '../../offline/offlineQueue';
import { changedLeaves, isEmptyLeaf, leafAt, leafPaths } from './formStateDiff';
import { httpStatus } from '../../api/client';
import { ProtocolCodecError } from './ambulanzValueMap';
import { apiErrorMessage, isUnavailable } from '../../api/client';
import { createPage1Template, normalizePage1State, page1FinalizeSchema, serializePage1State } from './page1State';

export type Page1SyncState = 'loading' | 'ready' | 'saving' | 'saved-local' | 'saved-server' | 'finalized' | 'error';

export interface UsePage1WorkflowArgs {
  patientId: number;
  operationSceneId: number | null;
}

/** Message for a failed save; transport failures stay pending for a retry instead. */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ProtocolCodecError) return error.message;
  return apiErrorMessage(error, 'Speichern auf dem Server fehlgeschlagen. Der Entwurf bleibt lokal gespeichert.');
}

export function useAmbulanzprotokollPage1Workflow({ patientId, operationSceneId }: UsePage1WorkflowArgs) {
  const form = useForm<Page1State>({
    defaultValues: createPage1Template(),
    mode: 'onChange',
  });
  const { getValues, reset, setValue, watch } = form;
  const [syncState, setSyncState] = useState<Page1SyncState>('loading');
  const [status, setStatus] = useState<Page1RecordStatus>('draft');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [source, setSource] = useState<'local' | 'server' | 'empty'>('empty');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<Page1PersistedRecord | null>(null);
  const [watchedState, setWatchedState] = useState<Page1State>(() => getValues());
  const saveTimerRef = useRef<number | null>(null);
  // The latest change not yet handed to the server or the queue (sent on unmount, never dropped).
  const unsentRef = useRef<Page1PersistedRecord | null>(null);
  // The queued save whose server answer this page waits for, with the state it carried.
  const queuedRef = useRef<{ writeId: string; state: Page1State } | null>(null);
  const lastWarningsRef = useRef<string[]>([]);
  // Serialized form state the server is known to hold; an unchanged form is never PUT again.
  const lastSyncedRef = useRef<string | null>(null);
  // The state this page's edits start from (the server's, or what was shown when it could not be
  // read). Saves send only the leaves that differ from it, so a value nobody touched here never
  // overwrites another device's newer one with this edit's timestamp (final review H1, M1).
  // Null for a patient the server does not know yet: everything is sent.
  const baseRef = useRef<Page1State | null>(null);
  // The session that opened this protocol. Work still pending when another account signs in on
  // the device is dropped, never saved or sent under the new account (security review 2.1).
  const ownerRef = useRef(currentDraftOwner());
  const ownerChanged = () => currentDraftOwner() !== ownerRef.current;

  useEffect(() => {
    const subscription = watch((value) => setWatchedState(value as Page1State));
    return () => subscription.unsubscribe();
  }, [watch]);

  const persistLocal = useCallback((formState: Page1State, nextStatus: Page1RecordStatus, updatedAt: string, finalizedAt: string | null, synced = false) => {
    const normalizedFormState = normalizePage1State(formState);
    const record: Page1PersistedRecord = {
      patientId,
      operationSceneId,
      status: nextStatus,
      updatedAt,
      finalizedAt,
      formState: normalizedFormState,
    };

    if (!writePage1Draft(record, ownerRef.current, synced)) return;
    setCurrentRecord(record);
    setLastSavedAt(updatedAt);
    setStatus(nextStatus);
    setSource('local');
  }, [operationSceneId, patientId]);

  const setBodyMap = useCallback((value: BodyMapMarker[]) => {
    setValue('assessment_secondary.bodymap', value, { shouldDirty: true, shouldTouch: true });
    setWatchedState(normalizePage1State(getValues()));
  }, [getValues, setValue]);

  const setSignature = useCallback((value: string | null) => {
    setValue('signatures.entlass_san_na', value, { shouldDirty: true, shouldTouch: true });
    setWatchedState(normalizePage1State(getValues()));
  }, [getValues, setValue]);

  const acceptServerRecord = useCallback((record: Page1ServerRecord, sentState: Page1State) => {
    if (ownerChanged()) return;
    lastWarningsRef.current = record.warnings ?? [];
    // The server computes the GCS sum authoritatively (WP 4.2); take its value into the form
    // without marking anything dirty, so it is not sent back as an edit.
    const serverGcs = record.formState?.vitals?.gcs_summe ?? null;
    const sent: Page1State = { ...sentState, vitals: { ...sentState.vitals, gcs_summe: serverGcs } };
    if (getValues('vitals.gcs_summe') !== serverGcs) setValue('vitals.gcs_summe', serverGcs);
    lastSyncedRef.current = serializePage1State(normalizePage1State(sent));
    const held = normalizePage1State(record.formState);
    baseRef.current = held;
    const accepted: Page1PersistedRecord = { ...record, operationSceneId };
    if (record.status === 'finalized') {
      // The finalized form and its print show what the server holds. Its merge never lets an
      // empty value replace a recorded one, so a cleared field comes back: say so.
      reset(held);
      const notCleared = leafPaths(sent as unknown as Record<string, unknown>).filter((path) => isEmptyLeaf(leafAt(sent, path)) && !isEmptyLeaf(leafAt(held, path)));
      if (notCleared.length) {
        lastWarningsRef.current = [
          ...lastWarningsRef.current,
          `Geleerte Felder wurden nicht übernommen, der gespeicherte Wert bleibt: ${notCleared.join(', ')}.`,
        ];
      }
      clearPage1Draft(patientId);
      setCurrentRecord(accepted);
      setStatus('finalized');
      setLastSavedAt(record.updatedAt);
    } else if (!unsentRef.current) {
      persistLocal(sent, 'draft', record.updatedAt ?? new Date().toISOString(), null, true);
    }
    // Otherwise the user typed on during the round trip: the newer cached draft stays, unsynced,
    // and is saved after the pause (security review 4, M4).
    setSource('server');
    setSyncState(record.status === 'finalized' ? 'finalized' : 'saved-server');
  }, [getValues, operationSceneId, patientId, persistLocal, reset, setValue]);

  /**
   * Hands a saved state to the server, or to the offline queue when the patient is provisional,
   * has queued writes, or the server is unreachable (parity plan WP 6.3). Resolves to 'queued',
   * 'saved', or the refusal.
   */
  const save = useCallback(async (record: Page1PersistedRecord): Promise<'saved' | 'queued' | 'refused' | 'dropped'> => {
    const owner = ownerRef.current;
    if (!owner || ownerChanged()) return 'dropped';
    const state = normalizePage1State(record.formState);
    unsentRef.current = null;
    setSyncState('saving');
    try {
      const outcome = await sendOrQueue(
        patientId,
        () => putPage1(patientId, { formState: state, status: record.status, clientUpdatedAt: record.updatedAt ?? undefined, baseFormState: baseRef.current ?? undefined }),
        async () => {
          const writeId = await queuePage1(record, owner, baseRef.current);
          if (writeId) queuedRef.current = { writeId, state };
        },
      );
      if (outcome.queued) {
        if (ownerChanged()) return 'dropped';
        // Queued is stored on this device: the same state is not handed over again.
        lastSyncedRef.current = serializePage1State(state);
        setSyncState('saved-local');
        return 'queued';
      }
      acceptServerRecord(outcome.result, state);
      return 'saved';
    } catch (error) {
      if (ownerChanged()) return 'dropped';
      setErrorMessage(saveErrorMessage(error));
      setSyncState('error');
      return 'refused';
    }
  }, [acceptServerRecord, patientId]);

  // The queue reports the server's answer to this page's latest queued save.
  useEffect(() => onProtocolSaved((saved) => {
    const queued = queuedRef.current;
    if (!queued || saved.writeId !== queued.writeId) return;
    queuedRef.current = null;
    acceptServerRecord(page1FromServer(saved.record), queued.state);
  }), [acceptServerRecord]);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      setSyncState('loading');
      setErrorMessage(null);

      // A queued save counts as local work: after logout its cached copy is gone, the queue has it.
      const pending = await offlineQueue.pendingProtocol(patientId);
      const queuedRecord: Page1PersistedRecord | null = pending
        ? { ...page1FromServer({ ...pending.body, patientId, updatedAt: pending.body.clientUpdatedAt ?? pending.createdAt, finalizedAt: null }), operationSceneId }
        : null;
      const localRecord = chooseNewestRecord(readPage1Draft(patientId), queuedRecord);

      // A provisional patient exists only on this device until the queue created it.
      if (isProvisional(patientId)) {
        if (cancelled) return;
        const shown = localRecord?.formState ? normalizePage1State(localRecord.formState) : createPage1Template();
        reset(shown);
        // Already queued or cached for the queue: opening the page queues nothing new.
        baseRef.current = null;
        lastSyncedRef.current = serializePage1State(shown);
        setIsHydrated(true);
        setCurrentRecord(localRecord);
        setStatus(localRecord?.status ?? 'draft');
        setLastSavedAt(localRecord?.updatedAt ?? null);
        setSource(localRecord ? 'local' : 'empty');
        setSyncState(localRecord ? 'saved-local' : 'ready');
        return;
      }

      try {
        const serverRecord = await getPage1(patientId);

        if (cancelled) return;

        const chosenRecord = chooseNewestRecord(localRecord, { ...serverRecord, operationSceneId });
        const nextState = chosenRecord?.formState ? normalizePage1State(chosenRecord.formState) : createPage1Template();
        const localIsNewer = chosenRecord === localRecord;
        baseRef.current = normalizePage1State(serverRecord.formState);
        lastSyncedRef.current = serializePage1State(localIsNewer ? nextState : baseRef.current);
        reset(nextState);
        setIsHydrated(true);
        setCurrentRecord(chosenRecord ?? null);
        setStatus(chosenRecord?.status ?? 'draft');
        setLastSavedAt(chosenRecord?.updatedAt ?? null);
        setSource(localIsNewer ? 'local' : 'server');
        setSyncState(chosenRecord?.status === 'finalized' && !localIsNewer ? 'finalized' : 'ready');

        // Newer local work (a draft or a finalization that never reached the server) is handed
        // over now, with the time it was made, not the time the page was opened.
        if (localIsNewer && localRecord) void save(localRecord);
      } catch (error) {
        if (cancelled) return;

        // Only an unreachable server falls back to the local copy. A refusal (401/403/404) must not
        // show what the server just withheld, and the form stays closed (isHydrated false).
        const offline = isUnavailable(error);
        const usable = offline ? localRecord : null;
        const fallback = usable?.formState ? normalizePage1State(usable.formState) : createPage1Template();
        reset(fallback);
        // Opening offline is no edit: nothing is queued until the user changes something, and
        // then only what was changed (final review H1).
        baseRef.current = fallback;
        lastSyncedRef.current = serializePage1State(fallback);
        setIsHydrated(offline);
        setCurrentRecord(usable ?? null);
        setStatus(usable?.status ?? 'draft');
        setLastSavedAt(usable?.updatedAt ?? null);
        setSource(usable ? 'local' : 'empty');
        setErrorMessage(offline ? 'Server nicht erreichbar: Änderungen werden auf diesem Gerät gespeichert und später gesendet.' : apiErrorMessage(error, 'Fehler beim Laden des Ambulanzprotokolls'));
        setSyncState(offline ? 'saved-local' : 'error');
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [operationSceneId, patientId, reset, save]);

  useEffect(() => {
    // A finalized protocol is never autosaved: a change to it is a correction (parity plan 4.3).
    if (!isHydrated || !watchedState || status === 'finalized') return;
    const nextValue = normalizePage1State(watchedState as Page1State);
    if (serializePage1State(nextValue) === lastSyncedRef.current || ownerChanged()) return;

    // Every change is cached on the device at once; the server save waits for a typing pause.
    const record: Page1PersistedRecord = { patientId, operationSceneId, status: 'draft', updatedAt: new Date().toISOString(), finalizedAt: null, formState: nextValue };
    persistLocal(nextValue, 'draft', record.updatedAt!, null);
    unsentRef.current = record;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void save(record);
    }, 800);
  }, [isHydrated, operationSceneId, patientId, persistLocal, save, status, watchedState]);

  // Leaving the page during the typing pause queues the last change instead of dropping it.
  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const unsent = unsentRef.current;
    const owner = ownerRef.current;
    unsentRef.current = null;
    if (unsent && owner && !ownerChanged()) void queuePage1(unsent, owner, baseRef.current).then(() => offlineQueue.flush(true));
  }, [patientId]);

  useEffect(() => {
    function handleOffline() {
      setSyncState((prev) =>
        prev === 'saving' || prev === 'saved-server' || prev === 'ready' ? 'saved-local' : prev,
      );
    }

    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  const finalize = async () => {
    if (ownerChanged()) return;
    const validState = normalizePage1State(getValues());
    const validation = page1FinalizeSchema.safeParse(validState);
    const finalState = validation.success ? normalizePage1State(validation.data) : validState;
    const clientWarnings = validation.success
      ? []
      : validation.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    setValidationWarnings(clientWarnings);
    const finalizedAt = new Date().toISOString();

    setErrorMessage(null);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;

    const record: Page1PersistedRecord = { patientId, operationSceneId, status: 'finalized', updatedAt: finalizedAt, finalizedAt, formState: finalState };
    const outcome = await save(record);
    if (outcome === 'queued') {
      // The queue holds it; the cached copy shows it finalized until the server confirms.
      persistLocal(finalState, 'finalized', finalizedAt, finalizedAt, true);
      setErrorMessage('Finalisierung lokal gespeichert; Server-Sync ausstehend');
    } else if (outcome === 'saved') {
      // Server warnings are non-blocking hints, shown next to the client checks (parity plan 4.2).
      setValidationWarnings([...clientWarnings, ...lastWarningsRef.current]);
    }
    // Refused: the protocol stays a draft so it can be fixed and finalized again.
  };

  /**
   * Saves a correction of a finalized protocol (WP 4.3). The server requires the reason, checks
   * who may correct, and keeps the previous version as a revision. Corrections need the server:
   * they are not queued offline.
   */
  const saveCorrection = async (correctionReason: string): Promise<boolean> => {
    if (ownerChanged()) return false;
    const formState = normalizePage1State(getValues());
    const base = currentRecord?.formState ? normalizePage1State(currentRecord.formState) : createPage1Template();
    const changed = changedLeaves(formState as unknown as Record<string, unknown>, base as unknown as Record<string, unknown>);
    if (!Object.keys(changed).length) {
      setErrorMessage('Keine Änderung zum Speichern.');
      return false;
    }
    setSyncState('saving');
    setErrorMessage(null);
    try {
      // Only the changed fields are sent, so a concurrent correction of another field survives.
      const saved = await putPage1(patientId, { formState, baseFormState: base, status: 'finalized', clientUpdatedAt: new Date().toISOString(), correctionReason });
      acceptServerRecord(saved, formState);
      // The form shows what the server holds. Its merge never lets an empty value replace a
      // recorded one, so a cleared field comes back: say so instead of implying it was removed.
      const held = normalizePage1State(saved.formState);
      reset(held);
      const notCleared = leafPaths(changed).filter((path) => isEmptyLeaf(leafAt(changed, path)) && !isEmptyLeaf(leafAt(held, path)));
      setValidationWarnings([
        ...(saved.warnings ?? []),
        ...(notCleared.length
          ? [`Leeren ist bei einer Korrektur nicht möglich, der Wert bleibt erhalten: ${notCleared.join(', ')}. Bitte einen korrigierten Wert eintragen.`]
          : []),
      ]);
      return true;
    } catch (error) {
      setErrorMessage(
        httpStatus(error) === 403
          ? 'Keine Berechtigung, dieses Protokoll zu korrigieren.'
          : isUnavailable(error)
            ? 'Korrektur nicht gespeichert: keine Verbindung zum Server.'
            : saveErrorMessage(error),
      );
      setSyncState('error');
      return false;
    }
  };

  /** Drops unsaved correction edits: back to the finalized version the server holds. */
  const discardCorrection = () => {
    if (currentRecord?.formState) reset(normalizePage1State(currentRecord.formState));
    setErrorMessage(null);
    setSyncState('finalized');
  };

  return {
    form,
    finalize,
    syncState,
    status,
    source,
    lastSavedAt,
    errorMessage,
    validationWarnings,
    currentRecord,
    isHydrated,
    saveCorrection,
    discardCorrection,
    setBodyMap,
    setSignature,
  };
}

function chooseNewestRecord(
  localRecord: Page1PersistedRecord | null,
  serverRecord: Page1PersistedRecord | null,
) {
  if (!localRecord) return serverRecord;
  if (!serverRecord) return localRecord;
  return comparePage1UpdatedAt(localRecord.updatedAt, serverRecord.updatedAt) > 0 ? localRecord : serverRecord;
}
