# Evidencias de Fase 2

## Concurrencia y ban de cuenta

El primer escenario autenticó al usuario, reprodujo Widevine y mantuvo la sesión activa. Cinco solicitudes adicionales de sesión devolvieron 409. El score observado fue 0, 25, 50, 75 y 100; después se creó `AUTO_BAN:REPEATED_CONCURRENCY_VIOLATION` y el manifest devolvió 401. Finalmente se retiró el ban, se renovó la credencial y se detuvo la sesión.

- `capturas/fase2_01_concurrencia_y_ban.png`
- `pcap/fase2_01_concurrencia_y_ban.pcap`: 111 paquetes, 131.226 bytes y 35 solicitudes HTTP.
- `json/fase2_01_concurrencia_y_ban.json`: score, sesión y eventos Redis, incluidos `risk.incremented`, `ban.created`, `ban.cleared` y `playback.stopped`.
- `json/fase2_01_concurrencia_y_ban_http.json`: resumen seguro del PCAP.

La captura contiene seis `POST /playback/session`: una creación 201 y cinco rechazos 409. Registra también las dos licencias legítimas, el rechazo del manifest, las consultas administrativas y la recuperación.

## Fallos de autenticación y ban de dispositivo

El segundo escenario inició una reproducción válida y envió ocho logins incorrectos desde el mismo `deviceId`. Las ocho solicitudes devolvieron 401, se creó `AUTH_FAILURE_BURST` y una nueva carga del manifest quedó rechazada. Después se retiró el ban y se cerró la sesión.

- `capturas/fase2_02_fallos_auth_y_ban_device.png`
- `pcap/fase2_02_fallos_auth_y_ban_device.pcap`: 83 paquetes, 92.984 bytes y 25 solicitudes HTTP.
- `json/fase2_02_fallos_auth_y_ban_device.json`: eventos y estado Redis.
- `json/fase2_02_fallos_auth_y_ban_device_http.json`: resumen seguro del PCAP.

`pcap/fase2_00_evaluacion_completa.pcapng` agrega ambos escenarios: 194 paquetes y 227.788 bytes.

## Filtros de Wireshark

```text
http.request
http.request.uri == "/playback/session" || http.request.uri == "/auth/login"
http.response.code == 401 || http.response.code == 409
http.request.uri contains "admin/bans" || http.request.uri contains "admin/overview"
```

Las cabeceras de autorización no se incluyen en los resúmenes JSON, aunque permanecen dentro de los PCAP brutos como credenciales efímeras del laboratorio.

