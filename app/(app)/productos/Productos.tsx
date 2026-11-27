'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, descargarCsv } from '@/lib/formato'
import { ProductoNuevo, type FilaParecida } from '../venta/ProductoNuevo'
import { type FilaCatalogo, type InfoProducto, type Opcion, textoVariante, leerNumero, margenTexto } from './comun'
import Ficha from './Ficha'
import Ingreso from './Ingreso'
import Agrupar from './Agrupar'

type Filtro = 'todos' | 'sin_stock' | 'bajo_minimo' | 'sin_precio' | 'sin_costo' | 'revisar'
type Grupo = { id: number; codigo: string; nombre: string; categoria: string | null; revisar: boolean; variantes: FilaCatalogo[] }

const POR_PAGINA = 150

export default function Productos({ esAdmin, categorias, avisos }: { esAdmin: boolean; categorias: Opcion[]; avisos?: React.ReactNode }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [filas, setFilas] = useState<FilaCatalogo[] | null>(null)
  const [info, setInfo] = useState<Map<number, InfoProducto>>(new Map())
  const [costos, setCostos] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [categoria, setCategoria] = useState('')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const [elegida, setElegida] = useState<number | null>(null)
  const [panel, setPanel] = useState<'nada' | 'nuevo' | 'ingreso' | 'agrupar'>('nada')
  const [contando, setContando] = useState(false)
  const [conteo, setConteo] = useState<Record<number, string>>({})
  const [guardandoConteo, setGuardandoConteo] = useState(false)
  const [aviso, setAviso] = useState('')
  const [mostrar, setMostrar] = useState(POR_PAGINA)

  const cargar = useCallback(async () => {
    const [cat, prods, cos] = await Promise.all([
      supabase.from('catalogo').select('producto_id, producto_codigo, producto, categoria, en_web, variante_id, codigo, atributos, precio, stock_minimo, activo, stock').order('producto').order('codigo').limit(5000),
      supabase.from('productos').select('id, nombre, categoria_id, revisar').eq('activo', true).limit(5000),
      esAdmin ? supabase.from('costos_variante').select('variante_id, costo').limit(10000) : Promise.resolve({ data: [], error: null }),
    ])
    if (cat.error) return setError('No se pudo leer el catálogo: ' + cat.error.message)
    setFilas((cat.data ?? []) as FilaCatalogo[])
    setInfo(new Map(((prods.data ?? []) as InfoProducto[]).map((p) => [p.id, p])))
    setCostos(new Map(((cos.data ?? []) as { variante_id: number; costo: number }[]).filter((c) => c.costo != null).map((c) => [c.variante_id, Number(c.costo)])))
  }, [supabase, esAdmin])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { setMostrar(POR_PAGINA) }, [busqueda, filtro, categoria])

  const cumple = useCallback((v: FilaCatalogo) => {
    switch (filtro) {
      case 'sin_stock': return v.activo && v.stock <= 0
      case 'bajo_minimo': return v.activo && v.stock_minimo > 0 && v.stock < v.stock_minimo
      case 'sin_precio': return v.activo && !(Number(v.precio) > 0)
      case 'sin_costo': return v.activo && !costos.has(v.variante_id)
      default: return true
    }
  }, [filtro, costos])

  const grupos = useMemo(() => {
    if (!filas) return []
    const q = busqueda.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const porProducto = new Map<number, Grupo>()
    for (const f of filas) {
      const g = porProducto.get(f.producto_id) ?? { id: f.producto_id, codigo: f.producto_codigo, nombre: f.producto, categoria: f.categoria, revisar: !!info.get(f.producto_id)?.revisar, variantes: [] }
      g.variantes.push(f)
      porProducto.set(f.producto_id, g)
    }
    return [...porProducto.values()].filter((g) => {
      if (categoria && g.categoria !== categoria) return false
      if (filtro === 'revisar' && !g.revisar) return false
      if (q) {
        const texto = (g.nombre + ' ' + g.codigo + ' ' + g.variantes.map((v) => v.codigo + ' ' + textoVariante(v.atributos)).join(' '))
          .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        if (!q.split(/\s+/).every((p) => texto.includes(p))) return false
      }
      return filtro === 'revisar' || filtro === 'todos' || g.variantes.some(cumple)
    })
  }, [filas, info, busqueda, categoria, filtro, cumple])

  const totales = useMemo(() => {
    const vs = filas ?? []
    return {
      productos: new Set(vs.map((v) => v.producto_id)).size,
      sinPrecio: vs.filter((v) => v.activo && !(Number(v.precio) > 0)).length,
      sinCosto: vs.filter((v) => v.activo && !costos.has(v.variante_id)).length,
      contados: vs.filter((v) => v.stock !== 0).length,
    }
  }, [filas, costos])

  const filaElegida = filas?.find((f) => f.variante_id === elegida) ?? null
  const conteoListo = Object.entries(conteo).filter(([, t]) => t.trim() !== '')

  async function guardarConteo() {
    setError('')
    const items = conteoListo.map(([id, t]) => ({ variante_id: Number(id), contado: leerNumero(t) }))
    if (items.some((i) => !Number.isInteger(i.contado) || i.contado < 0)) return setError('Revisá las cantidades: tienen que ser números enteros, 0 o más.')
    setGuardandoConteo(true)
    const { data, error } = await supabase.rpc('contar_stock', { p: { items } })
    setGuardandoConteo(false)
    if (error) return setError('No se pudo guardar el conteo: ' + error.message)
    setAviso(`Conteo guardado: ${items.length} productos contados, ${(data as { cambios: number }).cambios} con diferencia.`)
    setConteo({}); setContando(false)
    cargar()
  }

  function exportar() {
    descargarCsv('productos.csv', (filas ?? []).map((v) => ({
      Codigo: v.codigo, Producto: v.producto, Variante: textoVariante(v.atributos), Categoria: v.categoria ?? '',
      ...(esAdmin ? { Costo: costos.get(v.variante_id) ?? '' } : {}),
      Precio: v.precio ?? '', Stock: v.stock, Minimo: v.stock_minimo, Activa: v.activo ? 'Sí' : 'No',
    })))
  }

  const alternar = (id: number) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const elegir = (id: number) => { setElegida(id); setPanel('nada') }

  const chips: [Filtro, string][] = [
    ['todos', 'Todos'], ['sin_stock', 'Sin stock'], ['bajo_minimo', 'Debajo del mínimo'], ['sin_precio', `Sin precio (${totales.sinPrecio})`],
    ...(esAdmin ? [['sin_costo', `Sin costo cargado (${totales.sinCosto})`] as [Filtro, string]] : []),
    ['revisar', 'A revisar'],
  ]

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Productos y stock</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            {filas ? `${totales.productos} productos · ${totales.contados} con stock contado` : 'Cargando…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="boton-sec" onClick={exportar} disabled={!filas}>Exportar</button>
          <button className="boton-sec" aria-pressed={contando} onClick={() => { setContando((c) => !c); setConteo({}); setPanel('nada') }}
            style={contando ? { borderColor: 'var(--tinta)', fontWeight: 600 } : undefined}>{contando ? 'Salir del conteo' : 'Contar stock'}</button>
          <button className="boton-sec" onClick={() => { setPanel('ingreso'); setContando(false); setElegida(null) }}>Ingresar mercadería</button>
          {esAdmin && <button className="boton-sec" onClick={() => { setPanel('agrupar'); setContando(false); setElegida(null) }}>Unir variantes</button>}
          {esAdmin && <button className="boton" style={{ height: 'auto', padding: '10px 16px' }} onClick={() => { setPanel('nuevo'); setContando(false); setElegida(null) }}>Nuevo producto</button>}
        </div>
      </header>

      {avisos}

      {aviso && (
        <div role="status" style={{ background: '#F2F6EF', border: '1px solid #CFDCC6', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{aviso}</span>
          <button onClick={() => setAviso('')} style={{ border: 0, background: 'none', textDecoration: 'underline' }}>Cerrar</button>
        </div>
      )}
      {error && <div role="alert" className="error">{error}</div>}

      {panel === 'nuevo' && (
        <ProductoNuevo nombreInicial="" categorias={categorias} onCancelar={() => setPanel('nada')}
          onListo={async (f: FilaParecida) => {
            // Si lo crea un admin desde acá, no hace falta dejarlo "a revisar"
            await supabase.from('productos').update({ revisar: false }).eq('id', f.producto_id)
            setPanel('nada'); await cargar(); setBusqueda(f.producto); setElegida(f.variante_id)
          }} />
      )}
      {panel === 'agrupar' && filas && (
        <Agrupar filas={filas} onCerrar={() => setPanel('nada')} onListo={(texto) => { setAviso(texto); cargar() }} />
      )}
      {panel === 'ingreso' && filas && (
        <Ingreso filas={filas} esAdmin={esAdmin} costos={costos} onCerrar={() => setPanel('nada')}
          onListo={(texto) => { setPanel('nada'); setAviso(texto); cargar() }} />
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <label style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid var(--borde)', padding: '0 14px', height: 44 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B6560" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <span className="oculto">Buscar</span>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o código"
            style={{ flex: 1, border: 0, outline: 'none', background: 'transparent' }} />
        </label>
        <select className="campo" aria-label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ width: 200, height: 44 }}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
        </select>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {chips.map(([f, t]) => (
            <button key={f} type="button" className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{t}</button>
          ))}
        </div>
      </div>

      {contando && (
        <div className="panel" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', borderColor: 'var(--dorado)', background: 'var(--crema)', position: 'sticky', top: 0, zIndex: 3 }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <b>Modo conteo.</b> <span className="muted">Escribí cuántos hay en el local al lado de cada producto. Lo que dejes vacío no se toca. Usá el buscador y la categoría para ir por partes.</span>
          </div>
          <span className="muted">{conteoListo.length} contados</span>
          <button className="boton" disabled={!conteoListo.length || guardandoConteo} onClick={guardarConteo}>{guardandoConteo ? 'Guardando…' : 'Guardar conteo'}</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: filaElegida && !contando ? 'minmax(0, 1fr) 380px' : 'minmax(0, 1fr)', gap: 24, alignItems: 'start' }} className="grilla-productos">
        <section aria-label="Lista de productos" className="panel" style={{ minWidth: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--tinta-suave)', fontSize: 12, borderBottom: '1px solid var(--beige)', background: 'var(--crema)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 500 }}>Producto / variante</th>
                <th style={{ padding: '12px 8px', fontWeight: 500 }}>Código</th>
                {esAdmin && <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'right' }}>Costo</th>}
                {esAdmin && <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'right' }}>Margen</th>}
                <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'right' }}>Precio</th>
                <th style={{ padding: '12px 16px', fontWeight: 500, textAlign: 'right' }}>{contando ? 'Hay en el local' : 'Stock'}</th>
              </tr>
            </thead>
            <tbody>
              {filas === null && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>Cargando…</td></tr>}
              {filas && grupos.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 20 }}>No hay productos con ese filtro.</td></tr>}
              {grupos.slice(0, mostrar).map((g) => {
                const varias = g.variantes.length > 1
                const abierto = abiertos.has(g.id) || (varias && (busqueda.trim() !== '' || filtro !== 'todos' || contando))
                const stockTotal = g.variantes.reduce((s, v) => s + v.stock, 0)
                if (!varias) return <FilaVariante key={g.id} v={g.variantes[0]} titulo={g.nombre} sub={[g.categoria, g.revisar ? 'a revisar' : null].filter(Boolean).join(' · ')}
                  esAdmin={esAdmin} costo={costos.get(g.variantes[0].variante_id)} elegida={elegida === g.variantes[0].variante_id} onElegir={elegir}
                  contando={contando} conteo={conteo[g.variantes[0].variante_id] ?? ''} onConteo={(t) => setConteo((c) => ({ ...c, [g.variantes[0].variante_id]: t }))} />
                return [
                  <tr key={'g' + g.id} onClick={() => alternar(g.id)} style={{ background: abierto ? 'var(--fondo)' : undefined, borderBottom: '1px solid var(--linea)', cursor: 'pointer' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <button type="button" aria-expanded={abierto} onClick={(e) => { e.stopPropagation(); alternar(g.id) }}
                        style={{ border: 0, background: 'none', padding: 0, fontWeight: 600, fontSize: 14, textAlign: 'left' }}>{abierto ? '▾' : '▸'} {g.nombre}</button>
                      <div className="small muted">{[g.categoria, `${g.variantes.length} variantes`, g.revisar ? 'a revisar' : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td style={{ padding: '12px 8px' }} className="muted">{g.codigo}</td>
                    {esAdmin && <td />}{esAdmin && <td />}<td />
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{stockTotal}</td>
                  </tr>,
                  ...(abierto ? g.variantes.filter((v) => filtro === 'todos' || filtro === 'revisar' || cumple(v)).map((v) => (
                    <FilaVariante key={v.variante_id} v={v} titulo={textoVariante(v.atributos) || v.codigo} sub="" sangria
                      esAdmin={esAdmin} costo={costos.get(v.variante_id)} elegida={elegida === v.variante_id} onElegir={elegir}
                      contando={contando} conteo={conteo[v.variante_id] ?? ''} onConteo={(t) => setConteo((c) => ({ ...c, [v.variante_id]: t }))} />
                  )) : []),
                ]
              })}
            </tbody>
          </table>
          {grupos.length > mostrar && (
            <div style={{ padding: 14, textAlign: 'center', borderTop: '1px solid var(--linea)' }}>
              <span className="muted small">Mostrando {mostrar} de {grupos.length} · </span>
              <button onClick={() => setMostrar((m) => m + POR_PAGINA)} style={{ border: 0, background: 'none', textDecoration: 'underline', color: 'var(--dorado-texto)' }}>Ver más</button>
            </div>
          )}
        </section>

        {filaElegida && !contando && (
          <Ficha key={filaElegida.variante_id} fila={filaElegida} info={info.get(filaElegida.producto_id) ?? null}
            hermanas={(filas ?? []).filter((f) => f.producto_id === filaElegida.producto_id)}
            esAdmin={esAdmin} costo={costos.get(filaElegida.variante_id)} categorias={categorias}
            onCerrar={() => setElegida(null)} onCambio={cargar} onElegir={elegir} />
        )}
      </div>
    </>
  )
}

function FilaVariante({ v, titulo, sub, sangria, esAdmin, costo, elegida, onElegir, contando, conteo, onConteo }: {
  v: FilaCatalogo; titulo: string; sub: string; sangria?: boolean; esAdmin: boolean; costo?: number
  elegida: boolean; onElegir: (id: number) => void; contando: boolean; conteo: string; onConteo: (t: string) => void
}) {
  const precio = Number(v.precio) > 0 ? Number(v.precio) : null
  const bajo = v.stock_minimo > 0 && v.stock < v.stock_minimo
  return (
    <tr onClick={() => !contando && onElegir(v.variante_id)}
      style={{ borderBottom: '1px solid var(--linea)', cursor: contando ? 'default' : 'pointer', color: v.activo ? undefined : 'var(--apagado)',
        background: elegida ? 'var(--crema)' : undefined, outline: elegida ? '1.5px solid var(--dorado)' : undefined, outlineOffset: -1.5 }}>
      <td style={{ padding: sangria ? '10px 16px 10px 36px' : '12px 16px' }}>
        <div style={{ fontWeight: sangria ? (elegida ? 500 : 400) : 600, fontSize: sangria ? 13 : 14 }}>{titulo}</div>
        {!sangria && (textoVariante(v.atributos) || sub) && <div className="small muted">{[textoVariante(v.atributos), sub].filter(Boolean).join(' · ')}</div>}
      </td>
      <td style={{ padding: '10px 8px' }} className="muted">{v.codigo}</td>
      {esAdmin && (
        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
          {costo != null ? pesos(costo) : <span style={{ color: '#6E4E1E', textDecoration: 'underline' }}>Cargar costo</span>}
        </td>
      )}
      {esAdmin && <td style={{ padding: '10px 8px', textAlign: 'right' }} className={costo && precio ? undefined : 'muted'}>{costo && precio ? margenTexto(Math.round((precio / costo) * 100) / 100) : '—'}</td>}
      <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 500 }}>
        {precio ? pesos(precio) : <span style={{ color: 'var(--error)', fontWeight: 400 }}>Sin precio</span>}
      </td>
      <td style={{ padding: '6px 16px', textAlign: 'right' }} onClick={(e) => contando && e.stopPropagation()}>
        {contando ? (
          <input aria-label={'Cuántos hay de ' + titulo} inputMode="numeric" value={conteo} onChange={(e) => onConteo(e.target.value.replace(/[^\d]/g, ''))}
            placeholder={String(v.stock)} className="campo" style={{ width: 80, height: 34, textAlign: 'right' }} />
        ) : (
          <span style={{ fontWeight: 500, color: v.stock <= 0 ? 'var(--apagado)' : bajo ? 'var(--alerta)' : undefined }}>
            {v.stock}{bajo ? ' · bajo' : ''}
          </span>
        )}
      </td>
    </tr>
  )
}
