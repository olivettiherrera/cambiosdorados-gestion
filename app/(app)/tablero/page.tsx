import { redirect } from 'next/navigation'
import { obtenerPerfil } from '@/lib/supabase/server'
import Tablero from './Tablero'

export default async function PaginaTablero() {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') redirect('/venta')
  return <Tablero />
}
