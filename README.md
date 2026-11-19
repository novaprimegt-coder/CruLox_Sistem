# CruLox Sistem V4.5.16

Corrección localizada de separación entre las instrucciones bancarias y notas adicionales del segundo paso del checkout, sin modificar campos, bancos, pagos, carrito, pedidos ni cuentas.

Optimización puntual del asistente: su `ResizeObserver` vigila el indicador de pasos, con actualización agrupada en `requestAnimationFrame`, en lugar de recalcular por cambios de tamaño del formulario. En móvil se elimina un desenfoque costoso del pie fijo y no se reservan capas permanentes de composición para paneles ocultos.

Se conserva y verifica byte a byte la V4.5.15 como base estable. Las pruebas de interfaces y flujo son locales; no se garantiza comportamiento sin fallos en todos los dispositivos ni transacciones remotas con Firebase.
