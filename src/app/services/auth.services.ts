import { inject, Injectable } from '@angular/core';
import type { UserCredential, Unsubscribe, User } from 'firebase/auth';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';

import { auth, firebaseConfig } from '../firebase.config';

import { BackendService } from './backend.service';
import { NotificationsService } from './notifications.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly backend = inject(BackendService);
  private readonly notifications = inject(NotificationsService);
  private readonly toasts = inject(ToastService);
  // Registrar usuario
  registrar(correo: string, contrasena: string): Promise<UserCredential> {
    return createUserWithEmailAndPassword(auth, correo, contrasena);
  }

  // Iniciar sesión
  ingresar(correo: string, contrasena: string): Promise<UserCredential> {
    return signInWithEmailAndPassword(auth, correo, contrasena);
  }

  // Cerrar sesión
  async salir(): Promise<void> {
    await this.notifications.desactivar();
    await signOut(auth);
  }

  // Consulta Firebase para comprobar que la sesión persistida sigue siendo válida.
  async comprobarSesion(): Promise<User | null> {
    await auth.authStateReady();
    const usuario = auth.currentUser;
    if (!usuario) return null;
    await usuario.reload();
    return auth.currentUser;
  }

  async obtenerUsuarioParaSupabase(): Promise<User> {
    const usuario = await this.comprobarSesion();
    if (!usuario) {
      throw new Error('Inicia sesión en Firebase antes de guardar tu perfil');
    }

    // Recoge los claims asignados por Admin SDK, incluso con una sesión ya abierta.
    let token = await usuario.getIdTokenResult(true);
    if (
      token.claims['aud'] !== firebaseConfig.projectId ||
      token.claims['iss'] !== `https://securetoken.google.com/${firebaseConfig.projectId}` ||
      token.claims['sub'] !== usuario.uid
    ) {
      throw new Error(`La sesión de Firebase no corresponde al proyecto ${firebaseConfig.projectId}`);
    }
    if (token.claims['role'] !== 'authenticated') {
      await this.backend.llamar('prepareSession');
      token = await usuario.getIdTokenResult(true);
    }
    if (token.claims['role'] !== 'authenticated') {
      throw new Error(
        `La sesión de Firebase es válida, pero falta el permiso para Supabase. ` +
          `Asigna role=authenticated mediante Admin SDK al UID ${usuario.uid} en ${firebaseConfig.projectId} y vuelve a guardar.`,
      );
    }
    if (auth.currentUser?.uid !== usuario.uid) {
      throw new Error('La sesión cambió. Vuelve a intentar guardar el perfil');
    }
    return usuario;
  }

  // Saber si el usuario está autenticado
  observar(callback: (usuario: User | null) => void): Unsubscribe {
    return onAuthStateChanged(auth, (usuario) => {
      if (usuario)
        void this.notifications
          .vincularSesion()
          .catch(() => this.toasts.mostrar('Vuelve a activar las notificaciones', 'danger'));
      callback(usuario);
    });
  }
}
