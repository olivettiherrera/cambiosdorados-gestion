'use client'

import { useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, fechaCorta, horaCordoba } from '@/lib/formato'
import { type FilaCatalogo, type InfoProducto, type Opcion, textoVariante, leerNumero, redondear900, MOTIVOS } from './comun'

type Movimiento = { fecha: string; motivo: string; cantidad: number; nota: string | null; usuario: string | null; venta: string | null }
type Par = { clave: string; valor: string }

const conMiles = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? Math.round(n).toLocaleString('es-AR') : '')
const aPares = (a: Record<string, string>) => Object.entries(a ?? {}).map(([clave, valor]) => ({ clave, valor }))
const deParesAObjeto = (ps: Par[]) => Object.fromEntries(ps.filter((p) => p.clave.trim() && p.valor.trim()).map((p) => [p.clave.trim(), p.valor.trim()]))

const rotulo: React.CSSProperties = { fontSize: 12, letterSpacing: 1, color: 'var(--tinta-suave)', textTransform: 'uppercase' }
const bloque: React.CSSProperties = { padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--linea)' }

/** Panel lateral de una variante: precio (costo × margen), stock con su historial, datos del producto y sus variantes. */
export default function Ficha({ fila, info, hermanas, esAdmin, costo, categorias, onCerrar, onCambio, onElegir }: {
  fila: FilaCatalogo; info: InfoProducto | null; hermanas: FilaCatalogo[]; esAdmin: boolean; costo?: number
  categorias: Opcion[]; onCerrar: () => void; onCambio: () => Promise<void> | void; onElegir: (id: number) => void
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const precioInicial = Number(fila.precio) > 0 ? Number(fila.precio) : null
  const [costoT, setCostoT] = useState(conMiles(costo))
  const [margenT, setMargenT] = useState(costo && precioInicial ? (Math.round((precioInicial / costo) * 100) / 100).toLocaleString('es-AR') : '')
  const [precioT, setPrecioT] = useState(conMiles(precioInicial))
  const [regla, setRegla] = useState<'mantener_margen' | 'mantener_precio'>('mantener_margen')
  const [minimo, setMinimo] = useState(String(fila.stock_minimo ?? 0))
  const [pares, setPares] = useState<Par[]>(aPares(fila.atributos))
  const [nombre, setNombre] = useState(info?.nombre ?? fila.producto)
  const [categoriaId, setCategoriaId] = useState(info?.categoria_id ? String(info.categoria_id) : '')
  const [revisar, setRevisar] = useState(!!info?.revisar)
  const [movs, setMovs] = useState<Movimiento[] | null>(null)
  const [ajustando, setAjustando] = useState(false)
  const [contado, setContado] = useState('')
  const [nueva, setNueva] = useState<{ pares: Par[]; precio: string } | null>(null)
  const [trabajando, setTrabajando] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('movimientos_variante', { p_variante: fila.variante_id }).then(({ data }) => setMovs((data ?? []) as Movimiento[]))
    if (esAdmin) supabase.from('variantes').select('regla_si_cambia_costo').eq('id', fila.variante_id).single()
      .then(({ data }) => data && setRegla(data.regla_si_cambia_costo))
  }, [supabase, fila.variante_id, fila.stock, esAdmin])

  // Costo × margen = precio (redondeado a 900). Cambiar el precio a mano recalcula el margen.
  const recalcular = (c: string, m: string) => {
    const cn = leerNumero(c), mn = Number(m.replace(',', '.'))
    if (cn > 0 && mn > 0) setPrecioT(conMiles(redondear900(cn * mn)))
  }
  const cambiarPrecio = (t: string) => {
    setPrecioT(t)
    const cn = leerNumero(costoT), pn = leerNumero(t)
    if (cn > 0 && pn > 0) setMargenT((Math.round((pn / cn) * 100) / 100).toLocaleString('es-AR'))
  }

  async function hacer(etiqueta: string, accion: () => Promise<string | null>, ok: string) {
    setError(''); setMensaje(''); setTrabajando(etiqueta)
    const fallo = await accion()
    setTrabajando('')
    if (fallo) return setError(fallo)
    setMensaje(ok)
    await onCambio()
  }

  const guardarVariante = () => hacer('variante', async () => {
    const p = leerNumero(precioT), c = leerNumero(costoT), m = Number(minimo)
    if (precioT.trim() && !(p > 0)) return 'El precio no es válido.'
    if (costoT.trim() && !(c > 0)) return 'El costo no es válido.'
    if (!Number.isInteger(m) || m < 0) return 'El mínimo tiene que ser 0 o más.'
    const { error } = await supabase.rpc('guardar_variante', { p: {
      variante_id: fila.variante_id, precio: precioT.trim() ? p : '', costo: costoT.trim() ? c : '',
      regla, stock_minimo: m, atributos: deParesAObjeto(pares),
    } })
    return error ? 'No se pudo guardar: ' + error.message : null
  }, 'Guardado.')

  const guardarProducto = () => hacer('producto', async () => {
    if (nombre.trim().length < 3) return 'Escribí el nombre del producto.'
    const { error } = await supabase.from('productos').update({ nombre: nombre.trim(), categoria_id: categoriaId ? Number(categoriaId) : null, revisar }).eq('id', fila.producto_id)
    return error ? 'No se pudo guardar el producto: ' + error.message : null
  }, 'Producto guardado.')

  const guardarAjuste = () => hacer('stock', async () => {
    const n = leerNumero(contado)
    if (!Number.isInteger(n) || n < 0) return 'Escribí cuántos hay (0 o más).'
    const { error } = await supabase.rpc('contar_stock', { p: { items: [{ variante_id: fila.variante_id, contado: n }] } })
    if (error) return 'No se pudo ajustar: ' + error.message
    setAjustando(false); setContado('')
    return null
  }, 'Stock actualizado.')

  const crearVariante = () => hacer('nueva', async () => {
    if (!nueva) return null
    const atributos = deParesAObjeto(nueva.pares)
    if (!Object.keys(atributos).length) return 'Poné al menos un dato de la variante (ej: Color → Rojo).'
    const p = leerNumero(nueva.precio)
    const { data, error } = await supabase.rpc('agregar_variante', { p: { producto_id: fila.producto_id, atributos, precio: p > 0 ? p : '' } })
    if (error) return 'No se pudo crear la variante: ' + error.message
    setNueva(null)
    setTimeout(() => onElegir(data as number), 300)
    return null
  }, 'Variante creada.')

  const descVariante = textoVariante(fila.atributos)

  return (
    <aside aria-label="Detalle del producto" className="panel" style={{ flex: '1 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
      <div style={{ ...bloque, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="small muted">{fila.producto} · {fila.codigo}</div>
          <h2 style={{ marginTop: 4 }}>{descVariante || fila.producto}</h2>
        </div>
        <button aria-label="Cerrar detalle" onClick={onCerrar} style={{ border: 0, background: 'none', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
      </div>

      {(mensaje || error) && (
        <div role={error ? 'alert' : 'status'} style={{ padding: '10px 24px', background: error ? '#FBEFEC' : '#F2F6EF', color: error ? 'var(--error)' : '#2F5229', fontSize: 13 }}>
          {error || mensaje}
        </div>
      )}

      <div style={bloque}>
        <div style={rotulo}>Precio</div>
        {esAdmin ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label className="etiqueta" style={{ flex: '1 1 90px' }}>Costo de compra
                <input className="campo" inputMode="decimal" value={costoT} placeholder="$"
                  onChange={(e) => { setCostoT(e.target.value); recalcular(e.target.value, margenT) }} />
              </label>
              <span className="muted" style={{ paddingBottom: 10 }}>×</span>
              <label className="etiqueta" style={{ flex: '0 1 64px' }}>Margen
                <input className="campo" inputMode="decimal" value={margenT} placeholder="2,4"
                  onChange={(e) => { setMargenT(e.target.value); recalcular(costoT, e.target.value) }} />
              </label>
              <span className="muted" style={{ paddingBottom: 10 }}>=</span>
              <label className="etiqueta" style={{ flex: '1 1 100px' }}>Precio de venta
                <input className="campo" inputMode="decimal" value={precioT} placeholder="$" onChange={(e) => cambiarPrecio(e.target.value)}
                  style={{ borderColor: 'var(--tinta)', fontWeight: 600 }} />
              </label>
            </div>
            <div className="small muted">Con costo y margen, el precio se redondea para que termine en 900. También podés escribir el precio directo.</div>
            <div style={{ background: 'var(--fondo)', padding: '12px 14px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontWeight: 500 }}>Si cambia el costo (al ingresar mercadería)</div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="radio" name={'regla' + fila.variante_id} checked={regla === 'mantener_margen'} onChange={() => setRegla('mantener_margen')} /> Mantener el margen (sube el precio)
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="radio" name={'regla' + fila.variante_id} checked={regla === 'mantener_precio'} onChange={() => setRegla('mantener_precio')} /> Mantener el precio (baja el margen)
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <label className="etiqueta" style={{ width: 110 }}>Stock mínimo
                <input className="campo" inputMode="numeric" value={minimo} onChange={(e) => setMinimo(e.target.value.replace(/[^\d]/g, ''))} />
              </label>
              <div className="etiqueta" style={{ flex: 1, minWidth: 200 }}>Variante (color, medida…)
                {pares.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input className="campo" aria-label="Dato" value={p.clave} placeholder="Color" onChange={(e) => setPares((ps) => ps.map((x, j) => (j === i ? { ...x, clave: e.target.value } : x)))} style={{ height: 34 }} />
                    <input className="campo" aria-label="Valor" value={p.valor} placeholder="Negro" onChange={(e) => setPares((ps) => ps.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} style={{ height: 34 }} />
                  </div>
                ))}
                <button type="button" onClick={() => setPares((ps) => [...ps, { clave: '', valor: '' }])}
                  style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', textDecoration: 'underline', color: 'var(--dorado-texto)', fontSize: 12 }}>+ agregar dato</button>
              </div>
            </div>
            <button className="boton" onClick={guardarVariante} disabled={trabajando === 'variante'}>{trabajando === 'variante' ? 'Guardando…' : 'Guardar precio y datos'}</button>
          </>
        ) : (
          <div style={{ fontFamily: 'var(--titulos)', fontSize: 28 }}>{precioInicial ? pesos(precioInicial) : <span className="error" style={{ fontSize: 16 }}>Sin precio cargado</span>}</div>
        )}
      </div>

      <div style={bloque}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={rotulo}>Stock · {fila.stock} en el local</div>
          {!ajustando && <button onClick={() => { setAjustando(true); setContado(String(Math.max(fila.stock, 0))) }}
            style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--dorado-texto)' }}>Ajustar</button>}
        </div>
        {ajustando && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label className="etiqueta" style={{ flex: 1 }}>¿Cuántos hay en el local?
              <input className="campo" autoFocus inputMode="numeric" value={contado} onChange={(e) => setContado(e.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && guardarAjuste()} />
            </label>
            <button className="boton" style={{ height: 40 }} disabled={trabajando === 'stock'} onClick={guardarAjuste}>Guardar</button>
            <button className="boton-sec" style={{ height: 40 }} onClick={() => setAjustando(false)}>Cancelar</button>
          </div>
        )}
        <div className="small muted">Mínimo: {fila.stock_minimo || 'sin definir'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          {movs === null && <span className="muted">Cargando movimientos…</span>}
          {movs?.length === 0 && <span className="muted">Todavía no tiene movimientos. Cargá el conteo inicial con “Ajustar”.</span>}
          {movs?.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: i < movs.length - 1 ? '1px solid var(--linea)' : 0 }}>
              <span>
                {m.venta ? `Venta ${m.venta}` : MOTIVOS[m.motivo] ?? m.motivo}{m.usuario ? ` · ${m.usuario}` : ''}
                <span className="small muted"> · {fechaCorta(m.fecha)} {horaCordoba(m.fecha)}{m.nota && !m.nota.startsWith('Conteo:') ? ` · ${m.nota}` : ''}</span>
              </span>
              <span style={{ color: m.cantidad < 0 ? 'var(--error)' : 'var(--ok)', whiteSpace: 'nowrap' }}>{m.cantidad > 0 ? '+ ' : '− '}{Math.abs(m.cantidad)}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ ...bloque, borderBottom: esAdmin ? bloque.borderBottom : 0 }}>
        <div style={rotulo}>Variantes del producto ({hermanas.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {hermanas.map((h) => (
            <button key={h.variante_id} onClick={() => onElegir(h.variante_id)} disabled={h.variante_id === fila.variante_id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: 0, borderBottom: '1px solid var(--linea)', background: h.variante_id === fila.variante_id ? 'var(--crema)' : '#fff', padding: '8px 4px', textAlign: 'left', cursor: h.variante_id === fila.variante_id ? 'default' : 'pointer', opacity: 1 }}>
              <span>{textoVariante(h.atributos) || 'Única'} <span className="small muted">{h.codigo}</span></span>
              <span className="small">{Number(h.precio) > 0 ? pesos(h.precio) : 'sin precio'} · {h.stock}</span>
            </button>
          ))}
        </div>
        {esAdmin && !nueva && (
          <button className="boton-sec" onClick={() => setNueva({ pares: [{ clave: Object.keys(fila.atributos ?? {})[0] ?? 'Color', valor: '' }], precio: precioT })}>Agregar variante</button>
        )}
        {esAdmin && nueva && (
          <div style={{ background: 'var(--fondo)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nueva.pares.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <input className="campo" aria-label="Dato" value={p.clave} placeholder="Color" style={{ height: 34 }}
                  onChange={(e) => setNueva((n) => n && { ...n, pares: n.pares.map((x, j) => (j === i ? { ...x, clave: e.target.value } : x)) })} />
                <input className="campo" aria-label="Valor" value={p.valor} placeholder="Rojo" style={{ height: 34 }} autoFocus={i === 0}
                  onChange={(e) => setNueva((n) => n && { ...n, pares: n.pares.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) })} />
              </div>
            ))}
            <button type="button" onClick={() => setNueva((n) => n && { ...n, pares: [...n.pares, { clave: '', valor: '' }] })}
              style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', textDecoration: 'underline', color: 'var(--dorado-texto)', fontSize: 12 }}>+ agregar dato</button>
            <label className="etiqueta">Precio de venta
              <input className="campo" inputMode="decimal" value={nueva.precio} onChange={(e) => setNueva((n) => n && { ...n, precio: e.target.value })} placeholder="$" />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="boton" style={{ flex: 1 }} disabled={trabajando === 'nueva'} onClick={crearVariante}>Crear variante</button>
              <button className="boton-sec" onClick={() => setNueva(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {esAdmin && (
        <div style={{ ...bloque, borderBottom: 0 }}>
          <div style={rotulo}>Producto</div>
          <label className="etiqueta">Nombre
            <input className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="etiqueta">Categoría
            <select className="campo" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={revisar} onChange={(e) => setRevisar(e.target.checked)} /> A revisar (cargado al vuelo, falta completar)
          </label>
          <button className="boton-sec" onClick={guardarProducto} disabled={trabajando === 'producto'}>{trabajando === 'producto' ? 'Guardando…' : 'Guardar producto'}</button>
        </div>
      )}
    </aside>
  )
}
