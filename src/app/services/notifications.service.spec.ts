import { TestBed } from '@angular/core/testing';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

import { auth } from '../firebase.config';

import { BackendService } from './backend.service';
import { NotificationsService } from './notifications.service';
import { ToastService } from './toast.service';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor-firebase/messaging', () => ({ FirebaseMessaging: { addListener: vi.fn() } }));

describe('Foreground notifications after reloading', () => {
  it('restores the listener from a saved device token and shows every received message as a toast', async () => {
    await auth.authStateReady();
    const original = auth.currentUser;
    Object.defineProperty(auth, 'currentUser', { value: { uid: 'alice' }, writable: true, configurable: true });
    localStorage.setItem('chat-dual-push-token', 'test-token');
    let received!: () => void;
    vi.mocked(FirebaseMessaging.addListener).mockImplementation(async (_event, callback) => {
      received = callback as () => void;
      return { remove: async () => undefined };
    });
    const mostrar = vi.fn().mockResolvedValue(undefined);
    const llamar = vi.fn().mockResolvedValue({});
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: { mostrar } },
        { provide: BackendService, useValue: { llamar } },
      ],
    });
    try {
      const service = TestBed.inject(NotificationsService);
      await Promise.all([service.vincularSesion(), service.vincularSesion()]);
      expect(FirebaseMessaging.addListener).toHaveBeenCalledOnce();
      received();
      received();
      expect(mostrar).toHaveBeenCalledTimes(2);
      expect(mostrar).toHaveBeenCalledWith('Tienes un nuevo mensaje');
      Object.defineProperty(auth, 'currentUser', { value: null });
      received();
      expect(mostrar).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(auth, 'currentUser', { value: original });
      localStorage.removeItem('chat-dual-push-token');
    }
  });
});
