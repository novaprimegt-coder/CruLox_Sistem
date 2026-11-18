# CruLox Sistem V4.5.9

Actualización limitada al diseño y flujo de compra, información de cuentas existentes, carga previa obligatoria de comprobante y restauración de fotografía en el encabezado.

La evidencia del pedido se guarda en almacenamiento del navegador porque Firestore restringe los pedidos y Firebase Storage no está habilitado. **Esto no garantiza disponibilidad del comprobante en otros dispositivos ni en el panel remoto.** No se han añadido cuentas bancarias inventadas: solo Banrural y Banco Azteca usan las cuentas que ya estaban publicadas en el detalle de pedidos. Para otros métodos se bloquea el avance hasta configurar detalles oficiales.

El build conserva el HTML aprobado y reemplaza exclusivamente los módulos identificados. Las operaciones comerciales no deben declararse sincronizadas hasta disponer de backend y reglas seguras.
