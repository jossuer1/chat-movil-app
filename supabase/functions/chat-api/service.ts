import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError, coordinates, record, text, uuid } from '../_shared/errors.ts';
import { FirebaseGateway, isConflict } from '../_shared/firebase.ts';
import type { DocumentData, Write } from '../_shared/firebase.ts';

interface Room extends Record<string, unknown> {
  title: string;
  ownerUid: string;
  memberUids: string[];
  revision: number;
  createdAt: string;
}
interface Attachment {
  path: string;
  name: string;
  mime: string;
  size: number;
}
interface Location {
  id: string;
  latitude: number;
  longitude: number;
}
interface Message extends Record<string, unknown> {
  authorUid: string;
  authorName: string;
  text: string;
  kind: string;
  attachment: Attachment | null;
  location: Location | null;
}

function validAttachment(value: unknown, roomId: string, uid: string, messageId: string): Attachment | null {
  if (value == null) return null;
  const attachment = record(value);
  const path = text(attachment.path, 600);
  const prefix = `${roomId}/${uid}/${messageId}/`;
  if (!path.startsWith(prefix) || path.includes('..') || path.split('/').length !== 4) {
    throw new ApiError(400, 'invalid-argument', 'El archivo no corresponde al remitente y mensaje');
  }
  if (!Number.isInteger(attachment.size) || Number(attachment.size) < 1 || Number(attachment.size) > 10485760) {
    throw new ApiError(400, 'invalid-argument', 'El archivo debe pesar entre 1 byte y 10 MB');
  }
  return { path, name: text(attachment.name, 200), mime: text(attachment.mime, 150), size: Number(attachment.size) };
}

function validLocation(value: unknown, id: string): Location | null {
  if (value == null) return null;
  const location = record(value);
  if (uuid(location.id) !== id) throw new ApiError(400, 'invalid-argument', 'La ubicación no corresponde al mensaje');
  return { id, ...coordinates(location.latitude, location.longitude) };
}

function sameCoordinate(previous: number | undefined, current: number | undefined): boolean {
  // PostgREST puede serializar float8 con 15 cifras significativas. La tolerancia
  // de 1e-9 grados absorbe ese redondeo (aprox. 0,1 mm), no cambios de posición.
  return (
    previous === current ||
    (typeof previous === 'number' &&
      typeof current === 'number' &&
      Number.isFinite(previous) &&
      Number.isFinite(current) &&
      Math.abs(previous - current) <= 1e-9)
  );
}

function sameMessage(previous: Message, current: Message): boolean {
  return (
    previous.authorUid === current.authorUid &&
    previous.text === current.text &&
    previous.attachment?.path === current.attachment?.path &&
    previous.attachment?.name === current.attachment?.name &&
    previous.attachment?.mime === current.attachment?.mime &&
    previous.attachment?.size === current.attachment?.size &&
    previous.location?.id === current.location?.id &&
    sameCoordinate(previous.location?.latitude, current.location?.latitude) &&
    sameCoordinate(previous.location?.longitude, current.location?.longitude)
  );
}

export class ChatBackend {
  constructor(
    private readonly firebase: FirebaseGateway,
    private readonly supabase: SupabaseClient,
  ) {}

  private async roomForUser(roomId: string, uid: string): Promise<DocumentData & { data: Room }> {
    uuid(roomId);
    const room = await this.firebase.get(`chatRooms/${roomId}`);
    if (!room || !(room.data as Room).memberUids.includes(uid)) {
      throw new ApiError(403, 'permission-denied', 'No perteneces a esta sala');
    }
    return room as DocumentData & { data: Room };
  }

  private job(id: string, ownerUid: string, kind: string, roomId: string, extra: Record<string, unknown> = {}): Write {
    return this.firebase.put(
      `chatJobs/${id}`,
      {
        ownerUid,
        kind,
        roomId,
        createdAt: new Date(),
        leaseUntil: new Date(0),
        ...extra,
      },
      { exists: false },
    );
  }

  private roomWrite(room: DocumentData & { data: Room }, changes: Record<string, unknown> = {}): Write {
    return this.firebase.put(
      room.path,
      { ...room.data, ...changes, createdAt: new Date(room.data.createdAt) },
      { updateTime: room.updateTime },
    );
  }

  private async synchronize(roomId: string): Promise<void> {
    const document = await this.firebase.get(`chatRooms/${roomId}`);
    if (!document) return;
    const room = document.data as Room;
    const { error } = await this.supabase.rpc('chat_sync_room', {
      p_id: roomId,
      p_title: room.title,
      p_owner: room.ownerUid,
      p_members: room.memberUids,
      p_revision: room.revision,
      p_created_at: room.createdAt,
    });
    if (error) {
      console.error('chat_sync_room', error.code, error.message);
      throw new ApiError(
        503,
        'synchronization',
        'La sala está pendiente de sincronización con Supabase. Vuelve a intentarlo',
      );
    }
  }

  async execute(action: string, uid: string, data: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'prepareSession':
        await this.firebase.prepareSession(uid);
        return { uid };
      case 'createRoom':
        return this.createRoom(uid, data);
      case 'changeMember':
        return this.changeMember(uid, data);
      case 'listMembers':
        return this.listMembers(uid, data);
      case 'prepareUpload':
        return this.prepareUpload(uid, data);
      case 'downloadFile':
        return this.downloadFile(uid, data);
      case 'saveLocation':
        return this.saveLocation(uid, data);
      case 'sendMessage':
        return this.sendMessage(uid, data);
      case 'deleteMessage':
        return this.deleteMessage(uid, data);
      case 'registerDevice':
        return this.registerDevice(uid, data);
      case 'unregisterDevice':
        return this.unregisterDevice(uid, data);
      case 'flushJobs':
        return { processed: await this.drainJobs(uid) };
      default:
        throw new ApiError(404, 'not-found', 'Operación desconocida');
    }
  }

  private async profile(uid: string): Promise<{ nombre: string }> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('nombre,apellido')
      .eq('firebase_uid', uid)
      .maybeSingle<{ nombre: string; apellido?: string }>();
    if (error) throw new ApiError(503, 'profiles', 'No se pudo consultar el perfil en Supabase');
    if (!data) throw new ApiError(400, 'profile-required', 'Guarda primero tu nombre de usuario');
    return { nombre: [data.nombre, data.apellido].filter(Boolean).join(' ') };
  }

  private async createRoom(uid: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const id = uuid(data.id);
    const title = text(data.title, 80);
    await this.profile(uid);
    const path = `chatRooms/${id}`;
    const previous = await this.firebase.get(path);
    if (previous) {
      if (previous.data.ownerUid !== uid || previous.data.title !== title)
        throw new ApiError(409, 'already-exists', 'El identificador de sala ya está en uso');
    } else {
      try {
        await this.firebase.commit([
          this.firebase.put(
            path,
            { title, ownerUid: uid, memberUids: [uid], revision: 1, createdAt: new Date() },
            { exists: false },
          ),
          this.job(`room-${id}-1`, uid, 'sync-room', id),
        ]);
      } catch (error) {
        if (!isConflict(error)) throw error;
        const existing = await this.firebase.get(path);
        if (existing?.data.ownerUid !== uid || existing.data.title !== title)
          throw new ApiError(409, 'already-exists', 'El identificador de sala ya está en uso');
      }
    }
    await this.synchronize(id);
    return { id };
  }

  private async changeMember(uid: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    const roomId = uuid(data.roomId);
    const targetUid = text(data.uid, 128);
    if (typeof data.add !== 'boolean') throw new ApiError(400, 'invalid-argument', 'Operación inválida');
    const initial = await this.roomForUser(roomId, uid);
    if (initial.data.ownerUid !== uid)
      throw new ApiError(403, 'permission-denied', 'Solo el creador administra participantes');
    if (targetUid === uid) throw new ApiError(400, 'owner-required', 'El creador debe permanecer en la sala');
    if (data.add) await this.firebase.user(targetUid);
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = await this.roomForUser(roomId, uid);
      if (room.data.ownerUid !== uid)
        throw new ApiError(403, 'permission-denied', 'Solo el creador administra participantes');
      const members = new Set(room.data.memberUids);
      if (data.add) members.add(targetUid);
      else members.delete(targetUid);
      if (members.size > 100) throw new ApiError(400, 'room-full', 'La sala admite hasta 100 participantes');
      if (members.size === room.data.memberUids.length) {
        await this.synchronize(roomId);
        return { ok: true };
      }
      const revision = room.data.revision + 1;
      try {
        await this.firebase.commit([
          this.roomWrite(room, { memberUids: [...members], revision }),
          this.job(`room-${roomId}-${revision}`, uid, 'sync-room', roomId),
        ]);
        await this.synchronize(roomId);
        return { ok: true };
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new ApiError(409, 'concurrent-update', 'La sala cambió durante la operación. Vuelve a intentarlo');
  }

  private async listMembers(uid: string, data: Record<string, unknown>) {
    const id = uuid(data.roomId);
    const room = await this.roomForUser(id, uid);
    await this.synchronize(id);
    const { data: profiles, error } = await this.supabase
      .from('profiles')
      .select('firebase_uid,nombre,apellido,usuario,foto_path')
      .in('firebase_uid', room.data.memberUids)
      .returns<{ firebase_uid: string; nombre: string; apellido?: string; usuario?: string; foto_path?: string }[]>();
    if (error) throw new ApiError(503, 'profiles', 'No se pudieron cargar los participantes');
    const members = new Map((profiles ?? []).map((profile) => [profile.firebase_uid, profile]));
    return Promise.all(
      room.data.memberUids.map(async (member) => {
        const profile = members.get(member);
        let foto_url: string | null = null;
        // Solo se firman fotos de participantes y dentro de su propia carpeta.
        if (profile?.foto_path?.startsWith(`${member}/`) && !profile.foto_path.includes('..')) {
          const { data: photo } = await this.supabase.storage
            .from('profile-photos')
            .createSignedUrl(profile.foto_path, 3600);
          foto_url = photo?.signedUrl ?? null;
        }
        return {
          uid: member,
          nombre: profile ? [profile.nombre, profile.apellido].filter(Boolean).join(' ') : member,
          usuario: profile?.usuario ?? null,
          foto_url,
        };
      }),
    );
  }

  private async prepareUpload(uid: string, data: Record<string, unknown>): Promise<Attachment & { signedUrl: string }> {
    const roomId = uuid(data.roomId);
    const messageId = uuid(data.messageId);
    await this.roomForUser(roomId, uid);
    const name = text(data.name, 200);
    const mime = text(data.mime, 150);
    const filename = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
    const attachment = validAttachment(
      { path: `${roomId}/${uid}/${messageId}/${filename}`, name, mime, size: data.size },
      roomId,
      uid,
      messageId,
    )!;
    const { data: upload, error } = await this.supabase.storage
      .from('chat-files')
      .createSignedUploadUrl(attachment.path, { upsert: true });
    if (error) throw new ApiError(503, 'storage', 'No se pudo preparar la subida');
    return { ...attachment, signedUrl: upload.signedUrl };
  }

  private async downloadFile(uid: string, data: Record<string, unknown>): Promise<{ url: string }> {
    const roomId = uuid(data.roomId);
    await this.roomForUser(roomId, uid);
    const path = text(data.path, 600);
    if (!path.startsWith(`${roomId}/`) || path.includes('..') || path.split('/').length !== 4)
      throw new ApiError(403, 'permission-denied', 'El archivo no pertenece a la sala');
    const { data: download, error } = await this.supabase.storage
      .from('chat-files')
      .createSignedUrl(path, 60, { download: true });
    if (error) throw new ApiError(404, 'file-not-found', 'El archivo ya no está disponible');
    return { url: download.signedUrl };
  }

  private async saveLocation(uid: string, data: Record<string, unknown>): Promise<Location> {
    const roomId = uuid(data.roomId);
    const id = uuid(data.id);
    await this.roomForUser(roomId, uid);
    const point = coordinates(data.latitude, data.longitude);
    await this.synchronize(roomId);
    const { error } = await this.supabase
      .from('chat_locations')
      .upsert({ id, room_id: roomId, firebase_uid: uid, ...point }, { onConflict: 'id,room_id,firebase_uid' });
    if (error) throw new ApiError(503, 'locations', 'No se pudo guardar la ubicación');
    return { id, ...point };
  }

  private async sendMessage(uid: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const roomId = uuid(data.roomId);
    const id = uuid(data.id);
    await this.roomForUser(roomId, uid);
    const attachment = validAttachment(data.attachment, roomId, uid, id);
    const location = validLocation(data.location, id);
    if (attachment && location)
      throw new ApiError(400, 'invalid-argument', 'Comparte el archivo y la ubicación en mensajes separados');
    if (
      typeof data.text !== 'string' ||
      data.text.trim().length > 4000 ||
      (!data.text.trim() && !attachment && !location)
    ) {
      throw new ApiError(
        400,
        'invalid-argument',
        'El mensaje debe tener texto, archivo o ubicación, con un máximo de 4000 caracteres',
      );
    }
    const profile = await this.profile(uid);
    const message: Message = {
      authorUid: uid,
      authorName: profile.nombre.slice(0, 100),
      text: data.text.trim(),
      kind: attachment ? 'file' : location ? 'location' : 'text',
      attachment,
      location,
    };
    const path = `chatRooms/${roomId}/messages/${id}`;
    const existing = await this.firebase.get(path);
    if (existing) {
      if (!sameMessage(existing.data as Message, message))
        throw new ApiError(409, 'message-conflict', 'Este envío ya existe con otro contenido');
      return { id };
    }
    if (attachment) {
      const { data: file, error } = await this.supabase.storage.from('chat-files').info(attachment.path);
      if (error || file.size !== attachment.size)
        throw new ApiError(400, 'invalid-file', 'El archivo debe subirse completamente antes de enviar el mensaje');
    }
    if (location) {
      const { data: point, error } = await this.supabase
        .from('chat_locations')
        .select('latitude,longitude')
        .eq('id', location.id)
        .eq('room_id', roomId)
        .eq('firebase_uid', uid)
        .maybeSingle();
      if (error) throw new ApiError(503, 'locations', 'No se pudo verificar la ubicación. Vuelve a intentar el envío');
      if (!point)
        throw new ApiError(400, 'invalid-location', 'No se encontró la ubicación guardada. Vuelve a compartirla');
      if (!sameCoordinate(point.latitude, location.latitude) || !sameCoordinate(point.longitude, location.longitude))
        throw new ApiError(400, 'invalid-location', 'La ubicación no coincide con la guardada. Vuelve a compartirla');
      // El mensaje utiliza el punto autorizado que se leyó de Supabase.
      message.location = { id: location.id, ...coordinates(point.latitude, point.longitude) };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = await this.roomForUser(roomId, uid);
      const previous = await this.firebase.get(path);
      if (previous) {
        if (!sameMessage(previous.data as Message, message))
          throw new ApiError(409, 'message-conflict', 'Este envío ya existe con otro contenido');
        return { id };
      }
      try {
        await this.firebase.commit([
          this.roomWrite(room),
          this.firebase.put(path, { ...message, editedAt: null, reactions: {} }, { exists: false }, ['createdAt']),
          this.job(`notify-${roomId}-${id}`, uid, 'notify-message', roomId, { messageId: id }),
        ]);
        return { id };
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new ApiError(409, 'concurrent-update', 'La sala cambió durante el envío. Vuelve a intentarlo');
  }

  private async deleteMessage(uid: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    const roomId = uuid(data.roomId);
    const id = uuid(data.id);
    const path = `chatRooms/${roomId}/messages/${id}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = await this.roomForUser(roomId, uid);
      const message = await this.firebase.get(path);
      if (!message) return { ok: true };
      if (message.data.authorUid !== uid && room.data.ownerUid !== uid)
        throw new ApiError(403, 'permission-denied', 'Solo el autor o creador de la sala puede eliminar el mensaje');
      try {
        await this.firebase.commit([
          this.roomWrite(room),
          this.firebase.remove(path, { updateTime: message.updateTime }),
          this.job(`cleanup-${roomId}-${id}`, uid, 'cleanup-message', roomId, { messageId: id, message: message.data }),
        ]);
        return { ok: true };
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    throw new ApiError(409, 'concurrent-update', 'El mensaje cambió. Vuelve a intentarlo');
  }

  private async devicePath(token: string): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return `pushDevices/${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  private async registerDevice(uid: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    const token = text(data.token, 4096);
    await this.firebase.commit([
      this.firebase.put(await this.devicePath(token), { uid, token, updatedAt: new Date() }),
    ]);
    return { ok: true };
  }

  private async unregisterDevice(uid: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    const path = await this.devicePath(text(data.token, 4096));
    const device = await this.firebase.get(path);
    if (device?.data.uid === uid) {
      try {
        await this.firebase.commit([this.firebase.remove(path, { updateTime: device.updateTime })]);
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
    }
    return { ok: true };
  }

  async drainJobs(uid: string): Promise<number> {
    const jobs = await this.firebase.query('chatJobs', 'ownerUid', uid, 10);
    let processed = 0;
    for (const job of jobs) {
      if (Date.parse(String(job.data.leaseUntil)) > Date.now()) continue;
      const leaseToken = crypto.randomUUID();
      let leased: DocumentData | null = null;
      try {
        await this.firebase.commit([
          this.firebase.put(
            job.path,
            { ...job.data, leaseToken, leaseUntil: new Date(Date.now() + 180000) },
            { updateTime: job.updateTime },
          ),
        ]);
        leased = await this.firebase.get(job.path);
        if (!leased || leased.data.leaseToken !== leaseToken) continue;
        await this.processJob(leased);
        await this.firebase.commit([this.firebase.remove(job.path, { updateTime: leased.updateTime })]);
        processed++;
      } catch (error) {
        if (isConflict(error)) continue;
        console.error('chat-job', job.path, error instanceof Error ? error.message : 'failed');
        if (leased?.data.leaseToken === leaseToken) {
          await this.firebase
            .commit([
              this.firebase.put(
                job.path,
                { ...leased.data, leaseUntil: new Date(0) },
                { updateTime: leased.updateTime },
              ),
            ])
            .catch(() => undefined);
        }
      }
    }
    return processed;
  }

  private async processJob(job: DocumentData): Promise<void> {
    const roomId = uuid(job.data.roomId);
    if (job.data.kind === 'sync-room') {
      await this.synchronize(roomId);
      return;
    }
    if (job.data.kind === 'notify-message') {
      await this.notify(roomId, uuid(job.data.messageId));
      return;
    }
    if (job.data.kind !== 'cleanup-message') throw new Error('Unknown job type');
    const id = uuid(job.data.messageId);
    const message = job.data.message as Message;
    if (message.attachment) {
      const attachment = validAttachment(message.attachment, roomId, message.authorUid, id)!;
      const { error } = await this.supabase.storage.from('chat-files').remove([attachment.path]);
      if (error) throw error;
    }
    if (message.location) {
      const { error } = await this.supabase
        .from('chat_locations')
        .delete()
        .eq('id', message.location.id)
        .eq('room_id', roomId)
        .eq('firebase_uid', message.authorUid);
      if (error) throw error;
    }
  }

  private async notify(roomId: string, id: string): Promise<void> {
    const message = await this.firebase.get(`chatRooms/${roomId}/messages/${id}`);
    const room = await this.firebase.get(`chatRooms/${roomId}`);
    if (!message || !room) return;
    const recipients = (room.data as Room).memberUids.filter((member) => member !== message.data.authorUid);
    for (let start = 0; start < recipients.length; start += 30) {
      const devices = await this.firebase.query('pushDevices', 'uid', recipients.slice(start, start + 30), null, 'IN');
      for (let offset = 0; offset < devices.length; offset += 8) {
        await Promise.all(
          devices.slice(offset, offset + 8).map(async (device) => {
            try {
              await this.firebase.google(
                `https://fcm.googleapis.com/v1/projects/${this.firebase.projectId}/messages:send`,
                'POST',
                {
                  message: {
                    token: device.data.token,
                    notification: { title: 'Chat Dual', body: 'Tienes un nuevo mensaje' },
                    data: { roomId, messageId: id },
                  },
                },
              );
            } catch (error) {
              if (error instanceof ApiError && ['FCM_UNREGISTERED', 'FCM_INVALID_ARGUMENT'].includes(error.code)) {
                await this.firebase
                  .commit([this.firebase.remove(device.path, { updateTime: device.updateTime })])
                  .catch(() => undefined);
                return;
              }
              throw error;
            }
          }),
        );
      }
    }
  }
}
