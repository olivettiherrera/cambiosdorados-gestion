-- =====================================================================
-- Cambios Dorados · Sistema de gestión
-- 001_esquema.sql — tablas, vistas, permisos (Supabase / Postgres 15+)
--
-- Roles:
--   admin    = Joan y Sele: ven y editan todo (gastos, costos, tablero, facturas)
--   vendedor = Mica: vende, cierra caja, ve stock y precios, NO ve costos,
--              márgenes, gastos ni facturación
-- =====================================================================

-- ---------- Tipos ----------------------------------------------------
create type rol_usuario      as enum ('admin', 'vendedor');
create type motivo_stock     as enum ('conteo_inicial', 'ingreso', 'venta', 'venta_web', 'ajuste', 'devolucion');
create type estado_venta     as enum ('confirmada', 'sena', 'anulada');
create type origen_dato      as enum ('sistema', 'remitos', 'compilado', 'tiendanube', 'telegram', 'caja', 'migracion');
create type grupo_gasto      as enum ('mercaderia', 'fijos', 'variables', 'mejoras', 'retiros');
create type estado_factura   as enum ('ok', 'error', 'verificar');
create type regla_costo      as enum ('mantener_margen', 'mantener_precio');

-- ---------- Personas -------------------------------------------------
create table perfiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  rol         rol_usuario not null default 'vendedor',
  activo      boolean not null default true
);

-- Vendedores incluye gente que ya no usa el sistema (ej. Mali), para la historia.
create table vendedores (
  id          bigint generated always as identity primary key,
  nombre      text not null unique,
  perfil_id   uuid references perfiles (id),
  activo      boolean not null default true
);

-- ---------- Catálogo -------------------------------------------------
create table categorias (
  id              bigint generated always as identity primary key,
  nombre          text not null,
  padre_id        bigint references categorias (id),
  tiendanube_id   bigint unique
);

create table proveedores (
  id      bigint generated always as identity primary key,
  nombre  text not null unique
);

create table productos (
  id                     bigint generated always as identity primary key,
  codigo                 text not null unique,           -- 000412
  nombre                 text not null,
  descripcion            text,
  categoria_id           bigint references categorias (id),
  proveedor_id           bigint references proveedores (id),
  tiendanube_product_id  bigint unique,                  -- null = solo en el local
  activo                 boolean not null default true,
  creado_en              timestamptz not null default now()
);

create table variantes (
  id                     bigint generated always as identity primary key,
  producto_id            bigint not null references productos (id) on delete cascade,
  codigo                 text not null unique,           -- 000412-02
  atributos              jsonb not null default '{}',    -- {"Color":"Negro","Medidas":"27cm x 13cm"}
  precio                 numeric(12,2),
  costo                  numeric(12,2),                  -- solo admin
  regla_si_cambia_costo  regla_costo not null default 'mantener_margen',
  stock_minimo           integer not null default 0,
  codigo_barras          text,
  tiendanube_variant_id  bigint unique,
  activo                 boolean not null default true
);
create index on variantes (producto_id);

-- El stock NUNCA se escribe a mano: es la suma de movimientos.
create table movimientos_stock (
  id            bigint generated always as identity primary key,
  variante_id   bigint not null references variantes (id),
  cantidad      integer not null,                        -- + entra, - sale
  motivo        motivo_stock not null,
  venta_item_id bigint,                                  -- se completa en ventas
  nota          text,
  usuario_id    uuid references perfiles (id),
  creado_en     timestamptz not null default now()
);
create index on movimientos_stock (variante_id);

-- ---------- Clientes y cobro -----------------------------------------
create table clientes (
  id             bigint generated always as identity primary key,
  nombre         text not null,
  doc_tipo       smallint,          -- 80 CUIT · 96 DNI · null
  doc_nro        text,
  condicion_iva  smallint,          -- 5 CF · 1 RI · 6 Monotributo · 4 Exento · 15 No alcanzado
  email          text,
  telefono       text,
  lista_precio   text,              -- null = minorista · 'arquitectos' · 'mayorista'
  domicilio      text,              -- traído del padrón de ARCA
  notas          text,
  creado_en      timestamptz not null default now(),
  unique (doc_tipo, doc_nro)
);

create table canales (
  id      bigint generated always as identity primary key,
  nombre  text not null unique      -- Showroom, WhatsApp, Instagram, Web, Arquitectos, Estilismo, Asesoría...
);

create table medios_pago (
  id              bigint generated always as identity primary key,
  nombre          text not null unique,
  descuento_pct   numeric(5,2) not null default 0,   -- 15 en efectivo y transferencia
  comision_pct    numeric(5,2) not null default 0,   -- lo que retiene Getnet / Mercado Pago (aprox. 15%)
  activo          boolean not null default true
);

-- ---------- Ventas ---------------------------------------------------
create table ventas (
  id               bigint generated always as identity primary key,
  numero           text not null unique,               -- 20261126-0007 · web-1184 · H-000123 (histórico)
  fecha            timestamptz not null,
  canal_id         bigint references canales (id),
  cliente_id       bigint references clientes (id),
  cliente_texto    text,                               -- nombre libre (histórico o sin ficha)
  total_lista      numeric(12,2) not null,
  total            numeric(12,2) not null,             -- lo cobrado
  estado           estado_venta not null default 'confirmada',
  origen           origen_dato not null default 'sistema',
  detalle_texto    text,                               -- histórico sin renglones
  observacion      text,
  creado_por       uuid references perfiles (id),
  creado_en        timestamptz not null default now()
);
create index on ventas (fecha);

create table venta_vendedores (
  venta_id     bigint not null references ventas (id) on delete cascade,
  vendedor_id  bigint not null references vendedores (id),
  primary key (venta_id, vendedor_id)
);

create table venta_items (
  id            bigint generated always as identity primary key,
  venta_id      bigint not null references ventas (id) on delete cascade,
  variante_id   bigint references variantes (id),       -- null en histórico no vinculado
  descripcion   text not null,
  cantidad      integer not null default 1,
  precio_lista  numeric(12,2) not null,                 -- total del renglón
  precio_final  numeric(12,2) not null
);
create index on venta_items (venta_id);
alter table movimientos_stock
  add constraint movimientos_stock_venta_item_fk foreign key (venta_item_id) references venta_items (id);

create table pagos (
  id              bigint generated always as identity primary key,
  venta_id        bigint not null references ventas (id) on delete cascade,
  medio_pago_id   bigint not null references medios_pago (id),
  monto           numeric(12,2) not null,                  -- lo que pagó el cliente (se factura esto)
  comision        numeric(12,2) not null default 0,        -- lo que retiene Getnet / Mercado Pago
  neto            numeric(12,2) generated always as (monto - comision) stored,  -- lo que entra a la cuenta
  fecha           timestamptz not null default now()      -- una seña y su saldo son dos pagos
);
create index on pagos (venta_id);

-- ---------- Facturación ----------------------------------------------
create table emisores (
  id           bigint generated always as identity primary key,
  nombre       text not null unique,       -- Joan, Sele
  cuit         text not null unique,
  punto_venta  integer not null
);

create table facturas (
  id                  bigint generated always as identity primary key,
  venta_id            bigint references ventas (id),
  emisor_id           bigint not null references emisores (id),
  tipo                smallint not null default 11,            -- Factura C
  punto_venta         integer not null,
  numero              integer,
  fecha               date not null,
  importe             numeric(12,2) not null,
  cae                 text,
  cae_vto             date,
  receptor_doc_tipo   smallint not null default 99,
  receptor_doc_nro    text not null default '0',
  receptor_cond_iva   smallint not null default 5,
  receptor_nombre     text,
  receptor_domicilio  text,
  pdf_url             text,
  estado              estado_factura not null default 'ok',
  mensaje             text,
  creado_por          uuid references perfiles (id),
  creado_en           timestamptz not null default now(),
  unique (emisor_id, punto_venta, tipo, numero)
);

-- ---------- Gastos (solo admin) --------------------------------------
create table cuentas (
  id      bigint generated always as identity primary key,
  nombre  text not null unique             -- Santander (Sele), Galicia, Efectivo, Mercado Pago, Cuenta Joan
);

create table tipos_gasto (
  id      bigint generated always as identity primary key,
  nombre  text not null unique,
  grupo   grupo_gasto not null
);

create table egresos (
  id              bigint generated always as identity primary key,
  fecha           date not null,
  proveedor_id    bigint references proveedores (id),
  proveedor_texto text,
  tipo_gasto_id   bigint references tipos_gasto (id),
  importe         numeric(14,2) not null,
  cuenta_id       bigint references cuentas (id),
  conciliado      boolean not null default false,
  confirmado      boolean not null default true,     -- false = lo cargó el bot y falta revisar
  observaciones   text,
  origen          origen_dato not null default 'sistema',
  creado_por      uuid references perfiles (id),
  creado_en       timestamptz not null default now()
);
create index on egresos (fecha);

-- ---------- Caja -----------------------------------------------------
create table cierres_caja (
  id                bigint generated always as identity primary key,
  fecha             date not null,
  efectivo_inicio   numeric(12,2) not null default 0,
  efectivo_contado  numeric(12,2),
  efectivo_esperado numeric(12,2),
  efectivo_queda    numeric(12,2),
  detalle           jsonb not null default '{}',     -- por medio de pago: ventas, esperado, contado
  nota              text,
  origen            origen_dato not null default 'sistema',
  cerrado_por       uuid references perfiles (id),
  creado_en         timestamptz not null default now()
);

-- ---------- Historial de cambios -------------------------------------
create table auditoria (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id text not null,
  accion      text not null,                 -- INSERT / UPDATE / DELETE
  antes       jsonb,
  despues     jsonb,
  usuario_id  uuid,
  creado_en   timestamptz not null default now()
);

create or replace function registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria (tabla, registro_id, accion, antes, despues, usuario_id)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', ''),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

create trigger aud_variantes   after update or delete on variantes          for each row execute function registrar_auditoria();
create trigger aud_movimientos after insert or update or delete on movimientos_stock for each row execute function registrar_auditoria();
create trigger aud_ventas      after update or delete on ventas             for each row execute function registrar_auditoria();
create trigger aud_facturas    after insert or update or delete on facturas for each row execute function registrar_auditoria();
create trigger aud_egresos     after update or delete on egresos            for each row execute function registrar_auditoria();

-- ---------- Funciones de permisos ---------------------------------
create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'admin' and activo)
$$;

create or replace function es_usuario() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo)
$$;

-- ---------- Vistas ---------------------------------------------------
-- Stock por variante (suma de movimientos).
create view stock_variantes with (security_invoker = true) as
select v.id as variante_id, coalesce(sum(m.cantidad), 0)::integer as stock
from variantes v left join movimientos_stock m on m.variante_id = v.id
group by v.id;

-- Catálogo SIN costo ni margen: es lo que usa la pantalla de venta (Mica incluida).
-- Corre con permisos del dueño de la vista para poder leer variantes sin exponer el costo.
create view catalogo as
select p.id as producto_id, p.codigo as producto_codigo, p.nombre as producto,
       c.nombre as categoria, p.tiendanube_product_id is not null as en_web,
       v.id as variante_id, v.codigo, v.atributos, v.precio, v.stock_minimo, v.activo,
       coalesce(s.stock, 0) as stock
from variantes v
join productos p on p.id = v.producto_id
left join categorias c on c.id = p.categoria_id
left join stock_variantes s on s.variante_id = v.id
where p.activo and es_usuario();

-- Costo y margen (solo admin, por RLS de variantes).
create view variantes_con_margen with (security_invoker = true) as
select v.*, case when v.costo > 0 then round(v.precio / v.costo, 2) end as margen
from variantes v;

-- ---------- Permisos (Row Level Security) ----------------------------
do $$
declare t text;
begin
  foreach t in array array['perfiles','vendedores','categorias','proveedores','productos','variantes',
    'movimientos_stock','clientes','canales','medios_pago','ventas','venta_vendedores','venta_items',
    'pagos','emisores','facturas','cuentas','tipos_gasto','egresos','cierres_caja','auditoria']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Todo usuario activo lee lo operativo.
create policy leer on perfiles          for select using (es_usuario());
create policy leer on vendedores        for select using (es_usuario());
create policy leer on categorias        for select using (es_usuario());
create policy leer on productos         for select using (es_usuario());
create policy leer on movimientos_stock for select using (es_usuario());
create policy leer on clientes          for select using (es_usuario());
create policy leer on canales           for select using (es_usuario());
create policy leer on medios_pago       for select using (es_usuario());
create policy leer on ventas            for select using (es_usuario());
create policy leer on venta_vendedores  for select using (es_usuario());
create policy leer on venta_items       for select using (es_usuario());
create policy leer on pagos             for select using (es_usuario());
create policy leer on cierres_caja      for select using (es_usuario());

-- Vender y cerrar caja: cualquier usuario activo puede crear.
create policy crear on ventas            for insert with check (es_usuario());
create policy crear on venta_vendedores  for insert with check (es_usuario());
create policy crear on venta_items       for insert with check (es_usuario());
create policy crear on pagos             for insert with check (es_usuario());
create policy crear on movimientos_stock for insert with check (es_usuario());
create policy crear on clientes          for insert with check (es_usuario());
create policy crear on cierres_caja      for insert with check (es_usuario());

-- Solo admin: costos, proveedores, facturas, gastos, auditoría, y cualquier cambio o anulación.
create policy admin_todo on perfiles          for all using (es_admin()) with check (es_admin());
create policy admin_todo on vendedores        for all using (es_admin()) with check (es_admin());
create policy admin_todo on categorias        for all using (es_admin()) with check (es_admin());
create policy admin_todo on proveedores       for all using (es_admin()) with check (es_admin());
create policy admin_todo on productos         for all using (es_admin()) with check (es_admin());
create policy admin_todo on variantes         for all using (es_admin()) with check (es_admin());
create policy admin_todo on movimientos_stock for all using (es_admin()) with check (es_admin());
create policy admin_todo on clientes          for all using (es_admin()) with check (es_admin());
create policy admin_todo on canales           for all using (es_admin()) with check (es_admin());
create policy admin_todo on medios_pago       for all using (es_admin()) with check (es_admin());
create policy admin_todo on ventas            for all using (es_admin()) with check (es_admin());
create policy admin_todo on venta_vendedores  for all using (es_admin()) with check (es_admin());
create policy admin_todo on venta_items       for all using (es_admin()) with check (es_admin());
create policy admin_todo on pagos             for all using (es_admin()) with check (es_admin());
create policy admin_todo on emisores          for all using (es_admin()) with check (es_admin());
create policy admin_todo on facturas          for all using (es_admin()) with check (es_admin());
create policy admin_todo on cuentas           for all using (es_admin()) with check (es_admin());
create policy admin_todo on tipos_gasto       for all using (es_admin()) with check (es_admin());
create policy admin_todo on egresos           for all using (es_admin()) with check (es_admin());
create policy admin_todo on cierres_caja      for all using (es_admin()) with check (es_admin());
create policy admin_leer on auditoria         for select using (es_admin());

grant select on catalogo to authenticated;
