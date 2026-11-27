-- 010 — Clientes: fichas, resumen de compras y vinculación con las ventas históricas (que tienen el nombre escrito a mano).

create or replace function privado.clave_cliente(t text) returns text
language sql immutable set search_path = '' as $$ select nullif(btrim(regexp_replace(privado.normalizar(coalesce(t, '')), '\s+', ' ', 'g')), '') $$;
grant execute on function privado.clave_cliente(text) to authenticated;

-- Resumen por ficha
create or replace view clientes_resumen with (security_invoker = true) as
select c.*, count(v.id) filter (where v.estado <> 'anulada') as compras,
       coalesce(sum(v.total) filter (where v.estado <> 'anulada'), 0) as total_comprado,
       max(v.fecha) filter (where v.estado <> 'anulada') as ultima_compra
from clientes c left join ventas v on v.cliente_id = c.id
group by c.id;

-- Nombres escritos en ventas que todavía no tienen ficha
create or replace view clientes_sin_ficha with (security_invoker = true) as
select privado.clave_cliente(cliente_texto) as clave, (array_agg(btrim(cliente_texto) order by fecha desc))[1] as nombre,
       count(*) as compras, sum(total) as total_comprado, max(fecha) as ultima_compra
from ventas
where cliente_id is null and estado <> 'anulada' and privado.clave_cliente(cliente_texto) is not null
  and privado.clave_cliente(cliente_texto) not in ('cliente', 'clienta', 'consumidor final', 'cf', 'sin nombre', 'sin dato', '-', '.', 'x')
group by 1;

revoke all on clientes_resumen, clientes_sin_ficha from anon;
grant select on clientes_resumen, clientes_sin_ficha to authenticated;

-- Crear o editar ficha: {"id"?, "nombre", "doc_tipo", "doc_nro", "condicion_iva", "email", "telefono", "lista_precio", "domicilio", "notas", "vincular": "texto"}
-- Cualquiera crea; editar y vincular ventas viejas, solo admin (RLS de clientes y ventas).
create or replace function public.guardar_cliente(p jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_nombre text := btrim(coalesce(p->>'nombre', ''));
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  if length(v_nombre) < 2 then raise exception 'Escribí el nombre del cliente'; end if;
  if v_id is not null and not privado.es_admin() then raise exception 'Solo Joan y Sele pueden editar fichas'; end if;
  if v_id is null then
    insert into clientes (nombre, doc_tipo, doc_nro, condicion_iva, email, telefono, lista_precio, domicilio, notas)
    values (v_nombre, nullif(p->>'doc_tipo', '')::smallint, nullif(regexp_replace(coalesce(p->>'doc_nro', ''), '\D', '', 'g'), ''),
            nullif(p->>'condicion_iva', '')::smallint, nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'telefono'), ''),
            nullif(p->>'lista_precio', ''), nullif(btrim(p->>'domicilio'), ''), nullif(btrim(p->>'notas'), ''))
    returning id into v_id;
  else
    update clientes set nombre = v_nombre, doc_tipo = nullif(p->>'doc_tipo', '')::smallint,
      doc_nro = nullif(regexp_replace(coalesce(p->>'doc_nro', ''), '\D', '', 'g'), ''),
      condicion_iva = nullif(p->>'condicion_iva', '')::smallint, email = nullif(btrim(p->>'email'), ''),
      telefono = nullif(btrim(p->>'telefono'), ''), lista_precio = nullif(p->>'lista_precio', ''),
      domicilio = nullif(btrim(p->>'domicilio'), ''), notas = nullif(btrim(p->>'notas'), '')
    where id = v_id;
  end if;
  if privado.es_admin() and privado.clave_cliente(p->>'vincular') is not null then
    update ventas set cliente_id = v_id
     where cliente_id is null and privado.clave_cliente(cliente_texto) = privado.clave_cliente(p->>'vincular');
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Ya hay un cliente con ese documento';
end $$;
revoke execute on function public.guardar_cliente(jsonb) from public, anon;
grant execute on function public.guardar_cliente(jsonb) to authenticated;
