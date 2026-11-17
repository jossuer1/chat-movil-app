import { createClient } from '@supabase/supabase-js';

import { ApiError, record, text } from '../_shared/errors.ts';
import { FirebaseGateway, verifyFirebaseToken } from '../_shared/firebase.ts';
import { ChatBackend } from './service.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Backend {
  execute(action: string, uid: string, data: Record<string, unknown>): Promise<unknown>;
  drainJobs(uid: string): Promise<number>;
}

function createBackend(): Backend {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new ApiError(503, 'configuration', 'Falta la configuración de Supabase en Edge Functions');
  return new ChatBackend(
    new FirebaseGateway(),
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
}

export function createHandler(
  verify: (token: string) => Promise<string> = verifyFirebaseToken,
  factory: () => Backend = createBackend,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (request.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'Usa POST');
      const authorization = request.headers.get('Authorization');
      if (!authorization?.startsWith('Bearer '))
        throw new ApiError(401, 'unauthenticated', 'Inicia sesión en Firebase');
      const uid = await verify(authorization.slice(7));
      let body: Record<string, unknown>;
      try {
        body = record(await request.json());
      } catch {
        throw new ApiError(400, 'invalid-argument', 'El cuerpo debe ser JSON válido');
      }
      const action = text(body.action, 40);
      const backend = factory();
      const result = await backend.execute(action, uid, record(body.data ?? {}));
      const work = backend
        .drainJobs(uid)
        .catch((error) => console.error('chat-jobs', error instanceof Error ? error.message : 'failed'));
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
      else await work;
      return Response.json({ data: result }, { headers: corsHeaders });
    } catch (error) {
      const known = error instanceof ApiError;
      if (!known) console.error('chat-api', error instanceof Error ? error.message : 'failed');
      return Response.json(
        {
          error: {
            code: known ? error.code : 'internal',
            message: known
              ? error.message
              : 'No se pudo completar la operación. Revisa los registros de chat-api en Supabase',
          },
        },
        { status: known ? error.status : 500, headers: corsHeaders },
      );
    }
  };
}
