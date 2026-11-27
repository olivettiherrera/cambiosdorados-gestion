'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { crearClienteNavegador } from '@/lib/supabase/client'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [olvido, setOlvido] = useState(false)
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('link-vencido')) setError('El link venció o ya se usó. Pedí otro.')
  }, [])

  async function recuperar(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setAviso('')
    if (!email.trim()) return setError('Escribí tu mail.')
    setCargando(true)
    await crearClienteNavegador().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/confirmar` })
    setCargando(false)
    // Mismo mensaje exista o no la cuenta
    setAviso('Si ese mail tiene cuenta, te llega un link para poner una contraseña nueva. Revisá también spam.')
  }

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
      <form onSubmit={olvido ? recuperar : entrar} className="panel" style={{ width: '100%', maxWidth: 380, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--titulos)', fontSize: 28 }}>Cambios Dorados</div>
          <div className="muted" style={{ marginTop: 4 }}>Sistema de gestión</div>
        </div>
        <label className="etiqueta">Mail
          <input className="campo" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {!olvido && (
          <label className="etiqueta">Contraseña
            <input className="campo" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
        )}
        {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}
        {aviso && <div role="status" style={{ color: 'var(--ok)', fontSize: 13 }}>{aviso}</div>}
        <button className="boton" type="submit" disabled={cargando}>{cargando ? 'Un momento…' : olvido ? 'Mandarme el link' : 'Entrar'}</button>
        <button type="button" onClick={() => { setOlvido((o) => !o); setError(''); setAviso('') }}
          style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--dorado-texto)', fontSize: 13 }}>
          {olvido ? 'Volver a entrar con contraseña' : 'Olvidé mi contraseña'}
        </button>
      </form>
    </main>
  )
}
