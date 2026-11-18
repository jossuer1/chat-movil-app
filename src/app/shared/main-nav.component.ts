import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chatbubbleOutline, peopleOutline, settingsOutline } from 'ionicons/icons';

@Component({
  selector: 'app-main-nav',
  imports: [RouterLink, IonIcon],
  template: `
    <nav aria-label="Navegación principal">
      @for (tab of tabs; track tab.id) {
        <a [routerLink]="'/' + tab.id" [attr.aria-current]="active() === tab.id ? 'page' : null" routerDirection="root">
          <ion-icon [name]="tab.icon" aria-hidden="true" />{{ tab.nombre }}
        </a>
      }
    </nav>
  `,
  styles: [
    `
      nav {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
        width: min(100%, 680px);
        margin: auto;
        padding: 6px 12px calc(6px + var(--ion-safe-area-bottom, 0px));
        background: var(--ivory);
        border-top: 1px solid var(--line);
      }
      a {
        display: grid;
        place-content: center;
        justify-items: center;
        gap: 5px;
        min-height: 54px;
        color: var(--muted);
        text-decoration: none;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }
      a[aria-current='page'],
      a:hover {
        background: linear-gradient(180deg, #8b5cf61f, #8b5cf60a);
        color: var(--accent-ink);
      }
      ion-icon {
        font-size: 22px;
      }
    `,
  ],
})
export class MainNavComponent {
  readonly active = input.required<'chats' | 'friends' | 'settings'>();
  readonly tabs = [
    { id: 'chats', nombre: 'Chats', icon: 'chatbubble-outline' },
    { id: 'friends', nombre: 'Amigos', icon: 'people-outline' },
    { id: 'settings', nombre: 'Ajustes', icon: 'settings-outline' },
  ];
  constructor() {
    addIcons({ chatbubbleOutline, peopleOutline, settingsOutline });
  }
}
