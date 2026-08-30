# Fase 1 - Hardening de licencia Widevine

Esta fase parte de la base creada en fase 0, pero elimina el fallo deliberado `license/no_auth`.

## Que implementa

- Plataforma OTT en `http://localhost:9300`.
- Laboratorio de auditoria en `http://localhost:9301`.
- CDN Varnish en `http://localhost:9080`.
- `control-plane` con:
  - login,
  - `accessToken`,
  - `playback session`,
  - `playbackToken` efimero,
  - control de concurrencia por cuenta,
  - heartbeat,
  - parada de sesion,
  - proxy protegido del manifest DASH,
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
/manifest protegido + /license protegido = ambos requieren playbackToken valido
```

El usuario sin permiso puede iniciar sesion, pero no puede crear una `playback session` para el activo `sintel-widevine`.

## Usuarios de prueba

| Usuario | Password | Resultado esperado |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Puede crear sesion y reproducir Widevine |
| `usuario-denegado@tfm.local` | `demo123` | Login correcto, pero sin entitlement del activo |

## Puertos

- Cliente fase 1: `http://localhost:9300`
- Laboratorio de auditoria: `http://localhost:9301`
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
3. Reproduce Widevine. El manifest pasa por `http://localhost:9080/manifest/sintel-widevine` y la licencia por `http://localhost:9080/license`; ambos requieren token.
4. Inicia sesion con `usuario-denegado@tfm.local`.
5. Intenta crear playback session. Debe fallar por falta de entitlement.

### Laboratorio de auditoria

Abre `http://localhost:9301` y utiliza las credenciales de prueba. El boton de autenticacion encadena automaticamente login, creacion de sesion y generacion del `playbackToken`; el token completo no se muestra. Desde la misma pantalla se puede:

1. Reproducir con manifest y licencia protegidos.
2. Ver las claims no sensibles del token y el registro local de peticiones.
3. Ejecutar casos negativos reproducibles: sin token (401), token alterado (401), sesion distinta (409) y activo distinto (403).
4. Detener la sesion para invalidar el acceso asociado.

## Lectura para el TFM

Esta fase corresponde a la primera defensa en profundidad:

- El DRM sigue siendo Widevine.
- El servidor de licencias de pruebas sigue existiendo aguas arriba.
- La diferencia es que ya no se expone una ruta `no_auth`.
- El control-plane ata licencia a usuario, dispositivo, activo y sesion.
- El manifest tambien queda condicionado al mismo token y binding, no solo la licencia.
- Las rutas del origen local se validan contra el activo incluido en el `playbackToken`; un token de otro activo recibe `403`.
- El bypass de reproductor externo deja de funcionar salvo que se robe un `playbackToken` valido y vigente.
- La interfaz conserva solo metadatos de las operaciones y no imprime los tokens de acceso o reproduccion.
