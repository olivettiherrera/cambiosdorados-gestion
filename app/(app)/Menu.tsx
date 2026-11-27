'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { SECCIONES } from './secciones'

export default function Menu({ nombre, rol, avisos = 0 }: { nombre: string; rol: 'admin' | 'vendedor'; avisos?: number }) {
  const ruta = usePathname()
  const [abierto, setAbierto] = useState(false)
  useEffect(() => { setAbierto(false) }, [ruta])
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
        {s.ruta === 'productos' && avisos > 0 && (
          <span aria-label={avisos + ' para revisar'} style={{ marginLeft: 8, background: 'var(--dorado)', color: 'var(--tinta)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 }}>{avisos}</span>
        )}
      </Link>
    )
  }

  const actual = SECCIONES.find((s) => ruta === '/' + s.ruta)?.nombre ?? ''
  return (
    <>
    {/* Celular: barra arriba con botón de menú */}
    <div className="barra-movil">
      <button aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}
        style={{ background: 'none', border: 0, color: '#fff', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          {abierto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <span style={{ fontFamily: 'var(--titulos)', fontSize: 18 }}>{actual || 'Cambios Dorados'}</span>
      {avisos > 0 ? <Link href="/productos" aria-label={avisos + ' para revisar'} style={{ background: 'var(--dorado)', color: 'var(--tinta)', borderRadius: 10, padding: '1px 8px', fontSize: 12, fontWeight: 600 }}>{avisos}</Link> : <span style={{ width: 44 }} />}
    </div>
    {abierto && <div className="velo-menu" onClick={() => setAbierto(false)} aria-hidden="true" />}
    <nav aria-label="Menú principal" className={'menu-lateral' + (abierto ? ' abierto' : '')} style={{ flex: '0 0 230px', background: 'var(--tinta)', color: 'var(--fondo)', display: 'flex', flexDirection: 'column', padding: '28px 0', minHeight: '100vh' }}>
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
    </>
  )
}
