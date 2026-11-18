import { Component, input, signal } from '@angular/core';

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `@if (src() && failed() !== src()) {
      <img [src]="src()" alt="" (error)="failed.set(src())" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }`,
  styles: [
    `
      :host {
        display: inline-flex;
        width: var(--avatar-size, 44px);
        height: var(--avatar-size, 44px);
        flex: 0 0 var(--avatar-size, 44px);
        border-radius: 50%;
        overflow: hidden;
        background: var(--avatar-bg, var(--lavender));
        color: var(--accent-ink);
        align-items: center;
        justify-content: center;
        font-size: calc(var(--avatar-size, 44px) * 0.34);
        font-weight: 700;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    `,
  ],
})
export class AvatarComponent {
  readonly src = input<string | null | undefined>();
  readonly name = input('');
  readonly failed = signal<string | null | undefined>(undefined);
  initials(): string {
    return (
      this.name()
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase() || '?'
    );
  }
}
