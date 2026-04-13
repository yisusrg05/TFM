# Propuesta de endurecimiento OTT/CDN para el TFM

## 1. Estado actual del proyecto

La maqueta existente valida bien la topologia basica:

- `client/`: cliente web estatico con Shaka Player.
- `infra/varnish/default.vcl`: CDN local con Varnish.
- `origin-content/`: contenido DASH VOD minimo servido por Nginx.
- `license-server/`: mock HTTP de licencias.

La arquitectura actual es util para laboratorio, pero todavia no implementa controles reales de seguridad a nivel OTT:

- No hay autenticacion de usuarios ni autorizacion por activo.
- No hay control de acceso entre aplicacion, CDN y servidor de licencias.
- No existe atadura entre identidad, sesion, dispositivo y peticion de segmento.
- El contenido DASH actual es `clear` y el servidor de licencias es solo un mock.
- `origin` y `license-server` quedan expuestos directamente, por lo que se puede eludir la CDN.

## 2. Brechas principales observadas

### Criticas

1. **Bypass completo de la CDN**
   - `docker-compose.yml` publica `origin` en `8081` y `license-server` en `8082`.
   - Eso permite acceder al contenido y a la licencia por fuera de Varnish, anulando cualquier politica de control en la CDN.

2. **Sin autenticacion/autorizacion en `/content` ni `/license`**
   - Varnish enruta por path, pero no valida JWT, firma HMAC, sesion, dispositivo ni permisos por catalogo.
   - Cualquier cliente que conozca el MPD puede pedir segmentos y licencias.

3. **Licencia desacoplada del contexto de reproduccion**
   - `license-server/src/index.js` devuelve una respuesta fija.
   - No existen checks de usuario, activo, dispositivo, expiracion, nonce, integridad ni politica de uso.

4. **Contenido de prueba sin DRM real**
   - `origin-content/dash/minimal.mpd` referencia un MP4 local en claro.
   - Esto sirve para probar pipeline, pero no representa el escenario de Widevine que quieres defender.

### Altas

5. **CORS excesivamente permisivo**
   - `infra/varnish/default.vcl` usa `Access-Control-Allow-Origin: *`.
   - Eso facilita consumo desde clientes no oficiales o herramientas de terceros.

6. **Sin sesion de reproduccion ni control de concurrencia**
   - No hay concepto de `playback session`, heartbeat, revocacion ni limite de streams simultaneos.

7. **Sin trazabilidad ni telemetria antifraude**
   - No hay logs de negocio para detectar sharing, scraping, replay o automatizacion.

8. **Sin blindaje de cache**
   - La cache no diferencia entre contenido publico, protegido, licencias o manifiestos personalizados.
   - No hay claves de cache segmentadas por token/politica ni estrategia de `signed URLs/cookies`.

### Medias

9. **Cliente facilmente reproducible fuera de la app**
   - El MPD esta accesible por URL fija y no hay tokenizacion ni personalizacion por sesion.
   - Un reproductor externo puede intentar reutilizar la misma ruta.

10. **Falta de mecanismos de respuesta**
   - No hay cuarentena, baneos, revocacion de dispositivos, rate limiting ni bloqueo adaptativo.

## 3. Arquitectura objetivo de defensa en profundidad

### 3.1 Principio base

La proteccion no debe vivir solo en la app ni solo en el DRM. Debe repartirse en cuatro capas:

1. **Identidad y sesion**
   - Usuario autenticado.
   - Dispositivo registrado o con huella de riesgo.
   - Sesion de reproduccion unica.

2. **Autorizacion de acceso al contenido**
   - El backend emite un token de playback de vida corta para un asset concreto.
   - Ese token se valida en la CDN y en el servidor de licencias.

3. **Proteccion de la reproduccion**
   - DRM real con Widevine.
   - Politicas de licencia atadas a usuario, asset, sesion y dispositivo.

4. **Deteccion y respuesta**
   - Telemetria en tiempo real.
   - Deteccion de anomalias.
   - Revocacion, baneos y mitigaciones progresivas.

## 4. Mejoras propuestas

### 4.1 Autenticar y autorizar todas las peticiones a la CDN

**Objetivo:** que ningun MPD, segmento, clave o licencia pueda obtenerse solo con conocer la URL.

#### Recomendacion

Introducir un **backend de control** entre la app y la CDN:

- `POST /auth/login`
- `POST /playback/session`
- `POST /playback/heartbeat`
- `POST /playback/stop`
- `POST /drm/license`

Flujo propuesto:

1. El usuario inicia sesion en la app.
2. La app pide una `playback session` para un asset.
3. El backend emite:
   - `playback_token` corto (JWT o PASETO, 30-120 s).
   - `session_id`.
   - `entitlements` del asset.
   - restricciones de IP/device/account tier.
4. La app consume MPD y segmentos con:
   - `signed cookies`, o
   - `signed URLs`, o
   - cabecera `Authorization: Bearer <playback_token>`.
5. La CDN valida firma, expiracion, `asset_id`, `session_id`, IP/hash de dispositivo y alcance del token.

#### Lo importante para el TFM

- El **token de playback** debe ser distinto del token de login.
- El token debe ser **de corta vida**, renovable con heartbeat.
- Debe incluir `sub`, `account_id`, `device_id`, `asset_id`, `session_id`, `exp`, `jti`, `scope`.
- La CDN debe **rechazar** todo acceso sin token valido.

#### Implementacion sugerida en este repo

- Mantener Varnish como edge.
- Anadir un microservicio nuevo tipo `control-plane` que emita y valide tokens.
- Hacer que Varnish consulte ese servicio o valide HMAC/JWT localmente con secretos compartidos.
- Dejar `origin` y `license-server` sin puertos expuestos al host.

### 4.2 Blindar el servidor de licencias

**Objetivo:** que obtener la licencia requiera el mismo contexto autorizado que obtener el contenido.

#### Recomendacion

El endpoint de licencia debe validar:

- `playback_token` activo.
- `session_id` no revocada.
- `device_id` autorizado.
- coincidencia entre `asset_id`, `kid` y entitlement.
- limites de concurrencia.
- estado antifraude del usuario.

#### Politicas utiles

- TTL de licencia corto.
- Licencias no reutilizables entre sesiones.
- Revocacion si se detecta sharing o scraping.
- Registro de `challenge fingerprint`, IP, user-agent, device_id y cadencia de peticiones.

#### Observacion

Esto no evita por si solo que un cliente externo reproduzca si ha logrado licencia valida, pero si reduce mucho el abuso cuando se combina con tokens efimeros, control de sesion, watermarking y deteccion.

### 4.3 Control de concurrencia por cuenta

**Objetivo:** impedir varias reproducciones simultaneas con la misma cuenta, o al menos acotarlas.

#### Modelo recomendado

Crear una tabla o store de `active_playback_sessions` con:

- `session_id`
- `account_id`
- `device_id`
- `asset_id`
- `ip`
- `started_at`
- `last_heartbeat_at`
- `status`

#### Politica

- Free: 1 stream.
- Standard: 2 streams.
- Premium: 4 streams.

#### Logica

- Al pedir `playback/session`, se cuentan sesiones activas no expiradas.
- Si se supera el limite:
  - se bloquea la nueva sesion, o
  - se expulsa la mas antigua, o
  - se pide confirmacion al usuario.
- La app debe enviar `heartbeat` cada 15-30 s.
- Si no hay heartbeat en `N` segundos, la sesion expira.

#### Defensa adicional

La CDN y el servidor de licencias deben consultar el estado de la sesion para no fiarse solo del cliente.

### 4.4 Deteccion de anomalias en tiempo real

**Objetivo:** detectar patrones de uso compatibles con leeching, credential sharing o automatizacion.

#### Eventos a recoger

- login correcto/fallido
- alta de device
- creacion de playback session
- heartbeat
- peticion de MPD
- peticion de segmento
- peticion de licencia
- errores DRM/player
- cierres anormales

#### Senales de riesgo utiles

- muchas IPs para la misma cuenta en ventana corta
- misma cuenta en ASN/paises incompatibles
- ritmo de segmentos incompatible con un reproductor humano
- uso 24/7 o todos los dias a la misma hora exacta durante semanas
- muchos intentos de licencia sin heartbeats validos
- peticiones a segmentos sin haber pedido manifest o licencia
- cambio continuo de user-agent o device_id
- volumen de trafico muy superior al perfil esperado del plan

#### Enfoque tecnico

- Reglas simples al principio.
- Score de riesgo por cuenta/dispositivo/sesion.
- Respuesta por niveles:
  - nivel 1: registrar
  - nivel 2: challenge adicional / captcha / MFA
  - nivel 3: bloquear playback
  - nivel 4: ban temporal o permanente

#### Sobre el caso de "misma hora todos los dias"

Por si solo no deberia banear automaticamente. Es una buena **feature de riesgo**, no una evidencia concluyente. Conviene combinarla con regularidad exacta, ausencia de variacion, cadencia mecanica, duracion constante, origen de red fijo sospechoso y reproduccion no asociada a interaccion real.

### 4.5 Sistema de baneos y respuesta

**Objetivo:** disponer de medidas proporcionales y auditables.

#### Recomendacion

Separar varios niveles:

- revocacion de `session_id`
- bloqueo de `device_id`
- bloqueo temporal de `account_id`
- bloqueo por IP/ASN en edge
- bloqueo permanente con revision manual

#### Buenas practicas

- registrar motivo, evidencia, timestamp y actor que ejecuta el ban
- TTL para baneos temporales
- posibilidad de apelacion o desbloqueo manual
- diferenciar automatismos de decisiones humanas

### 4.6 Watermarking / banner forense visible

**Objetivo:** hacer atribuible la senal si termina redistribuyendose.

#### Dos niveles realistas para el TFM

1. **Overlay dinamico en la app**
   - Mostrar email parcial, `account_id`, `session_id`, hora y hash corto.
   - Cambiar posicion/opacidad periodicamente.
   - Util para demo y para dificultar grabaciones limpias.

2. **Watermark forense real**
   - Idealmente a nivel encoder/packager/CDN segment manipulation.
   - Mucho mas complejo y normalmente fuera del alcance de una maqueta simple.

#### Recomendacion practica

Para el TFM, implementa:

- banner visible persistente o intermitente en Shaka Player
- datos ligados a la sesion activa
- logs que permitan mapear el watermark a una cuenta concreta

Y deja el watermark forense imperceptible como linea futura o trabajo complementario.

## 5. Cambios concretos recomendados sobre este repositorio

### Fase 1: endurecimiento minimo creible

1. Crear un nuevo servicio `control-plane`:
   - autenticacion basica
   - emision de `playback_token`
   - control de concurrencia
   - store de sesiones activas

2. Cambiar Varnish para:
   - exigir token en `/content/*`
   - limitar CORS al dominio del cliente
   - aplicar rate limiting
   - adjuntar cabeceras de trazabilidad

3. Cambiar `license-server` para:
   - exigir `Authorization`
   - validar `session_id`, `asset_id` y `device_id`
   - rechazar sesiones revocadas

4. Cambiar `docker-compose.yml` para:
   - no exponer `origin` ni `license-server` al host
   - dejar solo `cdn` y `ott-client` publicos

5. Cambiar la app cliente para:
   - autenticarse
   - pedir `playback session`
   - incluir token en manifest/licencia
   - mostrar watermark/banner

### Fase 2: antifraude y observabilidad

1. Anadir Redis o base de datos ligera para sesiones y baneos.
2. Emitir eventos estructurados JSON.
3. Construir un motor simple de reglas:
   - concurrencia
   - geovelocity
   - reuse de device
   - cadencia automatizada
4. Crear panel basico de evidencia o logs.

### Fase 3: aproximacion mas real a Widevine

1. Sustituir el DASH clear por contenido empaquetado CENC.
2. Introducir PSSH/KID por asset.
3. Simular politicas reales de licencia.
4. Probar con reproductor oficial y con cliente externo para demostrar la diferencia entre:
   - app sin protecciones de backend
   - app con defensa en profundidad

## 6. Proximos pasos recomendados

### Prioridad alta

1. Cerrar bypasses:
   - quitar exposicion publica de `origin` y `license-server`
   - obligar paso por la CDN

2. Introducir `playback session`:
   - token efimero
   - `session_id`
   - `device_id`
   - `heartbeat`

3. Proteger `/content` y `/license` con la misma politica de autorizacion.

4. Limitar concurrencia y registrar eventos de reproduccion.

### Prioridad media

5. Anadir banner/watermark visible.
6. Crear sistema de riesgo y baneos progresivos.
7. Restringir CORS, headers y rate limits en edge.

### Prioridad estrategica

8. Migrar a un flujo con DASH cifrado y DRM mas fiel al caso real.
9. Preparar una demo comparativa de ataque/mitigacion para la memoria del TFM.

## 7. Enfoque experimental util para la memoria

Una forma muy solida de presentar el TFM es comparar tres estados:

1. **Estado A - base actual**
   - MPD accesible
   - sin auth
   - sin control de sesiones

2. **Estado B - hardening CDN/app**
   - signed tokens
   - control de concurrencia
   - watermark visible
   - baneos y anomalias

3. **Estado C - defensa en profundidad**
   - DRM + politicas + CDN protegida + antifraude

Asi podras demostrar no solo la arquitectura final, sino el valor incremental de cada control.

## 8. Conclusiones

La base actual es adecuada como punto de partida de laboratorio, pero todavia no evita CDN leeching, reproduccion externa ni abuso de cuentas. Para que el TFM responda de verdad al problema planteado, la mejora clave es introducir una **sesion de reproduccion autorizada y verificable extremo a extremo**, y usarla tanto en CDN como en licencias, observabilidad y respuesta antifraude.
