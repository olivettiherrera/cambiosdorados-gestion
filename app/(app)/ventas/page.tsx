import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import ListadoVentas from './ListadoVentas'

export default async function PaginaVentas() {
  const supabase = await crearClienteServidor()
  const perfil = await obtenerPerfil()
  const [canales, medios, vendedores] = await Promise.all([
    supabase.from('canales').select('id, nombre').order('nombre'),
    supabase.from('medios_pago').select('id, nombre').order('id'),
    supabase.from('vendedores').select('id, nombre').order('nombre'),
  ])
  return (
    <ListadoVentas
      esAdmin={perfil?.rol === 'admin'}
      canales={canales.data ?? []}
      medios={medios.data ?? []}
      vendedores={vendedores.data ?? []}
    />
  )
}
