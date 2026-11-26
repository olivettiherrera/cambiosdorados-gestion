'use client'

import { useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos } from '@/lib/formato'

export type FilaParecida = {
  variante_id: number; producto_id: number; producto: string; codigo: string
  atributos: Record<string, string>; precio: number | null; stock: number; categoria: string | null
  puntaje?: number; motivo?: string
}
type Categoria = { id: number; nombre: string }

const variante = (a: Record<string, string>) => Object.values(a ?? {}).join(' · ')

/** Sugerencias "¿Quisiste decir…?" cuando la búsqueda normal no encuentra nada. */
export function QuisisteDecir({ texto, onAgregar }: { texto: string; onAgregar: (f: FilaParecida) => void }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [filas, setFilas] = useState<FilaParecida[]>([])
  useEffect(() => {
    let vigente = true
    supabase.rpc('buscar_parecidos', { p_texto: texto }).then(({ data }) => vigente && setFilas((data ?? []) as FilaParecida[]))
    return () => { vigente = false }
  }, [supabase, texto])
  if (!filas.length) return null
  return (
    <div>
      <div className="small muted" style={{ padding: '14px 20px 4px' }}>¿Quisiste decir…?</div>
      {filas.map((f) => <FilaSugerida key={f.variante_id} f={f} onAgregar={onAgregar} />)}
    </div>
  )
}

function FilaSugerida({ f, onAgregar }: { f: FilaParecida; onAgregar: (f: FilaParecida) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderTop: '1px solid var(--linea)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {f.producto}{variante(f.atributos) && <span className="muted"> · {variante(f.atributos)}</span>}
        </div>
        <div className="small muted">{f.codigo}{f.categoria ? ` · ${f.categoria}` : ''} · stock {f.stock}{f.motivo ? ` · ${f.motivo}` : ''}</div>
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{f.precio ? pesos(f.precio) : <span className="muted small">sin precio</span>}</span>
      <button className="boton-sec" onClick={() => onAgregar(f)}>Agregar</button>
    </div>
  )
}

/** Alta rápida: primero revisa si ya existe algo parecido (nombre + precio) y recién después crea. */
export function ProductoNuevo({ nombreInicial, categorias, onListo, onCancelar }: {
  nombreInicial: string; categorias: Categoria[]
  onListo: (f: FilaParecida) => void; onCancelar: () => void
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [nombre, setNombre] = useState(nombreInicial)
  const [precio, setPrecio] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [parecidos, setParecidos] = useState<FilaParecida[] | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState('')

  const precioNum = Number(precio.replace(/\./g, '').replace(',', '.')) || 0
  const listo = nombre.trim().length >= 3 && precioNum > 0

  // Cambiar nombre o precio vuelve a pedir la revisión de parecidos
  useEffect(() => { setParecidos(null) }, [nombre, precio])

  async function revisar() {
    setError(''); setTrabajando(true)
    const { data, error } = await supabase.rpc('buscar_parecidos', { p_texto: nombre, p_precio: precioNum })
    setTrabajando(false)
    if (error) return setError(error.message)
    const fuertes = ((data ?? []) as FilaParecida[]).filter((f) => (f.puntaje ?? 0) >= 0.45)
    if (fuertes.length) setParecidos(fuertes)
    else crear()
  }

  async function crear() {
    setError(''); setTrabajando(true)
    const { data, error } = await supabase.rpc('crear_producto_rapido', {
      p: { nombre: nombre.trim(), precio: precioNum, categoria_id: categoriaId || null },
    })
    setTrabajando(false)
    if (error) return setError(error.message)
    onListo(data as FilaParecida)
  }

  return (
    <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderColor: 'var(--dorado)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2>Producto nuevo</h2>
        <button className="boton-sec" onClick={onCancelar}>Cancelar</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.3fr', gap: 12 }}>
        <label className="etiqueta">Nombre
          <input className="campo" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Florero Belly caramelo" />
        </label>
        <label className="etiqueta">Precio de venta
          <input className="campo" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="$"
            onKeyDown={(e) => e.key === 'Enter' && listo && !trabajando && (parecidos ? crear() : revisar())} />
        </label>
        <label className="etiqueta">Categoría (opcional)
          <select className="campo" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">Sin categoría</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </div>

      {parecidos ? (
        <div style={{ border: '1px solid var(--beige)' }}>
          <div style={{ padding: '12px 20px', background: 'var(--crema)' }}>
            <b>Ojo, ya hay productos parecidos.</b> <span className="muted">¿Es alguno de estos?</span>
          </div>
          {parecidos.map((f) => <FilaSugerida key={f.variante_id} f={f} onAgregar={onListo} />)}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--linea)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="small muted">Si no es ninguno, se crea “{nombre.trim()}” a {pesos(precioNum)}.</span>
            <button className="boton" disabled={trabajando} onClick={crear}>{trabajando ? 'Creando…' : 'No, es nuevo: crear'}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span className="small muted">Queda marcado para que Joan o Sele completen costo y variantes después.</span>
          <button className="boton" disabled={!listo || trabajando} onClick={revisar}>{trabajando ? 'Revisando…' : 'Crear y agregar a la venta'}</button>
        </div>
      )}
      {error && <div className="small error">{error}</div>}
    </div>
  )
}
