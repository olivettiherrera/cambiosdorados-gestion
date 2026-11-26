import { redirect } from 'next/navigation'
import { obtenerPerfil } from '@/lib/supabase/server'
import Menu from './Menu'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await obtenerPerfil()
  if (!perfil) redirect('/login?sin-perfil=1')
  return (
    <>
    {process.env.NEXT_PUBLIC_MODO_PRUEBA !== '0' && (
      <div role="status" style={{ background: '#6E4E1E', color: '#fff', textAlign: 'center', padding: '8px 16px', fontSize: 13, fontWeight: 500, letterSpacing: .3 }}>
        MODO PRUEBA · lo que se cargue acá no cuenta: las ventas reales se siguen cargando en la planilla
      </div>
    )}
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Menu nombre={perfil.nombre} rol={perfil.rol} />
      <main style={{ flex: 1, minWidth: 0, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {children}
      </main>
    </div>
    </>
  )
}
