import { afterNextRender, Component, DestroyRef, inject, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { filter, take } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor() {
    if (!Capacitor.isNativePlatform()) return;
    const router = inject(Router);
    const injector = inject(Injector);
    const destroy = inject(DestroyRef);
    let hidden = false;
    const hide = (): void => {
      if (hidden) return;
      hidden = true;
      clearTimeout(fallback);
      void SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => console.warn('No se pudo cerrar el splash nativo'));
    };
    // Evitar una pantalla bloqueada si la primera navegación falla.
    const fallback = setTimeout(hide, 8000);
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        afterNextRender(hide, { injector });
      });
    destroy.onDestroy(() => clearTimeout(fallback));
  }
}
