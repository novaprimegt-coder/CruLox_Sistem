# CruLox Sistem V4.5.8

Base V4.5.7 íntegra. Único cambio funcional: checkout en asistente animado de 3 pasos secuenciales obligatorios.

## Flujo de compra

1. Datos de activación (validación obligatoria).
2. Pago y entrega (validación obligatoria).
3. Revisión final y envío por el manejador anterior, sin modificar pedidos, carrito ni precios.

Los controles no permiten saltar pasos. Se conserva la información reutilizable por cuenta en el mismo navegador: identificadores de juego, correos de activación y método de pago escogido. No se guardan contraseñas, credenciales financieras, referencia de pago ni notas específicas de cada pedido.

El navegador respeta la preferencia de movimiento reducido. Las animaciones y el estilo son una implementación HTML/CSS/JS autocontenida del Stepper suministrado, evitando migrar el sistema a React.

Para compilar: `npm run build`. El script comprueba SHA-256 del HTML reconstruido. No implica sincronización de pedidos con Firestore ni cambios en su base de datos.
