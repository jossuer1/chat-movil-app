import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

import { ApiError } from './errors.ts';

export const firebaseProjectId = 'chat-dual-f31e5';
const signingKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export async function verifyFirebaseToken(token: string, keys: JWTVerifyGetKey = signingKeys): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat', 'auth_time'],
    });
    const now = Date.now() / 1000;
    if (
      !payload.sub ||
      payload.sub.length > 128 ||
      typeof payload.iat !== 'number' ||
      payload.iat > now + 30 ||
      typeof payload['auth_time'] !== 'number' ||
      payload['auth_time'] > now + 30
    )
      throw new Error('Invalid claims');
    return payload.sub;
  } catch {
    throw new ApiError(401, 'unauthenticated', 'La sesión de Firebase venció o no es válida. Vuelve a iniciar sesión');
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let accessToken: { value: string; expiresAt: number } | undefined;
let pendingToken: Promise<string> | undefined;

async function requestAccessToken(): Promise<string> {
  const serialized = Deno.env.get('FIREBASE_SERVICE_ACCOUNT');
  if (!serialized)
    throw new ApiError(503, 'configuration', 'Configura FIREBASE_SERVICE_ACCOUNT en los secretos de Supabase');
  let account: ServiceAccount;
  try {
    account = JSON.parse(serialized);
  } catch {
    throw new ApiError(
      503,
      'configuration',
      'El secreto FIREBASE_SERVICE_ACCOUNT debe contener el JSON de la cuenta de servicio',
    );
  }
  if (account.project_id !== firebaseProjectId || !account.client_email || !account.private_key) {
    throw new ApiError(503, 'configuration', `La cuenta de servicio debe corresponder a ${firebaseProjectId}`);
  }
  const privateKey = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({
    scope:
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/userinfo.email',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new ApiError(503, 'firebase-credentials', 'Google rechazó las credenciales administrativas de Firebase');
  const result = await response.json();
  accessToken = { value: result.access_token, expiresAt: Date.now() + Number(result.expires_in) * 1000 };
  return accessToken.value;
}

async function googleToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 90000) return accessToken.value;
  pendingToken ??= requestAccessToken().finally(() => {
    pendingToken = undefined;
  });
  return pendingToken;
}

type Fields = Record<string, WireValue>;
interface WireValue {
  nullValue?: null;
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  arrayValue?: { values?: WireValue[] };
  mapValue?: { fields?: Fields };
}
interface WireDocument {
  name: string;
  fields: Fields;
  updateTime: string;
}
export interface DocumentData {
  path: string;
  data: Record<string, unknown>;
  updateTime: string;
}
export type Precondition = { exists: boolean } | { updateTime: string };
export interface Write {
  verify?: string;
  update?: { name: string; fields: Fields };
  delete?: string;
  currentDocument?: Precondition;
  updateTransforms?: { fieldPath: string; setToServerValue: 'REQUEST_TIME' }[];
}

function encode(value: unknown): WireValue {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object' && value)
    return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new Error('Unsupported Firestore field');
}

function encodeFields(data: Record<string, unknown>): Fields {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encode(value)]),
  );
}

function decode(value: WireValue): unknown {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decode);
  return decodeFields(value.mapValue?.fields ?? {});
}

function decodeFields(fields: Fields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

export class FirebaseGateway {
  readonly documentRoot: string;
  private readonly firestoreUrl: string;

  constructor(
    readonly projectId = firebaseProjectId,
    private readonly getToken: () => Promise<string> = googleToken,
    firestoreHost = 'https://firestore.googleapis.com',
  ) {
    this.documentRoot = `projects/${projectId}/databases/(default)/documents`;
    this.firestoreUrl = `${firestoreHost}/v1/${this.documentRoot}`;
  }

  async google<T>(url: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const error: { error?: { status?: string; details?: { '@type'?: string; errorCode?: string }[] } } =
        await response.json().catch(() => ({}));
      const messaging = error.error?.details?.find(
        (detail) => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
      );
      const status = messaging?.errorCode ? `FCM_${messaging.errorCode}` : (error.error?.status ?? 'firebase-error');
      throw new ApiError(
        response.status,
        status,
        response.status === 403
          ? 'La cuenta de servicio de Firebase no tiene los permisos necesarios. Revisa su configuración IAM'
          : `No se pudo completar la operación con Firebase (${status})`,
      );
    }
    return response.json();
  }

  async get(path: string): Promise<DocumentData | null> {
    try {
      const result = await this.google<WireDocument>(`${this.firestoreUrl}/${path}`, 'GET');
      return { path, data: decodeFields(result.fields ?? {}), updateTime: result.updateTime };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  put(path: string, data: Record<string, unknown>, condition?: Precondition, serverTimestamps: string[] = []): Write {
    return {
      update: { name: `${this.documentRoot}/${path}`, fields: encodeFields(data) },
      currentDocument: condition,
      ...(serverTimestamps.length
        ? {
            updateTransforms: serverTimestamps.map((fieldPath) => ({
              fieldPath,
              setToServerValue: 'REQUEST_TIME' as const,
            })),
          }
        : {}),
    };
  }

  remove(path: string, condition?: Precondition): Write {
    return { delete: `${this.documentRoot}/${path}`, currentDocument: condition };
  }

  verify(path: string, updateTime: string): Write {
    return { verify: `${this.documentRoot}/${path}`, currentDocument: { updateTime } };
  }

  async commit(writes: Write[]): Promise<void> {
    await this.google(`${this.firestoreUrl}:commit`, 'POST', { writes });
  }

  async query(
    collectionId: string,
    field: string,
    value: unknown,
    maximum: number | null = 25,
    operator = 'EQUAL',
  ): Promise<DocumentData[]> {
    const result = await this.google<{ document?: WireDocument }[]>(`${this.firestoreUrl}:runQuery`, 'POST', {
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op: operator, value: encode(value) } },
        ...(maximum === null ? {} : { limit: maximum }),
      },
    });
    return result
      .filter((item) => item.document)
      .map((item) => ({
        path: item.document!.name.slice(this.documentRoot.length + 1),
        data: decodeFields(item.document!.fields ?? {}),
        updateTime: item.document!.updateTime,
      }));
  }

  async user(uid: string): Promise<{ localId: string; disabled?: boolean; customAttributes?: string }> {
    const result = await this.google<{ users?: { localId: string; disabled?: boolean; customAttributes?: string }[] }>(
      `https://identitytoolkit.googleapis.com/v1/projects/${this.projectId}/accounts:lookup`,
      'POST',
      { localId: [uid] },
    );
    if (!result.users?.length) throw new ApiError(404, 'user-not-found', 'El usuario no existe en Firebase');
    return result.users[0];
  }

  async prepareSession(uid: string): Promise<void> {
    const user = await this.user(uid);
    if (user.disabled) throw new ApiError(403, 'user-disabled', 'La cuenta está deshabilitada');
    const claims = JSON.parse(user.customAttributes || '{}');
    if (claims.role === 'authenticated') return;
    await this.google(`https://identitytoolkit.googleapis.com/v1/projects/${this.projectId}/accounts:update`, 'POST', {
      localId: uid,
      customAttributes: JSON.stringify({ ...claims, role: 'authenticated' }),
    });
  }
}

export function isConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    ([409, 412].includes(error.status) || ['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(error.code))
  );
}
