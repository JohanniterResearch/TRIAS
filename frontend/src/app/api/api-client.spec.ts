import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import { ApiClient, ApiRequestError } from './api-client';

describe('ApiClient response handling', () => {
  const sync = { markServerContact: vi.fn() };
  const auth = {
    bearerToken: vi.fn(() => null),
    activeSession: vi.fn<() => any>(() => null),
    refreshTokens: vi.fn(),
  };
  let api: ApiClient;

  beforeEach(() => {
    sync.markServerContact.mockReset();
    auth.activeSession.mockReset().mockReturnValue(null);
    auth.refreshTokens.mockReset();
    TestBed.configureTestingModule({
      providers: [
        ApiClient,
        { provide: AuthStore, useValue: auth },
        { provide: SyncStatusService, useValue: sync },
      ],
    });
    api = TestBed.inject(ApiClient);
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
