# Evidencias de Fase 1

## Escenario

El laboratorio autenticó al usuario permitido, creó una sesión, cargó el manifest y obtuvo dos licencias Widevine. Con el vídeo en reproducción ejecutó después cuatro pruebas negativas: ausencia de token, token alterado, sesión distinta y activo distinto. Los resultados visibles fueron 401, 401, 409 y 403.

## Artefactos

- `capturas/fase1_01_pruebas_manifest.png`: estado visible y registro local de los cuatro rechazos.
- `pcap/fase1_01_laboratorio_protegido.pcap`: 62 paquetes, 54.523 bytes y 17 solicitudes HTTP.
- `json/fase1_01_laboratorio_protegido_http.json`: secuencia HTTP sin exportar la cabecera Authorization.
- `logs/`: salida final de control-plane y servidor interno de licencia.

El PCAP contiene login, creación y parada de sesión, manifest, dos `POST /license` y las solicitudes negativas. La distribución observada fue: seis respuestas 200, una 201, seis preflight 204, dos 401, una 403 y una 409.

## Key Leak y CDN leeching

La batería complementaria ha comprobado el activo `local-cenc-clearkey` desde un cliente externo controlado. El manifest y un segmento sin token han devuelto 401. Una sesión válida ha recuperado tres objetos de contenido (253.023 bytes) sin solicitar licencia y ha podido reproducir con la clave conocida. La segunda sesión ha devuelto 409; la copia a otra instancia, 401; el cruce de activo, 403; y el acceso posterior a la parada, 401.

- `pcap/fase1_02_cdn_leeching.pcap`: 174 paquetes, 293.308 bytes, 14 solicitudes y 14 respuestas HTTP.
- `json/fase1_02_cdn_leeching.json`: sesión, códigos, bytes, latencias de contenido y resultado CORS.
- `json/fase1_02_cdn_leeching_http.json`: secuencia HTTP sin exportar `Authorization`.

La distribución del PCAP ha sido: siete respuestas 200, una 201, cuatro 401, una 403 y una 409. El HTTP 200 de la prueba CORS no implica que el navegador pueda leer la respuesta: `Access-Control-Allow-Origin` se mantiene en el cliente oficial. Un cliente nativo no aplica esta política, por lo que la autorización efectiva sigue dependiendo del token.

## Filtros de Wireshark

```text
http.request
http.request.uri contains "manifest" || http.request.uri contains "license"
http.response.code == 401 || http.response.code == 403 || http.response.code == 409
http.request.uri contains "dash-known-key"
```

El punto de captura es la CDN de Fase 1. El manifest Widevine se obtiene desde infraestructura externa después de la autorización local; los segmentos HTTPS externos no aparecen descifrados en el PCAP.
