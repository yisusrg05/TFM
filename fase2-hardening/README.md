# Fase 2 de hardening OTT/CDN

Variante nueva del laboratorio centrada en antifraude y observabilidad.

## Que anade sobre Fase 1

- Redis para persistir sesiones, eventos, bans y riesgo.
- Eventos estructurados JSON por login, playback, licencia y contenido.
- Reglas simples de anomalias:
  - multiples IPs por cuenta en ventana corta
  - demasiados errores de concurrencia
  - volumen anormal de peticiones de licencia
  - cadencia alta de heartbeats/contenido
- Baneos:
  - por cuenta
  - por dispositivo
  - automaticos por score
  - manuales via API admin
- Panel minimo de observabilidad en el cliente.

## Puertos

- Cliente fase 2: `http://localhost:9400`
- CDN fase 2: `http://localhost:9180`

## Arranque

```bash
docker compose -f fase2-hardening/docker-compose.yml up --build -d
```

## Credenciales demo

- `demo@tfm.local`
- `demo123`
