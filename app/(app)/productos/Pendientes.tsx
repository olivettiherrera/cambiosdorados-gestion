'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'

type Fila = {
  id: number; tipo: 'sin_stock' | 'sin_precio'; detalle: string | null; veces: number; actualizado_at: string; variante_id: number
  variantes: { codigo: string; atributos: Record<string, string>; precio: number | null; productos: { nombre: string } | null } | null
}

const numero = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'))

/** Avisos que dejan las ventas: productos vendidos sin stock en el sistema o sin precio cargado. Solo admin. */
export default function Pendientes() {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [stock, setStock] = useState<Record<number, number>>({})
  const [valor, setValor] = useState<Record<number, string>>({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from('pendientes')
      .select('id, tipo, detalle, veces, actualizado_at, variante_id, variantes(codigo, atributos, precio, productos(nombre))')
      .is('resuelto_at', null).order('actualizado_at', { ascending: false })
    if (error) return setError('No se pudieron leer los avisos: ' + error.message)
    const lista = (data ?? []) as unknown as Fila[]
    setFilas(lista)
    const ids = [...new Set(lista.map((f) => f.variante_id))]
    if (ids.length) {
      const { data: st } = await supabase.from('stock_variantes').select('variante_id, stock').in('variante_id', ids)
      setStock(Object.fromEntries((st ?? []).map((s) => [s.variante_id, s.stock])))
    }
  }, [supabase])
  useEffect(() => { cargar() }, [cargar])

  async function resolver(f: Fila) {
    setError('')
    const texto = valor[f.id] ?? ''
    const n = numero(texto)
    setGuardando(f.id)
    const { data: { user } } = await supabase.auth.getUser()
    if (f.tipo === 'sin_precio') {
      if (!(n > 0)) { setGuardando(null); return setError('Escribí el precio de venta.') }
      const { error } = await supabase.from('variantes').update({ precio: n }).eq('id', f.variante_id)
      if (error) { setGuardando(null); return setError('No se pudo guardar el precio: ' + error.message) }
    } else if (texto.trim() !== '') {
      if (!Number.isInteger(n) || n < 0) { setGuardando(null); return setError('Escribí cuántas unidades hay en el local (0 o más).') }
      const diferencia = n - (stock[f.variante_id] ?? 0)
      if (diferencia !== 0) {
        const { error } = await supabase.from('movimientos_stock').insert({ variante_id: f.variante_id, cantidad: diferencia, motivo: 'ajuste', usuario_id: user?.id })
        if (error) { setGuardando(null); return setError('No se pudo ajustar el stock: ' + error.message) }
      }
    }
    const { error } = await supabase.from('pendientes').update({ resuelto_at: new Date().toISOString(), resuelto_por: user?.id }).eq('id', f.id)
    setGuardando(null)
    if (error) return setError('No se pudo marcar como listo: ' + error.message)
    cargar()
  }

  const nombre = (f: Fila) => [f.variantes?.productos?.nombre, ...Object.values(f.variantes?.atributos ?? {})].filter(Boolean).join(' · ')

  return (
    <section className="panel" aria-label="Para revisar">
      <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--linea)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Para revisar</h2>
        <span className="muted small">Avisos que dejan las ventas · solo los ven Joan y Sele</span>
      </div>
      {error && <div role="alert" className="error" style={{ padding: '12px 24px' }}>{error}</div>}
      {filas === null && <div className="muted" style={{ padding: 24 }}>Cargando…</div>}
      {filas?.length === 0 && <div className="muted" style={{ padding: 24 }}>No hay nada pendiente.</div>}
      {filas?.map((f) => (
        <div key={f.id} style={{ padding: '14px 24px', borderBottom: '1px solid var(--linea)', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="etiqueta-estado" style={{ color: f.tipo === 'sin_stock' ? 'var(--alerta)' : 'var(--error)', borderColor: 'currentColor', width: 92, textAlign: 'center' }}>
            {f.tipo === 'sin_stock' ? 'Sin stock' : 'Sin precio'}
          </span>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{nombre(f)} <span className="muted small">{f.variantes?.codigo}</span></div>
            <div className="small muted">
              {f.tipo === 'sin_stock'
                ? `Se vendió sin stock cargado${f.veces > 1 ? ` (${f.veces} veces)` : ''}. Hoy el sistema dice ${stock[f.variante_id] ?? 0}. Contá cuántos hay en el local y cargalo.`
                : `Se vendió con precio a mano${f.veces > 1 ? ` (${f.veces} veces)` : ''}. Cargale el precio de venta.`}
              {f.detalle && <> · {f.detalle}</>}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--borde)', padding: '0 8px', height: 36, width: 140, background: '#fff' }}>
            <span className="muted small">{f.tipo === 'sin_precio' ? '$' : 'Hay'}</span>
            <input aria-label={f.tipo === 'sin_precio' ? 'Precio de ' + nombre(f) : 'Unidades en el local de ' + nombre(f)} inputMode="numeric"
              placeholder={f.tipo === 'sin_precio' ? 'precio' : 'unidades'} value={valor[f.id] ?? ''}
              onChange={(e) => setValor((v) => ({ ...v, [f.id]: e.target.value }))}
              style={{ border: 0, outline: 'none', width: '100%', textAlign: 'right', background: 'transparent' }} />
          </label>
          <button className="boton" style={{ height: 36 }} disabled={guardando === f.id} onClick={() => resolver(f)}>
            {guardando === f.id ? 'Guardando…' : f.tipo === 'sin_precio' ? 'Guardar precio' : (valor[f.id] ?? '').trim() ? 'Cargar stock' : 'Listo, sin cambios'}
          </button>
        </div>
      ))}
      {filas && filas.some((f) => f.tipo === 'sin_precio') && (
        <div className="small muted" style={{ padding: '12px 24px' }}>El precio que se guarda acá es el de lista; lo que ya se cobró en la venta no cambia.</div>
      )}
    </section>
  )
}
