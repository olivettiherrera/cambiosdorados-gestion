import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import NuevaVenta, { type Opcion, type MedioPago } from './NuevaVenta'

export default async function PaginaVenta() {
  const supabase = await crearClienteServidor()
  const perfil = await obtenerPerfil()
  const [canales, medios, vendedores, categorias, clientes] = await Promise.all([
    supabase.from('canales').select('id, nombre').order('id'),
    supabase.from('medios_pago').select('id, nombre, descuento_pct, comision_pct').eq('activo', true).order('id'),
    supabase.from('vendedores').select('id, nombre, perfil_id').eq('activo', true).order('id'),
    supabase.from('categorias').select('id, nombre').order('nombre'),
    supabase.from('clientes').select('id, nombre').order('nombre').limit(5000),
  ])

  // Medios que se usan hoy al vender; el resto queda en "Más".
  const principales = ['Transferencia Santander', 'Efectivo', 'Getnet (Santander)', 'Mercado Pago', 'Transferencia Galicia']
  const listaMedios = ((medios.data ?? []) as MedioPago[]).sort(
    (a, b) => (principales.indexOf(a.nombre) + 1 || 99) - (principales.indexOf(b.nombre) + 1 || 99),
  )
  const canalesVenta = ((canales.data ?? []) as Opcion[]).filter((c) => c.nombre !== 'Sin dato')
  const vendedorPropio = (vendedores.data ?? []).find((v) => v.perfil_id === perfil?.id)?.id ?? null

  return (
    <NuevaVenta
      canales={canalesVenta}
      medios={listaMedios}
      vendedores={(vendedores.data ?? []).map((v) => ({ id: v.id, nombre: v.nombre }))}
      vendedorInicial={vendedorPropio}
      categorias={categorias.data ?? []}
      clientes={clientes.data ?? []}
    />
  )
}
