-- 009 — Productos y stock: conteo, ingreso de mercadería, precio/costo y avisos que se cierran solos.

-- Cierra avisos abiertos de un producto (lo usan las funciones de abajo, que corren con permisos de quien las llama).
create or replace function privado.resolver_pendientes(p_tipo text, p_variante bigint)
returns void language sql security definer set search_path = public as $$
  update pendientes set resuelto_at = now(), resuelto_por = auth.uid()
   where tipo = p_tipo and variante_id = p_variante and resuelto_at is null and privado.es_usuario()
$$;
revoke execute on function privado.resolver_pendientes(text, bigint) from public, anon;
grant execute on function privado.resolver_pendientes(text, bigint) to authenticated;

-- Al cargarle precio a un producto se cierra su aviso "sin precio".
create or replace function privado.cerrar_sin_precio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.precio > 0 and (old.precio is null or old.precio <= 0) then
    update pendientes set resuelto_at = now(), resuelto_por = auth.uid()
     where tipo = 'sin_precio' and variante_id = new.id and resuelto_at is null;
  end if;
  return new;
end $$;
drop trigger if exists cerrar_sin_precio on variantes;
create trigger cerrar_sin_precio after update of precio on variantes for each row execute function privado.cerrar_sin_precio();

-- Redondeo de precios: el número terminado en 900 más cercano (42.960 -> 42.900; 46.800 -> 46.900).
create or replace function privado.redondear_900(x numeric) returns numeric
language sql immutable set search_path = '' as $$ select greatest(900, round((x - 900) / 1000) * 1000 + 900) $$;
grant execute on function privado.redondear_900(numeric) to authenticated;

-- Conteo: [{"variante_id": 10, "contado": 4}, ...], "nota": "..."
-- Guarda la diferencia como movimiento (conteo_inicial si nunca tuvo, ajuste si ya tenía) y cierra avisos "sin stock".
create or replace function public.contar_stock(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare it jsonb; v_id bigint; v_contado int; v_actual int; v_previos int; v_cambios int := 0;
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_id := (it->>'variante_id')::bigint;
    v_contado := (it->>'contado')::int;
    if v_contado is null or v_contado < 0 then raise exception 'Cantidad inválida'; end if;
    perform pg_advisory_xact_lock(hashtext('stock_' || v_id));
    select coalesce(sum(cantidad), 0), count(*) into v_actual, v_previos from movimientos_stock where variante_id = v_id;
    if v_contado <> v_actual then
      insert into movimientos_stock (variante_id, cantidad, motivo, nota, usuario_id)
      values (v_id, v_contado - v_actual, (case when v_previos = 0 then 'conteo_inicial' else 'ajuste' end)::motivo_stock,
              coalesce(nullif(p->>'nota', ''), 'Conteo: había ' || v_contado), auth.uid());
      v_cambios := v_cambios + 1;
    end if;
    perform privado.resolver_pendientes('sin_stock', v_id);
  end loop;
  return jsonb_build_object('cambios', v_cambios);
end $$;
revoke execute on function public.contar_stock(jsonb) from public, anon;
grant execute on function public.contar_stock(jsonb) to authenticated;

-- Ingreso de mercadería: [{"variante_id": 10, "cantidad": 4, "costo": 19500}], "nota": "Proveedor X"
-- El costo solo lo guarda un admin. Si la regla de la variante es mantener el margen, el precio se recalcula (termina en 900).
create or replace function public.ingresar_mercaderia(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare it jsonb; v_id bigint; v_cant int; v_costo numeric; v_ant numeric; v_var variantes%rowtype; v_precios int := 0;
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    v_id := (it->>'variante_id')::bigint;
    v_cant := (it->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    insert into movimientos_stock (variante_id, cantidad, motivo, nota, usuario_id)
    values (v_id, v_cant, 'ingreso', nullif(p->>'nota', ''), auth.uid());
    perform privado.resolver_pendientes('sin_stock', v_id);

    v_costo := nullif(it->>'costo', '')::numeric;
    if v_costo > 0 and privado.es_admin() then
      select * into v_var from variantes where id = v_id;
      select costo into v_ant from costos_variante where variante_id = v_id;
      insert into costos_variante (variante_id, costo, actualizado_en) values (v_id, v_costo, now())
      on conflict (variante_id) do update set costo = excluded.costo, actualizado_en = now();
      if v_var.regla_si_cambia_costo = 'mantener_margen' and v_ant > 0 and v_var.precio > 0 and v_ant <> v_costo then
        update variantes set precio = privado.redondear_900(v_costo * (v_var.precio / v_ant)) where id = v_id;
        v_precios := v_precios + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('precios_actualizados', v_precios);
end $$;
revoke execute on function public.ingresar_mercaderia(jsonb) from public, anon;
grant execute on function public.ingresar_mercaderia(jsonb) to authenticated;

-- Precio, costo, regla y mínimo de una variante (solo admin):
-- {"variante_id", "precio", "costo", "regla", "stock_minimo", "atributos"}
create or replace function public.guardar_variante(p jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare v_id bigint := (p->>'variante_id')::bigint;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele pueden cambiar precios y costos'; end if;
  update variantes set
    precio = case when p ? 'precio' then nullif(p->>'precio', '')::numeric else precio end,
    regla_si_cambia_costo = coalesce(nullif(p->>'regla', '')::regla_costo, regla_si_cambia_costo),
    stock_minimo = coalesce(nullif(p->>'stock_minimo', '')::int, stock_minimo),
    atributos = coalesce(p->'atributos', atributos)
  where id = v_id;
  if p ? 'costo' then
    if nullif(p->>'costo', '') is null then
      delete from costos_variante where variante_id = v_id;
    else
      insert into costos_variante (variante_id, costo, actualizado_en) values (v_id, (p->>'costo')::numeric, now())
      on conflict (variante_id) do update set costo = excluded.costo, actualizado_en = now();
    end if;
  end if;
end $$;
revoke execute on function public.guardar_variante(jsonb) from public, anon;
grant execute on function public.guardar_variante(jsonb) to authenticated;

-- Nueva variante de un producto existente (solo admin): {"producto_id", "atributos", "precio", "costo"}
create or replace function public.agregar_variante(p jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_prod productos%rowtype; v_n int; v_id bigint;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele pueden agregar variantes'; end if;
  select * into v_prod from productos where id = (p->>'producto_id')::bigint;
  if not found then raise exception 'Producto inexistente'; end if;
  perform pg_advisory_xact_lock(hashtext('variantes_' || v_prod.id));
  select coalesce(max(nullif(split_part(codigo, '-', 2), '')::int), 0) + 1 into v_n
    from variantes where producto_id = v_prod.id and split_part(codigo, '-', 2) ~ '^\d+$';
  insert into variantes (producto_id, codigo, atributos, precio)
  values (v_prod.id, lpad(v_prod.codigo, 6, '0') || '-' || lpad(v_n::text, 2, '0'),
          coalesce(p->'atributos', '{}'), nullif(p->>'precio', '')::numeric)
  returning id into v_id;
  if nullif(p->>'costo', '') is not null then
    insert into costos_variante (variante_id, costo) values (v_id, (p->>'costo')::numeric);
  end if;
  return v_id;
end $$;
revoke execute on function public.agregar_variante(jsonb) from public, anon;
grant execute on function public.agregar_variante(jsonb) to authenticated;

-- Historial de stock de una variante, con quién lo hizo y la venta.
create or replace function public.movimientos_variante(p_variante bigint)
returns table (fecha timestamptz, motivo text, cantidad int, nota text, usuario text, venta text)
language sql stable security definer set search_path = public as $$
  select m.creado_en, m.motivo::text, m.cantidad, m.nota, pf.nombre, v.numero
    from movimientos_stock m
    left join perfiles pf on pf.id = m.usuario_id
    left join venta_items vi on vi.id = m.venta_item_id
    left join ventas v on v.id = vi.venta_id
   where m.variante_id = p_variante and privado.es_usuario()
   order by m.creado_en desc, m.id desc
   limit 50
$$;
revoke execute on function public.movimientos_variante(bigint) from public, anon;
grant execute on function public.movimientos_variante(bigint) to authenticated;
