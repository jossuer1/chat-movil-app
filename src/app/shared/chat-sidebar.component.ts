import { Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonButton, IonIcon, IonInput } from '@ionic/angular';

import type { Sala } from '../services/chat.service';
import type { Perfil } from '../services/profiles.service';

import { AvatarComponent } from './avatar.component';

@Component({
  selector: 'app-chat-sidebar',
  templateUrl: './chat-sidebar.component.html',
  styleUrl: './chat-sidebar.component.scss',
  imports: [FormsModule, RouterLink, IonButton, IonIcon, IonInput, AvatarComponent],
})
export class ChatSidebarComponent {
  readonly perfil = input<Perfil | null>(null);
  readonly uid = input('');
  readonly salas = input<Sala[]>([]);
  readonly salaId = input('');
  readonly cargando = input(false);
  readonly ocupado = input(false);
  readonly tituloSala = model('');
  readonly mostrarCrear = model(false);
  readonly crear = output<void>();
  readonly abrir = output<string>();
  readonly notificar = output<void>();
  readonly salir = output<void>();
  readonly nombreCompleto = computed(() => [this.perfil()?.nombre, this.perfil()?.apellido].filter(Boolean).join(' '));
  busqueda = '';
  salasFiltradas(): Sala[] {
    return this.salas().filter((item) => item.title.toLocaleLowerCase().includes(this.busqueda.toLocaleLowerCase()));
  }
}
