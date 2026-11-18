import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonContent, IonFooter, IonHeader, IonIcon, IonInput } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { notificationsOutline } from 'ionicons/icons';

import { ChatSessionService } from '../services/chat-session.service';
import { ChatService } from '../services/chat.service';
import type { Participante } from '../services/chat.service';
import { NotificationsService } from '../services/notifications.service';
import { ToastService } from '../services/toast.service';
import { AvatarComponent } from '../shared/avatar.component';
import { MainNavComponent } from '../shared/main-nav.component';

@Component({
  selector: 'app-friends',
  templateUrl: './friends.page.html',
  imports: [
    FormsModule,
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
export class FriendsPage {
  readonly session = inject(ChatSessionService);
  readonly encontrado = signal<Participante | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal('');
  identificador = '';
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);
  private readonly toasts = inject(ToastService);

  constructor() {
    addIcons({ notificationsOutline });
  }
  ionViewWillEnter(): void {
    void this.session.refrescarPerfil();
  }

  cambiarIdentificador(value: string): void {
    this.identificador = value;
    this.encontrado.set(null);
    this.error.set('');
  }

  async buscar(): Promise<void> {
    await this.ejecutar(async () => {
      const identifier = this.identificador.trim();
      if (!identifier) return;
      this.encontrado.set(null);
      const encontrado = await this.chat.buscarContacto(identifier);
      if (this.identificador.trim() === identifier) this.encontrado.set(encontrado);
    });
  }

  async solicitar(): Promise<void> {
    const encontrado = this.encontrado();
    if (!encontrado) return;
    await this.ejecutar(async () => {
      const { status } = await this.chat.solicitarAmistad(this.identificador.trim(), encontrado.uid);
      this.cambiarIdentificador('');
      await this.toasts.mostrar(
        status === 'accepted' ? 'Esta persona ya está en tus amigos' : 'Solicitud pendiente de aceptación',
        'success',
      );
    });
  }

  async cambiarAmistad(id: string, aceptar: boolean): Promise<void> {
    await this.ejecutar(() => this.chat.cambiarAmistad(id, aceptar));
  }

  async abrirChat(uid: string): Promise<void> {
    await this.ejecutar(async () => {
      const { id } = await this.chat.abrirChatDirecto(uid);
      await this.router.navigate(['/room', id]);
    });
  }

  async activarNotificaciones(): Promise<void> {
    await this.ejecutar(() => this.notifications.activar());
  }

  private async ejecutar(accion: () => Promise<void>): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      await accion();
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'No se pudo completar la operación';
      this.error.set(mensaje);
      await this.toasts.mostrar(mensaje, 'danger');
    } finally {
      this.ocupado.set(false);
    }
  }
}
