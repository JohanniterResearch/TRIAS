import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import { apiErrorMessage, ApiClient, ApiRequestError } from './api-client';

describe('ApiClient response handling', () => {
  const sync = { markServerContact: vi.fn() };
  const auth = {
    bearerToken: vi.fn(() => null),
    activeSession: vi.fn<() => any>(() => null),
    refreshTokens: vi.fn(),
    sessionIdentity: vi.fn(),
  };
  let api: ApiClient;

  beforeEach(() => {
    sync.markServerContact.mockReset();
    auth.activeSession.mockReset().mockReturnValue(null);
    auth.refreshTokens.mockReset();
    auth.sessionIdentity.mockReturnValue({});
    TestBed.configureTestingModule({
      providers: [
        ApiClient,
        { provide: AuthStore, useValue: auth },
        { provide: SyncStatusService, useValue: sync },
      ],
    });
    api = TestBed.inject(ApiClient);
  });

  it('uses the structured API error message and retains the fallback for other failures', () => {
    expect(
      apiErrorMessage(
        new ApiRequestError(409, { message: 'Username already exists.' }),
        'Fallback',
      ),
    ).toBe('Username already exists.');
    expect(apiErrorMessage(new ApiRequestError(409, {}), 'Fallback')).toBe('Fallback');
    expect(apiErrorMessage(new Error('Network failed'), 'Fallback')).toBe('Fallback');
  });

  it.each([401, 403, 404, 500])(
    'throws ApiRequestError for an empty %i response',
    async (status) => {
      const result = firstValueFrom(
        (api as any).unwrap(
          Promise.resolve({
            response: new Response(null, { status }),
          }),
        ),
      );

      await expect(result).rejects.toMatchObject({ status } satisfies Partial<ApiRequestError>);
      expect(sync.markServerContact).not.toHaveBeenCalled();
    },
  );

  it('accepts a successful empty 204 response', async () => {
    await expect(
      firstValueFrom(
        (api as any).unwrap(
          Promise.resolve({
            response: new Response(null, { status: 204 }),
          }),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(sync.markServerContact).toHaveBeenCalledOnce();
  });

  it('revokes only the active session refresh token on logout', async () => {
    auth.activeSession.mockReturnValue({ refreshToken: 'current-refresh' });
    (api as any).client.POST = vi.fn(() =>
      Promise.resolve({ response: new Response(null, { status: 204 }) }),
    );

    await expect(firstValueFrom(api.logout())).resolves.toBeUndefined();
    expect((api as any).client.POST).toHaveBeenCalledWith('/api/logout', {
      body: { refreshToken: 'current-refresh' },
    });
  });

  it('rejects a replacement session even when it reused the same refresh credential', async () => {
    let complete!: (value: unknown) => void;
    auth.activeSession.mockReturnValue({ refreshToken: 'refresh-a', tokenType: 'user' });
    (api as any).client.POST = vi.fn(() => new Promise((resolve) => (complete = resolve)));
    const result = firstValueFrom(api.refreshSession());
    auth.sessionIdentity.mockReturnValue({});
    complete({
      data: { token: 'new', refreshToken: 'new-refresh' },
      response: new Response(null, { status: 200 }),
    });
    await expect(result).rejects.toThrow('active session changed');
    expect(auth.refreshTokens).not.toHaveBeenCalled();
  });

  it('does not apply a delayed refresh response to a replacement session', async () => {
    let complete!: (value: unknown) => void;
    auth.activeSession.mockReturnValue({ refreshToken: 'refresh-a', tokenType: 'user' });
    (api as any).client.POST = vi.fn(() => new Promise((resolve) => (complete = resolve)));

    const result = firstValueFrom(api.refreshSession());
    auth.activeSession.mockReturnValue({ refreshToken: 'refresh-b', tokenType: 'user' });
    complete({
      data: { token: 'access-a-new', refreshToken: 'refresh-a-new' },
      response: new Response(null, { status: 200 }),
    });

    await expect(result).rejects.toThrow('active session changed');
    expect(auth.refreshTokens).not.toHaveBeenCalled();
  });
});
