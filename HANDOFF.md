# Traspaso — estado del sistema de gestión de Cambios Dorados (26/11/2026)

Para retomar en una sesión nueva: abrir este repo (olivettiherrera/cambiosdorados-gestion) y leer este archivo y el README.

## Qué es
Sistema tipo ERP para Cambios Dorados: Next.js 16 en Vercel (https://cambiosdorados-gestion.vercel.app) + Supabase (proyecto `pmgbqflxcozeucwfwsgq`).
**MODO PRUEBA:** las planillas y los Apps Script (carga de ventas, Facturador ARCA) siguen siendo lo real y NO se tocan.

## Usuarios
| Mail | Quién | Rol |
|---|---|---|
| joanolivettiyherrera@gmail.com | Joan ("Cho") | admin |
| selenebechis@gmail.com | Sele | admin |
| cambiosdorados@gmail.com | Showroom (Mica/Sele) | vendedor |

Se crean en Supabase › Authentication › Add user › Create new user (+ Auto Confirm). La tabla `usuarios_permitidos` + trigger les asigna perfil y rol solos.
Gastos, Tablero y Facturación son solo admin (RLS + menú).

## Hecho
- Esquema, RLS, auditoría, migración histórica (4.846 ventas, 5.617 egresos, 513 productos, 390 facturas). Verificado mes a mes contra el tablero.
- Modelo de cobro: `pagos.monto` (se factura) / `comision` (~15% Getnet, MP, Nave) / `neto` (lo que entra). Descuento 15% en efectivo y transferencias.
- Pantallas: Login, **Nueva venta** (RPC `registrar_venta`), **Ventas** (filtros, totales, detalle, anular, CSV), **Caja del día** (`resumen_caja`, `cerrar_caja`).
- **Alta rápida de producto** desde la venta: `buscar_parecidos(texto, precio)` (pg_trgm + unaccent, nombre + precio ±25%) y `crear_producto_rapido` (queda `productos.revisar = true`).
- **Precio a mano y redondeo** (como en la planilla): cada renglón de la venta tiene el precio editable; si el producto no tiene precio sale en rojo "Sin precio: escribilo" y no deja confirmar. Botones para redondear el total para abajo a $100 / $500 / $1.000 o escribirlo a mano; queda como renglón "Redondeo" y en la observación de la venta. `registrar_venta` acepta `items[].precio` y `total_final` (sql/004, aplicado). Los productos sin precio se pueden agregar a la venta (antes el botón quedaba bloqueado).
- **Se vende aunque no haya stock ni precio**, y queda un aviso: tabla `pendientes` (sql/008). `registrar_venta` anota `sin_stock` (el sistema tenía menos de lo vendido) o `sin_precio` (se cobró a mano porque no tenía) vía `privado.anotar_pendiente`; uno abierto por producto y tipo, suma `veces`. Solo admin los ve: bandeja "Para revisar" en Productos y stock (cargar cuántos hay → movimiento `ajuste`; cargar precio → `variantes.precio`) y numerito en el menú.
- Nueva venta con **desplegables** (medio de pago, canal, vendió, compartida con, variantes) en vez de botones.
- SQL en `sql/001`…`008` (todo aplicado en Supabase).

## Pendiente de Joan
- Supabase › Authentication › URL Configuration: Site URL `https://cambiosdorados-gestion.vercel.app`, Redirect `https://cambiosdorados-gestion.vercel.app/**`.
- Activar "Leaked password protection" (Authentication › Email).
- Probar una venta, un producto nuevo y un cierre de caja.

## Próximos pasos
1. **Productos y stock** (ya tiene la bandeja de avisos): listado, editar, variantes, costos/margen (admin), bandeja de "a revisar", conteo inicial de stock. Más adelante: revisión con IA de duplicados del catálogo.
2. **Facturación** en la app (portar la lógica del Facturador: afipsdk, Factura C, CondicionIVAReceptorId, padrón por CUIT), siempre con botón manual.
3. **Clientes**.
4. **Gastos** (+ bot de Telegram) y **Tablero** — solo Joan y Sele.
5. Sincronizar stock con Tiendanube (app de Socio Tecnológico; su plan no tiene API propia).
6. Versión celular, "olvidé mi contraseña", exportación automática a Sheets.

## Reglas
- No pegar contraseñas ni claves en el chat.
- No commitear `salida/` (tiene datos reales de clientes).
- No borrar filas de `auditoria`.
- Lo que se pruebe en la base se deshace (o se hace dentro de begin/rollback).
