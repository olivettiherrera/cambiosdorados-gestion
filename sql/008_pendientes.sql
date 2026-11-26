-- 008 — Pendientes: avisos que deja una venta para que Joan/Sele completen después.
--   sin_stock:  se vendió algo que en el sistema tenía stock 0 (o menos) -> cargar/contar el stock.
--   sin_precio: se vendió con precio escrito a mano porque el producto no tenía -> cargar el precio.
-- Uno abierto por producto y tipo: si se vuelve a vender, suma "veces" en vez de repetir el aviso.

create table if not exists pendientes (
  id            bigint generated always as identity primary key,
  tipo          text not null check (tipo in ('sin_stock', 'sin_precio')),
  variante_id   bigint not null references variantes (id) on delete cascade,
  venta_id      bigint references ventas (id) on delete set null,   -- la última venta que lo generó
  detalle       text,
  veces         integer not null default 1,
  creado_at     timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  creado_por    uuid references perfiles (id) on delete set null,
  resuelto_at   timestamptz,
  resuelto_por  uuid references perfiles (id) on delete set null
);
create unique index if not exists pendientes_abierto on pendientes (tipo, variante_id) where resuelto_at is null;

alter table pendientes enable row level security;
drop policy if exists crear on pendientes;
drop policy if exists actualizar_venta on pendientes;
drop policy if exists admin_todo on pendientes;
-- Los genera registrar_venta a través de privado.anotar_pendiente (security definer); solo admin los ve y los resuelve.
create policy admin_todo on pendientes for all using (privado.es_admin()) with check (privado.es_admin());
revoke all on pendientes from anon;
grant select, update on pendientes to authenticated;

-- Para registrar_venta (que corre con los permisos de quien vende): sumar o abrir un aviso.
create or replace function privado.anotar_pendiente(p_tipo text, p_variante bigint, p_venta bigint, p_detalle text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.es_usuario() then return; end if;
  insert into pendientes (tipo, variante_id, venta_id, detalle, creado_por)
  values (p_tipo, p_variante, p_venta, p_detalle, auth.uid())
  on conflict (tipo, variante_id) where resuelto_at is null
  do update set veces = pendientes.veces + 1, venta_id = excluded.venta_id,
                detalle = excluded.detalle, actualizado_at = now();
end $$;
revoke execute on function privado.anotar_pendiente(text, bigint, bigint, text) from public, anon;
grant execute on function privado.anotar_pendiente(text, bigint, bigint, text) to authenticated;
