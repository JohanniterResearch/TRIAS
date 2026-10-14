import { useState } from 'react';
import { updateTriageColor, updateRespiration } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import { offlineQueue, sendOrQueue } from '../offline/offlineQueue';
import { encodeTriageColor } from '../api/codecs/triage';
import type { TriageColor } from '../types/triageColor';

export type ClinicalFlag = 'respiration' | 'blutung' | 'radialispuls' | 'transport' | 'dringend' | 'kontaminiert';

// Each write resolves to true only when it is stored, on the server or, offline, in the device's
// queue (parity plan WP 1.6, 6.3); a refused write shows its error in a role="alert" region.
type TriageBody = Parameters<typeof offlineQueue.queueTriage>[1];
export function usePatientTriage(patientId: number | null | undefined) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function write(send: (config: { expectedOwner: string }) => Promise<unknown>, queued: TriageBody, fallback: string): Promise<boolean> {
    if (!patientId) {
      setError('Kein Patient ausgewählt. Bitte Patienten-QR-Code scannen.');
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      await sendOrQueue(patientId, (owner) => send({ expectedOwner: owner }), (owner) => offlineQueue.queueTriage(patientId, queued, owner));
      return true;
    } catch (cause) {
      setError(apiErrorMessage(cause, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  }

  // clientUpdatedAt is the moment of the user's input, taken before the request, so a later
  // replay (Phase 6) never overwrites a newer value with an older decision (WP 3.4).
  const setTriageColor = (color: TriageColor, extra?: { respiration?: boolean; blutung?: boolean }) => {
    const body = { triageColor: encodeTriageColor(color), ...extra, clientUpdatedAt: new Date().toISOString() };
    return write(
      (config) => updateTriageColor(patientId!, body, config),
      body,
      'Triagefarbe konnte nicht gespeichert werden. Bitte erneut versuchen.',
    );
  };

  const setRespiration = (value: boolean) => {
    const body = { respiration: value, clientUpdatedAt: new Date().toISOString() };
    return write(
      (config) => updateRespiration(patientId!, body, config),
      body, // queued through the triage endpoint, which takes the same field
      'Atmung konnte nicht gespeichert werden. Bitte erneut versuchen.',
    );
  };

  /** One clinical flag per request, so two devices editing different flags both win (WP 3.3). */
  const setFlag = (flag: ClinicalFlag, value: boolean) => {
    const body = { [flag]: value, clientUpdatedAt: new Date().toISOString() };
    return write(
      (config) => updateTriageColor(patientId!, body, config),
      body,
      'Angabe konnte nicht gespeichert werden. Bitte erneut versuchen.',
    );
  };

  return { setTriageColor, setRespiration, setFlag, error, saving };
}
