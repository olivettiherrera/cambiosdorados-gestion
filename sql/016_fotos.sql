-- 016 — Fotos de productos. Se guardan en Supabase Storage (bucket "fotos", lectura pública como en la web)
-- y el link va en productos.foto_url (foto general) o variantes.foto_url (foto de un color/medida en particular).

alter table productos add column if not exists foto_url text;
alter table variantes add column if not exists foto_url text;

-- Catálogo con la foto que corresponde (la de la variante, si no la del producto)
create or replace view catalogo with (security_invoker = true) as
 SELECT p.id AS producto_id, p.codigo AS producto_codigo, p.nombre AS producto, c.nombre AS categoria,
    p.tiendanube_product_id IS NOT NULL AS en_web, v.id AS variante_id, v.codigo, v.atributos, v.precio,
    v.stock_minimo, v.activo, COALESCE(s.stock, 0) AS stock,
    coalesce(v.foto_url, p.foto_url) AS foto_url
   FROM variantes v
     JOIN productos p ON p.id = v.producto_id
     LEFT JOIN categorias c ON c.id = p.categoria_id
     LEFT JOIN stock_variantes s ON s.variante_id = v.id
  WHERE p.activo;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Subir: cualquier usuario del sistema (Mica puede sacarle foto desde el local). Borrar: solo admin.
drop policy if exists fotos_subir on storage.objects;
drop policy if exists fotos_borrar on storage.objects;
create policy fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and privado.es_usuario());
create policy fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'fotos' and privado.es_admin());

-- Poner o sacar la foto (para la variante sola o para todo el producto)
create or replace function public.poner_foto(p_variante bigint, p_url text, p_solo_variante boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not privado.es_usuario() then raise exception 'Usuario sin permiso'; end if;
  if p_url is not null and p_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/fotos/' then
    raise exception 'Foto inválida';
  end if;
  if p_solo_variante then
    update variantes set foto_url = p_url where id = p_variante;
  else
    update productos set foto_url = p_url where id = (select producto_id from variantes where id = p_variante);
    update variantes set foto_url = null where id = p_variante;
  end if;
end $$;
revoke execute on function public.poner_foto(bigint, text, boolean) from public, anon;
grant execute on function public.poner_foto(bigint, text, boolean) to authenticated;
