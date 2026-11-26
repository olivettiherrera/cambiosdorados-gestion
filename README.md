# Cambios Dorados · Sistema de gestión — Etapa 1 (base de datos y migración)

## Qué hay acá

| Carpeta / archivo | Qué es |
| --- | --- |
| `sql/001_esquema.sql` | Todas las tablas, vistas y permisos. Se corre una vez en Supabase (SQL Editor). |
| `sql/002_cargar_migracion.sql` | Carga los CSV de `salida/` en las tablas. Se puede correr de nuevo: borra lo migrado y lo vuelve a cargar. |
| `sql/000_stub_supabase_local.sql` | Solo para probar en un Postgres local. En Supabase **no** se corre. |
| `migracion/migrar.py` | Lee las planillas exportadas y genera los CSV limpios. |
| `migracion/leer.py` | Lector de las planillas exportadas. |
| `salida/*.csv` | Datos ya limpios, listos para cargar. |
| `salida/reporte_migracion.json` | Qué se migró, qué se corrigió y qué no se pudo mapear. |

## Permisos

- **admin** (Joan, Sele): todo.
- **vendedor** (Mica): vende, cierra caja, ve ventas, stock y precios.
  No ve costos ni márgenes (usa la vista `catalogo`), ni gastos, ni facturas.

Probado en un Postgres local: Mica ve 0 gastos, 0 facturas y 0 filas de `variantes` (donde está el costo), y los 513 productos por `catalogo`.

## Verificación contra el tablero actual

- **Gastos:** los 62 meses (oct 2021 a nov 2026) dan igual que la hoja `_EGRESOS` del tablero.
- **Ventas:** lo que entró (`pagos.neto`) da igual que `_VENTAS` en 59 de 62 meses. Los 3 que no
  (feb, ago y nov 2026) tienen ventas cargadas en Remitos que nunca se copiaron a Compilado: el sistema
  nuevo las tiene; el tablero no.
- En abr, may y jul 2026 hay ventas que en Compilado figuran dos veces (pagadas con dos medios). En el sistema es una sola venta: por eso la cantidad de ventas puede dar una menos.

## Lo facturable y lo que entra

Cada pago guarda tres números:
- `monto`: lo que pagó el cliente. Es lo que se factura.
- `comision`: lo que retienen Getnet, Mercado Pago o Nave (hoy alrededor del 15%).
- `neto`: lo que entra a la cuenta (`monto - comision`). Es lo que usa el tablero.

En la migración, la comisión sale de la diferencia entre el total del remito (o "Precio Unit") y el
"Monto Recibido" de Compilado, solo para medios con comisión. En efectivo y transferencia esa diferencia
es el 15% de descuento al cliente, así que no se cuenta como comisión.
Ejemplo octubre 2026: facturable $15.662.858 · comisiones $358.393 · entró $15.304.465.

## Correcciones que hace la migración

- Medios de pago unificados ("Santander (GetNet)" y "Getnet (Santander)" son uno; "efectivo" y "Efectivo" también).
- Vendedores: "Cho" = Joan. Las ventas compartidas ("Sele/Mica") quedan asignadas a las dos.
- Canal tomado de la columna Observación ("venta showroom" → Showroom, etc.).
- Fechas sin año ("27/10") completadas con la columna AÑO.
- Montos mal escritos ("18,216,90") corregidos; "600usd" y "100usd" quedan sin monto para revisar a mano.
- 21 gastos del bot de Telegram que no estaban en Egresos se suman.
- Facturas: 100 del Facturador (con CAE y PDF) + 290 anteriores tomadas de Compilado (sin CAE).

## Para cargar en Supabase

1. Crear el proyecto en Supabase.
2. SQL Editor → pegar y correr `sql/001_esquema.sql`.
3. Completar en `sql/002_cargar_migracion.sql` el CUIT y punto de venta reales de Joan y Sele (buscar `CUIT-JOAN`).
4. Desde esta carpeta: `cd salida && psql "<cadena de conexión de Supabase>" -v ON_ERROR_STOP=1 -f ../sql/002_cargar_migracion.sql`
5. Crear los usuarios de Joan, Sele y Mica en Authentication y sus filas en `perfiles` con el rol.

## Para volver a migrar con datos nuevos

Exportar de nuevo las cuatro planillas, ponerlas donde indica `migracion/leer.py` y correr:

```
python3 migracion/migrar.py salida
```
