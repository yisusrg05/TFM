# DASH CENC con clave conocida

Este directorio esta reservado para una prueba controlada de contenido CENC cifrado con una clave de laboratorio conocida.

Generacion desde la raiz del repositorio:

```powershell
.\fase0-basico\tools\package-cenc-known-key.ps1
```

Valores de laboratorio:

- KID: `1e5d4f9f3a2b4c7d8e9f001122334455`
- KEY: `00112233445566778899aabbccddeeff`

La demo asociada esta en `http://localhost:3003` y reproduce usando Shaka ClearKey sin llamar al servidor de licencias.
