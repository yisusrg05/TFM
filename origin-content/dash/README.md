# DASH mínimo local (sin binarios en repo)

Este directorio contiene un ejemplo mínimo de DASH VOD (clear, sin DRM) para validar:

- origin server
- routing/caché de Varnish
- reproducción con Shaka Player

Archivo principal:
- `minimal.mpd`

Notas:
- Para evitar binarios en el repositorio, el MPD referencia un `BaseURL` remoto público.
- URL del MPD vía CDN local: `http://localhost:8080/content/dash/minimal.mpd`
