# CruLox Sistem — V4.5.4

Tíenda digital CruLox. Se conserva la base V4.5.2 y se incorpora exclusivamente la configuración de Firebase y la corrección de registro/vinculación de cuentas.

## Compilación

Ejecutar `npm run build` para generar `dist/index.html`. `build.mjs` comprueba SHA-256 del archivo base y del HTML resultante.

`firebase-config-4.5.4.js` contiene la configuración pública de la aplicación web de Firebase.
`firebase-adapter-4.5.4.js` contiene el adaptador de autenticación y migración de cuentas locales.

## Estado de la integración

Authentication y perfiles de `users/{uid}` están implementados para comprobarse en Firebase real. Las operaciones de catálogo, pedidos, pagos y panel NO han sido validadas ni habilitadas por las reglas actuales de Firestore; no considerar el sistema listo para comercio en producción.

Las cuentas creadas antes de configurar Firebase pueden vincularse desde la sección Cuenta en el mismo navegador en el que se registraron, usando su contraseña. No se transfieren hashes de contraseñas a Firestore.
