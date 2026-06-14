# Fase 1 - Hardening de licencia Widevine

Esta fase parte de la base creada en fase 0, pero elimina el fallo deliberado `license/no_auth`.

## Que implementa

- Plataforma OTT en `http://localhost:9300`.
- CDN Varnish en `http://localhost:9080`.
- `control-plane` con:
  - login,
  - `accessToken`,
  - `playback session`,
  - `playbackToken` efimero,
  - control de concurrencia por cuenta,
  - heartbeat,
  - parada de sesion,
  - proxy protegido de licencia Widevine.
- `license-server` interno:
  - no se publica en el host,
  - recibe solo llamadas internas desde el control-plane,
  - proxifica el servidor Widevine de pruebas Shaka/CWIP.

## Cambio respecto a fase 0

En fase 0 existia:

```text
MPD publico + /license/no_auth = reproduccion externa sin login
```

En fase 1:

```text
MPD publico + /license protegido = requiere playbackToken valido
```

El usuario sin permiso puede iniciar sesion, pero no puede crear una `playback session` para el activo `sintel-widevine`.

## Usuarios de prueba

| Usuario | Password | Resultado esperado |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Puede crear sesion y reproducir Widevine |
| `usuario-denegado@tfm.local` | `demo123` | Login correcto, pero sin entitlement del activo |

## Puertos

- Cliente fase 1: `http://localhost:9300`
- CDN protegida fase 1: `http://localhost:9080`

`origin` y `license-server` no se publican en el host.

## Arranque

Desde la raiz del repositorio:

```bash
docker compose -f fase1-hardening/docker-compose.yml up --build -d
```

## Pruebas

1. Inicia sesion con `usuario-permitido@tfm.local`.
2. Crea playback session.
3. Reproduce Widevine. La licencia pasa por `http://localhost:9080/license` con token.
4. Inicia sesion con `usuario-denegado@tfm.local`.
5. Intenta crear playback session. Debe fallar por falta de entitlement.

## Lectura para el TFM

Esta fase corresponde a la primera defensa en profundidad:

- El DRM sigue siendo Widevine.
- El servidor de licencias de pruebas sigue existiendo aguas arriba.
- La diferencia es que ya no se expone una ruta `no_auth`.
- El control-plane ata licencia a usuario, dispositivo, activo y sesion.
- El bypass de reproductor externo deja de funcionar salvo que se robe un `playbackToken` valido y vigente.
