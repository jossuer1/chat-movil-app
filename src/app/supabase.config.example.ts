import { createClient } from '@supabase/supabase-js';

import { auth } from './firebase.config';

// Copiar como supabase.config.ts y completar solo en el equipo local.
export const supabaseConfig = {
  url: 'https://REEMPLAZAR.supabase.co',
  publishableKey: 'REEMPLAZAR_CLAVE_PUBLICA',
};
export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
  accessToken: async () => {
    await auth.authStateReady();
    return auth.currentUser ? auth.currentUser.getIdToken() : null;
  },
});
