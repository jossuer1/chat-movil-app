import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';

import { auth } from '../firebase.config';

import { AuthService } from './auth.services';
import { BackendService } from './backend.service';

describe('AuthService Supabase identity', () => {
  let originalUser: User | null;
  let user: { uid: string; reload: ReturnType<typeof vi.fn>; getIdTokenResult: ReturnType<typeof vi.fn> };
  const claims = {
    aud: 'chat-dual-f31e5',
    iss: 'https://securetoken.google.com/chat-dual-f31e5',
    sub: 'firebase-uid',
    role: 'authenticated',
  };

  beforeAll(async () => {
    await auth.authStateReady();
    originalUser = auth.currentUser;
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: BackendService, useValue: { llamar: vi.fn().mockResolvedValue({}) } }],
    });
    vi.spyOn(auth, 'authStateReady').mockResolvedValue(undefined);
    user = {
      uid: 'firebase-uid',
      reload: vi.fn().mockResolvedValue(undefined),
      getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
    };
    Object.defineProperty(auth, 'currentUser', { value: user, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(auth, 'currentUser', { value: originalUser, writable: true, configurable: true });
    vi.restoreAllMocks();
  });

  it('checks the user on Firebase and refreshes the token before accepting the identity', async () => {
    const service = TestBed.inject(AuthService);
    expect(await service.obtenerUsuarioParaSupabase()).toBe(auth.currentUser);
    expect(user.reload).toHaveBeenCalledOnce();
    expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
  });

  it('rejects an unauthenticated session', async () => {
    Object.defineProperty(auth, 'currentUser', { value: null });
    await expect(TestBed.inject(AuthService).obtenerUsuarioParaSupabase()).rejects.toThrow('Inicia sesión');
  });

  it('prepares a newly registered account and refreshes its claims before accessing Supabase', async () => {
    user.getIdTokenResult
      .mockResolvedValueOnce({ claims: { ...claims, role: undefined } })
      .mockResolvedValueOnce({ claims });
    expect(await TestBed.inject(AuthService).obtenerUsuarioParaSupabase()).toBe(auth.currentUser);
    expect(TestBed.inject(BackendService).llamar).toHaveBeenCalledWith('prepareSession');
    expect(user.getIdTokenResult).toHaveBeenCalledTimes(2);
  });

  it('reports the UID and project when the server has not assigned the role', async () => {
    user.getIdTokenResult.mockResolvedValue({ claims: { ...claims, role: undefined } });
    await expect(TestBed.inject(AuthService).obtenerUsuarioParaSupabase()).rejects.toThrow(
      'Asigna role=authenticated mediante Admin SDK al UID firebase-uid en chat-dual-f31e5',
    );
  });

  it('rejects a token issued for a different project even when the role is present', async () => {
    user.getIdTokenResult.mockResolvedValue({ claims: { ...claims, aud: 'otro-proyecto' } });
    await expect(TestBed.inject(AuthService).obtenerUsuarioParaSupabase()).rejects.toThrow(
      'no corresponde al proyecto',
    );
  });

  it('rejects a session whose cached user has been deleted from Firebase', async () => {
    user.reload.mockRejectedValue(new Error('auth/user-not-found'));
    await expect(TestBed.inject(AuthService).obtenerUsuarioParaSupabase()).rejects.toThrow('auth/user-not-found');
  });
});
