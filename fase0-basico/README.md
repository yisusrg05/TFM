# Fase 0 - OTT base con DRM/CENC/Widevine

Esta fase representa el sistema base del TFM: una infraestructura OTT funcional con CDN, origin, cliente web y flujo DRM, pero sin controles de defensa en profundidad.

La idea academica es importante: **incluso partiendo de contenido CENC/Widevine, la arquitectura sigue siendo abusiva si no hay autenticacion fuerte, sesiones, autorizacion contextual, control de concurrencia, deteccion y respuesta**.

## Que levanta esta version

- **`ott-client`**: plataforma OTT oficial con login, usuarios de prueba y control basico de permisos.
- **`external-player`**: reproductor externo sin login para demostrar reutilizacion de MPD + licencia `no_auth`.
- **`drm-audit-lab`**: laboratorio web para introducir MPD/licencia observados en red y registrar evidencias de reproduccion.
- **`key-leak-demo`**: prueba controlada de reproduccion con MPD + clave de laboratorio, sin servidor de licencias.
- **`cdn`**: Varnish como CDN local y punto publico de entrada.
- **`origin`**: Nginx sirviendo el contenido DASH.
- **`license-server`**: endpoint `/license` compatible con challenges binarios Widevine. Por defecto proxifica el servidor publico de pruebas de Shaka/CWIP.

Arquitectura:

```text
Browser (Shaka + EME/Widevine) -> CDN (Varnish, :8080)
                                    |-- /content/* -> Origin (Nginx)
                                    |-- /platform/license -> License proxy con permisos
                                    '-- /license/no_auth  -> License proxy publico -> CWIP/Shaka Widevine
```

## Estructura

```text
fase0-basico/
|-- docker-compose.yml
|-- README.md
|-- client/
|   '-- index.html
|-- external-player/
|   '-- index.html
|-- drm-audit-lab/
|   '-- index.html
|-- key-leak-demo/
|   '-- index.html
|-- license-server/
|   |-- Dockerfile
|   |-- package.json
|   '-- src/index.js
|-- tools/
|   '-- package-cenc-widevine.ps1
`-- varnish/
    '-- default.vcl

origin-content/
|-- dash/
|   '-- minimal.mpd
|-- dash-widevine/
|   '-- README.md
|-- mp4/
|   '-- video_144p_108k_h264.mp4
`-- index.html
```

## Puertos

- Cliente web: `http://localhost:3000`
- Reproductor externo: `http://localhost:3001`
- Laboratorio DRM: `http://localhost:3002`
- Demo MPD + clave conocida: `http://localhost:3003`
- CDN Varnish: `http://localhost:8080`
- Origin directo: `http://localhost:8081`
- License server directo: `http://localhost:8082`

## Usuarios de prueba

La plataforma oficial tiene dos usuarios:

| Usuario | Password | Permiso |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Puede reproducir `shaka-widevine` y `local-cenc-clearkey` |
| `usuario-denegado@tfm.local` | `demo123` | Login correcto, pero sin permiso para ningun activo |

Esto permite probar que la plataforma aplica autorizacion antes de entregar la configuracion de reproduccion y que el proxy de licencia vuelve a validar el activo en cada challenge Widevine.

## Activos de la plataforma

| Activo | Tipo | URL |
|---|---|---|
| `shaka-widevine` | Widevine real de pruebas | `https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd` |
| `local-cenc-clearkey` | CENC local con clave de laboratorio | `http://localhost:8080/content/dash-known-key/stream.mpd` |

## Arranque rapido

Desde `fase0-basico/`:

```bash
docker compose up --build -d
```

Parar:

```bash
docker compose down
```

## Generar contenido CENC/Widevine

La carpeta `origin-content/dash-widevine/` esta preparada para el contenido cifrado.

Desde la raiz del repositorio:

```powershell
.\fase0-basico\tools\package-cenc-widevine.ps1
```

Ese modo usa claves raw de laboratorio y senalizacion Widevine mediante Shaka Packager. Sirve para generar contenido CENC y estudiar el flujo, pero no sustituye al contenido Widevine publico de Shaka ni a una licencia Widevine productiva.

Para empaquetar contra un servicio Widevine real:

```powershell
$env:WIDEVINE_KEY_SERVER_URL="https://..."
$env:WIDEVINE_CONTENT_ID="..."
$env:WIDEVINE_SIGNER="..."
$env:WIDEVINE_AES_SIGNING_KEY="..."
$env:WIDEVINE_AES_SIGNING_IV="..."
.\fase0-basico\tools\package-cenc-widevine.ps1 -Mode widevine-service
```

## Generar contenido CENC con clave conocida

Para demostrar el riesgo de una clave filtrada sin trabajar con claves Widevine reales, genera un activo CENC de laboratorio:

```powershell
.\fase0-basico\tools\package-cenc-known-key.ps1
```

Ese script crea:

- MPD: `origin-content/dash-known-key/stream.mpd`
- KID: `1e5d4f9f3a2b4c7d8e9f001122334455`
- KEY: `00112233445566778899aabbccddeeff`

Despues abre `http://localhost:3003`. Esa interfaz configura Shaka con `drm.clearKeys` y reproduce sin llamar a ningun license server. Esto sirve para evidenciar la hipotesis: si una key sale del entorno protegido, el DRM deja de ser una barrera efectiva para ese activo.

## Licencias Widevine de prueba

Por defecto, la fase 0 usa el contenido Widevine publico de Shaka:

- Manifest: `https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd`
- License server de pruebas: `https://cwip-shaka-proxy.appspot.com/no_auth`

La plataforma oficial llama a `http://localhost:8080/platform/license`, que verifica si el usuario tiene permiso antes de proxificar la peticion.

Ademas, se mantiene deliberadamente `http://localhost:8080/license/no_auth`, que proxifica la misma licencia sin login. Ese endpoint es la debilidad de fase 0 y permite demostrar que un reproductor externo puede reproducir si obtiene el MPD y la URL de licencia observando la red.

## Configurar otro servidor de licencias

Ejemplo:

```powershell
$env:WIDEVINE_LICENSE_URL="https://proveedor.example/license"
$env:WIDEVINE_LICENSE_HEADERS_JSON='{"X-Api-Key":"valor"}'
docker compose up --build -d
```

Si `WIDEVINE_LICENSE_URL` se deja vacio manualmente, `/license` devuelve `501` indicando que falta proveedor real.

## Pruebas manuales

1. Abre `http://localhost:3000`.
2. Inicia sesion con `usuario-permitido@tfm.local`. Deben aparecer dos activos reproducibles.
3. Reproduce el activo Widevine publico.
4. Reproduce el activo CENC local con clave de laboratorio.
5. Inicia sesion con `usuario-denegado@tfm.local`. Deben aparecer los dos activos como denegados y no debe cargarse ningun MPD.
6. Abre `http://localhost:3001` y reproduce usando el MPD publico y `http://localhost:8080/license/no_auth`. Debe funcionar sin login.
7. Abre `http://localhost:3002` para registrar evidencias de MPD/licencia/reproduccion externa.
8. Genera el contenido con clave conocida y abre `http://localhost:3003` para demostrar reproduccion con MPD + KEY sin license server.

Comprobacion por terminal:

```bash
curl -I http://localhost:8080/content/dash/minimal.mpd
curl -X POST http://localhost:8080/license --data-binary @origin-content/dash-widevine/README.md -H "content-type: application/octet-stream"
```

## Lectura para el TFM

Esta fase debe usarse como baseline vulnerable:

- Existe DRM/CENC/Widevine funcional usando el contenido publico de Shaka.
- La plataforma puede denegar la configuracion de reproduccion completa a un usuario sin permiso.
- El proxy de licencia tambien valida el permiso del activo en cada challenge Widevine.
- La licencia tambien se expone por una ruta publica `no_auth`, que permite reproducir fuera de la plataforma.
- Si una clave de contenido se filtra, se puede reproducir un activo CENC de laboratorio con MPD + KID + KEY sin contactar con el license server.
- No hay autenticacion de usuario.
- No hay binding fuerte entre usuario, dispositivo, sesion y licencia.
- No hay control de concurrencia.
- No hay deteccion de abuso ni bloqueo.
- CDN y origin siguen siendo explotables si se conocen URLs o tokens.

Por eso las fases 1 y 2 introducen hardening y defensa en profundidad.

## Sobre claves DRM

El laboratorio no extrae ni muestra content keys Widevine del CDM. En navegadores, EME permite solicitar licencias y reproducir, pero no exportar claves Widevine desde el CDM.

La demo `key-leak-demo` usa una clave de laboratorio conocida generada por nosotros. Su objetivo no es romper Widevine, sino demostrar de forma controlada el impacto de una key filtrada: con MPD + KID + KEY, el cliente puede reproducir sin acudir al servidor de licencias.

## Nota academica/legal

Shaka Player publica este contenido y el servidor CWIP para pruebas de Widevine. Para produccion, Widevine requiere acuerdos, claves y un servidor de licencias autorizado. Esta maqueta usa esos recursos publicos solo como laboratorio reproducible.
