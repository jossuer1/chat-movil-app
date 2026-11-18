import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonFooter, IonHeader, IonIcon, IonInput } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { createOutline, notificationsOutline, searchOutline } from 'ionicons/icons';

import { ChatSessionService } from '../services/chat-session.service';
import { ChatService } from '../services/chat.service';
import { NotificationsService } from '../services/notifications.service';
import { ToastService } from '../services/toast.service';
import { AvatarComponent } from '../shared/avatar.component';
import { MainNavComponent } from '../shared/main-nav.component';

@Component({
  selector: 'app-chats',
  templateUrl: './chats.page.html',
  imports: [
    FormsModule,
    RouterLink,
    IonButton,
    IonContent,
    IonFooter,
    IonHeader,
    IonIcon,
    IonInput,
    AvatarComponent,
    MainNavComponent,
  ],
})
export class ChatsPage {
  readonly session = inject(ChatSessionService);
  readonly busqueda = signal('');
  readonly crear = signal(false);
  readonly ocupado = signal(false);
  readonly salas = computed(() =>
    this.session
      .salasVisibles()
      .filter((sala) => sala.title.toLocaleLowerCase().includes(this.busqueda().trim().toLocaleLowerCase())),
  );
  titulo = '';
  private pendiente?: { id: string; titulo: string };
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);
  private readonly toasts = inject(ToastService);

  constructor() {
    addIcons({ createOutline, notificationsOutline, searchOutline });
  }
  ionViewWillEnter(): void {
    void this.session.refrescarPerfil();
  }

  async crearSala(): Promise<void> {
    const titulo = this.titulo.trim();
    if (!titulo || !this.session.perfil() || this.ocupado()) return;
    this.ocupado.set(true);
    try {
      if (this.pendiente?.titulo !== titulo) this.pendiente = { id: crypto.randomUUID(), titulo };
      const { id } = await this.chat.crearSala(this.pendiente.id, titulo);
      this.titulo = '';
      this.pendiente = undefined;
      this.crear.set(false);
      await this.router.navigate(['/room', id]);
    } catch (error) {
      await this.toasts.mostrar(error instanceof Error ? error.message : 'No se pudo crear la sala', 'danger');
    } finally {
      this.ocupado.set(false);
    }
  }

  async activarNotificaciones(): Promise<void> {
    try {
      await this.notifications.activar();
    } catch (error) {
      await this.toasts.mostrar(
        error instanceof Error ? error.message : 'No se pudieron activar las notificaciones',
        'danger',
      );
    }
  }
}
