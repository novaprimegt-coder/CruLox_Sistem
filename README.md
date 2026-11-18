# CruLox Sistem — V4.5.2

Sistema de tienda CruLox basado en la versión HTML aprobada.

## Construcción

`npm run build` genera `dist/index.html` a partir de `source/00.bin` a `source/17.bin`. La integridad se valida con SHA-256 para garantizar que el HTML resultante es idéntico a la versión aprobada.

El repositorio usa fragmentos binarios únicamente para el transporte del archivo grande: **el sitio publicado sirve un único `index.html` original**, sin modificar sus funciones. No se requieren dependencias de npm.

## Estado

El adaptador Firebase existe en el código, pero la configuración sigue vacía; en ausencia de Firebase, los datos siguen almacenándose localmente. No debe tratarse como una operación multiusuario de producción hasta implementar la autenticación y reglas de seguridad necesarias.

**Archivo base**: `CRULOX_Tienda_BUSCADOR_PREMIUM_V4_5_2.html` (SHA-256: `339ae3ac66ddd4444d1ab3ccd437d41043f4b4e3d3a0ea91042da689824da2bc`).
