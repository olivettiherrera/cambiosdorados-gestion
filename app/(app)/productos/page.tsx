import { obtenerPerfil } from '@/lib/supabase/server'
import Pendientes from './Pendientes'

export default async function PaginaProductos() {
  const perfil = await obtenerPerfil()
  return (
    <>
      <header>
        <h1>Productos y stock</h1>
        <div className="muted" style={{ marginTop: 6 }}>El listado completo, variantes, costos y conteo de stock vienen en el próximo paso.</div>
      </header>
      {perfil?.rol === 'admin'
        ? <Pendientes />
        : <div className="panel" style={{ padding: 24 }}>Esta sección está en construcción.</div>}
    </>
  )
}
