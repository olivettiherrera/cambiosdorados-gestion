'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SECCIONES } from './secciones'

export default function Menu({ nombre, rol }: { nombre: string; rol: 'admin' | 'vendedor' }) {
  const ruta = usePathname()
  const visibles = SECCIONES.filter((s) => !s.soloAdmin || rol === 'admin')
  const generales = visibles.filter((s) => !['gastos', 'tablero'].includes(s.ruta))
  const privadas = visibles.filter((s) => ['gastos', 'tablero'].includes(s.ruta))

  const enlace = (s: (typeof SECCIONES)[number]) => {
    const activa = ruta === '/' + s.ruta
    return (
      <Link key={s.ruta} href={'/' + s.ruta} aria-current={activa ? 'page' : undefined}
        style={{
          display: 'block', padding: activa ? '11px 12px' : '11px 15px',
          color: activa ? '#fff' : 'var(--beige)', background: activa ? '#45423F' : 'transparent',
          borderLeft: activa ? '3px solid var(--dorado)' : '0', fontWeight: activa ? 500 : 400,
        }}>
        {s.nombre}
      </Link>
    )
  }

  return (
    <nav aria-label="Menú principal" style={{ flex: '0 0 230px', background: 'var(--tinta)', color: 'var(--fondo)', display: 'flex', flexDirection: 'column', padding: '28px 0', minHeight: '100vh' }}>
      <div style={{ padding: '0 24px 28px', borderBottom: '1px solid #45423F' }}>
        <div style={{ fontFamily: 'var(--titulos)', fontSize: 22 }}>Cambios Dorados</div>
        <div style={{ fontSize: 12, color: '#C9C2B8', marginTop: 4 }}>Sistema de gestión</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 2 }}>
        {generales.map(enlace)}
        {privadas.length > 0 && (
          <>
            <div style={{ fontSize: 11, letterSpacing: 1, color: '#A9A29A', padding: '20px 15px 6px' }}>SOLO JOAN Y SELE</div>
            {privadas.map(enlace)}
          </>
        )}
      </div>
      <div style={{ marginTop: 'auto', padding: '16px 24px 0', borderTop: '1px solid #45423F', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--dorado)', color: 'var(--tinta)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
          {nombre.charAt(0)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500 }}>{nombre}</div>
          <form action="/auth/salir" method="post">
            <button type="submit" style={{ background: 'none', border: 0, padding: 0, color: '#C9C2B8', fontSize: 12, textDecoration: 'underline' }}>Salir</button>
          </form>
        </div>
      </div>
    </nav>
  )
}
