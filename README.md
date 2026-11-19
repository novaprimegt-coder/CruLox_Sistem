# CruLox Sistem V4.5.14

## Corrección puntual de desaparición de productos

- Cuando la lista local de productos está vacía por pérdida o error de sincronización, se recuperan los 10 productos y variantes del catálogo base aprobado, respetando sus nombres, precios e imágenes.
- Cuando Firestore entrega una lista de productos vacía o documentos incompletos, la tienda conserva el último catálogo local válido. Si la colección contiene productos completos, mantiene la sincronización existente.
- Nunca se reemplaza una lista local no vacía al iniciar el sistema.
- Se conserva el diseño de disponibilidad por país y la cabecera lateral V4.5.13, y no se modifican compras, pagos, pedidos, usuarios, ni el panel administrativo.

La corrección no recupera automáticamente productos personalizados que ya se hubieran perdido de cualquier almacenamiento. La integración central de catálogo sigue dependiendo de permisos y datos efectivos de Firestore. El HTML final se verifica por SHA-256 antes del despliegue.
