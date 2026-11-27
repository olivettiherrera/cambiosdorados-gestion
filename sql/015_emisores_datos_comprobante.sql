-- 015 — Datos del emisor que van impresos en el comprobante (se cargan desde Facturación › Datos para el comprobante).
alter table emisores
  add column if not exists razon_social text,
  add column if not exists domicilio text,
  add column if not exists condicion_iva text default 'Responsable Monotributo',
  add column if not exists ingresos_brutos text,
  add column if not exists inicio_actividades date;
