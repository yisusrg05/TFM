# DASH minimo local

Este directorio contiene un ejemplo minimo de DASH VOD (clear, sin DRM) para validar:

- origin server
- routing/cache de Varnish
- reproduccion con Shaka Player

Archivo principal:
- `minimal.mpd`
- `../mp4/video_144p_108k_h264.mp4`

Notas:
- El MPD referencia un `BaseURL` local servido por `origin` y Varnish.
- URL del MPD via CDN local: `http://localhost:8080/content/dash/minimal.mpd`
- URL del MP4 via CDN local: `http://localhost:8080/content/mp4/video_144p_108k_h264.mp4`
