const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  FieldPath,
} = require('firebase/firestore');
let environment;
const roomId = 'afdf1b34-3498-4780-bf49-c0b557697a51';
const messageId = '58acc946-3e64-4abb-a39e-c7cb8fe62b9b';
const roomPath = `chatRooms/${roomId}`;
const messagePath = `${roomPath}/messages/${messageId}`;

function database(uid) {
  return environment.authenticatedContext(uid).firestore();
}
function message(uid = 'alice') {
  return {
    authorUid: uid,
    authorName: uid,
    text: 'Hola',
    kind: 'text',
    attachment: null,
    location: null,
    createdAt: serverTimestamp(),
    editedAt: null,
    reactions: {},
  };
}

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-chat-dual',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(require('node:path').join(__dirname, '../firestore.rules'), 'utf8'),
    },
  });
});
after(async () => {
  await environment?.cleanup();
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), roomPath), {
      title: 'Prueba',
      ownerUid: 'alice',
      memberUids: ['alice', 'bob'],
      revision: 1,
    });
    await setDoc(doc(context.firestore(), messagePath), message());
  });
});

test('members can query their rooms while strangers cannot read them', async () => {
  const rooms = await assertSucceeds(
    getDocs(query(collection(database('bob'), 'chatRooms'), where('memberUids', 'array-contains', 'bob'))),
  );
  assert.equal(rooms.size, 1);
  await assertFails(getDoc(doc(database('eve'), roomPath)));
});

test('clients cannot add themselves to a room', async () => {
  await assertFails(updateDoc(doc(database('eve'), roomPath), { memberUids: ['alice', 'bob', 'eve'] }));
});

test('message creation must go through the authenticated Edge backend', async () => {
  await assertFails(setDoc(doc(database('alice'), `${roomPath}/messages/new`), message()));
  await assertFails(setDoc(doc(database('bob'), `${roomPath}/messages/other`), message('alice')));
});

test('a non-member cannot send or read messages', async () => {
  await assertFails(getDoc(doc(database('eve'), messagePath)));
  await assertFails(setDoc(doc(database('eve'), `${roomPath}/messages/other`), message('eve')));
});

test('only the author can edit text and immutable fields cannot change', async () => {
  await assertSucceeds(
    updateDoc(doc(database('alice'), messagePath), { text: 'Editado', editedAt: serverTimestamp() }),
  );
  await assertFails(updateDoc(doc(database('bob'), messagePath), { text: 'Suplantado', editedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(database('alice'), messagePath), { authorUid: 'bob' }));
});

test('a participant may change only their own reaction', async () => {
  await assertSucceeds(updateDoc(doc(database('bob'), messagePath), new FieldPath('reactions', 'bob'), '👍'));
  await assertFails(updateDoc(doc(database('bob'), messagePath), new FieldPath('reactions', 'alice'), '❤️'));
});

test('message deletion must go through the backend to queue file cleanup', async () => {
  await assertFails(deleteDoc(doc(database('bob'), messagePath)));
  await assertFails(deleteDoc(doc(database('alice'), messagePath)));
});

test('revoked membership prevents further reads immediately', async () => {
  await environment.withSecurityRulesDisabled((context) =>
    updateDoc(doc(context.firestore(), roomPath), { memberUids: ['alice'] }),
  );
  await assertFails(getDoc(doc(database('bob'), messagePath)));
});

test('attachments cannot point at another room or another uploader', async () => {
  const invalid = {
    ...message(),
    kind: 'file',
    attachment: { path: 'other-room/alice/id/file.pdf', name: 'file.pdf', mime: 'application/pdf', size: 10 },
  };
  await assertFails(setDoc(doc(database('alice'), messagePath), invalid));
  await assertFails(
    setDoc(doc(database('alice'), messagePath), {
      ...invalid,
      attachment: { ...invalid.attachment, path: `${roomId}/alice/${messageId}/file.pdf` },
    }),
  );
});

test('invalid coordinates cannot be written', async () => {
  await assertFails(
    setDoc(doc(database('alice'), messagePath), {
      ...message(),
      kind: 'location',
      location: { id: messageId, latitude: 91, longitude: 0 },
    }),
  );
});

test('only the two users can read their friendship and only the backend can write it', async () => {
  const path = 'chatFriends/alice-bob';
  await environment.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), path), { uids: ['alice', 'bob'], senderUid: 'alice', status: 'pending' }),
  );
  const alice = database('alice');
  await assertSucceeds(getDocs(query(collection(alice, 'chatFriends'), where('uids', 'array-contains', 'alice'))));
  await assertSucceeds(getDoc(doc(database('bob'), path)));
  await assertFails(getDoc(doc(database('eve'), path)));
  await assertFails(updateDoc(doc(alice, path), { status: 'accepted' }));
});
