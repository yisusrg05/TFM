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

## Usuarios de prueba

| Usuario | Password | Resultado esperado |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Puede crear sesion, reproducir y ver observabilidad |
| `usuario-denegado@tfm.local` | `demo123` | Login correcto, pero sin entitlement del activo |

## Puertos

- Cliente fase 2: `http://localhost:9400`
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

## Lectura para el TFM

Esta fase corresponde a la arquitectura defensiva completa:

- Widevine no se usa de forma aislada.
- La licencia esta condicionada a sesion, identidad, dispositivo, activo y riesgo.
- El sistema produce evidencias medibles para el capitulo de evaluacion.
- La respuesta activa permite bloquear cuenta/dispositivo ante abuso.
