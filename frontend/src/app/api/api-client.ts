import { inject, Injectable } from '@angular/core';
import createClient from 'openapi-fetch';
import { from, map, Observable, tap } from 'rxjs';

import { environment } from '../../environments/environment';
import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import type { paths } from './openapi-types';

type ValidateTokenResponse =
  paths['/api/validate-token']['post']['responses'][200]['content']['application/json'];

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly auth = inject(AuthStore);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly client = createClient<paths>({ baseUrl: environment.apiBaseUrl });

  validateToken(): Observable<ValidateTokenResponse> {
    const token = this.auth.bearerToken();

    return from(this.client.POST('/api/validate-token', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })).pipe(
      map(({ data, error }) => {
        if (error || !data) {
          throw error ?? new Error('Token validation failed');
        }

        return data;
      }),
      tap(() => this.syncStatus.markSynced()),
    );
  }
}
