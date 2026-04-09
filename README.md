# TFM sobre Widevine · Base OTT con Docker Compose

Si: se puede montar **Varnish como CDN (edge cache)** y **Shaka Player** como cliente web.
Este repositorio ya queda con una base funcional para empezar.

## Que levanta esta version

- **`ott-client`**: cliente web estatico con Shaka Player.
- **`license-server`**: mock de servidor de licencias (Node + Express).
- **`origin`**: servidor de contenido estatico (Nginx).
- **`cdn`**: Varnish como capa de cache/proxy entre cliente y origin/license.

Arquitectura:

```text
Browser (Shaka) -> CDN (Varnish, :8080)
                     |-- /content/* -> Origin (Nginx)
                     '-- /license   -> License server (mock)
```

## Estructura

```text
.
|-- docker-compose.yml
|-- README.md
|-- client/
|   '-- index.html
|-- license-server/
|   |-- Dockerfile
|   |-- package.json
|   '-- src/index.js
|-- infra/
|   '-- varnish/default.vcl
`-- origin-content/
    |-- dash/
    |   '-- minimal.mpd
    |-- mp4/
    |   '-- video_144p_108k_h264.mp4
    '-- index.html
```

## Puertos

- Cliente web (Shaka): `http://localhost:3000`
- CDN Varnish: `http://localhost:8080`
- Origin directo: `http://localhost:8081`
- License server directo: `http://localhost:8082`

## Arranque rapido

```bash
docker compose up --build -d
```

Logs:

```bash
docker compose logs -f
```

Parar:

```bash
docker compose down
```

## Pruebas manuales iniciales

1. Abre `http://localhost:3000`.
2. Pulsa **Probar /license** (llama al mock via Varnish).
3. Pulsa **Cargar DASH local** para verificar reproduccion desde `origin-content/dash/minimal.mpd`.

### Comprobacion por terminal

```bash
curl -X POST http://localhost:8080/license -H 'content-type: application/json' -d '{"hello":"widevine"}'
curl -I http://localhost:8080/content/dash/minimal.mpd
curl -I http://localhost:8080/content/mp4/video_144p_108k_h264.mp4
```

Deberias ver cabecera `X-Cache: MISS` y en siguientes peticiones `X-Cache: HIT` sobre `/content`.

## Contenido DASH minimo incluido

Ya se incluye un ejemplo DASH VOD minimo (clear):

- MPD: `origin-content/dash/minimal.mpd`
- MP4 local: `origin-content/mp4/video_144p_108k_h264.mp4`
- El MPD referencia media local servida por `origin` y cacheable por Varnish.
- URL de reproduccion via CDN: `http://localhost:8080/content/dash/minimal.mpd`

## Siguiente iteracion recomendada (TFM)

- Anadir contenido DASH/HLS propio en `origin-content/`.
- Configurar endpoints de licencia con challenge real (protobuf/binary).
- Integrar empaquetado CENC y signaling (PSSH, KID, policy).
- Sustituir mock por servicio de licencias real o emulado con mayor fidelidad.

## Nota academica/legal

Widevine productivo requiere acuerdos y cumplimiento de requisitos de seguridad.
Esta maqueta es para laboratorio y diseno de arquitectura del TFM.
