import { DatePipe } from '@angular/common';
import type { OnInit, OnDestroy } from '@angular/core';
import { afterNextRender, Component, computed, inject, Injector, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonInput,
  IonTextarea,
  IonIcon,
  AlertController,
} from '@ionic/angular';
import type { User } from 'firebase/auth';
import { addIcons } from 'ionicons';
import {
  attachOutline,
  chatbubblesOutline,
  chevronBackOutline,
  createOutline,
  documentAttachOutline,
  locationOutline,
  notificationsOutline,
  searchOutline,
  sendOutline,
} from 'ionicons/icons';

import { AuthService } from '../services/auth.services';
import type { Sala, Mensaje, Adjunto, Ubicacion, Participante } from '../services/chat.service';
import { ChatService } from '../services/chat.service';
import { LocationService } from '../services/location.service';
import { NotificationsService } from '../services/notifications.service';
import type { Perfil } from '../services/profiles.service';
import { ProfilesService } from '../services/profiles.service';
import { ToastService } from '../services/toast.service';
import { AvatarComponent } from '../shared/avatar.component';
import { ChatSidebarComponent } from '../shared/chat-sidebar.component';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonInput,
    IonTextarea,
    AvatarComponent,
    ChatSidebarComponent,
    IonIcon,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  constructor() {
    addIcons({
      attachOutline,
      chatbubblesOutline,
      chevronBackOutline,
      createOutline,
      documentAttachOutline,
      locationOutline,
      notificationsOutline,
      searchOutline,
      sendOutline,
    });
  }
  readonly uid = signal('');
  readonly perfil = signal<Perfil | null>(null);
  readonly salas = signal<Sala[]>([]);
  readonly salaId = signal('');
  readonly sala = computed(() => this.salas().find((item) => item.id === this.salaId()) ?? null);
  readonly mensajes = signal<Mensaje[]>([]);
  readonly participantes = signal<Participante[]>([]);
  readonly mostrarCrear = signal(false);
  readonly cargando = signal(true);
  readonly ocupado = signal(false);
  readonly ubicando = signal(false);
  readonly error = signal('');
  readonly emojis = ['👍', '❤️', '😂', '🎉'];
  readonly notifications = inject(NotificationsService);
  tituloSala = '';
  uidParticipante = '';
  texto = '';
  editandoId = '';
  textoEditado = '';
  archivo: File | null = null;
  cantidad = 100;

  private readonly chat = inject(ChatService);
  private readonly profiles = inject(ProfilesService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly alerts = inject(AlertController);
  private readonly locations = inject(LocationService);
  private readonly toasts = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly content = viewChild(IonContent);
  private cancelarAuth?: () => void;
  private cancelarSalas?: () => void;
  private cancelarMensajes?: () => void;
  private solicitudSala?: { id: string; title: string };
  private envioPendiente?: {
    id: string;
    key: string;
    attachment: Adjunto | null;
    location: Ubicacion | null;
    accuracy?: number;
  };

  ngOnInit(): void {
    this.cancelarAuth = this.auth.observar((user) => {
      void this.iniciar(user);
    });
  }

  ionViewWillEnter(): void {
    if (this.uid()) void this.cargarPerfil(this.uid());
  }

  ngOnDestroy(): void {
    this.cancelarAuth?.();
    this.cancelarSalas?.();
    this.cancelarMensajes?.();
  }

  private async iniciar(user: User | null): Promise<void> {
    this.cancelarSalas?.();
    this.cancelarMensajes?.();
    this.uid.set(user?.uid ?? '');
    this.salas.set([]);
    this.cerrarSala();
    this.perfil.set(null);
    this.texto = '';
    this.archivo = null;
    this.envioPendiente = undefined;
    if (!user) {
      this.cargando.set(false);
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }
    this.cargando.set(true);
    this.cancelarSalas = this.chat.observarSalas(
      user.uid,
      (salas) => {
        if (this.uid() !== user.uid) return;
        this.salas.set(salas.sort((a, b) => a.title.localeCompare(b.title)));
        this.cargando.set(false);
        if (this.salaId() && !salas.some((item) => item.id === this.salaId())) this.cerrarSala();
        const solicitada = this.route.snapshot.queryParamMap.get('room');
        if (!this.salaId() && solicitada && salas.some((item) => item.id === solicitada)) this.abrirSala(solicitada);
      },
      (error) => {
        this.mostrarError(error);
        this.cargando.set(false);
      },
    );
    await this.cargarPerfil(user.uid);
  }

  private async cargarPerfil(uid: string): Promise<void> {
    try {
      const perfil = await this.profiles.obtenerMiPerfil();
      if (this.uid() === uid) this.perfil.set(perfil);
    } catch (error: unknown) {
      this.mostrarError(error);
    }
  }

  abrirSala(id: string): void {
    if (this.ocupado()) return;
    this.cancelarMensajes?.();
    this.salaId.set(id);
    this.mensajes.set([]);
    this.participantes.set([]);
    this.texto = '';
    this.archivo = null;
    this.editandoId = '';
    this.envioPendiente = undefined;
    this.cantidad = 100;
    this.escucharMensajes();
    void this.cargarParticipantes();
  }

  cerrarSala(): void {
    this.cancelarMensajes?.();
    this.salaId.set('');
    this.mensajes.set([]);
    this.participantes.set([]);
    this.editandoId = '';
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
                void this.content()?.scrollToBottom(150);
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

  async crearSala(): Promise<void> {
    await this.ejecutar(async () => {
      const title = this.tituloSala.trim();
      if (!title) throw new Error('Escribe un nombre para la sala');
      if (this.solicitudSala?.title !== title) this.solicitudSala = { id: crypto.randomUUID(), title };
      const result = await this.chat.crearSala(this.solicitudSala.id, title);
      this.tituloSala = '';
      this.solicitudSala = undefined;
      this.mostrarCrear.set(false);
      this.ocupado.set(false);
      this.abrirSala(result.id);
    });
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

  async cambiarParticipante(uid: string, agregar: boolean): Promise<void> {
    await this.ejecutar(async () => {
      await this.chat.cambiarParticipante(this.salaId(), uid, agregar);
      this.uidParticipante = '';
      await this.cargarParticipantes();
    });
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

  comenzarEdicion(mensaje: Mensaje): void {
    this.editandoId = mensaje.id;
    this.textoEditado = mensaje.text;
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

  async activarNotificaciones(): Promise<void> {
    await this.ejecutar(() => this.notifications.activar());
  }

  async salir(): Promise<void> {
    await this.ejecutar(() => this.auth.salir());
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
