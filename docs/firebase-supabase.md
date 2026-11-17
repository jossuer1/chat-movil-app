El proyecto configurado es `chat-dual-f31e5`, número `1508214901`. El proyecto Supabase es `lcmrvlnxpnzgqgiwzxpv`. El 15 de noviembre de 2026 se comprobó la configuración pública de Firebase Authentication y una consulta sin registros a las columnas `profiles.firebase_uid` y `profiles.nombre`. Ambas APIs respondieron. Las cuentas, claims, integración privada y políticas actuales requieren acceso administrativo para verificarlas.

El mensaje original se generaba localmente antes de llamar a Supabase. Un token de Firebase necesita el claim `role=authenticated` para usar las políticas del rol PostgreSQL `authenticated`. Third-Party Auth valida la identidad, y Admin SDK asigna ese claim. [Integración oficial](https://supabase.com/docs/guides/auth/third-party/firebase-auth).

Sigue estos pasos desde la raíz de `chat-dual`.

1. Abre Firebase Console, selecciona `chat-dual-f31e5` y entra en Configuración del proyecto → General. Comprueba el ID, el número de proyecto y la configuración de la app web completa contra `src/app/firebase.config.ts`, especialmente `apiKey` y `appId`. La respuesta pública comprobada relaciona la API key con el número `1508214901` y los dominios `chat-dual-f31e5.firebaseapp.com` y `chat-dual-f31e5.web.app`.

2. En Authentication → Sign-in method, habilita Correo electrónico/Contraseña. En Authentication → Users, limpia filtros y búsquedas. Regístrate desde la app con un correo de prueba que controles. La pantalla de bienvenida debe mostrar el correo y el UID devueltos por Firebase. Busca ese UID en Users y actualiza la lista. Si falla, la app mostrará el código o la causa de Firebase. En las herramientas de desarrollo del navegador, Network, el registro debe completar `accounts:signUp` con HTTP 200. El inicio de sesión usa `accounts:signInWithPassword`. La respuesta de registro contiene `localId`, que debe coincidir con el UID. Mantén las contraseñas y los tokens fuera de capturas y registros compartidos.

3. En Supabase Dashboard, selecciona `lcmrvlnxpnzgqgiwzxpv` → Authentication → Third-Party Auth. Abre la integración Firebase y confirma que está habilitada para `chat-dual-f31e5`. El cliente ya usa `accessToken` para enviar `usuario.getIdToken()` con cada petición. El guardado fuerza antes la renovación del token y comprueba su proyecto, UID y rol.

4. Para asignar el claim al usuario existente, ejecuta el script administrativo incluido. Usa una cuenta de servicio del proyecto con el rol Firebase Authentication Admin (`roles/firebaseauth.admin`). Puedes crearla en Google Cloud Console → IAM y administración → Cuentas de servicio → Crear cuenta de servicio. Asigna ese rol, abre la cuenta → Claves → Agregar clave → Crear clave JSON y guarda el archivo fuera del repositorio y de las carpetas publicadas. Por ejemplo, en `C:\Users\ASUS\.config\chat-dual-admin\credentials.json`. En un backend Google Cloud puedes usar una identidad de servicio adjunta y Application Default Credentials, evitando el archivo descargado. [Permisos de Authentication](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth), [configuración de Admin SDK](https://firebase.google.com/docs/admin/setup).

En una terminal PowerShell administrativa de confianza, ejecuta los comandos siguientes. Sustituye `UID_COPIADO_DE_LA_APP` por el UID real. El paquete Admin SDK se instala en la herramienta independiente.

```powershell
npm install --prefix tools/firebase-admin firebase-admin
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\Users\ASUS\.config\chat-dual-admin\credentials.json'
node tools/firebase-admin/firebase-user.mjs inspect chat-dual-f31e5 UID_COPIADO_DE_LA_APP
node tools/firebase-admin/firebase-user.mjs grant chat-dual-f31e5 UID_COPIADO_DE_LA_APP
```

`inspect` consulta la cuenta real y muestra UID, proveedor, fechas y rol. Si devuelve `auth/user-not-found`, esa cuenta no existe en el proyecto consultado. Vuelve a registrar o iniciar sesión y confirma la petición de Firebase antes de continuar. `grant` conserva los demás claims y asigna el rol. Debe mostrar `"role": "authenticated"`. La app obtiene un token actualizado al volver a pulsar Guardar perfil. La operación `setCustomUserClaims` reemplaza el objeto de claims completo, por eso el script conserva los anteriores. Ejecuta los cambios de claims de cada usuario desde un único proceso administrativo para evitar escrituras concurrentes. [Custom claims](https://firebase.google.com/docs/auth/admin/custom-claims).

5. En Supabase → SQL Editor, inspecciona el esquema y las políticas existentes.

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
order by ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.profiles'::regclass;

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'profiles';
```

`firebase_uid` debe admitir el UID como texto y tener una restricción o índice UNIQUE. `nombre` debe admitir texto. Si la tabla tiene otras columnas NOT NULL, deben tener un valor por defecto o incluirse en el guardado según tu modelo. Una referencia obligatoria a `auth.users` requiere adaptar el esquema para identidades externas. El UID procede de Firebase. Las políticas usan `auth.jwt()->>'sub'`, ya que convertir el UID de Firebase a UUID mediante `auth.uid()` puede fallar.

Revisa y ejecuta `supabase/profiles.sql`. El archivo crea la tabla si falta, habilita RLS, concede permisos de columnas para SELECT/INSERT/UPDATE y permite operar únicamente sobre el UID propio. Una política restrictiva verifica también proyecto y rol, incluso si ya existen otras políticas permisivas. La transacción conserva los datos existentes y fallará si hay duplicados o un esquema incompatible. Si ya utilizas accesos compartidos a perfiles, revisa esa política frente a los requisitos de esas funcionalidades antes de aplicarla. SELECT es necesario para devolver la fila guardada y para las actualizaciones del upsert. [Políticas RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

6. Regresa a la sesión Firebase y guarda un nombre. En Network, la petición `/rest/v1/profiles` debe completarse con éxito. En Table Editor → profiles debe aparecer el mismo UID y el nombre. Guarda otro nombre para verificar la actualización de esa fila. Con dos usuarios de prueba, confirma que cada uno puede guardar su perfil y que una petición con el UID del otro es rechazada por RLS. Una petición sin sesión tampoco debe poder escribir.

La asignación automática del claim se realiza ahora mediante prepareSession en Supabase Edge Functions. Consulta [la configuración vigente del chat](chat-setup.md) para el despliegue y las pruebas. El script administrativo de esta guía permanece disponible para diagnóstico.
