import { inject, Injectable } from '@angular/core';
import type { Timestamp, Unsubscribe } from 'firebase/firestore';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limitToLast,
  doc,
  serverTimestamp,
  updateDoc,
  FieldPath,
  deleteField,
} from 'firebase/firestore';

import { auth, firestore } from '../firebase.config';

import { BackendService } from './backend.service';

export interface Sala {
  id: string;
  title: string;
  ownerUid: string;
  memberUids: string[];
  revision: number;
}

export interface Participante {
  uid: string;
  nombre: string;
  usuario?: string | null;
  foto_url?: string | null;
}

export interface Adjunto {
  path: string;
  name: string;
  mime: string;
  size: number;
}

export interface Ubicacion {
  id: string;
  latitude: number;
  longitude: number;
}

export interface Mensaje {
  id: string;
  authorUid: string;
  authorName: string;
  text: string;
  kind: 'text' | 'file' | 'location';
  attachment: Adjunto | null;
  location: Ubicacion | null;
  createdAt: Timestamp | null;
  editedAt: Timestamp | null;
  reactions: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly backend = inject(BackendService);

  observarSalas(uid: string, recibir: (salas: Sala[]) => void, fallo: (error: Error) => void): Unsubscribe {
    return onSnapshot(
      query(collection(firestore, 'chatRooms'), where('memberUids', 'array-contains', uid)),
      (snapshot) => recibir(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as Sala)),
      fallo,
    );
  }

  observarMensajes(
    salaId: string,
    recibir: (mensajes: Mensaje[]) => void,
    fallo: (error: Error) => void,
    cantidad = 100,
  ): Unsubscribe {
    return onSnapshot(
      query(collection(firestore, 'chatRooms', salaId, 'messages'), orderBy('createdAt'), limitToLast(cantidad)),
      (snapshot) => recibir(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as Mensaje)),
      fallo,
    );
  }

  crearSala(id: string, titulo: string): Promise<{ id: string }> {
    return this.backend.llamar('createRoom', { id, title: titulo.trim() });
  }

  cambiarParticipante(roomId: string, uid: string, agregar: boolean): Promise<void> {
    return this.backend.llamar('changeMember', { roomId, uid: uid.trim(), add: agregar });
  }

  participantes(roomId: string): Promise<Participante[]> {
    return this.backend.llamar('listMembers', { roomId });
  }

  async enviar(
    roomId: string,
    id: string,
    _nombre: string,
    texto: string,
    attachment: Adjunto | null = null,
    location: Ubicacion | null = null,
  ): Promise<void> {
    const usuario = auth.currentUser;
    if (!usuario) throw new Error('Inicia sesión para enviar mensajes');
    if (!texto.trim() && !attachment && !location) throw new Error('Escribe un mensaje');
    // El backend consulta el nombre real y guarda el mensaje junto con su trabajo de notificación.
    await this.backend.llamar('sendMessage', { roomId, id, text: texto.trim(), attachment, location });
  }

  editar(roomId: string, id: string, texto: string): Promise<void> {
    if (!texto.trim()) throw new Error('El mensaje no puede quedar vacío');
    return updateDoc(doc(firestore, 'chatRooms', roomId, 'messages', id), {
      text: texto.trim(),
      editedAt: serverTimestamp(),
    });
  }

  eliminar(roomId: string, id: string): Promise<void> {
    return this.backend.llamar('deleteMessage', { roomId, id });
  }

  reaccionar(roomId: string, mensaje: Mensaje, emoji: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Inicia sesión para reaccionar');
    return updateDoc(
      doc(firestore, 'chatRooms', roomId, 'messages', mensaje.id),
      new FieldPath('reactions', uid),
      mensaje.reactions[uid] === emoji ? deleteField() : emoji,
    );
  }

  async subirArchivo(roomId: string, messageId: string, archivo: File): Promise<Adjunto> {
    if (archivo.size > 10 * 1024 * 1024) throw new Error('El archivo debe pesar como máximo 10 MB');
    const adjunto = await this.backend.llamar<Adjunto & { signedUrl: string }>('prepareUpload', {
      roomId,
      messageId,
      name: archivo.name,
      mime: archivo.type || 'application/octet-stream',
      size: archivo.size,
    });
    const respuesta = await fetch(adjunto.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': adjunto.mime },
      body: archivo,
    });
    if (!respuesta.ok) throw new Error('No se pudo subir el archivo. Vuelve a intentarlo');
    return { path: adjunto.path, name: adjunto.name, mime: adjunto.mime, size: adjunto.size };
  }

  abrirArchivo(roomId: string, path: string): Promise<{ url: string }> {
    return this.backend.llamar('downloadFile', { roomId, path });
  }

  guardarUbicacion(roomId: string, id: string, latitude: number, longitude: number): Promise<Ubicacion> {
    return this.backend.llamar('saveLocation', { roomId, id, latitude, longitude });
  }
}
