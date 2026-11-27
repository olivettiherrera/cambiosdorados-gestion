'use client'

import { useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos } from '@/lib/formato'
import { type FilaCatalogo } from './comun'

type Renglon = { fila: FilaCatalogo; valores: string[]; incluir: boolean }
type Grupo = { base: string; filas: FilaCatalogo[] }

const pareceMedida = (t: string) => /\d\s*(cm|cc|ml|mm|m\b|x|\*)|^(xs|s|m|l|xl)$|chico|grande|mediano/i.test(t)
const partes = (nombre: string) => nombre.split(' - ').slice(1).map((x) => x.trim()).filter(Boolean)

/** Sugiere juntar productos sueltos que son variantes ("Florero Tana - Negro", "Florero Tana - Blanco") y los une. */
export default function Agrupar({ filas, onCerrar, onListo }: { filas: FilaCatalogo[]; onCerrar: () => void; onListo: (texto: string) => void }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [hechos, setHechos] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<string | null>(null)

  const grupos = useMemo(() => {
    // Solo productos de una variante sin datos, con " - " en el nombre
    const porProducto = new Map<number, FilaCatalogo[]>()
    for (const f of filas) porProducto.set(f.producto_id, [...(porProducto.get(f.producto_id) ?? []), f])
    const sueltos = [...porProducto.values()].filter((vs) => vs.length === 1 && !Object.keys(vs[0].atributos ?? {}).length && vs[0].producto.includes(' - ')).map((vs) => vs[0])
    const porBase = new Map<string, FilaCatalogo[]>()
    for (const f of sueltos) {
      const base = f.producto.split(' - ')[0].trim()
      porBase.set(base.toLowerCase(), [...(porBase.get(base.toLowerCase()) ?? []), f])
    }
    return [...porBase.values()].filter((fs) => fs.length > 1)
      .map((fs) => ({ base: fs[0].producto.split(' - ')[0].trim(), filas: fs.sort((a, b) => a.producto.localeCompare(b.producto) || a.codigo.localeCompare(b.codigo)) }))
      .sort((a, b) => b.filas.length - a.filas.length)
  }, [filas])

  const pendientes = grupos.filter((g) => !hechos.has(g.base))

  return (
    <section className="panel" aria-label="Unir variantes" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'var(--dorado)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <div>
          <h2>Unir variantes</h2>
          <div className="small muted" style={{ marginTop: 4 }}>
            Productos que se cargaron sueltos pero son el mismo con distinto color o medida. Al unirlos quedan como un producto con variantes; no se pierden ventas, stock ni precios.
          </div>
        </div>
        <button className="boton-sec" onClick={onCerrar}>Cerrar</button>
      </div>
      {pendientes.length === 0 && <div className="muted">No quedan sugerencias.</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {pendientes.map((g) => abierto === g.base ? (
          <Editor key={g.base} grupo={g} onCancelar={() => setAbierto(null)}
            onUnir={async (nombre, variantes) => {
              const { error } = await supabase.rpc('agrupar_variantes', { p: { nombre, variantes } })
              if (error) return error.message
              setHechos((h) => new Set(h).add(g.base)); setAbierto(null)
              onListo(`“${nombre}” quedó con ${variantes.length} variantes.`)
              return null
            }} />
        ) : (
          <button key={g.base} onClick={() => setAbierto(g.base)}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, border: 0, borderBottom: '1px solid var(--linea)', background: '#fff', padding: '12px 4px', textAlign: 'left' }}>
            <span><b>{g.base}</b> <span className="muted small">· {g.filas.length} productos sueltos</span>
              <div className="small muted" style={{ marginTop: 2 }}>{[...new Set(g.filas.map((f) => partes(f.producto).join(' · ')))].slice(0, 6).join(' | ')}{g.filas.length > 6 ? '…' : ''}</div>
            </span>
            <span className="small" style={{ color: 'var(--dorado-texto)', textDecoration: 'underline', whiteSpace: 'nowrap' }}>Revisar y unir</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Editor({ grupo, onCancelar, onUnir }: {
  grupo: Grupo; onCancelar: () => void; onUnir: (nombre: string, variantes: { variante_id: number; atributos: Record<string, string> }[]) => Promise<string | null>
}) {
  const maxPartes = Math.max(...grupo.filas.map((f) => partes(f.producto).length), 1)
  const repetidos = grupo.filas.some((f, i) => grupo.filas.findIndex((g) => g.producto === f.producto) !== i)
  // Nombres de los datos: medida si lo parece, si no color; y una columna extra si hay nombres repetidos
  const clavesIniciales = Array.from({ length: maxPartes }, (_, i) => {
    const vals = grupo.filas.map((f) => partes(f.producto)[i] ?? '')
    return vals.some(pareceMedida) ? 'Medida' : i === 0 ? 'Color' : maxPartes === 2 && i === 1 ? (grupo.base.toLowerCase().includes('difusor') || grupo.base.toLowerCase().includes('splash') ? 'Aroma' : 'Color') : `Dato ${i + 1}`
  })
  if (repetidos && !clavesIniciales.includes('Medida')) clavesIniciales.push('Medida')
  const [nombre, setNombre] = useState(grupo.base)
  const [claves, setClaves] = useState<string[]>(clavesIniciales)
  const [renglones, setRenglones] = useState<Renglon[]>(grupo.filas.map((f) => {
    const ps = partes(f.producto)
    return { fila: f, incluir: true, valores: clavesIniciales.map((_, i) => ps[i] ?? '') }
  }))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const incluidos = renglones.filter((r) => r.incluir)
  const firma = (r: Renglon) => r.valores.map((v) => v.trim().toLowerCase()).join('|')
  const repetida = (r: Renglon) => incluidos.filter((x) => firma(x) === firma(r)).length > 1

  async function unir() {
    setError('')
    if (incluidos.length < 2) return setError('Dejá al menos dos productos marcados.')
    if (claves.some((c) => !c.trim())) return setError('Poné nombre a cada dato (ej. Color, Medida).')
    if (incluidos.some(repetida)) return setError('Hay variantes iguales (en rojo): completá qué las diferencia, por ejemplo la medida.')
    setGuardando(true)
    const err = await onUnir(nombre.trim(), incluidos.map((r) => ({
      variante_id: r.fila.variante_id,
      atributos: Object.fromEntries(claves.map((c, i) => [c.trim(), r.valores[i]?.trim() ?? '']).filter(([, v]) => v)),
    })))
    setGuardando(false)
    if (err) setError(err)
  }

  return (
    <div style={{ border: '1px solid var(--beige)', background: 'var(--crema)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, margin: '8px 0' }}>
      <label className="etiqueta">Nombre del producto
        <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      {repetidos && <div className="small" style={{ color: 'var(--alerta)' }}>Hay productos con el mismo nombre: seguramente cambia la medida u otro dato que no quedó en el nombre. Completalo antes de unir (fijate el precio o en la etiqueta).</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--tinta-suave)', fontSize: 12 }}>
              <th style={{ padding: 8, width: 30 }} />
              <th style={{ padding: 8 }}>Código</th>
              {claves.map((c, i) => (
                <th key={i} style={{ padding: 6 }}>
                  <input className="campo" aria-label={`Nombre del dato ${i + 1}`} value={c} style={{ height: 30, fontSize: 12, fontWeight: 600 }}
                    onChange={(e) => setClaves((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))} />
                </th>
              ))}
              <th style={{ padding: 6, width: 40 }}>
                <button type="button" title="Agregar otro dato" aria-label="Agregar otro dato" onClick={() => { setClaves((cs) => [...cs, '']); setRenglones((rs) => rs.map((r) => ({ ...r, valores: [...r.valores, ''] }))) }}
                  style={{ border: '1px solid var(--borde)', background: '#fff', width: 30, height: 30 }}>+</button>
              </th>
              <th style={{ padding: 8, textAlign: 'right' }}>Precio</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r, k) => (
              <tr key={r.fila.variante_id} style={{ borderTop: '1px solid var(--linea)', opacity: r.incluir ? 1 : 0.45, background: r.incluir && repetida(r) ? '#FBEFEC' : undefined }}>
                <td style={{ padding: 8 }}>
                  <input type="checkbox" aria-label={'Incluir ' + r.fila.codigo} checked={r.incluir} onChange={(e) => setRenglones((rs) => rs.map((x, j) => (j === k ? { ...x, incluir: e.target.checked } : x)))} />
                </td>
                <td style={{ padding: 8 }} className="muted">{r.fila.codigo}</td>
                {claves.map((_, i) => (
                  <td key={i} style={{ padding: 4 }}>
                    <input className="campo" aria-label={`${claves[i] || 'Dato'} de ${r.fila.codigo}`} value={r.valores[i] ?? ''} style={{ height: 32 }}
                      onChange={(e) => setRenglones((rs) => rs.map((x, j) => (j === k ? { ...x, valores: x.valores.map((v, m) => (m === i ? e.target.value : v)) } : x)))} />
                  </td>
                ))}
                <td />
                <td style={{ padding: 8, textAlign: 'right' }}>{Number(r.fila.precio) > 0 ? pesos(r.fila.precio) : <span className="muted">—</span>}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{r.fila.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <div role="alert" className="small error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="boton-sec" onClick={onCancelar}>Cancelar</button>
        <button className="boton" disabled={guardando} onClick={unir}>{guardando ? 'Uniendo…' : `Unir ${incluidos.length} como variantes`}</button>
      </div>
    </div>
  )
}
