# Fase 1 - Hardening de licencia Widevine

Esta fase parte de la base creada en fase 0, pero elimina el fallo deliberado `license/no_auth`.

## Que implementa

- Plataforma OTT en `http://localhost:9300`.
- Laboratorio de auditoria en `http://localhost:9301`.
- Laboratorio de Key Leak y CDN leeching en `http://localhost:9302`.
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
  - proxy protegido de inicializaciones y segmentos locales,
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
/manifest + /content + /license protegidos = requieren playbackToken valido
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
- Laboratorio de Key Leak / CDN leeching: `http://localhost:9302`
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

### Laboratorio de Key Leak y CDN leeching

Abre `http://localhost:9302`. El laboratorio representa un reproductor externo o backend IPTV y permite ejecutar de forma controlada:

1. Acceso al manifest y a los segmentos sin token, que debe devolver 401.
2. Peticion desde un origen web no permitido, cuya lectura bloquea el navegador por CORS.
3. Reproduccion de un unico canal con sesion valida, token e identificador de instancia coherentes y clave CENC conocida.
4. Segunda sesion simultanea (409), token copiado a otra instancia (401), cruce de activo (403) y uso posterior a la parada (401).

El caso tercero permanece posible de forma deliberada: para el servidor es una sesion autorizada y Fase 1 no dispone de puntuacion de riesgo. CORS no se presenta como autenticacion, ya que un cliente nativo no esta obligado a aplicarlo.

## Lectura para el TFM

Esta fase corresponde a la primera defensa en profundidad:

- El DRM sigue siendo Widevine.
- El servidor de licencias de pruebas sigue existiendo aguas arriba.
- La diferencia es que ya no se expone una ruta `no_auth`.
- El control-plane ata manifest, contenido y licencia a usuario, dispositivo, instancia, activo y sesion.
- El manifest y todos los objetos del activo CENC local quedan condicionados al mismo token y binding.
- Las rutas del origen local se validan contra el activo incluido en el `playbackToken`; un token de otro activo recibe `403`.
- El acceso externo anonimo deja de funcionar. Una sesion legitima con token vigente y clave conocida sigue pudiendo reproducir un canal, limitacion documentada en la evaluacion.
- La interfaz conserva solo metadatos de las operaciones y no imprime los tokens de acceso o reproduccion.
