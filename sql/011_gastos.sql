-- 011 — Gastos (solo Joan y Sele): alta/edición con proveedor por nombre, y vista para listar.

create or replace view egresos_listado with (security_invoker = true) as
select e.id, e.fecha, coalesce(pr.nombre, e.proveedor_texto) as proveedor, e.tipo_gasto_id, t.nombre as tipo, t.grupo,
       e.cuenta_id, c.nombre as cuenta, e.importe, e.observaciones, e.confirmado, e.conciliado, e.origen
from egresos e
left join proveedores pr on pr.id = e.proveedor_id
left join tipos_gasto t on t.id = e.tipo_gasto_id
left join cuentas c on c.id = e.cuenta_id;
revoke all on egresos_listado from anon;
grant select on egresos_listado to authenticated;

-- {"id"?, "fecha", "proveedor", "tipo_gasto_id", "cuenta_id", "importe", "observaciones"}
create or replace function public.guardar_egreso(p jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_prov bigint; v_nombre text := btrim(coalesce(p->>'proveedor', ''));
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele cargan gastos'; end if;
  if (p->>'importe')::numeric is null or (p->>'importe')::numeric <= 0 then raise exception 'Poné el importe'; end if;
  if v_nombre <> '' then
    select id into v_prov from proveedores where privado.normalizar(nombre) = privado.normalizar(v_nombre) limit 1;
    if v_prov is null then insert into proveedores (nombre) values (v_nombre) returning id into v_prov; end if;
  end if;
  if v_id is null then
    insert into egresos (fecha, proveedor_id, proveedor_texto, tipo_gasto_id, importe, cuenta_id, observaciones, origen, creado_por)
    values ((p->>'fecha')::date, v_prov, nullif(v_nombre, ''), nullif(p->>'tipo_gasto_id', '')::bigint, (p->>'importe')::numeric,
            nullif(p->>'cuenta_id', '')::bigint, nullif(btrim(p->>'observaciones'), ''), 'sistema', auth.uid())
    returning id into v_id;
  else
    update egresos set fecha = (p->>'fecha')::date, proveedor_id = v_prov, proveedor_texto = nullif(v_nombre, ''),
      tipo_gasto_id = nullif(p->>'tipo_gasto_id', '')::bigint, importe = (p->>'importe')::numeric,
      cuenta_id = nullif(p->>'cuenta_id', '')::bigint, observaciones = nullif(btrim(p->>'observaciones'), ''), confirmado = true
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.guardar_egreso(jsonb) from public, anon;
grant execute on function public.guardar_egreso(jsonb) to authenticated;
