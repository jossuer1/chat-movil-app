import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

import { chatConfig } from '../chat.config';
import { auth, firebaseConfig } from '../firebase.config';

import { BackendService } from './backend.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly toasts = inject(ToastService);
  private readonly backend = inject(BackendService);
  private token = localStorage.getItem('chat-dual-push-token') ?? '';
  private registeredUid = '';
  private listenersReady?: Promise<void>;

  async activar(): Promise<void> {
    if (!auth.currentUser) throw new Error('Inicia sesión para activar las notificaciones');
    if (!(await FirebaseMessaging.isSupported()).isSupported)
      throw new Error('Este dispositivo no admite notificaciones push');
    const native = Capacitor.isNativePlatform();
    if (!native && !chatConfig.vapidKey) throw new Error('Configura la clave pública VAPID en chat.config.ts');
    const permiso = await FirebaseMessaging.requestPermissions();
    if (permiso.receive !== 'granted') throw new Error('Las notificaciones están bloqueadas en este dispositivo');
    await this.inicializarListeners();
    const serviceWorkerRegistration = native
      ? undefined
      : await navigator.serviceWorker.register(
          `/assets/firebase-messaging-sw.js?config=${encodeURIComponent(JSON.stringify(firebaseConfig))}`,
        );
    const worker = serviceWorkerRegistration?.installing ?? serviceWorkerRegistration?.waiting;
    if (serviceWorkerRegistration && !serviceWorkerRegistration.active && worker) {
      await new Promise<void>((resolve, reject) => {
        const changed = (): void => {
          if (worker.state === 'activated' || worker.state === 'redundant') {
            worker.removeEventListener('statechange', changed);
            if (worker.state === 'activated') resolve();
            else reject(new Error('No se pudo activar el servicio de notificaciones'));
          }
        };
        worker.addEventListener('statechange', changed);
        changed();
      });
    }
    const result = await FirebaseMessaging.getToken({ vapidKey: chatConfig.vapidKey, serviceWorkerRegistration });
    await this.registrar(result.token);
    await this.toasts.mostrar('Notificaciones activadas', 'success');
  }

  private inicializarListeners(): Promise<void> {
    this.listenersReady ??= this.instalarListeners().catch((error: unknown) => {
      this.listenersReady = undefined;
      throw error;
    });
    return this.listenersReady;
  }

  private async instalarListeners(): Promise<void> {
    const handles = [];
    try {
      handles.push(
        await FirebaseMessaging.addListener('notificationReceived', () => {
          if (auth.currentUser) void this.toasts.mostrar('Tienes un nuevo mensaje');
        }),
      );
      if (Capacitor.isNativePlatform()) {
        handles.push(
          await FirebaseMessaging.addListener('tokenReceived', (event) => {
            void this.registrar(event.token).catch(() =>
              this.toasts.mostrar('Vuelve a activar las notificaciones para registrar este dispositivo', 'danger'),
            );
          }),
        );
        handles.push(
          await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
            const roomId = (event.notification.data as { roomId?: string } | undefined)?.roomId;
            if (roomId && auth.currentUser) window.location.assign(`/home?room=${encodeURIComponent(roomId)}`);
          }),
        );
      }
    } catch (error) {
      await Promise.allSettled(handles.map((handle) => handle.remove()));
      throw error;
    }
  }

  private async registrar(token: string): Promise<void> {
    this.token = token;
    this.registeredUid = '';
    localStorage.setItem('chat-dual-push-token', token);
    await this.vincularSesion();
  }

  async vincularSesion(): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!this.token || !uid) return;
    await this.inicializarListeners();
    if (uid === this.registeredUid) return;
    await this.backend.llamar('registerDevice', { token: this.token });
    this.registeredUid = uid;
  }

  async desactivar(): Promise<void> {
    if (!this.token) return;
    try {
      await this.backend.llamar('unregisterDevice', { token: this.token });
    } catch {
      await this.toasts.mostrar('No se pudo retirar el registro remoto de notificaciones', 'danger');
    }
    try {
      await FirebaseMessaging.deleteToken();
    } catch {
      await this.toasts.mostrar('No se pudo eliminar el token de este dispositivo', 'danger');
    } finally {
      this.token = '';
      this.registeredUid = '';
      localStorage.removeItem('chat-dual-push-token');
    }
  }
}
