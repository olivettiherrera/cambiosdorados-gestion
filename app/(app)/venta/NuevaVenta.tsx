'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { ProductoNuevo, QuisisteDecir, type FilaParecida } from './ProductoNuevo'

export type Opcion = { id: number; nombre: string }
export type MedioPago = { id: number; nombre: string; descuento_pct: number; comision_pct: number }

type FilaCatalogo = {
  producto_id: number; producto: string; categoria: string | null; en_web: boolean
  variante_id: number; codigo: string; atributos: Record<string, string>; precio: number | null; stock: number
}
type Producto = { id: number; nombre: string; categoria: string | null; en_web: boolean; variantes: FilaCatalogo[] }
type Renglon = { variante_id: number; descripcion: string; precio: number; cantidad: number }
type Resultado = { numero: string; total_lista: number; descuento: number; total: number; comision: number; neto: number }

const pesos = (n: number) => '$ ' + Math.round(n).toLocaleString('es-AR')
const descripcionVariante = (a: Record<string, string>) => Object.values(a).join(' · ')

export default function NuevaVenta({ canales, medios, vendedores, vendedorInicial, categorias }: {
  canales: Opcion[]; medios: MedioPago[]; vendedores: Opcion[]; vendedorInicial: number | null; categorias: Opcion[]
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<Producto[]>([])
  const [buscando, setBuscando] = useState(false)
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [medioId, setMedioId] = useState<number>(medios[0]?.id)
  const [canalId, setCanalId] = useState<number>(canales[0]?.id)
  const [vendedorIds, setVendedorIds] = useState<number[]>(vendedorInicial ? [vendedorInicial] : [])
  const [cliente, setCliente] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState<Resultado | null>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const [altaNueva, setAltaNueva] = useState<string | null>(null)

  // Búsqueda con una pequeña espera mientras se escribe
  useEffect(() => {
    const q = busqueda.trim()
    if (q.length < 2) { setProductos([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      const patron = `%${q.replace(/[%_,()]/g, ' ')}%`
      const { data } = await supabase
        .from('catalogo')
        .select('producto_id, producto, categoria, en_web, variante_id, codigo, atributos, precio, stock')
        .eq('activo', true)
        .or(`producto.ilike.${patron},codigo.ilike.${patron}`)
        .order('producto')
        .limit(80)
      const porProducto = new Map<number, Producto>()
      for (const f of (data ?? []) as FilaCatalogo[]) {
        const p = porProducto.get(f.producto_id) ?? { id: f.producto_id, nombre: f.producto, categoria: f.categoria, en_web: f.en_web, variantes: [] }
        p.variantes.push(f)
        porProducto.set(f.producto_id, p)
      }
      setProductos([...porProducto.values()].slice(0, 12))
      setBuscando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda, supabase])

  const medio = medios.find((m) => m.id === medioId)
  const lista = renglones.reduce((s, r) => s + r.precio * r.cantidad, 0)
  const descuento = Math.round(lista * (medio?.descuento_pct ?? 0)) / 100
  const total = lista - descuento
  const comision = Math.round(total * (medio?.comision_pct ?? 0)) / 100
  const unidades = renglones.reduce((s, r) => s + r.cantidad, 0)

  function agregar(v: FilaCatalogo, nombre: string) {
    if (v.precio == null) return
    setHecho(null)
    setRenglones((rs) => {
      const i = rs.findIndex((r) => r.variante_id === v.variante_id)
      if (i >= 0) return rs.map((r, j) => (j === i ? { ...r, cantidad: r.cantidad + 1 } : r))
      const variante = descripcionVariante(v.atributos)
      return [...rs, { variante_id: v.variante_id, descripcion: nombre + (variante ? ' · ' + variante : ''), precio: Number(v.precio), cantidad: 1 }]
    })
  }
  // Producto elegido entre los parecidos o recién creado
  function agregarParecido(f: FilaParecida) {
    agregar(f as unknown as FilaCatalogo, f.producto)
    setAltaNueva(null); setBusqueda(''); setProductos([])
    buscador.current?.focus()
  }
  const cambiarCantidad = (id: number, d: number) =>
    setRenglones((rs) => rs.flatMap((r) => (r.variante_id !== id ? [r] : r.cantidad + d <= 0 ? [] : [{ ...r, cantidad: r.cantidad + d }])))
  const alternarVendedor = (id: number) =>
    setVendedorIds((vs) => (vs.includes(id) ? vs.filter((x) => x !== id) : [...vs, id]))

  async function confirmar() {
    setError('')
    if (renglones.length === 0) return setError('Agregá al menos un producto.')
    if (vendedorIds.length === 0) return setError('Elegí quién vendió.')
    setGuardando(true)
    const { data, error } = await supabase.rpc('registrar_venta', {
      p: {
        canal_id: canalId, medio_pago_id: medioId, cliente_texto: cliente.trim() || null, vendedor_ids: vendedorIds,
        items: renglones.map((r) => ({ variante_id: r.variante_id, cantidad: r.cantidad })),
      },
    })
    setGuardando(false)
    if (error) return setError('No se pudo guardar la venta: ' + error.message)
    setHecho(data as Resultado)
    setRenglones([]); setCliente(''); setBusqueda(''); setProductos([])
    buscador.current?.focus()
  }

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <header>
        <h1>Nueva venta</h1>
        <div className="muted" style={{ marginTop: 6, textTransform: 'none' }}>{hoy.charAt(0).toUpperCase() + hoy.slice(1)}</div>
      </header>

      {hecho && (
        <div role="status" style={{ background: '#F2F6EF', border: '1px solid #CFDCC6', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span><strong style={{ color: '#2F5229' }}>Venta {hecho.numero} guardada.</strong> Cobrado {pesos(hecho.total)}
            {hecho.comision > 0 && <> · entra {pesos(hecho.neto)} después de la comisión</>}</span>
          <span className="muted small">Se puede facturar desde Facturación</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <section aria-label="Productos" style={{ flex: '3 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fff', border: '1px solid var(--borde)', padding: '0 16px', height: 52 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B6560" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <span className="oculto">Buscar producto</span>
            <input ref={buscador} autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Florero, difusor, 000412…" style={{ flex: 1, border: 0, outline: 'none', fontSize: 16, background: 'transparent' }} />
            <span className="small muted">{buscando ? 'Buscando…' : 'por nombre o código'}</span>
          </label>

          {altaNueva !== null ? (
            <ProductoNuevo key={altaNueva} nombreInicial={altaNueva} categorias={categorias}
              onListo={agregarParecido} onCancelar={() => setAltaNueva(null)} />
          ) : (
            <>
              {busqueda.trim().length >= 2 && !buscando && productos.length === 0 && (
                <div className="panel">
                  <div style={{ padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span className="muted">No encontré productos con “{busqueda.trim()}”.</span>
                    <button className="boton" onClick={() => setAltaNueva(busqueda.trim())}>Cargar producto nuevo</button>
                  </div>
                  <QuisisteDecir texto={busqueda.trim()} onAgregar={agregarParecido} />
                </div>
              )}

              {productos.length > 0 && (
                <div className="panel">
                  {productos.map((p) => <TarjetaProducto key={p.id} producto={p} onAgregar={agregar} />)}
                  <div style={{ padding: '12px 20px', borderTop: '1px solid var(--linea)' }} className="small">
                    <span className="muted">¿No es ninguno? </span>
                    <button onClick={() => setAltaNueva(busqueda.trim())} style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--dorado-texto)' }}>Cargar producto nuevo</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section aria-label="Venta en curso" className="panel" style={{ flex: '2 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--linea)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Venta en curso</h2>
            <span className="muted" style={{ fontSize: 13 }}>{unidades} {unidades === 1 ? 'producto' : 'productos'}</span>
          </div>

          <div style={{ padding: '8px 24px' }}>
            {renglones.length === 0 && <div className="muted" style={{ padding: '16px 0' }}>Buscá un producto y agregalo.</div>}
            {renglones.map((r, i) => (
              <div key={r.variante_id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: i < renglones.length - 1 ? '1px solid var(--linea)' : 0 }}>
                <div style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{r.descripcion}</div>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--borde)' }}>
                  <button aria-label={'Restar ' + r.descripcion} onClick={() => cambiarCantidad(r.variante_id, -1)} style={{ width: 32, height: 32, border: 0, background: '#fff' }}>−</button>
                  <span style={{ width: 28, textAlign: 'center' }}>{r.cantidad}</span>
                  <button aria-label={'Sumar ' + r.descripcion} onClick={() => cambiarCantidad(r.variante_id, 1)} style={{ width: 32, height: 32, border: 0, background: '#fff' }}>+</button>
                </div>
                <div style={{ width: 90, textAlign: 'right', fontWeight: 500 }}>{pesos(r.precio * r.cantidad)}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: '16px 24px', background: 'var(--fondo)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small muted" style={{ marginBottom: 8 }}>Medio de pago</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {medios.map((m) => (
                  <button key={m.id} type="button" className="chip" aria-pressed={m.id === medioId} onClick={() => setMedioId(m.id)}>{m.nombre}</button>
                ))}
              </div>
            </fieldset>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small muted" style={{ marginBottom: 8 }}>Vendió</legend>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {vendedores.map((v) => (
                  <button key={v.id} type="button" className="chip" aria-pressed={vendedorIds.includes(v.id)} onClick={() => alternarVendedor(v.id)}>{v.nombre}</button>
                ))}
              </div>
            </fieldset>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label className="etiqueta" style={{ flex: '1 1 140px' }}>Canal
                <select className="campo" value={canalId} onChange={(e) => setCanalId(Number(e.target.value))}>
                  {canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              <label className="etiqueta" style={{ flex: '2 1 200px' }}>Cliente (opcional)
                <input className="campo" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Nombre" />
              </label>
            </div>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--linea)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }} className="muted"><span>Subtotal (precio de lista)</span><span>{pesos(lista)}</span></div>
            {descuento > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ok)' }}>
                <span>{medio?.descuento_pct}% off por {medio?.nombre.toLowerCase()}</span><span>− {pesos(descuento)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>Total a cobrar</span>
              <span style={{ fontFamily: 'var(--titulos)', fontSize: 34 }}>{pesos(total)}</span>
            </div>
            {comision > 0 && <div className="small muted" style={{ textAlign: 'right' }}>Entra aprox. {pesos(total - comision)} después de la comisión de {medio?.nombre}</div>}
            {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 13 }}>{error}</div>}
            <button className="boton" style={{ marginTop: 10, height: 52, fontSize: 16 }} onClick={confirmar} disabled={guardando || renglones.length === 0}>
              {guardando ? 'Guardando…' : 'Confirmar venta'}
            </button>
            <div className="small muted" style={{ textAlign: 'center' }}>Se factura después, desde Facturación</div>
          </div>
        </section>
      </div>
    </>
  )
}

/** Un producto con sus variantes: un grupo de botones por atributo (Color, Medidas, Aroma…). */
function TarjetaProducto({ producto, onAgregar }: { producto: Producto; onAgregar: (v: FilaCatalogo, nombre: string) => void }) {
  const claves = useMemo(() => {
    const ks: string[] = []
    producto.variantes.forEach((v) => Object.keys(v.atributos ?? {}).forEach((k) => { if (!ks.includes(k)) ks.push(k) }))
    return ks
  }, [producto])
  const [eleccion, setEleccion] = useState<Record<string, string>>(() => ({ ...(producto.variantes[0]?.atributos ?? {}) }))

  const elegida = producto.variantes.find((v) => claves.every((k) => (v.atributos ?? {})[k] === eleccion[k])) ?? (claves.length === 0 ? producto.variantes[0] : undefined)
  const precios = producto.variantes.map((v) => Number(v.precio)).filter((n) => n > 0)

  return (
    <div style={{ padding: 20, display: 'flex', gap: 20, borderBottom: '1px solid var(--linea)' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{producto.nombre}</div>
            <div className="small muted">{[producto.categoria, producto.en_web ? 'En la web' : 'Solo en el local'].filter(Boolean).join(' · ')}</div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {elegida?.precio != null ? pesos(Number(elegida.precio)) : precios.length ? 'desde ' + pesos(Math.min(...precios)) : 'Sin precio'}
          </div>
        </div>
        {claves.map((k) => {
          const valores = [...new Set(producto.variantes.map((v) => (v.atributos ?? {})[k]).filter(Boolean))]
          return (
            <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="small muted" style={{ width: 64 }}>{k}</span>
              {valores.map((val) => (
                <button key={val} type="button" className="chip" aria-pressed={eleccion[k] === val}
                  onClick={() => setEleccion((e) => ({ ...e, [k]: val }))}>{val}</button>
              ))}
            </div>
          )
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="small" style={{ color: elegida && elegida.stock > 0 ? 'var(--ok)' : 'var(--apagado)' }}>
            {!elegida ? 'Esa combinación no existe' : elegida.stock > 0 ? `${elegida.stock} en el local` : 'Stock sin contar'}
          </span>
          <button className="boton" type="button" disabled={!elegida || elegida.precio == null}
            onClick={() => elegida && onAgregar(elegida, producto.nombre)}>Agregar a la venta</button>
        </div>
      </div>
    </div>
  )
}
