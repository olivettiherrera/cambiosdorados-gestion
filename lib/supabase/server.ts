import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function crearClienteServidor() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Llamado desde un Server Component: el proxy ya refresca la sesión.
          }
        },
      },
    },
  )
}

export type Perfil = { id: string; nombre: string; rol: 'admin' | 'vendedor' }

/** Usuario logueado + su perfil (rol). null si no hay sesión o no tiene perfil activo. */
export async function obtenerPerfil(): Promise<Perfil | null> {
  const supabase = await crearClienteServidor()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('perfiles').select('id, nombre, rol').eq('id', user.id).eq('activo', true).single()
  return (data as Perfil) ?? null
}
