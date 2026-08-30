# Evidencias de Fase 1

## Escenario

El laboratorio autenticó al usuario permitido, creó una sesión, cargó el manifest y obtuvo dos licencias Widevine. Con el vídeo en reproducción ejecutó después cuatro pruebas negativas: ausencia de token, token alterado, sesión distinta y activo distinto. Los resultados visibles fueron 401, 401, 409 y 403.

## Artefactos

- `capturas/fase1_01_pruebas_manifest.png`: estado visible y registro local de los cuatro rechazos.
- `pcap/fase1_01_laboratorio_protegido.pcap`: 62 paquetes, 54.523 bytes y 17 solicitudes HTTP.
- `json/fase1_01_laboratorio_protegido_http.json`: secuencia HTTP sin exportar la cabecera Authorization.
- `logs/`: salida final de control-plane y servidor interno de licencia.

El PCAP contiene login, creación y parada de sesión, manifest, dos `POST /license` y las solicitudes negativas. La distribución observada fue: seis respuestas 200, una 201, seis preflight 204, dos 401, una 403 y una 409.

## Filtros de Wireshark

```text
http.request
http.request.uri contains "manifest" || http.request.uri contains "license"
http.response.code == 401 || http.response.code == 403 || http.response.code == 409
```

El punto de captura es la CDN de Fase 1. El manifest Widevine se obtiene desde infraestructura externa después de la autorización local; los segmentos HTTPS externos no aparecen descifrados en el PCAP.

