-- 006 — Listado de ventas, caja del día y anulación.

-- Una fila por venta, con medios, vendedores y renglones ya resumidos.
-- security_invoker: cada uno ve lo que su RLS le deja (facturas solo admin).
create or replace view ventas_listado with (security_invoker = true) as
select v.id, v.numero, v.fecha,
       (v.fecha at time zone 'America/Argentina/Cordoba')::date as dia,
       v.canal_id, c.nombre as canal,
       coalesce(cl.nombre, v.cliente_texto) as cliente,
       v.total_lista, v.total, v.estado, v.origen, v.observacion,
       coalesce(p.comision, 0) as comision,
       v.total - coalesce(p.comision, 0) as neto,
       p.medios, p.medio_ids,
       vv.vendedores,
       coalesce(i.resumen, v.detalle_texto) as productos,
       coalesce(i.unidades, 0) as unidades,
       exists (select 1 from facturas f where f.venta_id = v.id and f.estado = 'ok') as facturada
from ventas v
left join canales c on c.id = v.canal_id
left join clientes cl on cl.id = v.cliente_id
left join lateral (
  select sum(pg.comision) as comision,
         string_agg(distinct mp.nombre, ' + ') as medios,
         array_agg(distinct mp.id) as medio_ids
  from pagos pg join medios_pago mp on mp.id = pg.medio_pago_id
  where pg.venta_id = v.id
) p on true
left join lateral (
  select string_agg(ve.nombre, ', ' order by ve.nombre) as vendedores
  from venta_vendedores x join vendedores ve on ve.id = x.vendedor_id
  where x.venta_id = v.id
) vv on true
left join lateral (
  select string_agg(case when it.cantidad > 1 then it.cantidad || '× ' else '' end || it.descripcion, ' · ' order by it.id) as resumen,
         sum(it.cantidad) as unidades
  from venta_items it where it.venta_id = v.id
) i on true;

grant select on ventas_listado to authenticated;
revoke all on ventas_listado from anon;

-- Resumen de un día por medio de pago (sin anuladas) + efectivo con que arrancó la caja.
create or replace function public.resumen_caja(p_dia date)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with pagos_dia as (
    select mp.id, mp.nombre, count(distinct v.id) as ventas,
           sum(pg.monto) as monto, sum(pg.comision) as comision, sum(pg.neto) as neto
    from ventas v
    join pagos pg on pg.venta_id = v.id
    join medios_pago mp on mp.id = pg.medio_pago_id
    where (v.fecha at time zone 'America/Argentina/Cordoba')::date = p_dia
      and v.estado <> 'anulada'
    group by mp.id, mp.nombre
  )
  select jsonb_build_object(
    'dia', p_dia,
    'medios', coalesce((select jsonb_agg(to_jsonb(pagos_dia) order by monto desc) from pagos_dia), '[]'),
    'efectivo_inicio', coalesce((
        select efectivo_queda from cierres_caja
        where fecha < p_dia and efectivo_queda is not null
        order by fecha desc, id desc limit 1), 0),
    'cierre', (select to_jsonb(c) from cierres_caja c
               where c.fecha = p_dia and c.origen = 'sistema'
               order by id desc limit 1)
  )
$$;
revoke execute on function public.resumen_caja(date) from public, anon;
grant execute on function public.resumen_caja(date) to authenticated;

-- Cerrar la caja: el sistema calcula lo esperado, la persona carga lo contado.
-- Entrada: {"dia": "2026-11-26", "efectivo_contado": 120000, "salidas": 5000,
--           "efectivo_queda": 20000, "nota": "..."}
create or replace function public.cerrar_caja(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_dia      date := coalesce((p->>'dia')::date, (now() at time zone 'America/Argentina/Cordoba')::date);
  r          jsonb;
  v_efvo     numeric := 0;
  v_esperado numeric;
  v_id       bigint;
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  if (p->>'efectivo_contado') is null then raise exception 'Falta el efectivo contado'; end if;
  if exists (select 1 from cierres_caja where fecha = v_dia and origen = 'sistema') then
    raise exception 'La caja del % ya está cerrada', to_char(v_dia, 'DD/MM');
  end if;

  r := resumen_caja(v_dia);
  select coalesce(sum((m->>'neto')::numeric), 0) into v_efvo
    from jsonb_array_elements(r->'medios') m where m->>'nombre' = 'Efectivo';

  v_esperado := (r->>'efectivo_inicio')::numeric + v_efvo - coalesce((p->>'salidas')::numeric, 0);

  insert into cierres_caja (fecha, efectivo_inicio, efectivo_contado, efectivo_esperado, efectivo_queda,
                            detalle, nota, origen, cerrado_por)
  values (v_dia, (r->>'efectivo_inicio')::numeric, (p->>'efectivo_contado')::numeric, v_esperado,
          coalesce((p->>'efectivo_queda')::numeric, (p->>'efectivo_contado')::numeric),
          jsonb_build_object('medios', r->'medios', 'salidas', coalesce((p->>'salidas')::numeric, 0)),
          nullif(p->>'nota', ''), 'sistema', auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'esperado', v_esperado,
                            'diferencia', (p->>'efectivo_contado')::numeric - v_esperado);
end $$;
revoke execute on function public.cerrar_caja(jsonb) from public, anon;
grant execute on function public.cerrar_caja(jsonb) to authenticated;

-- Anular una venta (solo Joan y Sele): queda en la historia y el stock vuelve.
create or replace function public.anular_venta(p_venta_id bigint, p_motivo text)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not privado.es_admin() then raise exception 'Solo Joan o Sele pueden anular ventas'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribí el motivo de la anulación'; end if;

  update ventas
     set estado = 'anulada',
         observacion = concat_ws(' · ', observacion, 'ANULADA: ' || trim(p_motivo))
   where id = p_venta_id and estado <> 'anulada';
  if not found then raise exception 'La venta no existe o ya estaba anulada'; end if;

  insert into movimientos_stock (variante_id, cantidad, motivo, venta_item_id, usuario_id, nota)
  select m.variante_id, -m.cantidad, 'devolucion', m.venta_item_id, auth.uid(), 'Anulación de venta'
  from movimientos_stock m
  join venta_items it on it.id = m.venta_item_id
  where it.venta_id = p_venta_id and m.motivo = 'venta';
end $$;
revoke execute on function public.anular_venta(bigint, text) from public, anon;
grant execute on function public.anular_venta(bigint, text) to authenticated;
