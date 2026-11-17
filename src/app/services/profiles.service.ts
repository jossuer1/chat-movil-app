import { inject, Injectable } from '@angular/core';

import { supabase } from '../supabase.config';

import { AuthService } from './auth.services';

export interface Perfil {
  firebase_uid: string;
  nombre: string;
  apellido?: string;
  usuario?: string | null;
  ciudad?: string;
  foto_path?: string | null;
  foto_url?: string | null;
}
export type DatosPerfil = Pick<Perfil, 'nombre' | 'apellido' | 'usuario' | 'ciudad' | 'foto_path'>;
const columnas = 'firebase_uid,nombre,apellido,usuario,ciudad,foto_path';

export function validarPerfil(perfil: DatosPerfil): DatosPerfil {
  const datos = {
    nombre: perfil.nombre.trim(),
    apellido: perfil.apellido?.trim() ?? '',
    usuario: perfil.usuario?.trim().toLowerCase() ?? '',
    ciudad: perfil.ciudad?.trim() ?? '',
    foto_path: perfil.foto_path ?? null,
  };
  if (!datos.nombre || !datos.apellido || !datos.ciudad) throw new Error('Completa nombre, apellido y ciudad');
  if (datos.nombre.length > 80 || datos.apellido.length > 80 || datos.ciudad.length > 100)
    throw new Error('Nombre y apellido: máximo 80 caracteres. Ciudad: máximo 100');
  if (!/^[a-z0-9_]{3,24}$/.test(datos.usuario))
    throw new Error('El usuario debe tener de 3 a 24 letras, números o guion bajo, sin espacios');
  return datos;
}
export function validarFoto(archivo: File): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(archivo.type))
    throw new Error('Selecciona una foto JPG, PNG o WebP');
  if (!archivo.size || archivo.size > 3 * 1024 * 1024) throw new Error('La foto debe pesar como máximo 3 MB');
}

@Injectable({ providedIn: 'root' })
export class ProfilesService {
  private readonly authService = inject(AuthService);
  async obtenerMiPerfil(): Promise<Perfil | null> {
    const usuario = await this.authService.obtenerUsuarioParaSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .select(columnas)
      .eq('firebase_uid', usuario.uid)
      .maybeSingle<Perfil>();
    if (error) throw error;
    return data ? this.conFoto(data) : null;
  }
  async guardarPerfil(perfil: DatosPerfil, foto?: File | null): Promise<Perfil> {
    const datos = validarPerfil(perfil);
    if (foto) validarFoto(foto);
    const usuario = await this.authService.obtenerUsuarioParaSupabase();
    const anterior = datos.foto_path;
    let nueva: string | null = null;
    if (foto) {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[foto.type];
      nueva = `${usuario.uid}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from('profile-photos').upload(nueva, foto, {
        contentType: foto.type,
        cacheControl: '3600',
        upsert: false,
      });
      if (error) throw new Error('No se pudo subir la foto: ' + error.message);
      datos.foto_path = nueva;
    }
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ firebase_uid: usuario.uid, ...datos }, { onConflict: 'firebase_uid' })
      .select(columnas)
      .single<Perfil>();
    if (error) {
      if (nueva) await supabase.storage.from('profile-photos').remove([nueva]);
      if (error.code === '23505') throw new Error('Ese nombre de usuario ya está ocupado. Elige otro');
      throw error;
    }
    if (nueva && anterior && anterior !== nueva) await supabase.storage.from('profile-photos').remove([anterior]);
    return this.conFoto(data);
  }
  private async conFoto(perfil: Perfil): Promise<Perfil> {
    if (!perfil.foto_path) return { ...perfil, foto_url: null };
    const { data } = await supabase.storage.from('profile-photos').createSignedUrl(perfil.foto_path, 3600);
    // Una imagen no disponible no debe impedir entrar al chat.
    return { ...perfil, foto_url: data?.signedUrl ?? null };
  }
}
