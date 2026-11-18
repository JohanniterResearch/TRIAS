import { effect, inject, Injectable } from '@angular/core';
import createClient from 'openapi-fetch';
import { from, map, Observable, tap, throwError } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import {
  PatientWriteJournal,
  PatientWriteIntent,
  PatientWriteKind,
  patientWriteContents,
} from '../sync/patient-write-journal';
import type { components, paths } from './openapi-types';

export type JsonBody<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** No server answer, or a 5xx: the write may be replayed later instead of being rejected. */
export function isRetryableFailure(error: unknown): boolean {
  return !(error instanceof ApiRequestError) || error.status >= 500;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

export function isAuthFailure(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiRequestError) || !isErrorBody(error.body)) return fallback;
  return error.body.message;
}

function isErrorBody(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string' &&
    value.message.length > 0
  );
}

type AdminPatientPage =
  paths['/api/admin/patients']['get']['responses'][200]['content']['application/json'];

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly auth = inject(AuthStore);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly client = createClient<paths>();
  private readonly patientJournal = inject(PatientWriteJournal);
  private readonly inFlightPatientWrites = new Map<
    string,
    { contents: string; promise: Promise<unknown> }
  >();

  constructor() {
    this.client.use({
      onRequest: ({ request }) => {
        const token = this.auth.bearerToken();
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`);
        }
        return request;
      },
    });
    window.addEventListener('online', () => void this.replayPatientWrites());
    queueMicrotask(() => void this.replayPatientWrites());
    effect(() => {
      this.auth.activeSession();
      void this.replayPatientWrites();
    });
  }

  private patientOwner(): string | null {
    const session = this.auth.activeSession();
    if (!session) return null;
    try {
      const part = session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(part));
      return `${session.tokenType}:${claims.sub}`;
    } catch {
      return `${session.tokenType}:${session.username ?? session.token}`;
    }
  }

  private patientWrite<T>(
    kind: PatientWriteKind,
    target: string | number | null,
    body: unknown,
    writeId: string,
  ): Observable<T> {
    const intent: PatientWriteIntent = {
      kind,
      target,
      body: structuredClone(body),
      writeId,
      owner: this.patientOwner() ?? 'anonymous',
    };
    return from(this.runPatientWrite(intent, true) as Promise<T>);
  }

  private async replayPatientWrites(): Promise<void> {
    const owner = this.patientOwner();
    if (!owner || !navigator.onLine) return;
    try {
      for (const intent of await this.patientJournal.pending(owner))
        await this.runPatientWrite(intent, false).catch(() => undefined);
    } catch {
      /* Durable journal remains authoritative if storage/network is temporarily unavailable. */
    }
  }

  private runPatientWrite(intent: PatientWriteIntent, persist: boolean): Promise<unknown> {
    const identity = JSON.stringify([intent.kind, intent.target, intent.writeId]);
    const active = this.inFlightPatientWrites.get(identity);
    if (active)
      return active.contents === patientWriteContents(intent.body)
        ? active.promise
        : Promise.reject(
            new ApiRequestError(409, { message: 'Vorgangskennung mit geändertem Auftragsinhalt.' }),
          );
    const work = (async () => {
      if (persist) await this.patientJournal.put(intent);
      if ((this.patientOwner() ?? 'anonymous') !== intent.owner)
        throw new Error('Sitzung hat gewechselt; Auftrag bleibt gespeichert.');
      for (let attempt = 0; ; attempt++) {
        try {
          if ((this.patientOwner() ?? 'anonymous') !== intent.owner)
            throw new Error('Sitzung hat gewechselt; Auftrag bleibt gespeichert.');
          const { data, error, response } = await this.sendPatientWrite(intent);
          if (!response.ok) throw new ApiRequestError(response.status, error);
          await this.patientJournal.remove(intent);
          this.syncStatus.markServerContact();
          return data;
        } catch (error) {
          if (isRetryableFailure(error) && attempt === 0) continue;
          if (
            error instanceof ApiRequestError &&
            error.status < 500 &&
            error.status !== 401 &&
            error.status !== 408 &&
            error.status !== 429
          )
            await this.patientJournal.put({ ...intent, blocked: true });
          throw error;
        }
      }
    })().finally(() => this.inFlightPatientWrites.delete(identity));
    this.inFlightPatientWrites.set(identity, {
      contents: patientWriteContents(intent.body),
      promise: work,
    });
    return work;
  }

  private sendPatientWrite(
    order: PatientWriteIntent,
  ): Promise<{ data?: unknown; error?: unknown; response: Response }> {
    const header = { 'Idempotency-Key': order.writeId };
    switch (order.kind) {
      case 'protocol-export':
        return this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1/export', {
          params: { path: { patientId: Number(order.target) }, header },
        });
      case 'respiration':
        return this.client.POST('/api/persons/{id}/respiration', {
          params: { path: { id: Number(order.target) }, header },
          body: order.body as JsonBody<'/api/persons/{id}/respiration', 'post'>,
        });
      case 'qr-intake':
        return this.client.POST('/api/verify-patient-qr-code', {
          params: { header },
          body: order.body as JsonBody<'/api/verify-patient-qr-code', 'post'>,
        });
      case 'qr-reassign':
        return this.client.POST('/api/persons/{id}/reassign-qr-code', {
          params: { path: { id: Number(order.target) }, header },
          body: order.body as JsonBody<'/api/persons/{id}/reassign-qr-code', 'post'>,
        });
      case 'admin-patient':
        return this.client.PUT('/api/admin/patients/{reference}', {
          params: { path: { reference: String(order.target) }, header },
          body: order.body as JsonBody<'/api/admin/patients/{reference}', 'put'>,
        });
      case 'admin-body':
        return this.client.PUT('/api/admin/patients/{reference}/body-parts', {
          params: { path: { reference: String(order.target) }, header },
          body: order.body as JsonBody<'/api/admin/patients/{reference}/body-parts', 'put'>,
        });
      case 'admin-qr':
        return this.client.POST('/api/admin/patients/{reference}/assign-qr-code', {
          params: { path: { reference: String(order.target) }, header },
          body: order.body as JsonBody<'/api/admin/patients/{reference}/assign-qr-code', 'post'>,
        });
      case 'team':
        return this.client.PUT('/api/teams/{id}', {
          params: { path: { id: Number(order.target) }, header },
          body: order.body as JsonBody<'/api/teams/{id}', 'put'>,
        });
    }
  }

  qrLogin(qr_code: string) {
    return this.unwrap(
      this.client.POST('/api/qr-login', {
        body: { qr_code } satisfies JsonBody<'/api/qr-login', 'post'>,
      }),
    );
  }

  userLogin(body: JsonBody<'/api/user-login', 'post'>) {
    return this.unwrap(this.client.POST('/api/user-login', { body }));
  }

  adminLogin(body: JsonBody<'/api/user-login', 'post'>) {
    return this.unwrap(this.client.POST('/api/admin-login', { body }));
  }

  changePassword(body: JsonBody<'/api/users/change-password', 'post'>): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/users/change-password', {
        body,
      }),
    );
  }

  selfCancel(): Observable<void> {
    return this.unwrap(this.client.POST('/api/users/self-cancel', {}));
  }

  // Revokes only the current session's refresh token, unlike selfCancel(), which ends
  // the account's access entirely. Future logins with the account remain possible.
  logout(): Observable<void> {
    const refreshToken = this.auth.activeSession()?.refreshToken;
    if (!refreshToken) {
      return throwError(() => new Error('no active session to log out'));
    }
    return this.unwrap(this.client.POST('/api/logout', { body: { refreshToken } }));
  }

  devLogin(role: JsonBody<'/api/dev-login', 'post'>['role']) {
    return this.unwrap(
      this.client.POST('/api/dev-login', {
        body: { role } satisfies JsonBody<'/api/dev-login', 'post'>,
      }),
    );
  }

  validateToken() {
    return this.unwrap(this.client.POST('/api/validate-token', {}));
  }

  refreshSession(): Observable<void> {
    const refreshToken = this.auth.activeSession()?.refreshToken;
    const owner = this.auth.sessionIdentity();
    if (!refreshToken) {
      return throwError(() => new Error('session cannot be refreshed'));
    }

    return this.unwrap(this.client.POST('/api/refresh-token', { body: { refreshToken } })).pipe(
      tap((tokens) => {
        if (
          this.auth.sessionIdentity() !== owner ||
          this.auth.activeSession()?.refreshToken !== refreshToken
        ) {
          throw new Error('active session changed while refresh was in flight');
        }
        this.auth.refreshTokens(tokens.token, tokens.refreshToken);
      }),
      map(() => undefined),
    );
  }

  listScenes() {
    return this.unwrap(this.client.GET('/api/operation-scenes', {}));
  }

  saveScene(body: JsonBody<'/api/operation-scenes', 'post'>) {
    return this.unwrap(
      this.client.POST('/api/operation-scenes', {
        body,
      }),
    );
  }

  deleteScene(id: number): Observable<void> {
    return this.unwrap(
      this.client.DELETE('/api/operation-scenes/{id}', {
        params: { path: { id } },
      }),
    );
  }

  createUser(body: JsonBody<'/api/users', 'post'>) {
    return this.unwrap(
      this.client.POST('/api/users', {
        body,
      }),
    );
  }

  listUsers() {
    return this.unwrap(this.client.GET('/api/users'));
  }

  revokeUser(id: number): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/users/{id}/revoke', {
        params: { path: { id } },
      }),
    );
  }

  adminUsers(
    search?: string,
    role?: 'responder' | 'leitstelle',
    accountType?: 'permanent' | 'event',
    status?: 'active' | 'revoked',
  ) {
    return this.unwrap(
      this.client.GET('/api/admin/users', {
        params: { query: { search, role, accountType, status } },
      }),
    );
  }

  updateAdminUser(id: number, body: JsonBody<'/api/admin/users/{id}', 'put'>) {
    return this.unwrap(
      this.client.PUT('/api/admin/users/{id}', { params: { path: { id } }, body }),
    );
  }

  resetAdminUserPassword(id: number, temporaryPassword: string): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/admin/users/{id}/reset-password', {
        params: { path: { id } },
        body: { temporaryPassword },
      }),
    );
  }

  reactivateAdminUser(id: number, temporaryPassword: string): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/admin/users/{id}/reactivate', {
        params: { path: { id } },
        body: { temporaryPassword },
      }),
    );
  }

  adminPatients(
    search: string,
    operationSceneId?: number,
    status?: 'draft' | 'finalized',
  ): Observable<AdminPatientPage> {
    return this.unwrap(
      this.client.GET('/api/admin/patients', {
        params: { query: { search: search || undefined, operationSceneId, status } },
      }),
    );
  }

  updateAdminPatient(
    reference: string,
    body: JsonBody<'/api/admin/patients/{reference}', 'put'>,
    writeId: string = crypto.randomUUID(),
  ): Observable<AdminPatientPage['items'][number]> {
    return this.patientWrite<components['schemas']['AdminPatient']>(
      'admin-patient',
      reference,
      body,
      writeId,
    );
  }

  adminPatientDetails(reference: string) {
    return this.unwrap(
      this.client.GET('/api/admin/patients/{reference}/details', {
        params: { path: { reference } },
      }),
    );
  }

  updateAdminPatientBodyParts(
    reference: string,
    body: JsonBody<'/api/admin/patients/{reference}/body-parts', 'put'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['AdminPatientDetails']>(
      'admin-body',
      reference,
      body,
      writeId,
    );
  }

  availableAdminPatientQrCodes() {
    return this.unwrap(this.client.GET('/api/admin/patient-qr-codes/available'));
  }

  assignAdminPatientQrCode(
    reference: string,
    body: JsonBody<'/api/admin/patients/{reference}/assign-qr-code', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['AssignAdminPatientQrCodeResponse']>(
      'admin-qr',
      reference,
      body,
      writeId,
    );
  }

  generateLoginQrCodes(body: JsonBody<'/api/login-qr-codes/generate', 'post'>) {
    return this.unwrap(
      this.client.POST('/api/login-qr-codes/generate', {
        body,
      }),
    );
  }

  listLoginQrCodes(eventSceneId?: number) {
    return this.unwrap(
      this.client.GET('/api/login-qr-codes', {
        params: { query: eventSceneId ? { eventSceneId } : {} },
      }),
    );
  }

  generatePatientQrCodes(
    body: JsonBody<'/api/patient-qr-codes/generate', 'post'>,
  ): Observable<string[]> {
    return this.unwrap(
      this.client.POST('/api/patient-qr-codes/generate', {
        body,
      }),
    );
  }

  listUnusedPatientQrCodes(): Observable<string[]> {
    return this.unwrap(this.client.GET('/api/patient-qr-codes/unused', {}));
  }

  verifyPatientQrCode(
    body: JsonBody<'/api/verify-patient-qr-code', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['VerifyQrResult']>(
      'qr-intake',
      body.qr_code,
      body,
      writeId,
    );
  }

  createManualPatient(body: JsonBody<'/api/persons/manual', 'post'>) {
    return this.unwrap(
      this.client.POST('/api/persons/manual', {
        body,
      }),
    );
  }

  updateTriage(
    patientId: number,
    body: JsonBody<'/api/persons/{id}/update-triage-color', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.unwrap(
      this.client.POST('/api/persons/{id}/update-triage-color', {
        params: { path: { id: patientId }, header: { 'Idempotency-Key': writeId } },
        body,
      }),
    );
  }

  updatePatientLocation(
    patientId: number,
    body: JsonBody<'/api/persons/{id}/location', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.unwrap(
      this.client.POST('/api/persons/{id}/location', {
        params: { path: { id: patientId }, header: { 'Idempotency-Key': writeId } },
        body,
      }),
    );
  }

  reassignPatientQrCode(
    patientId: number,
    body: JsonBody<'/api/persons/{id}/reassign-qr-code', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['Patient']>(
      'qr-reassign',
      patientId,
      body,
      writeId,
    );
  }

  getBodyParts(patientId: number) {
    return this.unwrap(
      this.client.GET('/api/body-parts', {
        params: { query: { idpatient: patientId } },
      }),
    );
  }

  toggleBodyPart(body: JsonBody<'/api/body-parts', 'put'>, writeId: string = crypto.randomUUID()) {
    return this.unwrap(
      this.client.PUT('/api/body-parts', {
        params: { header: { 'Idempotency-Key': writeId } },
        body,
      }),
    );
  }

  getProtokollPage1(patientId: number) {
    return this.unwrap(
      this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1', {
        params: { path: { patientId } },
      }),
    );
  }

  saveProtokollPage1(
    patientId: number,
    body: JsonBody<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.unwrap(
      this.client.PUT('/api/persons/{patientId}/ambulanzprotokoll-page1', {
        params: { path: { patientId }, header: { 'Idempotency-Key': writeId } },
        body,
      }),
    );
  }

  exportProtokollPage1(patientId: number, writeId: string = crypto.randomUUID()) {
    return this.patientWrite<components['schemas']['ProtokollExport']>(
      'protocol-export',
      patientId,
      {},
      writeId,
    );
  }

  updateRespiration(
    patientId: number,
    body: JsonBody<'/api/persons/{id}/respiration', 'post'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['Patient']>(
      'respiration',
      patientId,
      body,
      writeId,
    );
  }

  listPatients(operationSceneId: number) {
    return this.unwrap(
      this.client.GET('/api/persons', {
        params: { query: { operationSceneId } },
      }),
    );
  }

  listTeams(operationSceneId: number) {
    return this.unwrap(
      this.client.GET('/api/teams', {
        params: { query: { operationSceneId } },
      }),
    );
  }

  createTeam(body: JsonBody<'/api/teams', 'post'>) {
    return this.unwrap(
      this.client.POST('/api/teams', {
        body,
      }),
    );
  }

  updateTeam(
    id: number,
    body: JsonBody<'/api/teams/{id}', 'put'>,
    writeId: string = crypto.randomUUID(),
  ) {
    return this.patientWrite<components['schemas']['Team']>('team', id, body, writeId);
  }

  getTriageHistory(patientId: number) {
    return this.unwrap(
      this.client.GET('/api/persons/{id}/triage-history', {
        params: { path: { id: patientId } },
      }),
    );
  }

  private unwrap<T>(
    request: Promise<{ data?: T; error?: unknown; response: Response }>,
  ): Observable<T> {
    return from(request).pipe(
      map(({ data, error, response }) => {
        if (!response.ok) {
          throw new ApiRequestError(
            response.status,
            error ?? { message: response.statusText || 'Request failed' },
          );
        }

        return data as T;
      }),
      tap(() => this.syncStatus.markServerContact()),
    );
  }
}
