# Chat Dual

Aplicación de chat con Ionic, Angular Standalone, Capacitor, Firebase Authentication, Firestore y Supabase.

## Configuración local

Las configuraciones reales y las credenciales están excluidas de Git. El repositorio incluye únicamente ejemplos con valores de reemplazo. Para ejecutar una copia nueva:

1. Ejecuta `npm ci`.
2. Copia `src/app/firebase.config.example.ts` como `src/app/firebase.config.ts` y completa la configuración de tu proyecto Firebase.
3. Copia `src/app/supabase.config.example.ts` como `src/app/supabase.config.ts` y completa la URL y la clave pública de tu proyecto Supabase.
4. Copia `src/app/chat.config.example.ts` como `src/app/chat.config.ts` y completa la clave pública VAPID.
5. Copia los dos ejemplos de `src/environments/` quitando `.example` de sus nombres.
6. Revisa los identificadores de proyecto y las instrucciones de `docs/chat-setup.md` antes de desplegar en otro entorno.
7. Ejecuta `npm start`.

Las claves administrativas de Firebase y la clave `service_role` de Supabase se usan exclusivamente en el backend. No deben copiarse dentro del frontend ni incorporarse a un commit. Los JSON administrativos, variables `.env`, claves privadas, archivos de configuración nativa y resultados compilados están excluidos mediante `.gitignore`.

Los identificadores de proyectos, nombres de tablas, reglas y código de integración forman parte del código publicado. No conceden acceso por sí mismos. Las configuraciones con claves reales, incluso las claves públicas del cliente, se mantienen fuera de este repositorio por decisión del propietario.

Consulta `docs/chat-setup.md` para el backend y las pruebas. Una copia recién descargada necesita completar la configuración local antes de compilar.

## APK de Android

El proyecto nativo está en `android/`, con el paquete `com.jossuer.chatdual` y el nombre **Chat Dual**. La compilación actual genera un APK de prueba firmado con la clave de depuración local.

Requisitos: JDK 21, Android SDK 36 y Build Tools 36.0.0. Antes de compilar, completa las configuraciones locales descritas arriba y coloca el `google-services.json` de la aplicación Android correspondiente en `android/app/`. Este archivo y `android/local.properties` están excluidos de Git.

Desde PowerShell, dentro de `chat-dual`:

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

El resultado se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. La copia preparada para instalar está en `artifacts/chat-dual-debug.apk`. Los APK, los archivos compilados y las claves de firma no se suben a Git. El APK utiliza la configuración pública del cliente para conectarse a Firebase y Supabase. Las credenciales administrativas permanecen exclusivamente en el backend.


## Identidad visual

El logo vectorial se encuentra en `src/assets/brand/chat-dual-logo.svg`. Ejecuta `npm run assets:android` para regenerar los iconos y las pantallas de inicio de Android a partir de ese archivo. El generador utiliza el Chromium de Playwright (`npx playwright install chromium` si hace falta). El splash nativo se configura en `capacitor.config.ts` y se cierra cuando Angular termina de renderizar la primera ruta, con un cierre de respaldo para evitar bloqueos. Android 12 y posteriores muestran el splash nativo del sistema con el logo central; las versiones anteriores utilizan los recursos por densidad.

El APK actualizado de esta identidad visual es `artifacts/chat-dual-v1.1-debug.apk` (versionCode 2). El campo de contrasena permite alternar su visibilidad con un boton accesible y vuelve a ocultarse al cambiar entre login y registro.
