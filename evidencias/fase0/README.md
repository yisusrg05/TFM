# Evidencias de la auditoría de la fase 0

Fecha de adquisición: 26 de agosto de 2026.

Este directorio conserva las evidencias que respaldan los tres comportamientos principales descritos en el capítulo 4. Las capturas de pantalla demuestran el resultado visible de la reproducción y los PCAP documentan las solicitudes HTTP observadas en el punto de entrada de Varnish (`localhost:8080`). La clave mostrada en la prueba ClearKey es una clave creada exclusivamente para el laboratorio.

## Inventario

| Caso | Captura de pantalla | Captura de red | Qué demuestra |
|---|---|---|---|
| Flujo oficial Widevine | `capturas/fase0_01_flujo_oficial_widevine.png` | `pcap/fase0_01_flujo_oficial_widevine.pcap` | El usuario autorizado inicia sesión, obtiene la configuración y realiza dos solicitudes a `/platform/license` antes de reproducir. |
| Bypass Widevine sin autenticación | `capturas/fase0_02_bypass_widevine_no_auth.png` | `pcap/fase0_02_bypass_widevine_no_auth.pcap` | Un cliente externo reproduce el mismo activo mediante `/license/no_auth`; el PCAP contiene una petición CORS `OPTIONS` y dos `POST`, sin login ni petición previa a `/playback/config`. |
| ClearKey con clave conocida | `capturas/fase0_03_clearkey_sin_licencia.png` | `pcap/fase0_03_clearkey_sin_licencia.pcap` | La captura visual confirma la reproducción con la clave de laboratorio. El PCAP conserva una recuperación controlada del MPD, inicializaciones y primeros segmentos a través de la CDN, sin solicitudes a una ruta de licencia. |
| Vista conjunta | — | `pcap/fase0_00_auditoria_completa.pcapng` | Agrega los tres PCAP anteriores en un único archivo para su revisión en Wireshark. |

La captura conjunta contiene 157 paquetes y 320 kB de datos de protocolo. En el tercer PCAP cada recurso aparece dos veces porque la captura se tomó dentro del espacio de red de Varnish: una entrada corresponde a la petición del cliente y la otra al reenvío de Varnish hacia el origen.

## Secuencias verificadas

Flujo oficial:

```text
POST /auth/login
POST /playback/config
POST /platform/license
POST /platform/license
```

Bypass sin autenticación:

```text
OPTIONS /license/no_auth
POST    /license/no_auth
POST    /license/no_auth
```

ClearKey:

```text
GET /content/dash-known-key/stream.mpd
GET /content/dash-known-key/video_init.mp4
GET /content/dash-known-key/video_1.m4s
GET /content/dash-known-key/audio_init.mp4
GET /content/dash-known-key/audio_1.m4s
```

No aparece ninguna URI que contenga `license` en el PCAP de ClearKey.

## Filtros útiles de Wireshark

Para ver todas las peticiones HTTP:

```text
http.request
```

Para comparar los dos caminos de licencia:

```text
http.request.uri == "/platform/license" || http.request.uri == "/license/no_auth"
```

Para aislar el bypass:

```text
http.request.uri == "/license/no_auth"
```

Para mostrar los recursos ClearKey y comprobar que no se invoca una licencia:

```text
http.request.uri contains "dash-known-key" || http.request.uri contains "license"
```

Para una captura destinada a la memoria conviene mostrar las columnas `Time`, `Source`, `Destination`, `Method`, `Host`, `Request URI` y `Status Code`. Deben ocultarse o recortarse las cabeceras `Authorization`: el PCAP del flujo oficial puede conservar un token temporal del laboratorio aunque no se reproduzca en la memoria.

## Integridad y alcance

Las huellas SHA-256 se encuentran en `SHA256SUMS.txt`. Permiten demostrar que los ficheros analizados son los mismos que se usaron para redactar los resultados.

Los PCAP registran el tráfico HTTP local que atraviesa Varnish. El manifiesto y los segmentos del activo Widevine público se descargan por HTTPS desde el servicio externo de Shaka y, por tanto, no se descifran ni aparecen como HTTP legible en estas capturas. No se ha intentado extraer ninguna clave Widevine: la evidencia evalúa autorización y rutas de acceso, no una ruptura criptográfica del CDM.
