import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

import { AuthService } from './auth.services';
import { ChatService } from './chat.service';
import type { Amistad, Sala } from './chat.service';
import { ProfilesService } from './profiles.service';
import type { Perfil } from './profiles.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class ChatSessionService {
  readonly uid = signal('');
  readonly perfil = signal<Perfil | null>(null);
  readonly cargando = signal(true);
  readonly errorSalas = signal('');
  private readonly salas = signal<Sala[]>([]);
  private readonly amistades = signal<Amistad[]>([]);
  readonly contactos = computed(() =>
    this.amistades()
      .flatMap((amistad) => {
        const persona = amistad.contacts.find((contacto) => contacto.uid !== this.uid());
        return persona ? [{ ...amistad, persona }] : [];
      })
      .sort((a, b) => a.persona.nombre.localeCompare(b.persona.nombre)),
  );
  readonly amigos = computed(() =>
    this.contactos()
      .filter((item) => item.status === 'accepted')
      .map((item) => item.persona),
  );
  readonly salasVisibles = computed(() =>
    this.salas()
      .map((sala) => {
        if (!sala.direct) return sala;
        const contacto =
          this.amigos().find((persona) => sala.memberUids.includes(persona.uid)) ??
          sala.directNames?.find((persona) => persona.uid !== this.uid());
        return contacto ? { ...sala, title: contacto.nombre } : sala;
      })
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  private readonly chat = inject(ChatService);
  private readonly profiles = inject(ProfilesService);
  private readonly toasts = inject(ToastService);

  constructor() {
    let cancelarSalas: (() => void) | undefined;
    let cancelarAmistades: (() => void) | undefined;
    const cancelarAuth = inject(AuthService).observar((user) => {
      cancelarSalas?.();
      cancelarAmistades?.();
      this.uid.set(user?.uid ?? '');
      this.perfil.set(null);
      this.salas.set([]);
      this.amistades.set([]);
      this.errorSalas.set('');
      this.cargando.set(!!user);
      if (!user) return;
      const uid = user.uid;
      cancelarSalas = this.chat.observarSalas(
        uid,
        (salas) => {
          if (this.uid() !== uid) return;
          this.salas.set(salas);
          this.cargando.set(false);
        },
        (error) => {
          if (this.uid() !== uid) return;
          this.errorSalas.set(error.message);
          this.cargando.set(false);
        },
      );
      cancelarAmistades = this.chat.observarAmistades(
        uid,
        (amistades) => {
          if (this.uid() === uid) this.amistades.set(amistades);
        },
        (error) => {
          if (this.uid() === uid) void this.toasts.mostrar(error.message, 'danger');
        },
      );
      void this.refrescarPerfil();
    });
    inject(DestroyRef).onDestroy(() => {
      cancelarAuth();
      cancelarSalas?.();
      cancelarAmistades?.();
    });
  }

  async refrescarPerfil(): Promise<void> {
    const uid = this.uid();
    if (!uid) return;
    try {
      const perfil = await this.profiles.obtenerMiPerfil();
      if (this.uid() === uid) this.perfil.set(perfil);
    } catch (error) {
      if (this.uid() === uid)
        void this.toasts.mostrar(error instanceof Error ? error.message : 'No se pudo cargar el perfil', 'danger');
    }
  }
}
