-- =====================================================================
-- 002_cargar_migracion.sql — carga los CSV de migrar.py en las tablas.
-- Correr con psql desde la carpeta de los CSV:
--   cd salida && psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../sql/002_cargar_migracion.sql
-- Es repetible: borra lo migrado (origen <> 'sistema') y lo vuelve a cargar.
-- =====================================================================
begin;

create schema if not exists mig;
drop table if exists mig.categorias, mig.productos, mig.variantes, mig.ventas, mig.venta_items,
  mig.venta_vendedores, mig.pagos, mig.medios_pago, mig.canales, mig.vendedores, mig.facturas,
  mig.egresos, mig.tipos_gasto, mig.cierres_caja;

create table mig.categorias (ruta text, nombre text, padre_ruta text);
create table mig.productos (codigo text, nombre text, categoria text, tiendanube_handle text, en_web boolean);
create table mig.variantes (producto_codigo text, codigo text, atributos jsonb, precio numeric, costo numeric, stock_minimo int);
create table mig.ventas (numero text, fecha date, canal text, cliente_texto text, cliente_email text, total_lista numeric, total numeric, origen text, detalle_texto text, observacion text);
create table mig.venta_items (venta_numero text, producto_codigo text, descripcion text, cantidad int, precio_lista numeric, precio_final numeric);
create table mig.venta_vendedores (venta_numero text, vendedor text);
create table mig.pagos (venta_numero text, medio_pago text, monto numeric, comision numeric, fecha date);
create table mig.medios_pago (nombre text, descuento_pct numeric, comision_pct numeric, usos int);
create table mig.canales (nombre text, usos int);
create table mig.vendedores (nombre text, ventas int, activo boolean);
create table mig.facturas (venta_numero text, emisor text, punto_venta int, numero int, fecha date, importe numeric, cae text, cae_vto date, receptor_doc_tipo smallint, receptor_doc_nro text, receptor_cond_iva smallint, receptor_nombre text, receptor_domicilio text, pdf_url text, origen text);
create table mig.egresos (fecha date, proveedor text, tipo_gasto text, importe numeric, cuenta text, conciliado boolean, observaciones text, origen text);
create table mig.tipos_gasto (nombre text, grupo text);
create table mig.cierres_caja (fecha date, origen_planilla text, cierre_del_dia text, cant_ventas int, cant_items int, total_lista numeric, total_final numeric, detalle text);

\copy mig.categorias from 'categorias.csv' csv header
\copy mig.productos from 'productos.csv' csv header
\copy mig.variantes from 'variantes.csv' csv header
\copy mig.ventas from 'ventas.csv' csv header
\copy mig.venta_items from 'venta_items.csv' csv header
\copy mig.venta_vendedores from 'venta_vendedores.csv' csv header
\copy mig.pagos from 'pagos.csv' csv header
\copy mig.medios_pago from 'medios_pago.csv' csv header
\copy mig.canales from 'canales.csv' csv header
\copy mig.vendedores from 'vendedores.csv' csv header
\copy mig.facturas from 'facturas.csv' csv header
\copy mig.egresos from 'egresos.csv' csv header
\copy mig.tipos_gasto from 'tipos_gasto.csv' csv header
\copy mig.cierres_caja from 'cierres_caja.csv' csv header

-- ---------- limpiar lo migrado antes (repetible) ----------
delete from facturas where creado_por is null;
delete from pagos      where venta_id in (select id from ventas where origen <> 'sistema');
delete from venta_items where venta_id in (select id from ventas where origen <> 'sistema');
delete from venta_vendedores where venta_id in (select id from ventas where origen <> 'sistema');
delete from ventas where origen <> 'sistema';
delete from egresos where origen in ('migracion', 'telegram') and creado_por is null;
delete from cierres_caja where origen = 'migracion';

-- ---------- catálogos ----------
insert into canales (nombre) select nombre from mig.canales on conflict (nombre) do nothing;
insert into medios_pago (nombre, descuento_pct, comision_pct) select nombre, descuento_pct, comision_pct from mig.medios_pago
  on conflict (nombre) do update set descuento_pct = excluded.descuento_pct, comision_pct = excluded.comision_pct;
insert into vendedores (nombre, activo) select nombre, activo from mig.vendedores on conflict (nombre) do nothing;
insert into tipos_gasto (nombre, grupo) select nombre, grupo::grupo_gasto from mig.tipos_gasto
  on conflict (nombre) do update set grupo = excluded.grupo;
insert into cuentas (nombre) select distinct cuenta from mig.egresos where cuenta <> '' on conflict (nombre) do nothing;
insert into proveedores (nombre) select distinct proveedor from mig.egresos where proveedor <> '' on conflict (nombre) do nothing;

-- categorías (padres antes que hijos: por cantidad de niveles)
insert into categorias (nombre, padre_id)
select c.nombre, null from mig.categorias c where c.padre_ruta is null
  and not exists (select 1 from categorias x where x.nombre = c.nombre and x.padre_id is null);
insert into categorias (nombre, padre_id)
select c.nombre, p.id from mig.categorias c
join categorias p on p.nombre = c.padre_ruta and p.padre_id is null
where c.padre_ruta is not null
  and not exists (select 1 from categorias x where x.nombre = c.nombre and x.padre_id = p.id);

-- productos y variantes
insert into productos (codigo, nombre, categoria_id)
select m.codigo, m.nombre,
  (select k.id from categorias k left join categorias kp on kp.id = k.padre_id
    where coalesce(kp.nombre || ' > ', '') || k.nombre = m.categoria limit 1)
from mig.productos m
on conflict (codigo) do update set nombre = excluded.nombre, categoria_id = excluded.categoria_id;
insert into variantes (producto_id, codigo, atributos, precio, costo, stock_minimo)
select p.id, m.codigo, coalesce(m.atributos, '{}'), m.precio, m.costo, coalesce(m.stock_minimo, 0)
from mig.variantes m join productos p on p.codigo = m.producto_codigo
on conflict (codigo) do update set precio = excluded.precio;

-- ---------- ventas ----------
insert into ventas (numero, fecha, canal_id, cliente_texto, total_lista, total, estado, origen, detalle_texto, observacion)
select m.numero, (m.fecha::timestamp at time zone 'America/Argentina/Cordoba'),
       c.id, nullif(m.cliente_texto, ''), coalesce(m.total_lista, 0), coalesce(m.total, 0),
       'confirmada', m.origen::origen_dato, nullif(m.detalle_texto, ''), nullif(m.observacion, '')
from mig.ventas m left join canales c on c.nombre = m.canal;

insert into venta_vendedores (venta_id, vendedor_id)
select distinct v.id, d.id from mig.venta_vendedores m
join ventas v on v.numero = m.venta_numero join vendedores d on d.nombre = m.vendedor;

insert into venta_items (venta_id, variante_id, descripcion, cantidad, precio_lista, precio_final)
select v.id, va.id, m.descripcion, m.cantidad, m.precio_lista, m.precio_final
from mig.venta_items m join ventas v on v.numero = m.venta_numero
left join variantes va on va.codigo = nullif(m.producto_codigo, '') || '-01';

insert into pagos (venta_id, medio_pago_id, monto, comision, fecha)
select v.id, mp.id, coalesce(m.monto, 0), coalesce(m.comision, 0), (m.fecha::timestamp at time zone 'America/Argentina/Cordoba')
from mig.pagos m join ventas v on v.numero = m.venta_numero join medios_pago mp on mp.nombre = m.medio_pago;

-- ---------- facturas ----------
-- Emisores: completar CUIT y punto de venta reales antes de correr en producción.
insert into emisores (nombre, cuit, punto_venta) values
  ('Joan', 'CUIT-JOAN', 2), ('Sele', 'CUIT-SELE', 8)
on conflict (nombre) do nothing;

insert into facturas (venta_id, emisor_id, tipo, punto_venta, numero, fecha, importe, cae, cae_vto,
  receptor_doc_tipo, receptor_doc_nro, receptor_cond_iva, receptor_nombre, receptor_domicilio, pdf_url, estado, mensaje)
select v.id, e.id, 11, m.punto_venta, m.numero, coalesce(m.fecha, v.fecha::date), coalesce(m.importe, 0),
       nullif(m.cae, ''), m.cae_vto, coalesce(m.receptor_doc_tipo, 99), coalesce(nullif(m.receptor_doc_nro, ''), '0'),
       coalesce(m.receptor_cond_iva, 5), nullif(m.receptor_nombre, ''), nullif(m.receptor_domicilio, ''),
       nullif(m.pdf_url, ''), 'ok', 'Migrada desde ' || m.origen
from mig.facturas m join emisores e on e.nombre = m.emisor
left join ventas v on v.numero = nullif(m.venta_numero, '')
on conflict (emisor_id, punto_venta, tipo, numero) do nothing;

-- ---------- gastos ----------
insert into egresos (fecha, proveedor_id, proveedor_texto, tipo_gasto_id, importe, cuenta_id, conciliado, observaciones, origen)
select m.fecha, p.id, nullif(m.proveedor, ''), t.id, m.importe, c.id, coalesce(m.conciliado, false),
       nullif(m.observaciones, ''), m.origen::origen_dato
from mig.egresos m
left join proveedores p on p.nombre = m.proveedor
left join tipos_gasto t on t.nombre = m.tipo_gasto
left join cuentas c on c.nombre = m.cuenta
where m.fecha is not null;

-- ---------- cierres de caja ----------
insert into cierres_caja (fecha, detalle, nota, origen)
select m.fecha,
       jsonb_build_object('cant_ventas', m.cant_ventas, 'cant_items', m.cant_items,
                          'total_lista', m.total_lista, 'total_final', m.total_final, 'detalle', m.detalle,
                          'cierre_del_dia', m.cierre_del_dia),
       'Migrado (' || m.origen_planilla || ')', 'migracion'
from mig.cierres_caja m;

commit;
