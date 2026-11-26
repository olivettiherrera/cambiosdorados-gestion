-- 003 — Aplicado en Supabase el 26/11/2026 después del esquema inicial.
-- El costo pasa a su propia tabla (solo admin) para que la vista "catalogo" no necesite
-- permisos elevados, y las funciones de permisos salen del esquema público.

create table costos_variante (
  variante_id    bigint primary key references variantes (id) on delete cascade,
  costo          numeric(12,2),
  actualizado_en timestamptz not null default now()
);
insert into costos_variante (variante_id, costo) select id, costo from variantes where costo is not null;
alter table costos_variante enable row level security;
create policy admin_todo on costos_variante for all using (es_admin()) with check (es_admin());
create trigger aud_costos after insert or update or delete on costos_variante for each row execute function registrar_auditoria();

drop view variantes_con_margen;
drop view catalogo;
alter table variantes drop column costo;
create policy leer on variantes for select using (es_usuario());

create view catalogo with (security_invoker = true) as
select p.id as producto_id, p.codigo as producto_codigo, p.nombre as producto,
       c.nombre as categoria, p.tiendanube_product_id is not null as en_web,
       v.id as variante_id, v.codigo, v.atributos, v.precio, v.stock_minimo, v.activo,
       coalesce(s.stock, 0) as stock
from variantes v
join productos p on p.id = v.producto_id
left join categorias c on c.id = p.categoria_id
left join stock_variantes s on s.variante_id = v.id
where p.activo;

create view variantes_con_margen with (security_invoker = true) as
select v.*, k.costo, case when k.costo > 0 then round(v.precio / k.costo, 2) end as margen
from variantes v join costos_variante k on k.variante_id = v.id;

revoke all on catalogo, variantes_con_margen, stock_variantes from anon;
revoke execute on function es_admin(), es_usuario(), registrar_auditoria() from public, anon;
revoke execute on function registrar_auditoria() from authenticated;
grant execute on function es_admin(), es_usuario() to authenticated;

create schema if not exists privado;
grant usage on schema privado to authenticated;
alter function public.es_admin() set schema privado;
alter function public.es_usuario() set schema privado;
alter function public.registrar_auditoria() set schema privado;
