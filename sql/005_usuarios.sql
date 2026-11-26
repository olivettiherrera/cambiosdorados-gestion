-- 005 — Usuarios: borrar un usuario no se bloquea y los nuevos reciben su perfil solos.

-- Si se borra un usuario, lo que hizo queda en la historia sin autor.
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tabla, a.attname as columna
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = 'public.perfiles'::regclass
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.perfiles (id) on delete set null',
                   r.tabla, r.conname, r.columna);
  end loop;
end $$;

-- Mails habilitados y su rol: al crear el usuario en Supabase, el perfil se crea solo.
create table usuarios_permitidos (
  email   text primary key,
  nombre  text not null,
  rol     rol_usuario not null
);
alter table usuarios_permitidos enable row level security;
create policy admin_todo on usuarios_permitidos for all using (privado.es_admin()) with check (privado.es_admin());
insert into usuarios_permitidos values
  ('joanolivettiyherrera@gmail.com', 'Joan', 'admin'),
  ('selenebechis@gmail.com', 'Sele', 'admin'),
  ('cambiosdorados@gmail.com', 'Showroom', 'vendedor');

create or replace function privado.asignar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
declare u usuarios_permitidos%rowtype;
begin
  select * into u from usuarios_permitidos where lower(email) = lower(new.email);
  if found then
    insert into perfiles (id, nombre, rol) values (new.id, u.nombre, u.rol)
    on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol;
    update vendedores set perfil_id = new.id where nombre = u.nombre;
  end if;
  return new;
end $$;
revoke execute on function privado.asignar_perfil() from public, anon, authenticated;

create trigger asignar_perfil after insert on auth.users
for each row execute function privado.asignar_perfil();
