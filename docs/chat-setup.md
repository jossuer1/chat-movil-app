La aplicación está publicada en [Chat Dual](https://chat-dual-f31e5.web.app). El backend está migrado a Supabase Edge Functions. Firebase Authentication sigue siendo el único sistema de acceso. Los mensajes y los permisos de lectura en tiempo real permanecen en Firestore. Supabase guarda perfiles, salas, participantes, archivos y coordenadas.

La función desplegable es `chat-api`, en el proyecto `lcmrvlnxpnzgqgiwzxpv`. El frontend llama a `/functions/v1/chat-api` con el ID token de Firebase. Cada petición verifica firma RS256, emisor, proyecto, caducidad y UID mediante las claves públicas de Google. El preflight CORS se atiende antes de autenticar la petición.

`verify_jwt = false` en `supabase/config.toml` permite que el token externo llegue al código que verifica Firebase. RLS continúa habilitado en las tablas y el bucket sigue siendo privado. Las claves administrativas se utilizan exclusivamente en el servidor. [Autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth).

El proyecto puede utilizar Firebase Spark y Supabase Free. Las cuotas de ambos servicios siguen aplicándose. Estos comandos no activan Blaze ni cambian el plan de Supabase. La cuota publicada de Edge Functions Free es de 500.000 invocaciones mensuales. [Cuotas de Edge Functions](https://supabase.com/docs/guides/functions/pricing).

Para reproducir el despliegue desde la raíz `chat-dual`, sigue estos pasos.

1. Instala las herramientas con `npm ci` y las dependencias de las pruebas de reglas con `npm ci --prefix functions`.
2. Inicia sesión con `npx supabase login` y confirma que tienes acceso al proyecto `lcmrvlnxpnzgqgiwzxpv`.
3. Ejecuta `supabase/chat.sql` en SQL Editor si todavía falta. Si ya lo ejecutaste para la versión anterior, el mismo esquema sirve para Edge Functions y conserva las salas y perfiles existentes.
4. Guarda el JSON administrativo de Firebase como secreto de Supabase. El script siguiente lo lee desde una ruta privada, lo transmite como `FIREBASE_SERVICE_ACCOUNT` al proyecto indicado y elimina el archivo temporal usado por la CLI.

```powershell
node tools/deploy-edge-secrets.mjs C:\Credenciales\chat-dual-admin.json
```

La credencial debe pertenecer a `chat-dual-f31e5`. Su cuenta de servicio necesita permisos de Firebase Authentication, lectura y escritura en Firestore y envío de FCM. Los roles correspondientes son Firebase Authentication Admin, Cloud Datastore User y Firebase Cloud Messaging API Admin. Supabase proporciona automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` dentro de Edge Functions. [Secretos del servidor](https://supabase.com/docs/guides/functions/secrets).

5. Publica la función con `npm run deploy:edge`. En una terminal interactiva, confirma el destino que muestra la CLI. La cuenta Firebase se prepara automáticamente mediante `prepareSession` cuando necesita el claim `authenticated` y el cliente renueva su ID token.
6. La base Firestore `(default)` ya fue creada en `nam5` y las reglas se publicaron. Para futuras actualizaciones usa la CLI autenticada de Firebase.

```powershell
.\functions\node_modules\.bin\firebase.cmd login
.\functions\node_modules\.bin\firebase.cmd deploy --only firestore:rules --project chat-dual-f31e5
```

El acceso a mensajes requiere pertenecer a la sala. El frontend puede editar el texto propio y actualizar la reacción de su UID. La creación y eliminación se realizan en Edge Functions, que verifican al usuario y guardan el trabajo asociado en el mismo commit de Firestore. La función valida nombres de autor, rutas de archivos y coordenadas antes de crear mensajes.

Los trabajos `chatJobs` registran sincronizaciones de salas, notificaciones y limpieza de archivos. Se procesan en segundo plano al terminar peticiones autenticadas. Las operaciones fallidas quedan guardadas para un nuevo intento en la siguiente petición del mismo usuario. Si la aplicación queda inactiva después de un fallo, esos trabajos esperan hasta la próxima actividad. El control de versiones de las salas evita que una sincronización antigua reemplace una nueva. [Tareas en segundo plano](https://supabase.com/docs/guides/functions/background-tasks).

7. Para publicar también la interfaz en Firebase Hosting, ejecuta lo siguiente.

```powershell
npm run build
.\functions\node_modules\.bin\firebase.cmd deploy --only hosting --project chat-dual-f31e5
```

`firebase.json` publica únicamente `www` y utiliza una reescritura SPA para `/home`, `/auth` y `/profile`. El backend se mantiene en Supabase; la interfaz puede ejecutarse desde Hosting o desde `http://localhost:8100` durante el desarrollo.

La clave pública VAPID proporcionada ya está configurada en `src/app/chat.config.ts` y se confirmó la recepción de un aviso en Chrome. Para otro entorno, copia su clave pública de Firebase Console → Configuración del proyecto → Cloud Messaging → Certificados push web en el campo `vapidKey`, compila y publica la interfaz. Entra al chat y pulsa Activar notificaciones. Los envíos utilizan la API HTTP v1 de FCM desde Edge Functions. [FCM web](https://firebase.google.com/docs/cloud-messaging/js/client).

La configuración nativa de Capacitor requiere los archivos Firebase de cada plataforma, los permisos de ubicación y, para iOS, APNs y los callbacks de notificaciones. Los proyectos Android/iOS todavía no forman parte de este repositorio. La resolución específica de dependencias para el plugin FCM conserva el Firebase 13 existente. [Instalación nativa de FCM](https://capawesome.io/docs/sdks/capacitor/firebase/cloud-messaging/).

Las salas son privadas y su creador agrega participantes por UID. Se mantienen los límites de 100 participantes, 4.000 caracteres por mensaje y 10 MB por archivo. Las imágenes se comparten como archivos descargables. Los enlaces de descarga duran 60 segundos y conservan su vigencia si ya se emitieron antes de retirar un participante. Una subida que termina sin que se envíe su mensaje puede dejar un archivo sin referencia, cuya limpieza es administrativa. Las notificaciones son de mejor esfuerzo y pueden repetirse si un intento parcial necesita reejecutarse.

Para la mini prueba, abre la aplicación con dos cuentas en navegadores distintos. Guarda ambos perfiles, crea una sala, agrega al segundo UID y prueba mensajes, edición, reacciones, archivos y ubicación. Al quitar al segundo usuario debe perder acceso a nuevos mensajes y a nuevos enlaces de descarga.

Las verificaciones locales se ejecutan así. Los emuladores se utilizan únicamente para las pruebas de seguridad.

```powershell
npm run lint
npm run build
npm run test:unit
npm run test:e2e
npm run check:edge
npm run test:edge
$env:DEBUG = ''
npm run test:firestore
```

Las pruebas cubren autenticación JWT real con claves de prueba, CORS desde el puerto 8100, permisos por UID, reintentos de mensajes, revocación concurrente y recuperación de sincronizaciones y limpieza. `functions/` contiene las herramientas de pruebas de Firestore. El código del servidor está en `supabase/functions/`.


El registro solicita nombre, apellido, nombre de usuario y ciudad. La foto de perfil es opcional. El nombre de usuario se normaliza a min?sculas y admite de 3 a 24 letras ASCII, n?meros o guion bajo. Un ?ndice ?nico en PostgreSQL resuelve las colisiones incluso entre registros simult?neos. Firebase mantiene el UID interno y sigue siendo el ?nico proveedor de inicio de sesi?n.

Despu?s de registrarse se guarda el perfil y se abre el chat. Si falla Supabase despu?s de crear la cuenta Firebase, la sesi?n se conserva y el formulario permite reintentar guardar los datos. Los accesos posteriores recuperan el perfil y van directamente a `/home`. Los perfiles antiguos con solo nombre conservan el acceso. Pueden completar los nuevos campos desde **Mi perfil** (`/profile`), sin volver a registrarse.

Las fotos aceptan JPG, PNG o WebP hasta 3 MB en `profile-photos`, un bucket privado. RLS restringe las operaciones directas a la carpeta del UID de Firebase, comprobando tambi?n el emisor, el proyecto y el rol. `profiles.foto_path` guarda una ruta propia, nunca una URL temporal. El cliente firma su propia foto y `listMembers` firma las fotos de participantes solo tras comprobar la pertenencia a la sala. Los enlaces duran una hora y cualquier enlace ya emitido funciona hasta su caducidad. Se renuevan al cargar el perfil o actualizar la lista de participantes. Una foto que no carga se sustituye por iniciales. [Control de acceso de Storage](https://supabase.com/docs/guides/storage/security/access-control).

La prueba real de esta ampliaci?n verific? registro Firebase, claim autom?tico, guardado de todos los datos y foto privada, recarga, nuevo inicio de sesi?n directo al chat, edici?n persistente del perfil, env?o de mensaje y aislamiento de perfiles/fotos entre cuentas. La cuenta y los datos temporales de prueba se eliminaron al terminar. Las comprobaciones visuales incluyeron escritorio y m?vil de 390 px sin desbordamiento horizontal.

Los avisos dentro de la aplicación usan `ToastController` de Ionic, con cierre manual y duración limitada. Se muestran al recibir mensajes en primer plano, activar notificaciones, compartir ubicación y producirse errores del chat. Los listeners de FCM se restauran al vincular una sesión con un token guardado, también después de recargar la página. Las notificaciones con la aplicación en segundo plano siguen utilizando el sistema push del navegador o del dispositivo.

Al pulsar **Ubicación**, la app obtiene un punto y muestra una confirmación de Ionic con latitud, longitud y precisión aproximada. **No** o cerrar la confirmación no guarda ni envía coordenadas y conserva el borrador. **Sí, enviar** guarda el punto en Supabase y después envía el mensaje a Firestore. Los reintentos conservan el identificador y el punto ya confirmado para evitar duplicados. En web se solicita ubicación de red con espera máxima de 20 segundos y caché de hasta 30 segundos. Los errores de permiso bloqueado, posición no disponible y tiempo agotado muestran instrucciones mediante toast. El navegador necesita HTTPS (o localhost) y acceso a ubicación habilitado tanto en el navegador como en el sistema operativo.

Esta actualización se comprobó con pruebas unitarias de notificaciones, toast, geolocalización, confirmación, cancelación, reintentos y cambios de sesión. Una prueba de navegador con coordenadas simuladas verificó contra el backend real la ausencia de escrituras al cancelar, el envío confirmado y los toast de éxito/error. La sala y las coordenadas temporales se eliminaron después. Esa prueba no verifica el GPS físico del dispositivo del usuario.

Se corrigió un fallo de precisión al enviar ubicaciones con muchos decimales. En este proyecto PostgreSQL devuelve los valores `float8` con `extra_float_digits=0`, que redondea a 15 cifras significativas. La comparación exacta del servidor rechazaba puntos que sí estaban guardados. Ahora la validación y la deduplicación admiten únicamente diferencias de hasta `1e-9` grados, manteniendo las comprobaciones de UID, sala e identificador. El mensaje usa las coordenadas leídas de Supabase. [Salida de números de coma flotante en PostgreSQL](https://www.postgresql.org/docs/current/datatype-numeric.html).

La regresión se reprodujo en el backend publicado con coordenadas simuladas de 17 cifras: el guardado respondía correctamente y el envío fallaba. Después de desplegar la corrección, las mismas coordenadas se enviaron y el reintento conservó un solo mensaje. Las pruebas de integración también comprueban el rechazo de una ubicación modificada y de una ubicación perteneciente a otro remitente. Todos los datos temporales de esta comprobación se eliminaron. No se modificaron las ubicaciones del usuario.
