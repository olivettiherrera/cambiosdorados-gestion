-- 012 — Tablero (solo Joan y Sele): números de gestión entre dos fechas, en un solo llamado.
create or replace function public.tablero(p_desde date, p_hasta date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele'; end if;
  with v as (
    select l.* from ventas_listado l where l.dia between p_desde and p_hasta and l.estado <> 'anulada'
  ), e as (
    select * from egresos_listado where fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'ventas', (select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(total), 0), 'neto', coalesce(sum(neto), 0),
                 'comision', coalesce(sum(comision), 0), 'descuento', coalesce(sum(total_lista - total), 0),
                 'sin_facturar', count(*) filter (where not facturada), 'sin_facturar_monto', coalesce(sum(total) filter (where not facturada), 0)) from v),
    'gastos', (select jsonb_object_agg(coalesce(grupo::text, 'sin_tipo'), monto) from (select grupo, sum(importe) monto from e group by grupo) g),
    'por_mes', (select coalesce(jsonb_agg(x order by x.mes), '[]') from (
        select m.mes, coalesce(vv.total, 0) total, coalesce(vv.neto, 0) neto, coalesce(vv.cantidad, 0) cantidad,
               coalesce(ee.gastos, 0) gastos, coalesce(ee.retiros, 0) retiros, coalesce(ee.mercaderia, 0) mercaderia
        from (select distinct to_char(d, 'YYYY-MM') mes from generate_series(p_desde, p_hasta, interval '1 day') d) m
        left join (select to_char(dia, 'YYYY-MM') mes, sum(total) total, sum(neto) neto, count(*) cantidad from v group by 1) vv using (mes)
        left join (select to_char(fecha, 'YYYY-MM') mes, sum(importe) filter (where grupo is distinct from 'retiros') gastos,
                          sum(importe) filter (where grupo = 'retiros') retiros, sum(importe) filter (where grupo = 'mercaderia') mercaderia
                   from e group by 1) ee using (mes)) x),
    'por_canal', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (select coalesce(canal, 'Sin dato') nombre, count(*) cantidad, sum(total) total from v group by 1) x),
    'por_medio', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select mp.nombre, count(distinct pg.venta_id) cantidad, sum(pg.monto) total, sum(pg.comision) comision
        from pagos pg join medios_pago mp on mp.id = pg.medio_pago_id join v on v.id = pg.venta_id group by 1) x),
    'por_vendedor', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select ve.nombre, count(*) cantidad, sum(v.total / greatest(n.n, 1)) total
        from v join venta_vendedores vv on vv.venta_id = v.id join vendedores ve on ve.id = vv.vendedor_id
        join lateral (select count(*) n from venta_vendedores z where z.venta_id = v.id) n on true group by 1) x),
    'top_productos', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select vi.descripcion nombre, sum(vi.cantidad) unidades, sum(vi.precio_final) total
        from venta_items vi join v on v.id = vi.venta_id group by 1 order by 3 desc limit 10) x),
    'top_gastos', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select coalesce(tipo, 'Sin tipo') nombre, grupo, sum(importe) total from e group by 1, 2 order by 3 desc limit 10) x)
  ) into r;
  return r;
end $$;
revoke execute on function public.tablero(date, date) from public, anon;
grant execute on function public.tablero(date, date) to authenticated;
