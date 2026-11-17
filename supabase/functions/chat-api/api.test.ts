import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

import { ApiError } from '../_shared/errors.ts';
import { firebaseProjectId, verifyFirebaseToken } from '../_shared/firebase.ts';
import { createHandler } from './handler.ts';

Deno.test('CORS preflight succeeds without authentication or server secrets', async () => {
  const handle = createHandler(
    () => {
      throw new Error('Must not verify OPTIONS');
    },
    () => {
      throw new Error('Must not initialize backend');
    },
  );
  const response = await handle(
    new Request('https://example.test/chat-api', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8100' } }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Access-Control-Allow-Headers')!, /authorization/);
});

Deno.test('anonymous and invalid Firebase sessions are rejected before backend initialization', async () => {
  const handle = createHandler(
    () => Promise.reject(new ApiError(401, 'unauthenticated', 'Sesión inválida')),
    () => {
      throw new Error('Must not initialize backend');
    },
  );
  for (const headers of [new Headers(), new Headers({ Authorization: 'Bearer forged' })]) {
    const response = await handle(
      new Request('https://example.test/chat-api', { method: 'POST', headers, body: '{}' }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  }
});

Deno.test('the backend receives the verified UID and ignores a UID supplied in the body', async () => {
  let called = false;
  const handle = createHandler(
    async (token) => {
      assert.equal(token, 'firebase-token');
      return 'alice';
    },
    () => ({
      execute: (action, uid, data) => {
        assert.equal(action, 'prepareSession');
        assert.equal(uid, 'alice');
        assert.equal(data.uid, 'victim');
        called = true;
        return Promise.resolve({ uid });
      },
      drainJobs: () => Promise.resolve(0),
    }),
  );
  const response = await handle(
    new Request('https://example.test/chat-api', {
      method: 'POST',
      headers: { Authorization: 'Bearer firebase-token' },
      body: JSON.stringify({ action: 'prepareSession', data: { uid: 'victim' } }),
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { uid: 'alice' } });
  assert.equal(called, true);
});

Deno.test('invalid request bodies return JSON errors with CORS headers', async () => {
  const handle = createHandler(async () => 'alice');
  const response = await handle(
    new Request('https://example.test/chat-api', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid' },
      body: '{broken',
    }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'invalid-argument');
});

Deno.test('Firebase JWT verification checks signature, project, expiry and required claims', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256' };
  const trusted = createLocalJWKSet({ keys: [jwk] });
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown>, privateKey = keys.privateKey) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
  const claims = {
    sub: 'alice',
    aud: firebaseProjectId,
    iss: `https://securetoken.google.com/${firebaseProjectId}`,
    exp: now + 3600,
    iat: now,
    auth_time: now,
  };
  assert.equal(await verifyFirebaseToken(await sign(claims), trusted), 'alice');
  for (const invalid of [
    { ...claims, aud: 'other-project' },
    { ...claims, exp: now - 1 },
    { ...claims, auth_time: now + 3600 },
    { ...claims, sub: '' },
  ]) {
    await assert.rejects(() => sign(invalid).then((token) => verifyFirebaseToken(token, trusted)), ApiError);
  }
  const attacker = await generateKeyPair('RS256');
  await assert.rejects(
    () =>
      sign({ ...claims, role: 'authenticated' }, attacker.privateKey).then((token) =>
        verifyFirebaseToken(token, trusted),
      ),
    ApiError,
  );
});
