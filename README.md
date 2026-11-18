# CruLox Sistem V4.5.6

Ventana de cuenta rediseñada y dos funciones nuevas: foto de perfil (hasta 100 MB de archivo original, optimización automática para almacenamiento en el perfil) y eliminación voluntaria de la cuenta con contraseña y confirmación. Solo se modifica el adaptador de cuenta.

Ejecutar `npm run build` produce `dist/index.html` y comprueba la integridad de la versión previa.

**Despliegue condicionado:** para fotos sincronizadas y eliminación de cuentas remotas deben instalarse primero las reglas específicas de Firestore (`CRULOX_Firestore_Reglas_Perfil_V4_5_6.rules` entregadas por separado). El navegador no puede modificar estas reglas; no confundir una compilación correcta con una operación verificada en Firebase real.

Los pedidos preexistentes no se eliminan al borrar la cuenta: pueden conservarse para operaciones o registros legales.
