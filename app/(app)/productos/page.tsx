import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import Pendientes from './Pendientes'
import Productos from './Productos'

export default async function PaginaProductos() {
  const perfil = await obtenerPerfil()
  const supabase = await crearClienteServidor()
  const { data: categorias } = await supabase.from('categorias').select('id, nombre').order('nombre')
  const esAdmin = perfil?.rol === 'admin'
  return (
    <>
      <Productos esAdmin={esAdmin} categorias={categorias ?? []} avisos={esAdmin ? <Pendientes /> : null} />
    </>
  )
}
