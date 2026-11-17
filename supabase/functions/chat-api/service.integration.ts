import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

import { ApiError } from '../_shared/errors.ts';
import { FirebaseGateway } from '../_shared/firebase.ts';
import { ChatBackend } from './service.ts';

const emulator = Deno.env.get('FIRESTORE_EMULATOR_HOST');

async function fixture() {
  if (!emulator || !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error('Use a local Firestore emulator');
  const id = crypto.randomUUID();
  const owner = `owner-${id}`;
  const alice = `alice-${id}`;
  const bob = `bob-${id}`;
  const database = new (class extends FirebaseGateway {
    override user(uid: string) {
      return Promise.resolve({ localId: uid });
    }
  })('demo-chat-dual', () => Promise.resolve('owner'), `http://${emulator}`);
  let failSynchronization = false;
  let failCleanup = false;
  const synchronized: Record<string, unknown>[] = [];
  const removedFiles: string[][] = [];
  const locations = new Map<string, Record<string, unknown>>();
  const supabase = createClient('https://test.supabase.invalid', 'test-server-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (_url, options) => {
        const url = String(_url);
        if (url.includes('/rpc/chat_sync_room')) {
          if (failSynchronization)
            return Promise.resolve(Response.json({ code: 'test', message: 'Temporary failure' }, { status: 500 }));
          synchronized.push(JSON.parse(String(options?.body)));
          return Promise.resolve(Response.json(null));
        }
        if (url.includes('/rest/v1/profiles')) return Promise.resolve(Response.json({ nombre: 'Alicia' }));
        if (url.includes('/rest/v1/chat_locations')) {
          if (options?.method === 'POST') {
            const point = JSON.parse(String(options.body));
            // Reproduce la salida float8 de PostgreSQL con extra_float_digits=0.
            locations.set(`${point.id}/${point.room_id}/${point.firebase_uid}`, {
              latitude: Number(point.latitude.toPrecision(15)),
              longitude: Number(point.longitude.toPrecision(15)),
            });
            return Promise.resolve(new Response(null, { status: 201 }));
          }
          const params = new URL(url).searchParams;
          const key = ['id', 'room_id', 'firebase_uid'].map((name) => params.get(name)?.replace(/^eq\./, '')).join('/');
          return Promise.resolve(Response.json(locations.get(key) ?? null));
        }
        if (url.includes('/storage/v1/object/chat-files') && options?.method === 'DELETE') {
          if (failCleanup)
            return Promise.resolve(Response.json({ message: 'Temporary storage failure' }, { status: 500 }));
          removedFiles.push(JSON.parse(String(options?.body)).prefixes);
          return Promise.resolve(Response.json([]));
        }
        throw new Error(`Unexpected network call: ${url}`);
      },
    },
  });
  const service = new ChatBackend(database, supabase);
  await database.commit([
    database.put(`chatRooms/${id}`, {
      title: 'Test room',
      ownerUid: owner,
      memberUids: [owner, alice, bob],
      revision: 1,
      createdAt: new Date(),
    }),
  ]);
  return {
    id,
    owner,
    alice,
    bob,
    database,
    service,
    synchronized,
    removedFiles,
    locations,
    failSynchronization: (value: boolean) => {
      failSynchronization = value;
    },
    failCleanup: (value: boolean) => {
      failCleanup = value;
    },
  };
}

function integration(name: string, fn: () => Promise<void>) {
  Deno.test({ name, ignore: !emulator, fn });
}

integration('room creation is idempotent and queues its synchronization atomically', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  await test.service.execute('createRoom', test.alice, { id, title: 'My room' });
  await test.service.execute('createRoom', test.alice, { id, title: 'My room' });
  assert.equal((await test.database.get(`chatRooms/${id}`))?.data.revision, 1);
  assert.ok(await test.database.get(`chatJobs/room-${id}-1`));
  assert.equal(test.synchronized.length, 2);
});

integration('only the owner can add and remove participants', async () => {
  const test = await fixture();
  await assert.rejects(
    () => test.service.execute('changeMember', test.alice, { roomId: test.id, uid: 'eve', add: true }),
    ApiError,
  );
  await test.service.execute('changeMember', test.owner, { roomId: test.id, uid: 'eve', add: true });
  assert.ok(
    (await test.database.get(`chatRooms/${test.id}`))?.data.memberUids && test.synchronized.at(-1)?.p_revision === 2,
  );
  await test.service.execute('changeMember', test.owner, { roomId: test.id, uid: 'eve', add: false });
  assert.equal(test.synchronized.at(-1)?.p_revision, 3);
});

integration('message retries create one message and one notification job', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  const data = { roomId: test.id, id, text: 'Hello', attachment: null, location: null };
  await test.service.execute('sendMessage', test.alice, data);
  await test.service.execute('sendMessage', test.alice, data);
  const message = await test.database.get(`chatRooms/${test.id}/messages/${id}`);
  assert.equal(message?.data.authorUid, test.alice);
  assert.equal(message?.data.authorName, 'Alicia');
  assert.ok(typeof message?.data.createdAt === 'string');
  assert.equal((await test.database.query('chatJobs', 'ownerUid', test.alice)).length, 1);
  await assert.rejects(() => test.service.execute('sendMessage', test.alice, { ...data, text: 'Changed' }), ApiError);
});

integration('non-members cannot create messages', async () => {
  const test = await fixture();
  await assert.rejects(
    () => test.service.execute('sendMessage', 'eve', { roomId: test.id, id: crypto.randomUUID(), text: 'Hello' }),
    ApiError,
  );
});

integration('membership revoked between validation and commit prevents the message write', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  const original = test.database.commit.bind(test.database);
  let revoke = true;
  test.database.commit = async (writes) => {
    if (revoke && writes.some((write) => write.update?.name.endsWith(`/messages/${id}`))) {
      revoke = false;
      const room = (await test.database.get(`chatRooms/${test.id}`))!;
      await original([
        test.database.put(room.path, { ...room.data, memberUids: [test.owner] }, { updateTime: room.updateTime }),
      ]);
    }
    await original(writes);
  };
  await assert.rejects(
    () => test.service.execute('sendMessage', test.alice, { roomId: test.id, id, text: 'Hello' }),
    (error) => error instanceof ApiError && error.status === 403,
  );
  assert.equal(await test.database.get(`chatRooms/${test.id}/messages/${id}`), null);
});

integration('deletion checks the author and persists a cleanup job with the deleted content', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  await test.service.execute('sendMessage', test.alice, { roomId: test.id, id, text: 'Hello' });
  await assert.rejects(() => test.service.execute('deleteMessage', test.bob, { roomId: test.id, id }), ApiError);
  await test.service.execute('deleteMessage', test.owner, { roomId: test.id, id });
  assert.equal(await test.database.get(`chatRooms/${test.id}/messages/${id}`), null);
  assert.equal((await test.database.get(`chatJobs/cleanup-${test.id}-${id}`))?.data.kind, 'cleanup-message');
  await test.service.execute('deleteMessage', test.owner, { roomId: test.id, id });
});

integration('failed synchronization keeps a durable job that succeeds on a later attempt', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  test.failSynchronization(true);
  await assert.rejects(() => test.service.execute('createRoom', test.alice, { id, title: 'Retry room' }), ApiError);
  assert.ok(await test.database.get(`chatJobs/room-${id}-1`));
  test.failSynchronization(false);
  assert.equal(await test.service.drainJobs(test.alice), 1);
  assert.equal(await test.database.get(`chatJobs/room-${id}-1`), null);
});

integration('cleanup failures retain the job and retry without losing file ownership checks', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  const path = `${test.id}/${test.alice}/${id}/test.pdf`;
  await test.database.commit([
    test.database.put(`chatRooms/${test.id}/messages/${id}`, {
      authorUid: test.alice,
      authorName: 'Alicia',
      text: '',
      kind: 'file',
      attachment: { path, name: 'test.pdf', mime: 'application/pdf', size: 10 },
      location: null,
    }),
  ]);
  await test.service.execute('deleteMessage', test.owner, { roomId: test.id, id });
  test.failCleanup(true);
  assert.equal(await test.service.drainJobs(test.owner), 0);
  assert.ok(await test.database.get(`chatJobs/cleanup-${test.id}-${id}`));
  test.failCleanup(false);
  assert.equal(await test.service.drainJobs(test.owner), 1);
  assert.deepEqual(test.removedFiles, [[path]]);
});

integration('device ownership moves on login and an old account cannot unregister the new owner', async () => {
  const test = await fixture();
  const token = `token-${test.id}`;
  await test.service.execute('registerDevice', test.alice, { token });
  await test.service.execute('registerDevice', test.bob, { token });
  await test.service.execute('unregisterDevice', test.alice, { token });
  assert.equal((await test.database.query('pushDevices', 'uid', test.bob)).length, 1);
});

integration('an invalid FCM token is removed so its notification job can finish', async () => {
  const test = await fixture();
  await test.service.execute('registerDevice', test.bob, { token: `invalid-${test.id}` });
  const original = test.database.google.bind(test.database);
  test.database.google = <T>(url: string, method: string, body?: unknown): Promise<T> => {
    if (url.startsWith('https://fcm.googleapis.com/'))
      return Promise.reject(new ApiError(400, 'FCM_INVALID_ARGUMENT', 'Invalid token'));
    return original<T>(url, method, body);
  };
  await test.service.execute('sendMessage', test.alice, { roomId: test.id, id: crypto.randomUUID(), text: 'Hello' });
  assert.equal(await test.service.drainJobs(test.alice), 1);
  assert.equal((await test.database.query('pushDevices', 'uid', test.bob)).length, 0);
});

integration('GPS precision survives the SQL round trip and retry without creating another message', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  const point = { id, latitude: -0.18065312345678912, longitude: -78.46783412345678 };
  await test.service.execute('saveLocation', test.alice, { roomId: test.id, ...point });
  const payload = { roomId: test.id, id, text: '', location: point };
  await test.service.execute('sendMessage', test.alice, payload);
  await test.service.execute('sendMessage', test.alice, payload);
  const message = await test.database.get(`chatRooms/${test.id}/messages/${id}`);
  const stored = test.locations.get(`${id}/${test.id}/${test.alice}`);
  assert.deepEqual(message?.data.location, { id, ...stored });
  assert.notEqual(stored?.longitude, point.longitude);
  assert.equal((await test.database.query('chatJobs', 'ownerUid', test.alice)).length, 1);
  await assert.rejects(
    () =>
      test.service.execute('sendMessage', test.alice, {
        ...payload,
        location: { ...point, latitude: point.latitude + 0.0001 },
      }),
    ApiError,
  );
});

integration('location validation still rejects changed points and another sender location', async () => {
  const test = await fixture();
  const id = crypto.randomUUID();
  const point = { id, latitude: -0.18065312345678912, longitude: -78.46783412345678 };
  await test.service.execute('saveLocation', test.alice, { roomId: test.id, ...point });
  await assert.rejects(
    () =>
      test.service.execute('sendMessage', test.alice, {
        roomId: test.id,
        id,
        text: '',
        location: { ...point, longitude: point.longitude + 0.001 },
      }),
    ApiError,
  );
  await assert.rejects(
    () =>
      test.service.execute('sendMessage', test.bob, {
        roomId: test.id,
        id,
        text: '',
        location: point,
      }),
    ApiError,
  );
  assert.equal(await test.database.get(`chatRooms/${test.id}/messages/${id}`), null);
});
