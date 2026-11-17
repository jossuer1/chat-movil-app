import { Injectable } from '@angular/core';

import { chatConfig } from '../chat.config';
import { auth } from '../firebase.config';
import { supabaseConfig } from '../supabase.config';

interface EdgeResponse<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

@Injectable({ providedIn: 'root' })
export class BackendService {
  async llamar<T>(nombre: string, datos: object = {}): Promise<T> {
    await auth.authStateReady();
    const usuario = auth.currentUser;
    if (!usuario) throw new Error('Inicia sesión en Firebase para continuar');
    for (let intento = 0; intento < 2; intento++) {
      let respuesta: Response;
      try {
        respuesta = await fetch(`${supabaseConfig.url}/functions/v1/${chatConfig.edgeFunction}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await usuario.getIdToken(intento > 0)}`,
            apikey: supabaseConfig.publishableKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: nombre, data: datos }),
          signal: AbortSignal.timeout(45000),
        });
      } catch {
        throw new Error(
          'No se pudo conectar con el backend en Supabase. Revisa la conexión y el despliegue de chat-api',
        );
      }
      const contenido = (await respuesta.json().catch(() => null)) as EdgeResponse<T> | null;
      if (respuesta.status === 401 && intento === 0) continue;
      if (!respuesta.ok || !contenido || !('data' in contenido)) {
        throw new Error(
          contenido?.error?.message ??
            (respuesta.status === 404
              ? 'La función chat-api todavía no está desplegada en Supabase'
              : `Supabase rechazó la operación (${respuesta.status})`),
        );
      }
      return contenido.data as T;
    }
    throw new Error('La sesión venció. Vuelve a iniciar sesión');
  }
}
