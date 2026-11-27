-- 013 — Facturación desde la app (siempre con botón, nunca automática).
-- Antes de llamar a ARCA se "reserva" la factura (estado verificar). Así una venta nunca se factura dos veces,
-- aunque dos personas aprieten a la vez o la respuesta de ARCA se pierda.

create unique index if not exists facturas_una_por_venta on facturas (venta_id)
  where venta_id is not null and estado in ('ok', 'verificar');

-- Ventas que faltan facturar, con lo que hace falta para la factura
create or replace view ventas_por_facturar with (security_invoker = true) as
select v.id, v.numero, v.fecha, (v.fecha at time zone 'America/Argentina/Cordoba')::date as dia, v.total,
       coalesce(cl.nombre, v.cliente_texto) as cliente, cl.doc_tipo, cl.doc_nro, cl.condicion_iva,
       l.medios, l.vendedores, l.productos
from ventas v
join ventas_listado l on l.id = v.id
left join clientes cl on cl.id = v.cliente_id
where v.estado <> 'anulada' and v.total > 0
  and not exists (select 1 from facturas f where f.venta_id = v.id and f.estado in ('ok', 'verificar'));

create or replace view facturas_listado with (security_invoker = true) as
select f.*, e.nombre as emisor, v.numero as venta_numero, coalesce(cl.nombre, v.cliente_texto) as cliente
from facturas f join emisores e on e.id = f.emisor_id
left join ventas v on v.id = f.venta_id left join clientes cl on cl.id = v.cliente_id;

revoke all on ventas_por_facturar, facturas_listado from anon;
grant select on ventas_por_facturar, facturas_listado to authenticated;

-- Reserva: crea la factura en "verificar" con el número que se va a pedir. Falla si la venta ya tiene factura.
create or replace function public.reservar_factura(p_venta bigint, p_emisor bigint, p_numero int, p_doc_tipo smallint, p_doc_nro text, p_cond smallint, p_nombre text)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_id bigint; v_venta ventas%rowtype; v_em emisores%rowtype;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele facturan'; end if;
  select * into v_venta from ventas where id = p_venta for update;
  if not found or v_venta.estado = 'anulada' then raise exception 'La venta no existe o está anulada'; end if;
  select * into v_em from emisores where id = p_emisor;
  insert into facturas (venta_id, emisor_id, tipo, punto_venta, numero, fecha, importe, receptor_doc_tipo, receptor_doc_nro,
                        receptor_cond_iva, receptor_nombre, estado, mensaje, creado_por)
  values (p_venta, p_emisor, 11, v_em.punto_venta, p_numero, (now() at time zone 'America/Argentina/Cordoba')::date, v_venta.total,
          p_doc_tipo, p_doc_nro, p_cond, p_nombre, 'verificar', 'Enviando a ARCA…', auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Esa venta ya tiene factura (o se está facturando ahora)';
end $$;
revoke execute on function public.reservar_factura(bigint, bigint, int, smallint, text, smallint, text) from public, anon;
grant execute on function public.reservar_factura(bigint, bigint, int, smallint, text, smallint, text) to authenticated;

-- Marcar una venta como facturada a mano (hecha en la web de ARCA)
create or replace function public.factura_manual(p jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_id bigint; v_em emisores%rowtype; v_venta ventas%rowtype;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele facturan'; end if;
  select * into v_venta from ventas where id = (p->>'venta_id')::bigint;
  select * into v_em from emisores where id = (p->>'emisor_id')::bigint;
  if v_em.id is null then raise exception 'Elegí quién facturó'; end if;
  insert into facturas (venta_id, emisor_id, tipo, punto_venta, numero, fecha, importe, estado, mensaje, creado_por)
  values (v_venta.id, v_em.id, 11, v_em.punto_venta, nullif(p->>'numero', '')::int,
          coalesce(nullif(p->>'fecha', '')::date, (now() at time zone 'America/Argentina/Cordoba')::date),
          coalesce(nullif(p->>'importe', '')::numeric, v_venta.total), 'ok', 'Cargada a mano', auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Esa venta ya tiene factura, o ese número ya está cargado';
end $$;
revoke execute on function public.factura_manual(jsonb) from public, anon;
grant execute on function public.factura_manual(jsonb) to authenticated;
