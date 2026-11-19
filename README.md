# CruLox Sistem V4.5.15 — estabilidad y cuentas

Cambio limitado a reducir parpadeos y re-renderizados redundantes en el catálogo y sincronización Firebase, e impedir formularios de inicio/registro duplicados.

- Se retira el renderizado adicional al iniciar el módulo de regiones.
- Firestore solo provoca actualización visual cuando cambia el contenido realmente.
- Se evita reconstruir la ventana de cuenta mientras el cliente rellena el formulario.
- Se elimina un bucle de repintado cuando el perfil no tiene fotografía: la inicial solo se actualiza si cambia.
- Durante registro e inicio de sesión, se bloquean dobles envíos, se indica estado de envío y se preserva el perfil antes de restaurar la sesión.
- Se evita sobrescribir repetidamente un perfil remoto ya creado durante la restauración de sesión.

No se modificaron catálogo, pagos, productos, pedidos, apariencia ni reglas de Firestore. La vinculación comercial real todavía debe verificarse con cuentas de prueba en el proyecto remoto. La compilación valida el HTML íntegro con SHA-256.
