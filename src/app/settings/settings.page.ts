import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AlertController, IonButton, IonContent, IonFooter, IonHeader, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { logOutOutline } from 'ionicons/icons';

import { AuthService } from '../services/auth.services';
import { ChatSessionService } from '../services/chat-session.service';
import { ToastService } from '../services/toast.service';
import { AvatarComponent } from '../shared/avatar.component';
import { MainNavComponent } from '../shared/main-nav.component';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  imports: [RouterLink, IonButton, IonContent, IonFooter, IonHeader, IonIcon, AvatarComponent, MainNavComponent],
})
export class SettingsPage {
  readonly session = inject(ChatSessionService);
  readonly nombre = computed(() =>
    [this.session.perfil()?.nombre, this.session.perfil()?.apellido].filter(Boolean).join(' '),
  );
  readonly copiado = signal<'usuario' | 'uid' | null>(null);
  readonly aviso = signal('');
  readonly ocupado = signal(false);
  private readonly auth = inject(AuthService);
  private readonly alerts = inject(AlertController);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  constructor() {
    addIcons({ logOutOutline });
  }
  ionViewWillEnter(): void {
    this.copiado.set(null);
    this.aviso.set('');
    void this.session.refrescarPerfil();
  }

  async copiar(texto: string, tipo: 'usuario' | 'uid'): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.copiado.set(tipo);
      this.aviso.set('Copiado');
    } catch {
      this.copiado.set(null);
      this.aviso.set('Selecciona el texto para copiarlo manualmente.');
    }
  }

  async salir(): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    try {
      const alerta = await this.alerts.create({
        header: '¿Cerrar sesión?',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Cerrar sesión', role: 'confirm' },
        ],
      });
      await alerta.present();
      if ((await alerta.onDidDismiss()).role !== 'confirm') return;
      await this.auth.salir();
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (error) {
      await this.toasts.mostrar(error instanceof Error ? error.message : 'No se pudo cerrar sesión', 'danger');
    } finally {
      this.ocupado.set(false);
    }
  }
}
