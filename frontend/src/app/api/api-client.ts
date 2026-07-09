import { inject, Injectable } from '@angular/core';
import createClient from 'openapi-fetch';
import { from, map, Observable, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import type { paths } from './openapi-types';

type QrLoginRequest =
  paths['/api/qr-login']['post']['requestBody']['content']['application/json'];
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
type CreateUserRequest =
  paths['/api/users']['post']['requestBody']['content']['application/json'];
type User =
  paths['/api/users']['post']['responses'][201]['content']['application/json'];
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
type BodyParts =
  paths['/api/body-parts']['get']['responses'][200]['content']['application/json'];
type BodyPartToggleRequest =
  paths['/api/body-parts']['put']['requestBody']['content']['application/json'];
type ProtokollRecord =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['get']['responses'][200]['content']['application/json'];
type SaveProtokollRequest =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['requestBody']['content']['application/json'];
type ProtokollExport =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1/export']['get']['responses'][200]['content']['application/json'];

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly auth = inject(AuthStore);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly client = createClient<paths>({ baseUrl: environment.apiBaseUrl });

  qrLogin(qr_code: string): Observable<QrLoginResponse> {
    return this.unwrap(this.client.POST('/api/qr-login', { body: { qr_code } satisfies QrLoginRequest }));
  }

  userLogin(body: CredentialsRequest): Observable<UserLoginResponse> {
    return this.unwrap(this.client.POST('/api/user-login', { body }));
  }

  adminLogin(body: CredentialsRequest): Observable<AdminLoginResponse> {
    return this.unwrap(this.client.POST('/api/admin-login', { body }));
  }

  changePassword(body: ChangePasswordRequest): Observable<void> {
    return this.unwrap(this.client.POST('/api/users/change-password', {
      body,
      headers: this.authHeaders(),
    }));
  }

  selfCancel(): Observable<void> {
    return this.unwrap(this.client.POST('/api/users/self-cancel', {
      headers: this.authHeaders(),
    }));
  }

  devLogin(role: DevLoginRequest['role']): Observable<DevLoginResponse> {
    return this.unwrap(this.client.POST('/api/dev-login', { body: { role } satisfies DevLoginRequest }));
  }

  validateToken(): Observable<ValidateTokenResponse> {
    return this.unwrap(this.client.POST('/api/validate-token', {
      headers: this.authHeaders(),
    }));
  }

  listScenes(): Observable<OperationScene[]> {
    return this.unwrap(this.client.GET('/api/operation-scenes', {
      headers: this.authHeaders(),
    }));
  }

  saveScene(body: SaveSceneRequest): Observable<OperationScene> {
    return this.unwrap(this.client.POST('/api/operation-scenes', {
      body,
      headers: this.authHeaders(),
    }));
  }

  deleteScene(id: number): Observable<void> {
    return this.unwrap(this.client.DELETE('/api/operation-scenes/{id}', {
      params: { path: { id } },
      headers: this.authHeaders(),
    }));
  }

  createUser(body: CreateUserRequest): Observable<User> {
    return this.unwrap(this.client.POST('/api/users', {
      body,
      headers: this.authHeaders(),
    }));
  }

  revokeUser(id: number): Observable<void> {
    return this.unwrap(this.client.POST('/api/users/{id}/revoke', {
      params: { path: { id } },
      headers: this.authHeaders(),
    }));
  }

  generateLoginQrCodes(body: GenerateLoginQrRequest): Observable<LoginQrCode[]> {
    return this.unwrap(this.client.POST('/api/login-qr-codes/generate', {
      body,
      headers: this.authHeaders(),
    }));
  }

  listLoginQrCodes(eventSceneId?: number): Observable<LoginQrCode[]> {
    return this.unwrap(this.client.GET('/api/login-qr-codes', {
      params: { query: eventSceneId ? { eventSceneId } : {} },
      headers: this.authHeaders(),
    }));
  }

  revokeLoginQrCode(id: number): Observable<void> {
    return this.unwrap(this.client.POST('/api/login-qr-codes/{id}/revoke', {
      params: { path: { id } },
      headers: this.authHeaders(),
    }));
  }

  generatePatientQrCodes(body: GeneratePatientQrRequest): Observable<string[]> {
    return this.unwrap(this.client.POST('/api/patient-qr-codes/generate', {
      body,
      headers: this.authHeaders(),
    }));
  }

  listUnusedPatientQrCodes(): Observable<string[]> {
    return this.unwrap(this.client.GET('/api/patient-qr-codes/unused', {
      headers: this.authHeaders(),
    }));
  }

  verifyPatientQrCode(body: VerifyPatientQrRequest): Observable<VerifyPatientQrResult> {
    return this.unwrap(this.client.POST('/api/verify-patient-qr-code', {
      body,
      headers: this.authHeaders(),
    }));
  }

  createManualPatient(body: ManualPatientRequest): Observable<Patient> {
    return this.unwrap(this.client.POST('/api/persons/manual', {
      body,
      headers: this.authHeaders(),
    }));
  }

  updateTriage(patientId: number, body: TriageUpdateRequest): Observable<Patient> {
    return this.unwrap(this.client.POST('/api/persons/{id}/update-triage-color', {
      params: { path: { id: patientId } },
      body,
      headers: this.authHeaders(),
    }));
  }

  updatePatientLocation(patientId: number, body: LocationUpdateRequest): Observable<Patient> {
    return this.unwrap(this.client.POST('/api/persons/{id}/location', {
      params: { path: { id: patientId } },
      body,
      headers: this.authHeaders(),
    }));
  }

  reassignPatientQrCode(patientId: number, body: ReassignQrRequest): Observable<Patient> {
    return this.unwrap(this.client.POST('/api/persons/{id}/reassign-qr-code', {
      params: { path: { id: patientId } },
      body,
      headers: this.authHeaders(),
    }));
  }

  getBodyParts(patientId: number): Observable<BodyParts> {
    return this.unwrap(this.client.GET('/api/body-parts', {
      params: { query: { idpatient: patientId } },
      headers: this.authHeaders(),
    }));
  }

  toggleBodyPart(body: BodyPartToggleRequest): Observable<BodyParts> {
    return this.unwrap(this.client.PUT('/api/body-parts', {
      body,
      headers: this.authHeaders(),
    }));
  }

  getProtokollPage1(patientId: number): Observable<ProtokollRecord> {
    return this.unwrap(this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1', {
      params: { path: { patientId } },
      headers: this.authHeaders(),
    }));
  }

  saveProtokollPage1(patientId: number, body: SaveProtokollRequest): Observable<ProtokollRecord> {
    return this.unwrap(this.client.PUT('/api/persons/{patientId}/ambulanzprotokoll-page1', {
      params: { path: { patientId } },
      body,
      headers: this.authHeaders(),
    }));
  }

  exportProtokollPage1(patientId: number): Observable<ProtokollExport> {
    return this.unwrap(this.client.GET('/api/persons/{patientId}/ambulanzprotokoll-page1/export', {
      params: { path: { patientId } },
      headers: this.authHeaders(),
    }));
  }

  private unwrap<T>(request: Promise<{ data?: T; error?: unknown }>): Observable<T> {
    return from(request).pipe(
      map(({ data, error }) => {
        if (error) {
          throw error;
        }

        return data as T;
      }),
      tap(() => this.syncStatus.markSynced()),
    );
  }

  private authHeaders(): { Authorization: string } | undefined {
    const token = this.auth.bearerToken();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  }
}
