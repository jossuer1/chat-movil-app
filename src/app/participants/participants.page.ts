import { Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonBackButton, IonButton, IonContent, IonFooter, IonHeader, IonIcon, NavController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { searchOutline } from 'ionicons/icons';

import { ChatSessionService } from '../services/chat-session.service';
import { ChatService } from '../services/chat.service';
import type { Participante } from '../services/chat.service';
import { AvatarComponent } from '../shared/avatar.component';

@Component({
  selector: 'app-participants',
  templateUrl: './participants.page.html',
  imports: [
    FormsModule,
    RouterLink,
    IonBackButton,
    IonButton,
    IonContent,
    IonFooter,
    IonHeader,
    IonIcon,
    AvatarComponent,
  ],
})
export class ParticipantsPage implements OnInit {
  private readonly session = inject(ChatSessionService);
  private readonly nav = inject(NavController);
  private readonly chat = inject(ChatService);
  readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  readonly sala = computed(() => this.session.salasVisibles().find((room) => room.id === this.id));
  readonly puedeEditar = computed(
    () => !!this.sala() && !this.sala()?.direct && this.sala()?.ownerUid === this.session.uid(),
  );
  readonly cargando = this.session.cargando;
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly busqueda = signal('');
  readonly cambios = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly participantes = signal<Participante[]>([]);
  readonly opciones = computed(() => {
    const sala = this.sala();
    if (!sala || sala.direct) return [];
    const nombres = new Map(this.participantes().map((persona) => [persona.uid, persona]));
    const opciones = new Map(
      this.puedeEditar() ? this.session.amigos().map((persona) => [persona.uid, persona] as const) : [],
    );
    for (const uid of sala.memberUids) opciones.set(uid, nombres.get(uid) ?? opciones.get(uid) ?? { uid, nombre: uid });
    const filtro = this.busqueda().trim().toLocaleLowerCase();
    return [...opciones.values()]
      .filter((persona) =>
        [persona.nombre, persona.usuario, persona.uid].some((texto) => texto?.toLocaleLowerCase().includes(filtro)),
      )
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  constructor() {
    addIcons({ searchOutline });
  }

  async ngOnInit(): Promise<void> {
    try {
      this.participantes.set(await this.chat.participantes(this.id));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudieron cargar los participantes');
    }
  }

  esCreador(uid: string): boolean {
    return uid === this.sala()?.ownerUid;
  }

  esParticipante(uid: string): boolean {
    return this.cambios().get(uid) ?? this.sala()?.memberUids.includes(uid) ?? false;
  }

  seleccionar(uid: string, marcado: boolean): void {
    if (!this.puedeEditar() || this.esCreador(uid) || this.guardando()) return;
    const cambios = new Map(this.cambios());
    if (marcado === this.sala()?.memberUids.includes(uid)) cambios.delete(uid);
    else cambios.set(uid, marcado);
    this.cambios.set(cambios);
  }

  async guardar(): Promise<void> {
    if (!this.puedeEditar() || !this.cambios().size || this.guardando()) return;
    this.guardando.set(true);
    this.error.set('');
    const add: string[] = [];
    const remove: string[] = [];
    for (const [uid, marcado] of this.cambios()) (marcado ? add : remove).push(uid);
    try {
      await this.chat.guardarParticipantes(this.id, add, remove);
      this.cambios.set(new Map());
      await this.nav.navigateBack(['/room', this.id], { replaceUrl: true });
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudieron guardar los participantes');
    } finally {
      this.guardando.set(false);
    }
  }
}
