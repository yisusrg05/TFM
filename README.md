# Evaluación de seguridad en ecosistemas Widevine DRM

Este repositorio contiene el código, la memoria y las evidencias del Trabajo Fin de Máster **«Evaluación de Seguridad en Ecosistemas Widevine DRM: Diseño de una Arquitectura de Defensa en Profundidad para el Streaming en Directo»**.

El proyecto estudia Widevine dentro de la cadena completa de una plataforma OTT. El laboratorio permite comparar un sistema base deliberadamente permisivo con dos etapas de endurecimiento que incorporan autorización contextual, tokens de reproducción, control de concurrencia, observabilidad, puntuación de riesgo y respuesta ante comportamientos anómalos.

> [!IMPORTANT]
> Este es un entorno académico y controlado. Utiliza HTTP local, usuarios, claves y secretos de demostración, contenido público de pruebas y reglas antifraude ilustrativas. No debe desplegarse como servicio de producción ni utilizarse contra sistemas o contenidos de terceros.

## Fases del proyecto

| Fase | Finalidad | Controles principales |
|---|---|---|
| **Fase 0** | Establecer la línea base y reproducir los problemas analizados. | Widevine/CENC funcional, CDN Varnish, origen y licencia; conserva intencionadamente rutas permisivas y demostraciones de reproducción externa y clave conocida. |
| **Fase 1** | Aplicar controles preventivos alrededor del DRM. | Autenticación, autorización por activo, token de reproducción efímero, binding de sesión/dispositivo/instancia, heartbeat y límite de concurrencia. |
| **Fase 2** | Añadir detección, trazabilidad y respuesta. | Estado compartido en Redis, eventos JSON, contadores temporales, puntuación de riesgo, bans de cuenta o dispositivo y operaciones administrativas. |

Las tres fases se mantienen separadas para que sus flujos y resultados puedan compararse sin sustituir la línea base por la arquitectura final.

## Arquitectura general

```text
Cliente o laboratorio
        |
        v
CDN / punto de entrada (Varnish)
        |
        v
Plano de control (Fases 1 y 2)
   |                 |
   v                 v
Origen interno   Proxy de licencia
                         |
                         v
                 Servicio Widevine de pruebas

Fase 2: plano de control <-> Redis (sesiones, eventos, riesgo y bans)
```

El activo Widevine utiliza el contenido público de demostración de Shaka. El contenido CENC local con clave conocida permite estudiar de forma segura los escenarios de *Key Leak* y *CDN leeching* sin extraer claves de Widevine ni alterar el CDM del navegador.

## Contenido del repositorio

| Ruta | Contenido |
|---|---|
| [`fase0-basico/`](fase0-basico/) | Línea base OTT, cliente oficial, reproductor externo, laboratorio DRM, demostración de clave conocida, Varnish y proxy de licencia. |
| [`fase1-hardening/`](fase1-hardening/) | Primera etapa defensiva con plano de control, tokens, sesiones, concurrencia, cliente y laboratorios. |
| [`fase2-hardening/`](fase2-hardening/) | Segunda etapa defensiva con Redis, eventos, riesgo, bloqueos y panel de observabilidad. |
| [`cdn-leeching-lab/`](cdn-leeching-lab/) | Implementación compartida del laboratorio externo utilizado por las fases 1 y 2 para escenarios de *Key Leak* y *CDN leeching*. |
| [`origin-content/`](origin-content/) | Activos DASH locales, MP4 de origen y directorios de salida para CENC/Widevine y CENC con clave conocida. |
| [`evidencias/`](evidencias/) | PCAP, JSON, CSV, capturas, registros, resultados, métricas, hashes y scripts de la campaña de evaluación. |
| [`Latex/TFM_Plantilla_Final/`](Latex/TFM_Plantilla_Final/) | Fuentes LaTeX de la memoria, bibliografía, figuras y apéndice de evidencias. |
| [`propuesta-seguridad/`](propuesta-seguridad/) | Documento de diseño inicial que recoge brechas y propuestas de endurecimiento. |
| [`REVISION_FASES_1_2.md`](REVISION_FASES_1_2.md) | Revisión técnica final de las fases endurecidas, correcciones realizadas y limitaciones conocidas. |
| `Anteproyecto TFM - *` | Anteproyecto original en PDF y RTF. |
| [`LICENSE`](LICENSE) | Licencia GNU GPL v3 aplicable al código fuente. |
| [`LICENSE-DOCUMENTATION.md`](LICENSE-DOCUMENTATION.md) | Licencia CC BY 4.0 y delimitación de su alcance sobre la memoria y la documentación. |

Cada fase y la carpeta de evidencias disponen de un README propio con mayor detalle técnico.

## Requisitos

- Docker Engine o Docker Desktop con Docker Compose v2.
- Un navegador basado en Chromium con Widevine disponible para la reproducción DRM.
- Conexión a Internet para acceder al activo Widevine y al servicio CWIP público de Shaka.
- Python 3 para repetir las baterías automáticas y procesar las evidencias.
- PowerShell si se van a utilizar directamente los scripts de empaquetado incluidos en Fase 0.

No es necesario instalar Node.js, Nginx, Varnish o Redis en el anfitrión: Docker construye o descarga los componentes requeridos.

## Puesta en marcha

Clonar el repositorio:

```bash
git clone https://github.com/yisusrg05/TFM.git
cd TFM
```

### Fase 0

```bash
docker compose -f fase0-basico/docker-compose.yml up --build -d
```

### Fase 1

```bash
docker compose -f fase1-hardening/docker-compose.yml up --build -d
```

### Fase 2

```bash
docker compose -f fase2-hardening/docker-compose.yml up --build -d
```

Los puertos de las fases no se solapan, por lo que pueden mantenerse activas simultáneamente. Para detener una fase, se utiliza el mismo archivo Compose:

```bash
docker compose -f fase1-hardening/docker-compose.yml down
```

## Direcciones de acceso

| Entorno | Cliente OTT | Laboratorio general | Laboratorio Key Leak / CDN leeching | CDN / API |
|---|---:|---:|---:|---:|
| Fase 0 | [localhost:3000](http://localhost:3000) | [localhost:3002](http://localhost:3002) | [localhost:3003](http://localhost:3003) | [localhost:8080](http://localhost:8080) |
| Fase 1 | [localhost:9300](http://localhost:9300) | [localhost:9301](http://localhost:9301) | [localhost:9302](http://localhost:9302) | [localhost:9080](http://localhost:9080) |
| Fase 2 | [localhost:9400](http://localhost:9400) | [localhost:9401](http://localhost:9401) | [localhost:9402](http://localhost:9402) | [localhost:9180](http://localhost:9180) |

Fase 0 expone además, de forma deliberada, el reproductor externo en `http://localhost:3001`, el origen en `http://localhost:8081` y el proxy de licencia en `http://localhost:8082`. En las fases 1 y 2, el origen, el plano de control, Redis y el servidor de licencias permanecen dentro de la red Docker.

## Usuarios de demostración

| Usuario | Contraseña | Uso |
|---|---|---|
| `usuario-permitido@tfm.local` | `demo123` | Cuenta autorizada para crear una sesión y reproducir los activos del laboratorio. |
| `usuario-denegado@tfm.local` | `demo123` | Cuenta autenticable, pero sin permiso de reproducción. |

Estas credenciales forman parte del laboratorio y no deben reutilizarse en ningún otro entorno.

## Recorrido recomendado

1. Iniciar Fase 0 y comprobar la reproducción desde el cliente oficial.
2. Abrir el reproductor externo y la demostración de clave conocida para observar las limitaciones de la línea base.
3. Iniciar Fase 1 y repetir los accesos sin token, con contexto incorrecto y con una segunda sesión concurrente.
4. Iniciar Fase 2 y observar los eventos, el score y los bloqueos producidos por los laboratorios.
5. Consultar [`evidencias/`](evidencias/) para relacionar cada escenario con sus resultados HTTP, PCAP, exportaciones JSON y capturas.

Los pasos manuales y los resultados esperados se detallan en los README de [Fase 0](fase0-basico/README.md), [Fase 1](fase1-hardening/README.md) y [Fase 2](fase2-hardening/README.md).

## Repetición de la evaluación

Con las fases requeridas en ejecución, las baterías principales pueden lanzarse desde la raíz:

```powershell
python evidencias/scripts/run_evaluation.py functional
python evidencias/scripts/run_evaluation.py metrics --iterations 20
python evidencias/scripts/run_cdn_leeching.py all
python evidencias/scripts/summarize_pcaps.py
python evidencias/scripts/collect_environment.py
python evidencias/scripts/generate_hashes.py
```

La campaña automatizada comprende las comprobaciones funcionales generales, las pruebas específicas de *Key Leak* y *CDN leeching* y las mediciones temporales utilizadas en el capítulo de evaluación. El procedimiento, el inventario y la interpretación de cada artefacto se encuentran en [`evidencias/README.md`](evidencias/README.md).

> [!CAUTION]
> Los JSON y CSV publicados sustituyen los tokens completos por valores redactados. Los PCAP brutos pueden contener credenciales efímeras del laboratorio, por lo que deben manejarse únicamente como evidencias académicas y revisarse antes de reutilizarlos o distribuirlos por otros medios.

## Memoria del TFM

El documento principal es:

```text
Latex/TFM_Plantilla_Final/A0.MiTFM.tex
```

La carpeta contiene los ocho capítulos, los resúmenes en español e inglés, la bibliografía, las figuras y el apéndice dedicado a las evidencias. Puede importarse completa en Overleaf o compilarse con una distribución LaTeX compatible con la plantilla.

## Alcance y limitaciones

- No se extraen, publican ni manipulan claves internas de Widevine.
- La clave incluida en el activo CENC local es una clave creada expresamente para la demostración.
- El flujo Widevine depende de infraestructura pública de pruebas de Shaka/CWIP y no representa una integración comercial.
- Los tokens firmados del prototipo simplifican el formato de JWT y no sustituyen a un proveedor de identidad.
- Redis se ejecuta sin persistencia para que la Fase 2 pueda reiniciarse en un estado conocido.
- Las reglas de riesgo están diseñadas para producir escenarios reproducibles, no para tomar decisiones sobre usuarios reales.
- CORS, tokens, DRM y bloqueos reducen vías de abuso concretas, pero no impiden por sí solos la recaptura o el *restreaming* realizado desde una reproducción legítima.

## Licencia

El contenido del repositorio se distribuye bajo dos licencias diferenciadas:

- El **código fuente**, incluidos los scripts, servicios, Dockerfiles y configuraciones, se distribuye bajo la [GNU General Public License v3.0](LICENSE).
- La **memoria del TFM, los diagramas de elaboración propia y la documentación original del repositorio** se distribuyen bajo [Creative Commons Atribución 4.0 Internacional (CC BY 4.0)](LICENSE-DOCUMENTATION.md).

La licencia Creative Commons no se extiende a logotipos, marcas, contenidos audiovisuales, interfaces, capturas, citas ni otros elementos pertenecientes a terceros. Estos materiales conservan sus derechos y condiciones de uso originales; su aparición en el proyecto no implica que el autor pueda relicenciarlos.
