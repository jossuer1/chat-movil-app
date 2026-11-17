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
