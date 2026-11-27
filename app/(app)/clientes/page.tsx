import { obtenerPerfil } from '@/lib/supabase/server'
import Clientes from './Clientes'

export default async function PaginaClientes() {
  const perfil = await obtenerPerfil()
  return <Clientes esAdmin={perfil?.rol === 'admin'} />
}
