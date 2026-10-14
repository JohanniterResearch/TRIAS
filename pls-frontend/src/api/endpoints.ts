// Typed wrappers for the Ambulanzsystem API (contract/openapi.yaml -> openapi-types.ts).
// Tokens are added by the client interceptor, never passed here, so a retry after refresh uses
// the new token.
import type { AxiosRequestConfig } from 'axios';
import client from './client';
import type { components, paths } from './openapi-types';
import type { TriageColor } from '../types/triageColor';

export type Schemas = components['schemas'];

type JsonContent<T> = T extends { content: { 'application/json': infer B } } ? B : never;

/** Request body of an operation. */
export type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { requestBody?: infer R }
  ? JsonContent<NonNullable<R>>
  : never;

/** Response body of an operation for one status code. */
export type Res<P extends keyof paths, M extends keyof paths[P], S extends number = 200> = paths[P][M] extends {
  responses: infer R;
}
  ? S extends keyof R
    ? JsonContent<R[S]>
    : never
  : never;

export type Patient = Schemas['Patient'];
export type OperationScene = Schemas['OperationScene'];
export type LoginQrCode = Schemas['LoginQrCode'];

// Auth
export const qrLogin = (qr_code: string) => client.post<Res<'/api/qr-login', 'post'>>('/api/qr-login', { qr_code });

export const userLogin = (username: string, password: string) =>
  client.post<Res<'/api/user-login', 'post'>>('/api/user-login', { username, password } satisfies Body<'/api/user-login', 'post'>);

export const adminLogin = (username: string, password: string) =>
  client.post<Res<'/api/admin-login', 'post'>>('/api/admin-login', { username, password } satisfies Body<'/api/admin-login', 'post'>);

// DEV ONLY: 404 unless the backend runs in Development with Features:EnableDevLogin.
export const devLogin = (role: Body<'/api/dev-login', 'post'>['role']) =>
  client.post<Res<'/api/dev-login', 'post'>>('/api/dev-login', { role });

export const validateToken = () => client.post<Res<'/api/validate-token', 'post'>>('/api/validate-token');

export const logout = (refreshToken: string) => client.post('/api/logout', { refreshToken } satisfies Body<'/api/logout', 'post'>);

export const changePassword = (body: Body<'/api/users/change-password', 'post'>) => client.post('/api/users/change-password', body);

// Persons
export const getPersons = (operationSceneId: number) =>
  client.get<Res<'/api/persons', 'get'>>('/api/persons', { params: { operationSceneId } });

export const verifyPatientQrCode = (qr_code: string, operationSceneId: number) =>
  client.post<Res<'/api/verify-patient-qr-code', 'post'>>('/api/verify-patient-qr-code', {
    qr_code,
    operationSceneId,
  } satisfies Body<'/api/verify-patient-qr-code', 'post'>);

export type TriageUpdate = Omit<Body<'/api/persons/{id}/update-triage-color', 'post'>, 'triageColor'> & { triageColor?: TriageColor };

// Writes take an optional config, so a caller can bind the request to the session that made
// the change (`expectedOwner`).
export const updateTriageColor = (patientId: number, data: TriageUpdate, config?: AxiosRequestConfig) =>
  client.post<Patient>(`/api/persons/${patientId}/update-triage-color`, data satisfies Body<'/api/persons/{id}/update-triage-color', 'post'>, config);

export const updateRespiration = (patientId: number, data: Body<'/api/persons/{id}/respiration', 'post'>, config?: AxiosRequestConfig) =>
  client.post<Patient>(`/api/persons/${patientId}/respiration`, data, config);

export const updatePatientLocation = (patientId: number, data: Body<'/api/persons/{id}/location', 'post'>, config?: AxiosRequestConfig) =>
  client.post<Patient>(`/api/persons/${patientId}/location`, data, config);

/** Patient without a QR tag (WP 3.1). Replaying the same clientGeneratedId returns the same patient. */
export const createManualPatient = (body: Body<'/api/persons/manual', 'post'>, config?: AxiosRequestConfig) =>
  client.post<Patient>('/api/persons/manual', body, config);

/** Binds an unbound patient QR code to the patient and releases its previous one (WP 3.2). */
export const reassignPatientQrCode = (patientId: number, qr_code: string) =>
  client.post<Patient>(`/api/persons/${patientId}/reassign-qr-code`, { qr_code } satisfies Body<'/api/persons/{id}/reassign-qr-code', 'post'>);

export type TriageHistoryEntry = Schemas['TriageHistoryEntry'];

/** LeitstelleOrAdmin; the server refuses responder and QR sessions (WP 3.5). */
export const getTriageHistory = (patientId: number) =>
  client.get<Res<'/api/persons/{id}/triage-history', 'get'>>(`/api/persons/${patientId}/triage-history`);

// Body parts (Ambulanzsystem region keys; translate with api/codecs/bodyMap.ts)
export const getBodyParts = (idpatient: number) =>
  client.get<Res<'/api/body-parts', 'get'>>('/api/body-parts', { params: { idpatient } });

export const saveBodyPart = (idpatient: number, bodyPartId: string, isClicked: boolean, config?: AxiosRequestConfig) =>
  client.put<Res<'/api/body-parts', 'put'>>('/api/body-parts', { idpatient, bodyPartId, isClicked } satisfies Body<'/api/body-parts', 'put'>, config);

// QR codes
export const generatePatientQRCodes = (number: number) =>
  client.post<Res<'/api/patient-qr-codes/generate', 'post', 201>>('/api/patient-qr-codes/generate', { number });

export const getUnusedPatientQrCodes = () => client.get<Res<'/api/patient-qr-codes/unused', 'get'>>('/api/patient-qr-codes/unused');

export const generateLoginQRCodes = (body: Body<'/api/login-qr-codes/generate', 'post'>) =>
  client.post<Res<'/api/login-qr-codes/generate', 'post', 201>>('/api/login-qr-codes/generate', body);

export const getLoginQrCodes = (params: { eventSceneId?: number; unusedOnly?: boolean } = {}) =>
  client.get<Res<'/api/login-qr-codes', 'get'>>('/api/login-qr-codes', { params });

// Operation scenes
export const getOperationScenes = () => client.get<Res<'/api/operation-scenes', 'get'>>('/api/operation-scenes');

export const saveOperationScene = (body: Body<'/api/operation-scenes', 'post'>) =>
  client.post<Res<'/api/operation-scenes', 'post'>>('/api/operation-scenes', body);

export const deleteOperationScene = (id: number) => client.delete(`/api/operation-scenes/${id}`);

// Users
export const createUser = (body: Body<'/api/users', 'post'>) => client.post<Res<'/api/users', 'post', 201>>('/api/users', body);

export type User = Schemas['User'];
export type Organisation = Schemas['Organisation'];

export const listUsers = () => client.get<Res<'/api/users', 'get'>>('/api/users');

export const revokeUser = (id: number) => client.post(`/api/users/${id}/revoke`);

/** Ends the caller's own access (responder or QR session). */
export const selfCancel = () => client.post('/api/users/self-cancel');

// Admin management (AdminOnly): non-Admin accounts only.
export const searchAdminUsers = (params: {
  search?: string;
  role?: 'responder' | 'leitstelle';
  accountType?: 'permanent' | 'event';
  status?: 'active' | 'revoked';
  page?: number;
  pageSize?: number;
}) => client.get<Res<'/api/admin/users', 'get'>>('/api/admin/users', { params });

export const updateAdminUser = (id: number, body: Body<'/api/admin/users/{id}', 'put'>) =>
  client.put<Res<'/api/admin/users/{id}', 'put'>>(`/api/admin/users/${id}`, body);

export const resetAdminUserPassword = (id: number, temporaryPassword: string) =>
  client.post(`/api/admin/users/${id}/reset-password`, { temporaryPassword } satisfies Body<'/api/admin/users/{id}/reset-password', 'post'>);

export const reactivateAdminUser = (id: number, temporaryPassword: string) =>
  client.post(`/api/admin/users/${id}/reactivate`, { temporaryPassword } satisfies Body<'/api/admin/users/{id}/reactivate', 'post'>);

// Organisations (AdminOnly)
export const getOrganisations = () => client.get<Res<'/api/organisations', 'get'>>('/api/organisations');

export const createOrganisation = (name: string) =>
  client.post<Res<'/api/organisations', 'post', 201>>('/api/organisations', { name } satisfies Body<'/api/organisations', 'post'>);

// Teams (WP 5.2): create LeitstelleOrAdmin; read and update TriageWrite.
export type Team = Schemas['Team'];

export const getTeams = (operationSceneId: number) =>
  client.get<Res<'/api/teams', 'get'>>('/api/teams', { params: { operationSceneId } });

export const createTeam = (operationSceneId: number, name: string) =>
  client.post<Team>('/api/teams', { operationSceneId, name } satisfies Body<'/api/teams', 'post'>);

export const updateTeam = (id: number, body: Body<'/api/teams/{id}', 'put'>) => client.put<Team>(`/api/teams/${id}`, body);

// Admin patient search and correction (WP 5.3, AdminOnly). Patients are addressed by an opaque
// editReference, never by id.
export type AdminPatient = Schemas['AdminPatient'];
export type AdminPatientDetails = Schemas['AdminPatientDetails'];

export const searchAdminPatients = (params: { search?: string; operationSceneId?: number; status?: string; page?: number; pageSize?: number }) =>
  client.get<Res<'/api/admin/patients', 'get'>>('/api/admin/patients', { params });

export const getAdminPatientDetails = (reference: string) =>
  client.get<AdminPatientDetails>(`/api/admin/patients/${encodeURIComponent(reference)}/details`);

export const updateAdminPatient = (reference: string, body: Record<string, unknown>) =>
  client.put<AdminPatient>(`/api/admin/patients/${encodeURIComponent(reference)}`, body);

export const updateAdminPatientBodyParts = (reference: string, body: Schemas['AdminBodyPartsUpdate']) =>
  client.put<AdminPatientDetails>(`/api/admin/patients/${encodeURIComponent(reference)}/body-parts`, body);

export const getAvailablePatientQrCodes = (page = 1, pageSize = 50) =>
  client.get<Res<'/api/admin/patient-qr-codes/available', 'get'>>('/api/admin/patient-qr-codes/available', { params: { page, pageSize } });

export const assignAdminPatientQrCode = (reference: string, body: Schemas['AssignAdminPatientQrCode']) =>
  client.post<Schemas['AssignAdminPatientQrCodeResponse']>(`/api/admin/patients/${encodeURIComponent(reference)}/assign-qr-code`, body);

export const revokeLoginQrCode = (id: number) => client.post(`/api/login-qr-codes/${id}/revoke`);
