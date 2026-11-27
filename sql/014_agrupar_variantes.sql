-- 014 — Unir productos sueltos como variantes de un solo producto (ej. "Florero Tana - Negro" y "- Blanco").
-- No se borra nada: las variantes se mueven al producto que queda y los otros productos quedan inactivos.
-- Ventas, stock, costos y códigos de variante se mantienen.

-- {"nombre": "Florero Tana", "variantes": [{"variante_id": 1, "atributos": {"Color": "Negro"}}, ...]}
create or replace function public.agrupar_variantes(p jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_dest bigint; v_nombre text := btrim(coalesce(p->>'nombre', '')); it jsonb; v_prods bigint[]; v_n int;
begin
  if not privado.es_admin() then raise exception 'Solo Joan y Sele pueden unir productos'; end if;
  if length(v_nombre) < 3 then raise exception 'Escribí el nombre del producto'; end if;
  if jsonb_array_length(coalesce(p->'variantes', '[]')) < 2 then raise exception 'Elegí al menos dos'; end if;

  select array_agg(distinct v.producto_id) into v_prods
    from variantes v where v.id in (select (x->>'variante_id')::bigint from jsonb_array_elements(p->'variantes') x);
  -- El producto que queda: el de código más bajo
  select id into v_dest from productos where id = any(v_prods) order by codigo limit 1;

  -- Dos variantes no pueden quedar iguales
  select count(*) - count(distinct x->'atributos') into v_n from jsonb_array_elements(p->'variantes') x;
  if v_n > 0 then raise exception 'Hay variantes con los mismos datos: completá qué las diferencia (ej. medida)'; end if;
  if exists (select 1 from jsonb_array_elements(p->'variantes') x where x->'atributos' = '{}'::jsonb) then
    raise exception 'Cada variante tiene que tener al menos un dato (color, medida…)';
  end if;

  for it in select * from jsonb_array_elements(p->'variantes') loop
    update variantes set producto_id = v_dest, atributos = it->'atributos' where id = (it->>'variante_id')::bigint;
  end loop;
  update productos set nombre = v_nombre, revisar = false where id = v_dest;
  update productos set activo = false where id = any(v_prods) and id <> v_dest
    and not exists (select 1 from variantes where producto_id = productos.id);
  return v_dest;
end $$;
revoke execute on function public.agrupar_variantes(jsonb) from public, anon;
grant execute on function public.agrupar_variantes(jsonb) to authenticated;
