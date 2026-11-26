-- 004 — Registrar una venta completa en una sola transacción.
-- La llama la pantalla "Nueva venta". Corre con los permisos del usuario (RLS aplica).
--
-- Entrada (jsonb):
-- {
--   "canal_id": 1, "cliente_texto": "Marta", "cliente_email": null, "observacion": null,
--   "vendedor_ids": [1, 2],
--   "medio_pago_id": 3,
--   "items": [ {"variante_id": 10, "cantidad": 2, "precio": 25000 (opcional, precio a mano)}, ... ],
--   "total_final": 54700 (opcional, total redondeado a mano)
-- }
-- Devuelve: {"venta_id", "numero", "total_lista", "descuento", "total", "comision", "neto"}

create or replace function public.registrar_venta(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hoy        date := (now() at time zone 'America/Argentina/Cordoba')::date;
  v_numero     text;
  v_seq        int;
  v_venta_id   bigint;
  v_medio      medios_pago%rowtype;
  v_lista      numeric(12,2) := 0;
  v_desc_pct   numeric;
  v_total      numeric(12,2);
  v_comision   numeric(12,2);
  it           jsonb;
  v_var        record;
  v_cant       int;
  v_item_id    bigint;
  v_factor     numeric;
  v_precio     numeric;
  v_ajuste     numeric := 0;
begin
  if not privado.es_usuario() then
    raise exception 'Usuario sin permiso para vender';
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  select * into v_medio from medios_pago where id = (p->>'medio_pago_id')::bigint and activo;
  if not found then raise exception 'Medio de pago inválido'; end if;

  -- Total de lista: precio de la base, o el escrito a mano si el producto no tiene / se cambió
  for it in select * from jsonb_array_elements(p->'items') loop
    select v.id, v.precio, pr.nombre, v.atributos into v_var
      from variantes v join productos pr on pr.id = v.producto_id
     where v.id = (it->>'variante_id')::bigint and v.activo;
    if not found then raise exception 'Producto inactivo (variante %)', it->>'variante_id'; end if;
    v_precio := coalesce(nullif(it->>'precio', '')::numeric, v_var.precio);
    if v_precio is null or v_precio <= 0 then
      raise exception 'Falta el precio de "%"', v_var.nombre;
    end if;
    v_cant := greatest(coalesce((it->>'cantidad')::int, 1), 1);
    v_lista := v_lista + v_precio * v_cant;
  end loop;

  v_desc_pct := coalesce(v_medio.descuento_pct, 0);
  v_total    := round(v_lista * (1 - v_desc_pct / 100), 2);
  -- Total redondeado a mano (ej: 54.715 -> 54.700)
  if nullif(p->>'total_final', '') is not null then
    v_ajuste := (p->>'total_final')::numeric - v_total;
    if (p->>'total_final')::numeric <= 0 then raise exception 'El total tiene que ser mayor a cero'; end if;
    v_total := round((p->>'total_final')::numeric, 2);
  end if;

  v_comision := round(v_total * coalesce(v_medio.comision_pct, 0) / 100, 2);
  v_factor   := case when v_lista > 0 then v_total / v_lista else 1 end;

  -- Número del día: AAAAMMDD-NNNN (con bloqueo para que dos ventas simultáneas no repitan)
  perform pg_advisory_xact_lock(hashtext('ventas_' || v_hoy::text));
  select coalesce(max(split_part(numero, '-', 2)::int), 0) + 1 into v_seq
    from ventas where numero like to_char(v_hoy, 'YYYYMMDD') || '-%';
  v_numero := to_char(v_hoy, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  insert into ventas (numero, fecha, canal_id, cliente_texto, total_lista, total, origen, observacion, creado_por)
  values (v_numero, now(), (p->>'canal_id')::bigint, nullif(p->>'cliente_texto', ''), v_lista, v_total,
          'sistema',
          nullif(concat_ws(' · ', nullif(p->>'observacion', ''),
                 case when v_ajuste <> 0 then 'Redondeo ' || case when v_ajuste > 0 then '+' else '' end || round(v_ajuste)::text end), ''),
          auth.uid())
  returning id into v_venta_id;

  insert into venta_vendedores (venta_id, vendedor_id)
  select v_venta_id, x::bigint from jsonb_array_elements_text(coalesce(p->'vendedor_ids', '[]')) x
  on conflict do nothing;

  for it in select * from jsonb_array_elements(p->'items') loop
    select v.id, v.precio, pr.nombre, v.atributos into v_var
      from variantes v join productos pr on pr.id = v.producto_id
     where v.id = (it->>'variante_id')::bigint;
    v_cant := greatest(coalesce((it->>'cantidad')::int, 1), 1);
    v_precio := coalesce(nullif(it->>'precio', '')::numeric, v_var.precio);
    insert into venta_items (venta_id, variante_id, descripcion, cantidad, precio_lista, precio_final)
    values (v_venta_id, v_var.id,
            v_var.nombre || coalesce(' · ' || nullif((select string_agg(value, ' · ') from jsonb_each_text(v_var.atributos)), ''), ''),
            v_cant, v_precio * v_cant, round(v_precio * v_cant * v_factor, 2))
    returning id into v_item_id;

    insert into movimientos_stock (variante_id, cantidad, motivo, venta_item_id, usuario_id)
    values (v_var.id, -v_cant, 'venta', v_item_id, auth.uid());
  end loop;

  insert into pagos (venta_id, medio_pago_id, monto, comision)
  values (v_venta_id, v_medio.id, v_total, v_comision);

  return jsonb_build_object('venta_id', v_venta_id, 'numero', v_numero, 'total_lista', v_lista,
                            'descuento', v_lista - v_total, 'total', v_total,
                            'comision', v_comision, 'neto', v_total - v_comision);
end $$;

revoke execute on function public.registrar_venta(jsonb) from public, anon;
grant execute on function public.registrar_venta(jsonb) to authenticated;
