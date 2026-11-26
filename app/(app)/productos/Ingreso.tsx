'use client'

import { useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos } from '@/lib/formato'
import { type FilaCatalogo, textoVariante, leerNumero } from './comun'

type Linea = { fila: FilaCatalogo; cantidad: string; costo: string }

const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Ingreso de mercadería: suma stock y (si es admin) actualiza el costo; con "mantener margen" el precio se recalcula solo. */
export default function Ingreso({ filas, esAdmin, costos, onCerrar, onListo }: {
  filas: FilaCatalogo[]; esAdmin: boolean; costos: Map<number, number>
  onCerrar: () => void; onListo: (texto: string) => void
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [busqueda, setBusqueda] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const resultados = useMemo(() => {
    const q = normalizar(busqueda.trim())
    if (q.length < 2) return []
    const partes = q.split(/\s+/)
    return filas.filter((f) => f.activo && partes.every((p) => normalizar(`${f.producto} ${f.codigo} ${textoVariante(f.atributos)}`).includes(p))).slice(0, 8)
  }, [busqueda, filas])

  const agregar = (f: FilaCatalogo) => {
    setLineas((ls) => (ls.some((l) => l.fila.variante_id === f.variante_id) ? ls : [...ls, { fila: f, cantidad: '1', costo: '' }]))
    setBusqueda('')
  }
  const cambiar = (id: number, campo: 'cantidad' | 'costo', valor: string) =>
    setLineas((ls) => ls.map((l) => (l.fila.variante_id === id ? { ...l, [campo]: valor } : l)))

  async function guardar() {
    setError('')
    if (!lineas.length) return setError('Agregá al menos un producto.')
    const items = lineas.map((l) => ({ variante_id: l.fila.variante_id, cantidad: leerNumero(l.cantidad), costo: l.costo.trim() ? leerNumero(l.costo) : '' }))
    if (items.some((i) => !Number.isInteger(i.cantidad) || i.cantidad <= 0)) return setError('Las cantidades tienen que ser números enteros mayores a 0.')
    if (items.some((i) => i.costo !== '' && !(Number(i.costo) > 0))) return setError('Hay un costo que no es válido.')
    setGuardando(true)
    const { data, error } = await supabase.rpc('ingresar_mercaderia', { p: { items, nota: nota.trim() } })
    setGuardando(false)
    if (error) return setError('No se pudo guardar el ingreso: ' + error.message)
    const unidades = items.reduce((s, i) => s + i.cantidad, 0)
    const precios = (data as { precios_actualizados: number }).precios_actualizados
    onListo(`Ingreso guardado: ${unidades} unidades de ${items.length} productos.${precios ? ` Se actualizó el precio de ${precios} (cambió el costo y se mantuvo el margen).` : ''}`)
  }

  return (
    <section className="panel" aria-label="Ingresar mercadería" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'var(--dorado)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Ingresar mercadería</h2>
        <button className="boton-sec" onClick={onCerrar}>Cancelar</button>
      </div>

      <div style={{ position: 'relative' }}>
        <input className="campo" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscá el producto que entró (nombre o código)" style={{ height: 44 }} />
        {resultados.length > 0 && (
          <div className="panel" style={{ position: 'absolute', left: 0, right: 0, top: 46, zIndex: 5, boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}>
            {resultados.map((f) => (
              <button key={f.variante_id} onClick={() => agregar(f)}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', border: 0, borderBottom: '1px solid var(--linea)', background: '#fff', padding: '10px 14px', textAlign: 'left' }}>
                <span>{f.producto}{textoVariante(f.atributos) && <span className="muted"> · {textoVariante(f.atributos)}</span>} <span className="small muted">{f.codigo}</span></span>
                <span className="small muted">stock {f.stock}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lineas.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--tinta-suave)', fontSize: 12, borderBottom: '1px solid var(--beige)' }}>
              <th style={{ padding: '8px 4px', fontWeight: 500 }}>Producto</th>
              <th style={{ padding: '8px 4px', fontWeight: 500, width: 110 }}>Cantidad</th>
              {esAdmin && <th style={{ padding: '8px 4px', fontWeight: 500, width: 170 }}>Costo unitario (opcional)</th>}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.fila.variante_id} style={{ borderBottom: '1px solid var(--linea)' }}>
                <td style={{ padding: '8px 4px' }}>
                  {l.fila.producto}{textoVariante(l.fila.atributos) && <span className="muted"> · {textoVariante(l.fila.atributos)}</span>}
                  <div className="small muted">{l.fila.codigo} · hoy hay {l.fila.stock}</div>
                </td>
                <td style={{ padding: '8px 4px' }}>
                  <input className="campo" aria-label={'Cantidad de ' + l.fila.producto} inputMode="numeric" value={l.cantidad}
                    onChange={(e) => cambiar(l.fila.variante_id, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} style={{ height: 34 }} />
                </td>
                {esAdmin && (
                  <td style={{ padding: '8px 4px' }}>
                    <input className="campo" aria-label={'Costo de ' + l.fila.producto} inputMode="decimal" value={l.costo}
                      placeholder={costos.has(l.fila.variante_id) ? 'antes ' + pesos(costos.get(l.fila.variante_id)) : '$'}
                      onChange={(e) => cambiar(l.fila.variante_id, 'costo', e.target.value)} style={{ height: 34 }} />
                  </td>
                )}
                <td style={{ textAlign: 'right' }}>
                  <button aria-label={'Quitar ' + l.fila.producto} onClick={() => setLineas((ls) => ls.filter((x) => x !== l))}
                    style={{ border: 0, background: 'none', fontSize: 18, padding: 4 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="etiqueta" style={{ flex: '1 1 260px' }}>Proveedor / nota (opcional)
          <input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej: Remito 1234 de Cerámicas Sur" />
        </label>
        <button className="boton" disabled={guardando || !lineas.length} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar ingreso'}</button>
      </div>
      {esAdmin && <div className="small muted">Si cargás el costo y el producto está en “mantener el margen”, el precio de venta se actualiza solo (terminado en 900).</div>}
      {error && <div role="alert" className="small error">{error}</div>}
    </section>
  )
}
