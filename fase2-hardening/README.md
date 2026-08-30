# Fase 2 - Antifraude y observabilidad sobre Widevine

Esta fase mantiene la proteccion de fase 1 y anade persistencia, eventos, riesgo y respuesta.

## Que anade sobre fase 1

- Redis para sesiones, eventos, riesgo y baneos.
- Eventos estructurados de:
  - login,
  - creacion de sesion,
  - heartbeats,
  - licencia,
  - reproduccion,
  - bans.
- Score de riesgo por cuenta.
- Reglas simples:
  - multiples IPs,
  - errores de concurrencia,
  - rafagas de licencias,
  - cadencia anomala de contenido/heartbeat,
  - fallos de autenticacion.
- Baneos:
  - por cuenta,
  - por dispositivo,
  - automaticos por score,
  - manuales desde la API admin.
- Panel web de observabilidad en `http://localhost:9400`.
- Laboratorio de auditoria y bloqueo en `http://localhost:9401`.
- Manifest DASH y licencia protegidos por el mismo `playbackToken` efimero.

## Usuarios de prueba

| Usuario | Password | Resultado esperado |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Puede crear sesion, reproducir y ver observabilidad |
| `usuario-denegado@tfm.local` | `demo123` | Login correcto, pero sin entitlement del activo ni rol administrativo |

## Puertos

- Cliente fase 2: `http://localhost:9400`
- Laboratorio de auditoria y bloqueo: `http://localhost:9401`
- CDN fase 2: `http://localhost:9180`

## Arranque

Desde la raiz del repositorio:

```bash
docker compose -f fase2-hardening/docker-compose.yml up --build -d
```

## Pruebas

1. Inicia sesion con `usuario-permitido@tfm.local`.
2. Crea playback session y reproduce Widevine.
3. Actualiza observabilidad para ver eventos y score.
4. Aplica ban manual al device y comprueba que nuevas operaciones quedan bloqueadas.
5. Limpia el ban y repite.
6. Inicia sesion con `usuario-denegado@tfm.local` y comprueba el rechazo por entitlement.

### Laboratorio de auditoria y bloqueo

Abre `http://localhost:9401` y utiliza `usuario-permitido@tfm.local` / `demo123`. El primer boton realiza automaticamente el login, crea la sesion y genera el `playbackToken`. Después permite:

1. Reproducir solicitando con token tanto `http://localhost:9180/manifest/sintel-widevine` como la licencia.
2. Ejecutar los casos negativos 401/401/409/403 del manifest.
3. Simular ocho autenticaciones fallidas desde el mismo `deviceId`, activar un ban automatico `AUTH_FAILURE_BURST` y comprobar que una nueva peticion del manifest queda rechazada.
4. Retirar el ban desde el plano administrativo y demostrar que la reproduccion vuelve a funcionar.

El registro del laboratorio conserva estados y claims utiles para la evidencia, pero no imprime el token completo ni las claves Widevine; estas ultimas permanecen dentro del CDM del navegador.

## Lectura para el TFM

Esta fase corresponde a la arquitectura defensiva completa:

- Widevine no se usa de forma aislada.
- La licencia esta condicionada a sesion, identidad, dispositivo, activo y riesgo.
- El manifest exige el mismo token de reproduccion y deja de ser un punto de entrada publico.
- El acceso al origen local conserva el binding entre la ruta solicitada y el activo del `playbackToken`.
- El sistema produce evidencias medibles para el capitulo de evaluacion.
- La respuesta activa permite bloquear cuenta/dispositivo ante abuso.
- El plano administrativo valida un rol independiente y permanece disponible para observar y retirar un ban; el ban sigue bloqueando login, contenido, heartbeat y licencia.
