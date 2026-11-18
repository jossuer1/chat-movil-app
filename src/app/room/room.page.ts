import { DatePipe } from '@angular/common';
import type { ElementRef, OnInit, OnDestroy } from '@angular/core';
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonTextarea,
  IonIcon,
  IonBackButton,
  AlertController,
  ActionSheetController,
} from '@ionic/angular';
import type { ActionSheetButton } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  attachOutline,
  chevronBackOutline,
  documentAttachOutline,
  ellipsisHorizontal,
  locationOutline,
  personAddOutline,
  sendOutline,
} from 'ionicons/icons';

import { ChatSessionService } from '../services/chat-session.service';
import type { Mensaje, Adjunto, Ubicacion, Participante } from '../services/chat.service';
import { ChatService } from '../services/chat.service';
import { LocationService } from '../services/location.service';
import { ToastService } from '../services/toast.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-room',
  templateUrl: 'room.page.html',
  styleUrls: ['room.page.scss'],
  imports: [
    DatePipe,
    FormsModule,
    IonContent,
    IonButton,
    IonTextarea,
    AvatarComponent,
    IonIcon,
    RouterLink,
    IonBackButton,
  ],
})
export class RoomPage implements OnInit, OnDestroy {
  constructor() {
    addIcons({
      attachOutline,
      chevronBackOutline,
      documentAttachOutline,
      ellipsisHorizontal,
      locationOutline,
      personAddOutline,
      sendOutline,
    });
  }
  readonly session = inject(ChatSessionService);
  readonly uid = this.session.uid;
  readonly perfil = this.session.perfil;
  readonly salaId = signal('');
  readonly sala = computed(() => this.session.salasVisibles().find((item) => item.id === this.salaId()) ?? null);
  readonly mensajes = signal<Mensaje[]>([]);
  readonly participantes = signal<Participante[]>([]);
  readonly fotoConversacion = computed(() =>
    this.sala()?.direct ? this.participantes().find((persona) => persona.uid !== this.uid())?.foto_url : null,
  );
  readonly ocupado = signal(false);
  readonly ubicando = signal(false);
  readonly error = signal('');
  readonly emojis = ['👍', '❤️', '😂', '🎉'];
  texto = '';
  editandoId = '';
  textoEditado = '';
  archivo: File | null = null;
  cantidad = 100;

  private readonly chat = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  private readonly alerts = inject(AlertController);
  private readonly actions = inject(ActionSheetController);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly locations = inject(LocationService);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly conversationScroll = viewChild<ElementRef<HTMLDivElement>>('conversationScroll');
  private cancelarMensajes?: () => void;
  private envioPendiente?: {
    id: string;
    key: string;
    attachment: Adjunto | null;
    location: Ubicacion | null;
    accuracy?: number;
  };

  ngOnInit(): void {
    this.salaId.set(this.route.snapshot.paramMap.get('id') ?? '');
  }

  ionViewWillEnter(): void {
    this.escucharMensajes();
    void this.cargarParticipantes();
    void this.session.refrescarPerfil();
  }

  ionViewWillLeave(): void {
    this.cancelarMensajes?.();
  }

  ngOnDestroy(): void {
    this.cancelarMensajes?.();
  }
  private escucharMensajes(): void {
    this.cancelarMensajes?.();
    const id = this.salaId();
    this.cancelarMensajes = this.chat.observarMensajes(
      id,
      (mensajes) => {
        if (this.salaId() === id) {
          const anterior = this.mensajes().at(-1)?.id;
          this.mensajes.set(mensajes);
          if (mensajes.at(-1)?.id !== anterior) {
            afterNextRender(
              () => {
                const scroll = this.conversationScroll()?.nativeElement;
                if (scroll && this.salaId() === id) scroll.scrollTo(0, scroll.scrollHeight);
              },
              { injector: this.injector },
            );
          }
        }
      },
      (error) => {
        this.mostrarError(error);
        this.mensajes.set([]);
      },
      this.cantidad,
    );
  }

  cargarAnteriores(): void {
    this.cantidad += 100;
    this.escucharMensajes();
  }

  async cargarParticipantes(): Promise<void> {
    const id = this.salaId();
    if (!id) return;
    try {
      const personas = await this.chat.participantes(id);
      if (this.salaId() === id) this.participantes.set(personas);
    } catch (error: unknown) {
      this.mostrarError(error);
    }
  }

  elegirArchivo(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.archivo = input.files?.[0] ?? null;
    input.value = '';
  }

  async enviar(compartirUbicacion = false): Promise<void> {
    await this.ejecutar(async () => {
      const perfil = this.perfil();
      const roomId = this.salaId();
      const uid = this.uid();
      const texto = this.texto;
      if (!perfil) throw new Error('Guarda tu nombre en Perfil para continuar');
      if (!roomId) throw new Error('Selecciona una sala');
      if (compartirUbicacion && this.archivo)
        throw new Error('Envía o quita el archivo antes de compartir la ubicación');
      const key = JSON.stringify([
        roomId,
        this.texto,
        this.archivo?.name,
        this.archivo?.size,
        this.archivo?.lastModified,
        compartirUbicacion,
      ]);
      if (this.envioPendiente?.key !== key)
        this.envioPendiente = { id: crypto.randomUUID(), key, attachment: null, location: null };
      const envio = this.envioPendiente;
      if (compartirUbicacion) {
        let punto = envio.location;
        if (!punto) {
          this.ubicando.set(true);
          try {
            const position = await this.locations.obtener();
            punto = { id: envio.id, latitude: position.coords.latitude, longitude: position.coords.longitude };
            envio.accuracy = position.coords.accuracy;
          } finally {
            this.ubicando.set(false);
          }
        }
        this.comprobarDestino(uid, roomId);
        const precision =
          Number.isFinite(envio.accuracy) && Number(envio.accuracy) > 0
            ? `\nPrecisión aproximada: ±${Math.max(1, Math.round(Number(envio.accuracy)))} m.`
            : '';
        const alerta = await this.alerts.create({
          header: '¿Enviar tu ubicación?',
          subHeader: 'Esta es tu ubicación actual',
          message: `Latitud: ${punto.latitude.toFixed(6)}\nLongitud: ${punto.longitude.toFixed(6)}${precision}\n\nSe compartirá con los participantes de esta sala.`,
          cssClass: 'location-confirmation',
          buttons: [
            { text: 'No', role: 'cancel' },
            { text: 'Sí, enviar', role: 'confirm' },
          ],
        });
        await alerta.present();
        if ((await alerta.onDidDismiss()).role !== 'confirm') return;
        this.comprobarDestino(uid, roomId);
        // Conservar el mismo punto e ID si se pierde la respuesta y se reintenta.
        envio.location = punto;
        await this.chat.guardarUbicacion(roomId, envio.id, punto.latitude, punto.longitude);
      }
      if (this.archivo && !compartirUbicacion && !envio.attachment)
        envio.attachment = await this.chat.subirArchivo(roomId, envio.id, this.archivo);
      this.comprobarDestino(uid, roomId);
      await this.chat.enviar(roomId, envio.id, perfil.nombre, texto, envio.attachment, envio.location);
      this.texto = '';
      this.archivo = null;
      this.envioPendiente = undefined;
      if (compartirUbicacion) await this.toasts.mostrar('Ubicación enviada', 'success');
    });
  }

  private comprobarDestino(uid: string, roomId: string): void {
    if (this.uid() !== uid || this.salaId() !== roomId)
      throw new Error('La sesión o la sala cambió. Vuelve a intentarlo');
  }

  async opcionesMensaje(mensaje: Mensaje): Promise<void> {
    if (this.ocupado()) return;
    const salaId = this.salaId();
    const propia = mensaje.authorUid === this.uid();
    const buttons: ActionSheetButton[] = this.emojis.map((emoji) => ({
      text: mensaje.reactions[this.uid()] === emoji ? `Quitar reacción ${emoji}` : `Reaccionar ${emoji}`,
      data: { emoji },
    }));
    if (propia) buttons.push({ text: 'Editar', role: 'edit' });
    if (propia || this.sala()?.ownerUid === this.uid()) buttons.push({ text: 'Eliminar', role: 'destructive' });
    buttons.push({ text: 'Cancelar', role: 'cancel' });
    const menu = await this.actions.create({ header: 'Opciones del mensaje', buttons });
    await menu.present();
    const { role, data } = await menu.onDidDismiss<{ emoji?: string }>();
    if (salaId !== this.salaId() || this.ocupado()) return;
    if (role === 'edit') this.comenzarEdicion(mensaje);
    else if (role === 'destructive') await this.eliminar(mensaje);
    else if (data?.emoji) await this.reaccionar(mensaje, data.emoji);
  }

  comenzarEdicion(mensaje: Mensaje): void {
    this.editandoId = mensaje.id;
    this.textoEditado = mensaje.text;
    this.changeDetector.markForCheck();
  }

  async guardarEdicion(): Promise<void> {
    await this.ejecutar(async () => {
      await this.chat.editar(this.salaId(), this.editandoId, this.textoEditado);
      this.editandoId = '';
    });
  }

  async eliminar(mensaje: Mensaje): Promise<void> {
    const roomId = this.salaId();
    const alerta = await this.alerts.create({
      header: '¿Eliminar mensaje?',
      message: 'Se eliminará para los participantes de la sala.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    if ((await alerta.onDidDismiss()).role === 'destructive') {
      await this.ejecutar(() => this.chat.eliminar(roomId, mensaje.id));
    }
  }

  async reaccionar(mensaje: Mensaje, emoji: string): Promise<void> {
    await this.ejecutar(() => this.chat.reaccionar(this.salaId(), mensaje, emoji));
  }

  numeroReacciones(mensaje: Mensaje, emoji: string): number {
    return Object.values(mensaje.reactions).filter((value) => value === emoji).length;
  }

  continuaMensaje(mensaje: Mensaje, anterior?: Mensaje): boolean {
    if (!anterior || anterior.authorUid !== mensaje.authorUid) return false;
    if (!mensaje.createdAt || !anterior.createdAt) return true;
    const intervalo = mensaje.createdAt.toMillis() - anterior.createdAt.toMillis();
    return intervalo >= 0 && intervalo <= 5 * 60 * 1000;
  }

  nombreAutor(mensaje: Mensaje): string {
    return this.participantes().find((persona) => persona.uid === mensaje.authorUid)?.nombre ?? mensaje.authorUid;
  }

  fotoAutor(uid: string): string | null {
    return (
      (uid === this.uid() ? this.perfil()?.foto_url : this.participantes().find((p) => p.uid === uid)?.foto_url) ?? null
    );
  }

  async descargar(adjunto: Adjunto): Promise<void> {
    await this.ejecutar(async () => {
      const { url } = await this.chat.abrirArchivo(this.salaId(), adjunto.path);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      enlace.download = adjunto.name;
      enlace.click();
    });
  }

  private async ejecutar(operacion: () => Promise<void>): Promise<void> {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    try {
      await operacion();
    } catch (error: unknown) {
      this.mostrarError(error);
    } finally {
      this.ocupado.set(false);
    }
  }

  private mostrarError(error: unknown): void {
    const mensaje =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'No se pudo completar la operación';
    this.error.set(mensaje);
    void this.toasts.mostrar(mensaje, 'danger');
  }
}
