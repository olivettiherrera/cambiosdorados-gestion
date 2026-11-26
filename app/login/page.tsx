'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { crearClienteNavegador } from '@/lib/supabase/client'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setCargando(true)
    const supabase = crearClienteNavegador()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave })
    setCargando(false)
    if (error) {
      setError('Mail o contraseña incorrectos.')
      return
    }
    router.replace('/venta')
    router.refresh()
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={entrar} className="panel" style={{ width: '100%', maxWidth: 380, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--titulos)', fontSize: 28 }}>Cambios Dorados</div>
          <div className="muted" style={{ marginTop: 4 }}>Sistema de gestión</div>
        </div>
        <label className="etiqueta">Mail
          <input className="campo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="etiqueta">Contraseña
          <input className="campo" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}
        <button className="boton" type="submit" disabled={cargando}>{cargando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
