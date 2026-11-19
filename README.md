# CruLox Sistem V4.5.13

Cambio limitado a la cobertura geográfica mostrada en tarjetas, también las que agrupan variantes (por ejemplo, diamantes), y detalles de productos; además, nueva cabecera del menú lateral.

Los países no se presuponen ni se inventan. El mapa `COVERAGE_BY_PRODUCT` de `availability-regions-4.5.12.js` está inicialmente vacío y se completará con los países oficiales que indique la administración. Permite asignar países por identificador o nombre exacto del producto; si la información está ausente, se muestra «Países por definir». También respeta `availableCountries` si un catálogo sincronizado lo proporciona.

La cabecera lateral reutiliza el logotipo oficial con una presentación visual mejorada. No se modificaron pagos, pedidos, precios, inventario, cuentas, Firebase ni el panel administrativo.

El archivo publicado se genera desde la última base estable y se verifica mediante SHA-256 para impedir cambios inesperados. La configuración de países en el código se publica mediante GitHub y Vercel; el editor administrativo de la tienda permanece deshabilitado por seguridad y no debe presentarse como herramienta de edición operativa.
