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
- **Productos y stock** (`app/(app)/productos`): listado agrupado por producto con variantes, buscador, categoría y filtros (sin stock, debajo del mínimo, sin precio, sin costo, a revisar), exportar CSV. Ficha lateral: costo × margen = precio (redondeado a 900), regla si cambia el costo, mínimo, datos de la variante, ajustar stock, historial de movimientos, variantes del producto, agregar variante, nombre/categoría/"a revisar". **Modo conteo** (escribir cuántos hay al lado de cada uno → `contar_stock`) e **Ingresar mercadería** (`ingresar_mercaderia`; el costo solo lo graba admin y con "mantener margen" recalcula el precio). Funciones en sql/009. Contar o ingresar cierra los avisos "sin stock"; cargar precio cierra los "sin precio" (trigger).
- Hoy los 513 productos tienen una sola variante cada uno (los colores vienen como productos separados, ej. "Almohadón Tejido - Verde"); agruparlos es el paso de revisión de duplicados.
- **Clientes** (`app/(app)/clientes`, sql/010): fichas (DNI/CUIT, condición IVA, lista de precios, contacto), compras por cliente, y "Nombres de ventas viejas" (vista `clientes_sin_ficha`, agrupa `ventas.cliente_texto`): un admin crea la ficha y `guardar_cliente` vincula esas ventas. En Nueva venta el campo Cliente sugiere las fichas y manda `cliente_id`.
- **Gastos** (solo admin, sql/011): por mes, tarjetas por grupo (sin contar retiros en el total), filtros, alta/edición/borrado (`guardar_egreso` crea el proveedor si no existe). Para gastos nuevos no se ofrece "Cuenta Joan (extra)" (CHO EXTRA no va al sistema).
- **Tablero** (solo admin, sql/012 `tablero(desde, hasta)`): vendido, entró, gastos, resultado, retiros, ticket promedio; gráfico por mes (entró vs gastos), por canal, medio, vendedora, gastos que más pesan, productos más vendidos, ventas sin facturar.
- **Facturación** (solo admin, sql/013 + `lib/arca.ts` + `app/api/facturar`): ventas por facturar con selección (máx. 40 por tanda), emisor Joan PV 2 / Sele PV 8, confirmación y emisión de Factura C vía Afip SDK; receptor según la ficha del cliente (CUIT+condición, DNI, o consumidor final; controla dígito del CUIT y el tope de CF anónimo). Antiduplicados: `reservar_factura` deja la factura en "verificar" antes de llamar a ARCA (índice único por venta); si la respuesta se pierde consulta `FECompConsultar`; si no puede confirmar queda "Verificar en ARCA" y corta la tanda. "Ya la hice" marca una venta facturada a mano. **Por defecto en modo prueba** (homologación, CUIT de prueba de Afip SDK, no guarda nada). No se probó contra ARCA real.
  - Para facturar de verdad, en Vercel › Settings › Environment Variables: `AFIPSDK_TOKEN`, `ARCA_AMBIENTE=prod`, `ARCA_CERT_<CUIT>` y `ARCA_KEY_<CUIT>` de Joan y de Sele (los mismos que tiene el Facturador en Propiedades del script; PEM, los saltos de línea pueden ir como `\n`). Opcional `ARCA_LIMITE_CF`. Primero probar en modo prueba con el token solo.
  - Falta: consulta de padrón por CUIT (requiere autorizar "Constancia de Inscripción" en el Administrador de Relaciones de ARCA).
- UI: Nueva venta con la venta a lo ancho y el cobro fijo a la derecha; Ventas, Caja y Productos reacomodados (filtros que se acomodan, ficha de producto al costado; en pantallas angostas pasa a panel encima).
- **Olvidé mi contraseña** en el login: manda el mail de Supabase con link a `/auth/confirmar` → `/nueva-clave`. Necesita que en Supabase › Authentication › URL Configuration esté la Redirect URL `https://cambiosdorados-gestion.vercel.app/**`.
- **Unir variantes** (Productos › Unir variantes, sql/014 `agrupar_variantes`): sugiere grupos de productos sueltos por el nombre antes de " - " (105 grupos, 345 productos), con los datos (Color, Medida, Aroma…) pre-completados y editables. Los productos con nombre idéntico (ej. "Pie de cama/ manta - Arena" ×3) perdieron un dato en la migración: hay que completarlo antes de unir. No borra nada: mueve las variantes al producto de código más bajo y deja los otros inactivos.
- **Celular**: menú desplegable arriba, pantallas en una columna, campos de 16px (sin zoom en iPhone).
- **Comprobante PDF** (`/facturacion/[id]`, sql/015): Factura C imprimible con CAE y QR de ARCA ("Guardar como PDF" del navegador). Los datos del emisor (razón social, domicilio, IIBB, inicio de actividades) se cargan en Facturación › Datos para el comprobante.
- **Fotos de productos** (sql/016): bucket público `fotos` de Supabase Storage; `productos.foto_url` (general) y `variantes.foto_url` (solo esa variante); `catalogo.foto_url` devuelve la que corresponda. Se suben desde la ficha (en el celular abre la cámara; se achican a 1200 px JPEG) con `poner_foto`; suben todos, quitar solo admin. Miniaturas en Productos (filtro "Sin foto") y en Nueva venta. Idea: traer las fotos de Tiendanube emparejando por nombre.
- SQL en `sql/001`…`016` (todo aplicado en Supabase).

## Pendiente de Joan
- Supabase › Authentication › URL Configuration: Site URL `https://cambiosdorados-gestion.vercel.app`, Redirect `https://cambiosdorados-gestion.vercel.app/**`.
- Activar "Leaked password protection" (Authentication › Email).
- Probar una venta, un producto nuevo y un cierre de caja.

## Próximos pasos
1. Revisar con Joan cómo se ven las pantallas (no se pudieron ver con usuario logueado) y ajustar al look de los mockups (https://claude.ai/artifact/6hGXHmjrcNCjon4Mpmce58).
2. Facturación real: cargar las variables en Vercel, probar en homologación, después una factura real chica. Padrón por CUIT.
3. Unir las variantes sugeridas (lo hace Joan desde Productos; los de nombre repetido necesitan el dato que falta).
4. Bot de Telegram para gastos (necesita el token del bot; cargan `confirmado = false`; Gastos ya muestra "revisar").
5. Sincronizar stock con Tiendanube (app de Socio Tecnológico; su plan no tiene API propia).
6. Exportación automática a Sheets (necesita una cuenta de servicio de Google).

## Reglas
- No pegar contraseñas ni claves en el chat.
- No commitear `salida/` (tiene datos reales de clientes).
- No borrar filas de `auditoria`.
- Lo que se pruebe en la base se deshace (o se hace dentro de begin/rollback).
