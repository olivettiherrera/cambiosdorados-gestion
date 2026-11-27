import { redirect } from 'next/navigation'
import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import Menu from './Menu'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const perfil = await obtenerPerfil()
  if (!perfil) redirect('/login?sin-perfil=1')
  let avisos = 0
  if (perfil.rol === 'admin') {
    const supabase = await crearClienteServidor()
    const { count } = await supabase.from('pendientes').select('id', { count: 'exact', head: true }).is('resuelto_at', null)
    avisos = count ?? 0
  }
  return (
    <>
    {process.env.NEXT_PUBLIC_MODO_PRUEBA !== '0' && (
      <div role="status" style={{ background: '#6E4E1E', color: '#fff', textAlign: 'center', padding: '8px 16px', fontSize: 13, fontWeight: 500, letterSpacing: .3 }}>
        MODO PRUEBA · lo que se cargue acá no cuenta: las ventas reales se siguen cargando en la planilla
      </div>
    )}
    <div className="marco-app" style={{ display: 'flex', minHeight: '100vh' }}>
      <Menu nombre={perfil.nombre} rol={perfil.rol} avisos={avisos} />
      <main className="contenido-app" style={{ flex: 1, minWidth: 0, padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {children}
      </main>
    </div>
    </>
  )
}
