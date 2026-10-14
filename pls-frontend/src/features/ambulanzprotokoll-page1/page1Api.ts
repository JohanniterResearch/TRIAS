import client from '../../api/client';
import type { Body, Res } from '../../api/endpoints';
import { decodePage1, encodePage1 } from './ambulanzValueMap';
import { changedLeaves } from './formStateDiff';
import type { Page1PersistedRecord, Page1State } from './page1State';

type ServerRecord = Res<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'get'>;
type ServerFormState = Body<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>['formState'];

export interface Page1SavePayload {
  formState: Page1State;
  status: 'draft' | 'finalized';
  /** Moment of the user's edit, for the server's per-field newer-wins merge. */
  clientUpdatedAt?: string;
  /** Required by the server when saving a protocol that is already finalized. */
  correctionReason?: string;
  /**
   * The version the edit started from. When given, only the leaves that differ from it are sent
   * (corrections, security review 3 M2); the server merge leaves absent leaves untouched.
   */
  baseFormState?: Page1State;
}

export type Page1ServerRecord = Omit<Page1PersistedRecord, 'operationSceneId'> & { warnings?: string[] };

const path = (patientId: number) => `/api/persons/${patientId}/ambulanzprotokoll-page1`;

// Every value crosses the PLS <-> Ambulanzsystem vocabulary codec here and nowhere else.
function fromServer(record: ServerRecord & { warnings?: string[] }): Page1ServerRecord {
  return {
    patientId: record.patientId,
    status: record.status,
    updatedAt: record.updatedAt,
    finalizedAt: record.finalizedAt ?? null,
    formState: decodePage1(record.formState as unknown as Page1State),
    warnings: record.warnings,
  };
}

export const getPage1 = async (patientId: number) => {
  const { data } = await client.get<ServerRecord>(path(patientId));
  return fromServer(data);
};

type ServerExport = Res<'/api/persons/{patientId}/ambulanzprotokoll-page1/export', 'get'>;

/**
 * Server export (WP 4.4): the server records a watermarked snapshot and an audit entry; the
 * protocol inside is decoded to the PLS vocabulary for the download, like every other read.
 */
export const exportPage1 = async (patientId: number) => {
  const { data } = await client.get<ServerExport>(`${path(patientId)}/export`);
  return {
    ...data,
    protokoll: { ...data.protokoll, formState: decodePage1(data.protokoll.formState as unknown as Page1State) },
  };
};

/** The PUT body in server vocabulary (also what the offline queue stores). */
export function page1RequestBody({ baseFormState, ...payload }: Page1SavePayload): Body<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'> {
  const encoded = encodePage1(payload.formState) as unknown as Record<string, unknown>;
  const formState = baseFormState ? changedLeaves(encoded, encodePage1(baseFormState) as unknown as Record<string, unknown>) : encoded;
  return { ...payload, formState: formState as unknown as ServerFormState };
}

export const putPage1 = async (patientId: number, payload: Page1SavePayload) => {
  const { data } = await client.put<Res<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>>(path(patientId), page1RequestBody(payload));
  return fromServer(data);
};

/** A server record (as the queue reports it) in PLS vocabulary. */
export const page1FromServer = (record: unknown) => fromServer(record as ServerRecord);
