import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';

import { auth } from '../firebase.config';
import { supabaseConfig } from '../supabase.config';

import { BackendService } from './backend.service';

describe('BackendService Edge transport', () => {
  let originalUser: User | null;
  let getIdToken: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    await auth.authStateReady();
    originalUser = auth.currentUser;
  });
  beforeEach(() => {
    getIdToken = vi.fn().mockResolvedValue('firebase-id-token');
    Object.defineProperty(auth, 'currentUser', {
      value: { uid: 'alice', getIdToken },
      writable: true,
      configurable: true,
    });
    vi.spyOn(auth, 'authStateReady').mockResolvedValue(undefined);
    fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    Object.defineProperty(auth, 'currentUser', { value: originalUser, writable: true, configurable: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('calls Supabase with the Firebase token and public key', async () => {
    await expect(TestBed.inject(BackendService).llamar('createRoom', { title: 'Room' })).resolves.toEqual({ ok: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${supabaseConfig.url}/functions/v1/chat-api`);
    expect(options.headers.Authorization).toBe('Bearer firebase-id-token');
    expect(options.headers.apikey).toBe(supabaseConfig.publishableKey);
    expect(JSON.parse(options.body)).toEqual({ action: 'createRoom', data: { title: 'Room' } });
  });

  it('refreshes the Firebase token once after an authentication rejection', async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(Response.json({ error: { message: 'expired' } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: { ok: true } }));
    await TestBed.inject(BackendService).llamar('prepareSession');
    expect(getIdToken.mock.calls.map((call) => call[0])).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an unauthenticated caller before making a network request', async () => {
    Object.defineProperty(auth, 'currentUser', { value: null });
    await expect(TestBed.inject(BackendService).llamar('createRoom')).rejects.toThrow('Inicia sesión');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an undeployed function clearly', async () => {
    fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(TestBed.inject(BackendService).llamar('createRoom')).rejects.toThrow('todavía no está desplegada');
  });
});
