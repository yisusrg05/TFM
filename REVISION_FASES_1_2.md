# Revisión previa de las fases 1 y 2

Fecha de revisión: 30 de agosto de 2026.

## Estado final

Las dos fases se encuentran levantadas y operativas de forma simultánea con la fase 0:

| Entorno | Cliente | CDN/control-plane | Laboratorio | Estado |
|---|---:|---:|---:|---|
| Fase 1 | `http://localhost:9300` | `http://localhost:9080` | `http://localhost:9301` | Operativo |
| Fase 2 | `http://localhost:9400` | `http://localhost:9180` | `http://localhost:9401` | Operativo |

Todos los contenedores de ambas fases están en estado `running`, con cero reinicios inesperados. Los clientes, los endpoints de salud, los orígenes internos y los servidores internos de licencia responden con HTTP 200. No se observaron errores de aplicación en los registros después de la regresión final.

## Fase 1

### Comprobaciones superadas

- Login del usuario autorizado: HTTP 200.
- Login del usuario sin entitlement: HTTP 200, seguido de HTTP 403 al crear la sesión.
- Creación de la primera playback session: HTTP 201.
- Segunda sesión concurrente para la misma cuenta: HTTP 409 `CONCURRENCY_LIMIT`.
- Contenido y licencia sin token: HTTP 401.
- Manifest sin token: HTTP 401; con token valido: HTTP 200 y tipo `application/dash+xml`.
- Uso de un access token donde se exige playback token: HTTP 401.
- Ruta heredada `/license/no_auth`: HTTP 404 con token y HTTP 401 sin token.
- Cabecera de sesión distinta a la incluida en el token: HTTP 409 `SESSION_MISMATCH`.
- Acceso a contenido de otro activo con un token de `sintel-widevine`: HTTP 403 `CONTENT_NOT_ALLOWED_FOR_ASSET`.
- Token de reproducción después de detener la sesión: rechazado.
- Reproducción Widevine real: vídeo no pausado, `readyState=4`, duración aproximada de 888 segundos y tiempo creciente.
- El laboratorio `http://localhost:9301` genera el token desde usuario y contraseña, registra las peticiones protegidas de manifest/licencia y supera los casos negativos 401/401/409/403.
- La interfaz no imprime `accessToken` ni `playbackToken`.

### Correcciones aplicadas

- Eliminada la impresión de tokens completos en el panel de eventos.
- Bloqueado el cambio de identidad mientras existe una sesión activa.
- Propagada de forma fiable la IP del cliente desde Varnish, sobrescribiendo cabeceras aportadas por el navegador.
- Añadido binding entre `assetId` y el prefijo permitido del origen local.

## Fase 2

### Comprobaciones superadas

- Conserva todos los controles de sesión, entitlement, licencia y concurrencia de la fase 1.
- El manifest protegido responde HTTP 200 con token valido y 401/409/403 en los casos sin token, sesion distinta y activo distinto.
- El usuario denegado solo tiene rol `user`; el acceso a `/admin/overview` devuelve HTTP 403.
- El usuario autorizado con rol administrativo obtiene observabilidad y eventos.
- Varnish sustituye un `X-Forwarded-For` aportado por el cliente; la IP falsa de prueba no llega al control-plane.
- Un ban manual de dispositivo queda visible como `ban.created`.
- Mientras el dispositivo está baneado, el heartbeat devuelve HTTP 401.
- El plano administrativo sigue pudiendo consultar el ban y eliminarlo.
- La retirada queda registrada como `ban.cleared` y la reproducción puede detenerse normalmente después.
- Cinco rechazos de concurrencia consecutivos elevan el score a 100 con razón `REPEATED_CONCURRENCY_VIOLATION`.
- Al alcanzar el umbral se crea `AUTO_BAN:REPEATED_CONCURRENCY_VIOLATION`.
- El auto-ban bloquea el heartbeat y puede retirarse desde el plano administrativo.
- Los eventos de reproducción incluyen `playback.session_created` y dos `license.request` en la prueba Widevine.
- La representación de eventos usa nodos de texto: una cadena con apariencia de HTML permanece como texto y no crea elementos en el DOM.
- El binding de contenido devuelve HTTP 403 si el activo del token no corresponde con la ruta local y HTTP 409 si la cabecera de sesión no coincide.
- Reproducción Widevine real: vídeo no pausado, `readyState=4`, duración aproximada de 888 segundos y tiempo creciente.
- El laboratorio `http://localhost:9401` genera el token automaticamente desde las credenciales y reproduce con manifest y licencia protegidos.
- Ocho autenticaciones fallidas desde el mismo dispositivo crean un ban `AUTH_FAILURE_BURST`; el manifest posterior devuelve HTTP 401 y la interfaz impide iniciar otra reproducción.
- Al retirar el ban desde el plano administrativo, el manifest y la reproducción vuelven a funcionar.

### Correcciones aplicadas

- Separado el acceso administrativo del bloqueo de reproducción para que un operador no quede sin capacidad de respuesta tras aplicar un ban.
- Retirado el rol administrativo al usuario sin entitlement.
- Corregida la colisión del campo `type` que convertía `ban.created` y `ban.cleared` en eventos llamados `device`.
- Conservado el tipo del objetivo del ban en `subjectType`.
- Sustituido el renderizado de eventos mediante `innerHTML` por creación segura de nodos y `textContent`.
- Bloqueado el cambio de identidad durante una sesión activa.
- Añadida propagación fiable de IP y binding entre activo, sesión y ruta de contenido.

## Estado de los datos

Redis se reinició después de las pruebas para dejar la fase 2 sin sesiones, scores ni bans de ensayo. Los contenedores continúan levantados. La fase 1 también quedó sin sesiones activas.

## Limitaciones que deben explicarse en la memoria

- El laboratorio usa HTTP local y secretos de demostración; no representa una configuración de producción con TLS, gestor de secretos e identidad corporativa.
- La licencia Widevine depende del proxy público de pruebas de Shaka/CWIP y el MPD Widevine se descarga desde infraestructura externa.
- Los umbrales antifraude son ilustrativos y no están calibrados con tráfico real ni con una tasa conocida de falsos positivos.
- Redis se configura sin persistencia para que las pruebas sean repetibles; un despliegue real necesitaría persistencia, alta disponibilidad y política de retención.
- La prueba se ha realizado con un navegador y un entorno Docker local, no con diversidad de dispositivos, redes o regiones.
- No existe todavía una batería automatizada de integración; la revisión combinó pruebas HTTP controladas, estado de contenedores y reproducción real en navegador.

## Orientación para los capítulos

El capítulo 5 puede presentar la fase 1 como eliminación del bypass directo de licencia y binding de usuario, dispositivo, activo y sesión. Las comparaciones principales con fase 0 son los códigos 401/403/404/409, la desaparición de `/license/no_auth` y la reproducción legítima que continúa funcionando.

El capítulo 6 puede presentar la fase 2 como capa de detección y respuesta. Las evidencias más fuertes son la persistencia de eventos, el score 0→100, `ban.created`, el heartbeat bloqueado, `ban.cleared` y la recuperación posterior. Conviene separar claramente prevención, detección y respuesta para no atribuir al DRM funciones que pertenecen al control-plane o al sistema antifraude.
