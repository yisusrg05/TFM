# TFM sobre Widevine · Base OTT con Docker Compose

Sí: se puede montar **Varnish como CDN (edge cache)** y **Shaka Player** como cliente web.
Este repositorio ya queda con una base funcional para empezar.

## Qué levanta esta versión

- **`ott-client`**: cliente web estático con Shaka Player.
- **`license-server`**: mock de servidor de licencias (Node + Express).
- **`origin`**: servidor de contenido estático (Nginx).
- **`cdn`**: Varnish como capa de caché/proxy entre cliente y origin/license.

Arquitectura:

```text
Browser (Shaka) -> CDN (Varnish, :8080)
                     ├─ /content/* -> Origin (Nginx)
                     └─ /license   -> License server (mock)
```

## Estructura

```text
.
├─ docker-compose.yml
├─ README.md
├─ client/
│  └─ index.html
├─ license-server/
│  ├─ Dockerfile
│  ├─ package.json
│  └─ src/index.js
├─ infra/
│  └─ varnish/default.vcl
└─ origin-content/
   └─ index.html
```

## Puertos

- Cliente web (Shaka): `http://localhost:3000`
- CDN Varnish: `http://localhost:8080`
- Origin directo: `http://localhost:8081`
- License server directo: `http://localhost:8082`

## Arranque rápido

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
2. Pulsa **Probar /license** (llama al mock vía Varnish).
3. Pulsa **Cargar DASH local** para verificar reproducción desde `origin-content/dash/minimal.mpd`.

### Comprobación por terminal

```bash
curl -X POST http://localhost:8080/license -H 'content-type: application/json' -d '{"hello":"widevine"}'
curl -I http://localhost:8080/content/dash/minimal.mpd
```

Deberías ver cabecera `X-Cache: MISS` y en siguientes peticiones `X-Cache: HIT` sobre `/content`.


## Contenido DASH mínimo incluido

Ya se incluye un ejemplo DASH VOD mínimo (clear):

- MPD: `origin-content/dash/minimal.mpd`
- El MPD usa media remota (sin binarios versionados en el repo).
- URL de reproducción vía CDN: `http://localhost:8080/content/dash/minimal.mpd`

## Siguiente iteración recomendada (TFM)

- Añadir contenido DASH/HLS propio en `origin-content/`.
- Configurar endpoints de licencia con challenge real (protobuf/binary).
- Integrar empaquetado CENC y signaling (PSSH, KID, policy).
- Sustituir mock por servicio de licencias real o emulado con mayor fidelidad.

## Nota académica/legal

Widevine productivo requiere acuerdos y cumplimiento de requisitos de seguridad.
Esta maqueta es para laboratorio y diseño de arquitectura del TFM.
