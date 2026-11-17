import { inject, Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly controller = inject(ToastController);
  private pending: Promise<void> = Promise.resolve();

  mostrar(message: string, color: 'primary' | 'success' | 'danger' = 'primary'): Promise<void> {
    this.pending = this.pending
      .then(async () => {
        const previous = await this.controller.getTop();
        if (previous) await previous.dismiss();
        const toast = await this.controller.create({
          message,
          color,
          position: 'top',
          duration: color === 'danger' ? 7000 : 5000,
          cssClass: 'chat-toast',
          buttons: [{ text: 'Cerrar', role: 'cancel' }],
        });
        await toast.present();
      })
      .catch(() => {
        console.warn('No se pudo mostrar el aviso de Ionic');
      });
    return this.pending;
  }
}
