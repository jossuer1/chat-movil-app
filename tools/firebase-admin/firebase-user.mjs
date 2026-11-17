// Ejecutar únicamente en un entorno administrativo con Application Default Credentials.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [accion, projectId, uid, ...extras] = process.argv.slice(2);

if (!['inspect', 'grant'].includes(accion) || !projectId || !uid || extras.length > 0) {
  console.error('Uso: node firebase-user.mjs <inspect|grant> <firebase-project-id> <uid>');
  process.exit(1);
}

if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Desactiva FIREBASE_AUTH_EMULATOR_HOST para consultar Firebase Authentication real.');
}

try {
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const auth = getAuth(app);
  const user = await auth.getUser(uid);

  if (accion === 'grant') {
    // setCustomUserClaims reemplaza el objeto entero. Conservamos los demás claims.
    await auth.setCustomUserClaims(uid, { ...user.customClaims, role: 'authenticated' });
  }

  const verifiedUser = await auth.getUser(uid);
  console.log(
    JSON.stringify(
      {
        projectId,
        uid: verifiedUser.uid,
        disabled: verifiedUser.disabled,
        providers: verifiedUser.providerData.map((provider) => provider.providerId),
        createdAt: verifiedUser.metadata.creationTime,
        lastSignInAt: verifiedUser.metadata.lastSignInTime,
        role: verifiedUser.customClaims?.role ?? null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.code ?? 'admin/error', error.message);
  process.exitCode = 1;
}
