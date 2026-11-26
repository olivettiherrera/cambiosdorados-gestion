import { notFound, redirect } from 'next/navigation'
import { obtenerPerfil } from '@/lib/supabase/server'
import { SECCIONES } from '../secciones'

export default async function SeccionProxima({ params }: { params: Promise<{ seccion: string }> }) {
  const { seccion } = await params
  const s = SECCIONES.find((x) => x.ruta === seccion)
  if (!s) notFound()
  const perfil = await obtenerPerfil()
  if (s.soloAdmin && perfil?.rol !== 'admin') redirect('/venta')
  return (
    <>
      <h1>{s.nombre}</h1>
      <div className="panel" style={{ padding: 24 }}>
        <div style={{ fontWeight: 500 }}>Esta sección está en construcción.</div>
        <div className="muted" style={{ marginTop: 6 }}>Va a quedar como en los mockups. Por ahora se puede cargar ventas.</div>
      </div>
    </>
  )
}
