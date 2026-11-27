'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { crearClienteNavegador } from '@/lib/supabase/client'

export default function NuevaClave() {
  const router = useRouter()
  const [clave, setClave] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (clave.length < 8) return setError('Usá al menos 8 caracteres.')
    if (clave !== repetida) return setError('Las dos contraseñas no coinciden.')
    setGuardando(true)
    const { error } = await crearClienteNavegador().auth.updateUser({ password: clave })
    setGuardando(false)
    if (error) return setError(error.message.includes('weak') || error.message.includes('pwned') ? 'Esa contraseña es muy fácil o apareció en filtraciones: elegí otra.' : 'No se pudo cambiar: ' + error.message)
    router.replace('/venta')
    router.refresh()
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={guardar} className="panel" style={{ width: '100%', maxWidth: 380, padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--titulos)', fontSize: 28 }}>Contraseña nueva</div>
          <div className="muted" style={{ marginTop: 4 }}>Elegí la contraseña con la que vas a entrar.</div>
        </div>
        <label className="etiqueta">Contraseña nueva
          <input className="campo" type="password" autoComplete="new-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <label className="etiqueta">Repetila
          <input className="campo" type="password" autoComplete="new-password" required value={repetida} onChange={(e) => setRepetida(e.target.value)} />
        </label>
        {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}
        <button className="boton" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar y entrar'}</button>
      </form>
    </main>
  )
}
