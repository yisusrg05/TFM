# DASH CENC/Widevine

Este directorio queda reservado para contenido CENC/Widevine local generado durante el laboratorio.

La fase 0 usa por defecto el contenido publico de Shaka para tener Widevine funcional sin contratar un proveedor:

- Manifest: `https://storage.googleapis.com/shaka-demo-assets/sintel-widevine/dash.mpd`
- License server: `https://cwip-shaka-proxy.appspot.com/no_auth`

El contenido local generado aqui es opcional y sirve para estudiar empaquetado CENC propio.

Generacion desde la raiz del repositorio:

```powershell
.\fase0-basico\tools\package-cenc-widevine.ps1
```

El modo por defecto usa claves raw de laboratorio y genera un MPD con senalizacion Widevine. Para un flujo Widevine real reproducible en navegador hace falta usar un proveedor Widevine autorizado tanto en el empaquetado como en el servidor de licencias:

```powershell
$env:WIDEVINE_KEY_SERVER_URL="https://..."
$env:WIDEVINE_CONTENT_ID="..."
$env:WIDEVINE_SIGNER="..."
$env:WIDEVINE_AES_SIGNING_KEY="..."
$env:WIDEVINE_AES_SIGNING_IV="..."
.\fase0-basico\tools\package-cenc-widevine.ps1 -Mode widevine-service
```

Salida esperada:

- `stream.mpd`
- `video_init.mp4`
- `video_*.m4s`
