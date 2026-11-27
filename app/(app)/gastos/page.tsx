import { redirect } from 'next/navigation'
import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import Gastos from './Gastos'

export default async function PaginaGastos() {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') redirect('/venta')
  const supabase = await crearClienteServidor()
  const [tipos, cuentas, provs] = await Promise.all([
    supabase.from('tipos_gasto').select('id, nombre, grupo').order('nombre'),
    supabase.from('cuentas').select('id, nombre').order('nombre'),
    supabase.from('egresos_listado').select('proveedor').gte('fecha', '2025-01-01').not('proveedor', 'is', null).limit(5000),
  ])
  const proveedores = [...new Set((provs.data ?? []).map((p) => p.proveedor as string))].sort((a, b) => a.localeCompare(b))
  return <Gastos tipos={tipos.data ?? []} cuentas={cuentas.data ?? []} proveedores={proveedores} />
}
