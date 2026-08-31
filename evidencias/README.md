# Evidencias de evaluación comparativa

Fecha de adquisición: 30 y 31 de agosto de 2026.

Este directorio conserva los datos utilizados para redactar el capítulo 7. La campaña combina pruebas HTTP automatizadas, reproducción Widevine real en navegador, capturas PCAP dentro del espacio de red de cada CDN, estado JSON de Redis y capturas de las interfaces. Los tokens completos se sustituyen por `<redacted>` en JSON y CSV; los PCAP pueden contener credenciales efímeras de laboratorio y no deben publicarse sin revisión.

## Resultado global

- 65 comprobaciones funcionales finales: 65 superadas y 0 fallidas.
- 27 comprobaciones complementarias de Key Leak y CDN leeching: 27 superadas y 0 fallidas.
- Resultado agregado: 92/92 comprobaciones superadas.
- 240 muestras temporales: 20 por combinación de fase y operación, sin errores HTTP inesperados.
- Fase 0: 12 comprobaciones generales y 3 complementarias.
- Fase 1: 21 comprobaciones generales y 11 complementarias.
- Fase 2: 32 comprobaciones generales y 13 complementarias, incluidas detección, ban y recuperación.
- Cinco PCAP de las fases endurecidas, dos exportaciones de estado de Redis y cinco capturas de navegador.

La ampliación se ha ejecutado como una batería independiente. No se han recalculado las 240 métricas temporales ni se han modificado los escenarios anteriores, ya que CDN leeching incorpora variables específicas: bytes servidos, objetos de contenido, solicitudes de licencia, CORS, instancia de cliente y riesgo.

Durante la primera ejecución, la prueba `F2-LICENSE-WRONG-SESSION` detectó que `/license` en Fase 2 no contrastaba la cabecera de sesión. El resultado inicial fue 64/65 y HTTP 500. Se añadió la validación temprana y la regresión completa terminó en 65/65, con HTTP 409 `SESSION_MISMATCH`. El detalle se conserva en `resultados/incidencia_binding_licencia_fase2.json`.

## Inventario

- `fase0/`: evidencias de la auditoría base ya utilizadas en el capítulo 4, ahora acompañadas de resúmenes HTTP JSON.
- `fase1/`: PCAP del laboratorio general y de CDN leeching, resúmenes HTTP, captura y logs.
- `fase2/`: PCAP de concurrencia, autenticación y CDN leeching, PCAPNG de la batería original, estados Redis, capturas y logs.
- `resultados/resultados_funcionales.*`: matriz completa de pruebas.
- `resultados/resultados_cdn_leeching.*`: matriz complementaria de 27 pruebas y resúmenes por fase.
- `resultados/metricas_raw.csv`: 240 observaciones individuales.
- `resultados/metricas_resumen.*`: media, mediana, percentil 95, extremos y desviación típica.
- `resultados/entorno_ejecucion.json`: versiones, contenedores y consumo puntual.
- `scripts/`: herramientas reproducibles de ejecución, exportación y análisis.

Las huellas SHA-256 se generan al final de la campaña y permiten comprobar que los artefactos analizados no se han modificado después de redactar los resultados.

## Repetición

Desde la raíz del repositorio:

```powershell
python evidencias/scripts/run_evaluation.py functional
python evidencias/scripts/run_evaluation.py metrics --iterations 20
python evidencias/scripts/run_cdn_leeching.py all
python evidencias/scripts/summarize_pcaps.py
python evidencias/scripts/collect_environment.py
python evidencias/scripts/generate_hashes.py
```

La parte funcional reinicia el estado en memoria de Fase 1 y limpia Redis entre los escenarios de Fase 2. La medición de Fase 2 limpia Redis antes de cada ciclo para evitar que la propia campaña active los umbrales de heartbeat. La batería complementaria reinicia cada fase por defecto; `--skip-reset` permite adquirir un PCAP después de haber comprobado manualmente que el servicio está disponible. La adquisición PCAP requiere `nicolaka/netshoot` y se realiza compartiendo el espacio de red del contenedor CDN correspondiente.
