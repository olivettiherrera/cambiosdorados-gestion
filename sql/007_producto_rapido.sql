-- 007 — Cargar un producto nuevo desde la venta, avisando antes si ya hay uno parecido.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- "Florero Bélly " -> "florero belly": sin tildes, minúsculas, espacios simples.
create or replace function privado.normalizar(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '\s+', ' ', 'g')
$$;
grant usage on schema privado to authenticated;
grant execute on function privado.normalizar(text) to authenticated;

create index if not exists productos_nombre_trgm on productos
  using gin (privado.normalizar(nombre) extensions.gin_trgm_ops);

-- Productos cargados al vuelo: quedan "a revisar" para completar costo, categoría y variantes.
alter table productos add column if not exists revisar boolean not null default false;
alter table productos add column if not exists creado_por uuid references perfiles (id) on delete set null;

-- Parecidos por nombre (tolera errores, orden de palabras y tildes) y precio cercano.
create or replace function public.buscar_parecidos(p_texto text, p_precio numeric default null)
returns table (variante_id bigint, producto_id bigint, producto text, codigo text, atributos jsonb,
               precio numeric, stock integer, categoria text, puntaje numeric, motivo text)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select privado.normalizar(p_texto) as t),
  candidatos as (
    select c.*,
           greatest(word_similarity(q.t, privado.normalizar(c.producto)),
                    similarity(q.t, privado.normalizar(c.producto))) as sim_nombre,
           case when p_precio > 0 and c.precio > 0
                then greatest(0, 1 - abs(c.precio - p_precio) / p_precio / 0.25) end as sim_precio
    from catalogo c, q
    where c.activo and length(q.t) >= 3
  )
  select variante_id, producto_id, producto, codigo, atributos, precio, stock::integer, categoria,
         round((sim_nombre + coalesce(sim_precio, 0) * 0.3)::numeric, 2) as puntaje,
         concat_ws(' y ',
           case when sim_nombre >= 0.6 then 'nombre muy parecido' when sim_nombre >= 0.35 then 'nombre parecido' end,
           case when sim_precio >= 0.6 then 'precio similar' end) as motivo
  from candidatos
  where sim_nombre >= 0.3 or (sim_nombre >= 0.2 and sim_precio >= 0.6)
  order by puntaje desc
  limit 6
$$;
revoke execute on function public.buscar_parecidos(text, numeric) from public, anon;
grant execute on function public.buscar_parecidos(text, numeric) to authenticated;

-- Crea producto + variante única y devuelve la fila lista para sumar a la venta.
-- Lo puede usar cualquier usuario (Mica incluida); corre con permisos elevados solo para esto.
create or replace function public.crear_producto_rapido(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nombre  text := btrim(regexp_replace(coalesce(p->>'nombre', ''), '\s+', ' ', 'g'));
  v_precio  numeric := (p->>'precio')::numeric;
  v_cod     int;
  v_prod    bigint;
  v_var     bigint;
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  if length(v_nombre) < 3 then raise exception 'Escribí el nombre del producto'; end if;
  if v_precio is null or v_precio <= 0 then raise exception 'Poné el precio de venta'; end if;

  perform pg_advisory_xact_lock(hashtext('codigo_producto'));
  select coalesce(max(codigo::int), 0) + 1 into v_cod from productos where codigo ~ '^\d+$';

  insert into productos (codigo, nombre, categoria_id, revisar, creado_por)
  values (v_cod::text, v_nombre, nullif(p->>'categoria_id', '')::bigint, true, auth.uid())
  returning id into v_prod;

  insert into variantes (producto_id, codigo, precio)
  values (v_prod, lpad(v_cod::text, 6, '0') || '-01', round(v_precio, 2))
  returning id into v_var;

  return (select to_jsonb(c) from catalogo c where c.variante_id = v_var);
end $$;
revoke execute on function public.crear_producto_rapido(jsonb) from public, anon;
grant execute on function public.crear_producto_rapido(jsonb) to authenticated;
