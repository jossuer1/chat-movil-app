import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type { Position } from '@capacitor/geolocation';
import { Geolocation } from '@capacitor/geolocation';

@Injectable({ providedIn: 'root' })
export class LocationService {
  async obtener(): Promise<Position> {
    const native = Capacitor.isNativePlatform();
    if (!native && (!globalThis.isSecureContext || !navigator.geolocation))
      throw new Error('Abre la aplicación con HTTPS para compartir tu ubicación');
    try {
      if (native) {
        const permiso = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (permiso.location !== 'granted' && permiso.coarseLocation !== 'granted')
          throw new Error('Permite el acceso a la ubicación en los ajustes de la aplicación');
      }
      // En web la ubicación de red evita depender de un GPS que muchos ordenadores no tienen.
      const point = await Geolocation.getCurrentPosition({
        enableHighAccuracy: native,
        timeout: 20000,
        maximumAge: 30000,
      });
      if (
        !Number.isFinite(point.coords.latitude) ||
        !Number.isFinite(point.coords.longitude) ||
        Math.abs(point.coords.latitude) > 90 ||
        Math.abs(point.coords.longitude) > 180
      )
        throw new Error('El dispositivo devolvió una ubicación no válida. Vuelve a intentarlo');
      return point;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === '1' || code === 'OS-PLUG-GLOC-0003')
        throw new Error(
          'Ubicación bloqueada. Permite el acceso desde el candado del navegador o los ajustes del dispositivo',
          { cause: error },
        );
      if (code === '2' || code === 'OS-PLUG-GLOC-0007' || code === 'OS-PLUG-GLOC-0002')
        throw new Error(
          'No se pudo obtener tu ubicación. Activa la ubicación del dispositivo y comprueba tu conexión',
          { cause: error },
        );
      if (code === '3' || code === 'OS-PLUG-GLOC-0010')
        throw new Error(
          'No se encontró tu ubicación a tiempo. Activa la ubicación del dispositivo y vuelve a intentarlo',
          { cause: error },
        );
      throw error;
    }
  }
}
