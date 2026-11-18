import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

import { FirebaseGateway } from '../_shared/firebase.ts';
import { ChatBackend } from './service.ts';

function fixture(photoPath = 'alice/abc.png') {
  const roomId = '00000000-0000-4000-8000-000000000001';
  const signed: string[] = [];
  const uploaded: string[] = [];
  const firebase = new (class extends FirebaseGateway {
    override get(path: string) {
      return Promise.resolve({
        path,
        updateTime: '2026-01-01T00:00:00Z',
        data: {
          title: 'Sala',
          ownerUid: 'alice',
          memberUids: ['alice', 'bob'],
          revision: 1,
          createdAt: '2026-01-01T00:00:00Z',
        },
      });
    }
  })();
  const supabase = createClient('https://example.supabase.invalid', 'test', {
    auth: { persistSession: false },
    global: {
      fetch: async (input, options) => {
        const url = String(input);
        if (url.includes('/rpc/chat_sync_room')) return Response.json(null);
        if (url.includes('/rest/v1/profiles'))
          return Response.json([
            { firebase_uid: 'alice', nombre: 'Ana', apellido: 'Pérez', usuario: 'ana_perez', foto_path: photoPath },
            { firebase_uid: 'bob', nombre: 'Perfil anterior' },
          ]);
        if (url.includes('/object/sign/profile-photos/')) {
          signed.push(url);
          return Response.json({ signedURL: '/object/sign/profile-photos/alice/abc.png?token=test' });
        }
        if (url.includes('/object/profile-photos/') && options?.method === 'POST') {
          uploaded.push(url);
          assert.deepEqual(options.body, Uint8Array.of(255, 216, 255, 217));
          return Response.json({ Key: url });
        }
        throw new Error('Unexpected call');
      },
    },
  });
  return { roomId, signed, uploaded, service: new ChatBackend(firebase, supabase) };
}

Deno.test('member profiles include full names and signed photos and preserve legacy profiles', async () => {
  const test = fixture();
  const result = (await test.service.execute('listMembers', 'alice', { roomId: test.roomId })) as Record<
    string,
    unknown
  >[];
  assert.equal(result[0].nombre, 'Ana Pérez');
  assert.equal(result[0].usuario, 'ana_perez');
  assert.match(String(result[0].foto_url), /object\/sign\/profile-photos/);
  assert.equal(result[1].nombre, 'Perfil anterior');
  assert.equal(result[1].foto_url, null);
  assert.equal(test.signed.length, 1);
});
Deno.test('a nonmember cannot retrieve profiles or signed photos', async () => {
  const test = fixture();
  await assert.rejects(() => test.service.execute('listMembers', 'outsider', { roomId: test.roomId }));
  assert.equal(test.signed.length, 0);
});
Deno.test('a profile cannot cause the backend to sign another user photo', async () => {
  const test = fixture('bob/private.png');
  const result = (await test.service.execute('listMembers', 'alice', { roomId: test.roomId })) as Record<
    string,
    unknown
  >[];
  assert.equal(result[0].foto_url, null);
  assert.equal(test.signed.length, 0);
});

Deno.test('photo upload validates bytes and uses the authenticated user folder', async () => {
  const test = fixture();
  await assert.rejects(() =>
    test.service.execute('uploadProfilePhoto', 'alice', { mime: 'image/jpeg', content: btoa('<svg/>') }),
  );
  const photo = (await test.service.execute('uploadProfilePhoto', 'alice', {
    mime: 'image/jpeg',
    content: btoa(String.fromCharCode(255, 216, 255, 217)),
    path: 'bob/other.jpg',
  })) as { path: string };
  assert.match(photo.path, /^alice\/[a-f0-9-]+\.jpg$/);
  assert.deepEqual(test.uploaded, [`https://example.supabase.invalid/storage/v1/object/profile-photos/${photo.path}`]);
});
