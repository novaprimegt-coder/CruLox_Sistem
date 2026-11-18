# CruLox Sistem — V4.5.5

Actualización localizada de los textos visibles del formulario de sincronización de perfil. Se elimina el nombre del proveedor de infraestructura de los mensajes y botones de la cuenta sin alterar el proveedor, autenticación, permisos, datos ni los flujos existentes.

Ejecutar `npm run build` para obtener `dist/index.html`. El proceso verifica integridad de la versión base y del HTML final con SHA-256.

La configuración del servicio y el código del adaptador se mantienen técnicamente iguales salvo los textos orientados a usuarios. Las reglas de Firestore siguen siendo una capa de seguridad imprescindible; no se sustituyen por ocultar el nombre del proveedor.

Sincronización real de catálogo, pedidos y panel administrativo sigue pendiente de reglas y pruebas de integración.
