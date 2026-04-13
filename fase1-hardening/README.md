# Fase 1 de hardening OTT/CDN

Esta carpeta contiene una variante nueva y aislada de la maqueta original para demostrar el primer nivel de defensa en profundidad sin modificar los servicios base del repositorio.

## Que implementa

- `control-plane/`
  - login demo
  - emision de `accessToken`
  - creacion de `playback session`
  - emision y renovacion de `playbackToken` efimero
  - control de concurrencia por cuenta
  - heartbeat y parada de sesion
  - proxy protegido hacia contenido y licencia

- `varnish/default.vcl`
  - solo expone rutas de negocio necesarias
  - exige cabecera `Authorization` en contenido, licencia y operaciones de sesion sensibles
  - limita CORS al cliente de esta fase
  - deja trazabilidad con `X-Request-Id`

- `license-server/`
  - ya no expone licencia directa al exterior
  - acepta solo llamadas internas desde el `control-plane`

- `client/`
  - login
  - creacion de sesion protegida
  - heartbeat
  - prueba de licencia protegida
  - reproduccion DASH a traves de la CDN endurecida
  - watermark visible ligado a usuario y sesion

## Arquitectura

```text
Browser (cliente fase1, :9300)
  -> CDN Varnish (:9080)
      -> control-plane
          -> origin (interno)
          -> license-server (interno)
```

## Credenciales demo

- Email: `demo@tfm.local`
- Password: `demo123`

## Puertos

- Cliente fase 1: `http://localhost:9300`
- CDN protegida fase 1: `http://localhost:9080`

`origin` y `license-server` no se publican en el host en esta variante.

## Arranque

```bash
docker compose -f fase1-hardening/docker-compose.yml up --build -d
```
