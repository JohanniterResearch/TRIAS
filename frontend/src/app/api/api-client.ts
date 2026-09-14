import { inject, Injectable } from '@angular/core';
import createClient from 'openapi-fetch';
import { from, map, Observable, tap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import type { paths } from './openapi-types';

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

type QrLoginRequest = paths['/api/qr-login']['post']['requestBody']['content']['application/json'];
type QrLoginResponse =
  paths['/api/qr-login']['post']['responses'][200]['content']['application/json'];
type CredentialsRequest =
  paths['/api/user-login']['post']['requestBody']['content']['application/json'];
type UserLoginResponse =
  paths['/api/user-login']['post']['responses'][200]['content']['application/json'];
type AdminLoginResponse =
  paths['/api/admin-login']['post']['responses'][200]['content']['application/json'];
type ChangePasswordRequest =
  paths['/api/users/change-password']['post']['requestBody']['content']['application/json'];
type DevLoginRequest =
  paths['/api/dev-login']['post']['requestBody']['content']['application/json'];
type DevLoginResponse =
  paths['/api/dev-login']['post']['responses'][200]['content']['application/json'];
type ValidateTokenResponse =
  paths['/api/validate-token']['post']['responses'][200]['content']['application/json'];
type RefreshTokenResponse =
  paths['/api/refresh-token']['post']['responses'][200]['content']['application/json'];
type CreateUserRequest = paths['/api/users']['post']['requestBody']['content']['application/json'];
type User = paths['/api/users']['post']['responses'][201]['content']['application/json'];
type UserList = paths['/api/users']['get']['responses'][200]['content']['application/json'];
type GenerateLoginQrRequest =
  paths['/api/login-qr-codes/generate']['post']['requestBody']['content']['application/json'];
type LoginQrCode =
  paths['/api/login-qr-codes']['get']['responses'][200]['content']['application/json'][number];
type GeneratePatientQrRequest =
  paths['/api/patient-qr-codes/generate']['post']['requestBody']['content']['application/json'];
type SaveSceneRequest =
  paths['/api/operation-scenes']['post']['requestBody']['content']['application/json'];
type OperationScene =
  paths['/api/operation-scenes']['get']['responses'][200]['content']['application/json'][number];
type VerifyPatientQrRequest =
  paths['/api/verify-patient-qr-code']['post']['requestBody']['content']['application/json'];
type VerifyPatientQrResult =
  paths['/api/verify-patient-qr-code']['post']['responses'][200]['content']['application/json'];
type ManualPatientRequest =
  paths['/api/persons/manual']['post']['requestBody']['content']['application/json'];
type Patient =
  paths['/api/persons/manual']['post']['responses'][201]['content']['application/json'];
type TriageUpdateRequest =
  paths['/api/persons/{id}/update-triage-color']['post']['requestBody']['content']['application/json'];
type LocationUpdateRequest =
  paths['/api/persons/{id}/location']['post']['requestBody']['content']['application/json'];
type ReassignQrRequest =
  paths['/api/persons/{id}/reassign-qr-code']['post']['requestBody']['content']['application/json'];
type BodyParts = paths['/api/body-parts']['get']['responses'][200]['content']['application/json'];
type BodyPartToggleRequest =
  paths['/api/body-parts']['put']['requestBody']['content']['application/json'];
type ProtokollRecord =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['get']['responses'][200]['content']['application/json'];
type SaveProtokollRequest =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['requestBody']['content']['application/json'];
type SaveProtokollResponse =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['responses'][200]['content']['application/json'];
type ProtokollExport =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1/export']['get']['responses'][200]['content']['application/json'];
type PatientList = paths['/api/persons']['get']['responses'][200]['content']['application/json'];
type Team = paths['/api/teams']['get']['responses'][200]['content']['application/json'][number];
type TeamCreateRequest = paths['/api/teams']['post']['requestBody']['content']['application/json'];
type TeamUpdateRequest =
  paths['/api/teams/{id}']['put']['requestBody']['content']['application/json'];
type TriageHistoryEntry =
  paths['/api/persons/{id}/triage-history']['get']['responses'][200]['content']['application/json'][number];

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly auth = inject(AuthStore);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly client = createClient<paths>({ baseUrl: environment.apiBaseUrl });

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
  }

  qrLogin(qr_code: string): Observable<QrLoginResponse> {
    return this.unwrap(
      this.client.POST('/api/qr-login', { body: { qr_code } satisfies QrLoginRequest }),
    );
  }

  userLogin(body: CredentialsRequest): Observable<UserLoginResponse> {
    return this.unwrap(this.client.POST('/api/user-login', { body }));
  }

  adminLogin(body: CredentialsRequest): Observable<AdminLoginResponse> {
    return this.unwrap(this.client.POST('/api/admin-login', { body }));
  }

  changePassword(body: ChangePasswordRequest): Observable<void> {
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

  devLogin(role: DevLoginRequest['role']): Observable<DevLoginResponse> {
    return this.unwrap(
      this.client.POST('/api/dev-login', { body: { role } satisfies DevLoginRequest }),
    );
  }

  validateToken(): Observable<ValidateTokenResponse> {
    return this.unwrap(this.client.POST('/api/validate-token', {}));
  }

  refreshSession(): Observable<void> {
    const refreshToken = this.auth.activeSession()?.refreshToken;
    const owner = this.auth.sessionIdentity();
    if (!refreshToken) {
      return throwError(() => new Error('session cannot be refreshed'));
    }

    return this.unwrap(this.client.POST('/api/refresh-token', { body: { refreshToken } })).pipe(
      tap((tokens: RefreshTokenResponse) => {
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

  listScenes(): Observable<OperationScene[]> {
    return this.unwrap(this.client.GET('/api/operation-scenes', {}));
  }

  saveScene(body: SaveSceneRequest): Observable<OperationScene> {
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

  createUser(body: CreateUserRequest): Observable<User> {
    return this.unwrap(
      this.client.POST('/api/users', {
        body,
      }),
    );
  }

  listUsers(): Observable<UserList> {
    return this.unwrap(this.client.GET('/api/users'));
  }

  revokeUser(id: number): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/users/{id}/revoke', {
        params: { path: { id } },
      }),
    );
  }

  generateLoginQrCodes(body: GenerateLoginQrRequest): Observable<LoginQrCode[]> {
    return this.unwrap(
      this.client.POST('/api/login-qr-codes/generate', {
        body,
      }),
    );
  }

  listLoginQrCodes(eventSceneId?: number): Observable<LoginQrCode[]> {
    return this.unwrap(
      this.client.GET('/api/login-qr-codes', {
        params: { query: eventSceneId ? { eventSceneId } : {} },
      }),
    );
  }

  revokeLoginQrCode(id: number): Observable<void> {
    return this.unwrap(
      this.client.POST('/api/login-qr-codes/{id}/revoke', {
        params: { path: { id } },
      }),
    );
  }

  generatePatientQrCodes(body: GeneratePatientQrRequest): Observable<string[]> {
    return this.unwrap(
      this.client.POST('/api/patient-qr-codes/generate', {
        body,
      }),
    );
  }

  listUnusedPatientQrCodes(): Observable<string[]> {
    return this.unwrap(this.client.GET('/api/patient-qr-codes/unused', {}));
  }

  verifyPatientQrCode(body: VerifyPatientQrRequest): Observable<VerifyPatientQrResult> {
    return this.unwrap(
      this.client.POST('/api/verify-patient-qr-code', {
        body,
      }),
    );
  }

  createManualPatient(body: ManualPatientRequest): Observable<Patient> {
    return this.unwrap(
      this.client.POST('/api/persons/manual', {
        body,
      }),
    );
  }

  updateTriage(patientId: number, body: TriageUpdateRequest): Observable<Patient> {
    return this.unwrap(
      this.client.POST('/api/persons/{id}/update-triage-color', {
        params: { path: { id: patientId } },
        body,
      }),
    );
  }

  updatePatientLocation(patientId: number, body: LocationUpdateRequest): Observable<Patient> {
    return this.unwrap(
      this.client.POST('/api/persons/{id}/location', {
        params: { path: { id: patientId } },
        body,
      }),
    );
  }

  reassignPatientQrCode(patientId: number, body: ReassignQrRequest): Observable<Patient> {
    return this.unwrap(
      this.client.POST('/api/persons/{id}/reassign-qr-code', {
        params: { path: { id: patientId } },
        body,
      }),
    );
  }

  getBodyParts(patientId: number): Observable<BodyParts> {
    return this.unwrap(
      this.client.GET('/api/body-parts', {
        params: { query: { idpatient: patientId } },
      }),
    );
  }

  toggleBodyPart(body: BodyPartToggleRequest): Observable<BodyParts> {
    return this.unwrap(
      this.client.PUT('/api/body-parts', {
        body,
      }),
    );
  }

  getProtokollPage1(patientId: number): Observable<ProtokollRecord> {
    return this.unwrap(
      this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1', {
        params: { path: { patientId } },
      }),
    );
  }

  saveProtokollPage1(
    patientId: number,
    body: SaveProtokollRequest,
  ): Observable<SaveProtokollResponse> {
    return this.unwrap(
      this.client.PUT('/api/persons/{patientId}/ambulanzprotokoll-page1', {
        params: { path: { patientId } },
        body,
      }),
    );
  }

  exportProtokollPage1(patientId: number): Observable<ProtokollExport> {
    return this.unwrap(
      this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1/export', {
        params: { path: { patientId } },
      }),
    );
  }

  listPatients(operationSceneId: number): Observable<PatientList> {
    return this.unwrap(
      this.client.GET('/api/persons', {
        params: { query: { operationSceneId } },
      }),
    );
  }

  listTeams(operationSceneId: number): Observable<Team[]> {
    return this.unwrap(
      this.client.GET('/api/teams', {
        params: { query: { operationSceneId } },
      }),
    );
  }

  createTeam(body: TeamCreateRequest): Observable<Team> {
    return this.unwrap(
      this.client.POST('/api/teams', {
        body,
      }),
    );
  }

  updateTeam(id: number, body: TeamUpdateRequest): Observable<Team> {
    return this.unwrap(
      this.client.PUT('/api/teams/{id}', {
        params: { path: { id } },
        body,
      }),
    );
  }

  getTriageHistory(patientId: number): Observable<TriageHistoryEntry[]> {
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
