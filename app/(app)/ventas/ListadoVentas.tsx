'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, hoyCordoba, fechaCorta, horaCordoba, descargarCsv } from '@/lib/formato'

type Opcion = { id: number; nombre: string }
type Venta = {
  id: number; numero: string; fecha: string; dia: string; canal: string | null; canal_id: number | null
  cliente: string | null; total_lista: number; total: number; comision: number; neto: number
  estado: 'confirmada' | 'sena' | 'anulada'; origen: string; observacion: string | null
  medios: string | null; medio_ids: number[] | null; vendedores: string | null
  productos: string | null; unidades: number; facturada: boolean
}
type Item = { descripcion: string; cantidad: number; precio_lista: number; precio_final: number }

const POR_PAGINA = 100
const mesActual = () => hoyCordoba().slice(0, 7)
const finDeMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

export default function ListadoVentas({ esAdmin, canales, medios, vendedores }: {
  esAdmin: boolean; canales: Opcion[]; medios: Opcion[]; vendedores: Opcion[]
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [desde, setDesde] = useState(mesActual() + '-01')
  const [hasta, setHasta] = useState(hoyCordoba())
  const [canalId, setCanalId] = useState('')
  const [medioId, setMedioId] = useState('')
  const [vendedor, setVendedor] = useState('')
  const [texto, setTexto] = useState('')
  const [verAnuladas, setVerAnuladas] = useState(false)
  const [ventas, setVentas] = useState<Venta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [pagina, setPagina] = useState(0)
  const [abierta, setAbierta] = useState<Venta | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    let q = supabase.from('ventas_listado').select('*')
      .gte('dia', desde).lte('dia', hasta)
      .order('fecha', { ascending: false }).limit(5000)
    if (canalId) q = q.eq('canal_id', Number(canalId))
    if (medioId) q = q.contains('medio_ids', [Number(medioId)])
    if (vendedor) q = q.ilike('vendedores', `%${vendedor}%`)
    const { data, error } = await q
    if (error) setError(error.message)
    setVentas((data ?? []) as Venta[])
    setPagina(0)
    setCargando(false)
  }, [supabase, desde, hasta, canalId, medioId, vendedor])

  useEffect(() => { cargar() }, [cargar])

  const filtradas = useMemo(() => {
    const t = texto.trim().toLowerCase()
    return ventas.filter((v) =>
      (verAnuladas || v.estado !== 'anulada') &&
      (!t || [v.numero, v.cliente, v.productos, v.observacion].some((x) => x?.toLowerCase().includes(t))))
  }, [ventas, texto, verAnuladas])

  const totales = useMemo(() => {
    const validas = filtradas.filter((v) => v.estado !== 'anulada')
    const sum = (k: 'total' | 'comision' | 'neto' | 'total_lista') => validas.reduce((a, v) => a + Number(v[k]), 0)
    return { cantidad: validas.length, total: sum('total'), comision: sum('comision'), neto: sum('neto'),
      descuento: sum('total_lista') - sum('total'), sinFacturar: validas.filter((v) => !v.facturada).length }
  }, [filtradas])

  const elegirMes = (mes: string) => {
    if (!mes) return
    setDesde(mes + '-01')
    const fin = finDeMes(mes)
    setHasta(fin > hoyCordoba() ? hoyCordoba() : fin)
  }

  const exportar = () => descargarCsv(`ventas_${desde}_a_${hasta}.csv`, filtradas.map((v) => ({
    numero: v.numero, fecha: v.dia, hora: horaCordoba(v.fecha), canal: v.canal, cliente: v.cliente,
    productos: v.productos, unidades: v.unidades, medio: v.medios, vendedores: v.vendedores,
    precio_lista: Number(v.total_lista), cobrado: Number(v.total), comision: Number(v.comision), neto: Number(v.neto),
    estado: v.estado, ...(esAdmin ? { facturada: v.facturada ? 'sí' : 'no' } : {}), observacion: v.observacion,
  })))

  const visibles = filtradas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA)
  const paginas = Math.ceil(filtradas.length / POR_PAGINA)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1>Ventas</h1>
        <button className="boton-sec" onClick={exportar} disabled={!filtradas.length}>Descargar para Excel</button>
      </div>

      <div className="panel" style={{ padding: 16, display: 'grid', gridTemplateColumns: '140px 140px 140px 1fr 1fr 1fr 1.4fr', gap: 12, alignItems: 'end' }}>
        <label className="etiqueta">Mes
          <input className="campo" type="month" value={desde.slice(0, 7) === hasta.slice(0, 7) ? desde.slice(0, 7) : ''} onChange={(e) => elegirMes(e.target.value)} />
        </label>
        <label className="etiqueta">Desde<input className="campo" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="etiqueta">Hasta<input className="campo" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="etiqueta">Canal
          <select className="campo" value={canalId} onChange={(e) => setCanalId(e.target.value)}>
            <option value="">Todos</option>{canales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="etiqueta">Medio de pago
          <select className="campo" value={medioId} onChange={(e) => setMedioId(e.target.value)}>
            <option value="">Todos</option>{medios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="etiqueta">Vendedor
          <select className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            <option value="">Todos</option>{vendedores.map((c) => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}
          </select>
        </label>
        <label className="etiqueta">Buscar
          <input className="campo" placeholder="Cliente, producto o número" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <div className="tarjeta"><span className="rotulo">Ventas</span><span className="valor">{totales.cantidad}</span>
          <span className="small muted">Ticket promedio {pesos(totales.cantidad ? totales.total / totales.cantidad : 0)}</span></div>
        <div className="tarjeta"><span className="rotulo">Facturable</span><span className="valor">{pesos(totales.total)}</span>
          <span className="small muted">Lo que pagaron los clientes</span></div>
        <div className="tarjeta"><span className="rotulo">Comisiones</span><span className="valor">{pesos(totales.comision)}</span>
          <span className="small muted">Getnet, Mercado Pago, Nave</span></div>
        <div className="tarjeta" style={{ borderColor: 'var(--dorado)' }}><span className="rotulo">Entró</span><span className="valor">{pesos(totales.neto)}</span>
          <span className="small muted">Facturable menos comisiones</span></div>
        <div className="tarjeta"><span className="rotulo">Descuentos</span><span className="valor">{pesos(totales.descuento)}</span>
          <span className="small muted">15% efectivo y transferencia</span></div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="small muted">
        <span>{cargando ? 'Cargando…' : `${filtradas.length} ventas`}{esAdmin && !cargando ? ` · ${totales.sinFacturar} sin factura` : ''}
          {error && <span className="error"> · {error}</span>}</span>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} /> Mostrar anuladas
        </label>
      </div>

      <div className="panel" style={{ overflow: 'auto', maxHeight: '62vh' }}>
        <table className="tabla">
          <colgroup>
            <col style={{ width: 92 }} /><col style={{ width: 110 }} /><col style={{ width: 130 }} />
            <col style={{ width: 300 }} /><col style={{ width: 170 }} /><col style={{ width: 110 }} />
            <col style={{ width: 110 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} />
            {esAdmin && <col style={{ width: 80 }} />}
          </colgroup>
          <thead><tr>
            <th>Fecha</th><th>Canal</th><th>Cliente</th><th>Productos</th><th>Medio</th><th>Vendedor</th>
            <th className="num">Cobrado</th><th className="num">Comisión</th><th className="num">Entró</th>
            {esAdmin && <th>Factura</th>}
          </tr></thead>
          <tbody>
            {visibles.map((v) => (
              <tr key={v.id} className={v.estado === 'anulada' ? 'anulada' : ''} onClick={() => setAbierta(v)}>
                <td title={v.numero}>{fechaCorta(v.dia)}</td>
                <td>{v.canal ?? '—'}</td>
                <td title={v.cliente ?? ''}>{v.cliente || <span className="muted">—</span>}</td>
                <td title={v.productos ?? ''}>{v.productos ?? '—'}</td>
                <td title={v.medios ?? ''}>{v.medios ?? '—'}</td>
                <td>{v.vendedores ?? '—'}</td>
                <td className="num">{pesos(v.total)}</td>
                <td className="num muted">{Number(v.comision) ? pesos(v.comision) : '—'}</td>
                <td className="num">{pesos(v.neto)}</td>
                {esAdmin && <td>{v.facturada ? <span className="etiqueta-estado" style={{ color: 'var(--ok)' }}>Sí</span> : <span className="muted small">No</span>}</td>}
              </tr>
            ))}
            {!cargando && !visibles.length && <tr><td colSpan={10} className="muted" style={{ padding: 24, textAlign: 'center' }}>No hay ventas con estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button className="boton-sec" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span className="small muted">Página {pagina + 1} de {paginas}</span>
          <button className="boton-sec" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      )}

      {abierta && <DetalleVenta venta={abierta} esAdmin={esAdmin} cerrar={() => setAbierta(null)} alAnular={() => { setAbierta(null); cargar() }} />}
    </>
  )
}

function DetalleVenta({ venta, esAdmin, cerrar, alAnular }: { venta: Venta; esAdmin: boolean; cerrar: () => void; alAnular: () => void }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [items, setItems] = useState<Item[] | null>(null)
  const [motivo, setMotivo] = useState('')
  const [anulando, setAnulando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('venta_items').select('descripcion, cantidad, precio_lista, precio_final').eq('venta_id', venta.id).order('id')
      .then(({ data }) => setItems((data ?? []) as Item[]))
  }, [supabase, venta.id])

  const anular = async () => {
    setAnulando(true); setError('')
    const { error } = await supabase.rpc('anular_venta', { p_venta_id: venta.id, p_motivo: motivo })
    setAnulando(false)
    if (error) setError(error.message); else alAnular()
  }

  return (
    <aside className="lateral" onKeyDown={(e) => e.key === 'Escape' && cerrar()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div>
          <div className="small muted">{venta.numero}</div>
          <h2>{venta.cliente || 'Sin nombre'}</h2>
          <div className="small muted">{fechaCorta(venta.dia)} · {horaCordoba(venta.fecha)} · {venta.canal ?? 'Sin canal'}</div>
        </div>
        <button className="boton-sec" onClick={cerrar}>Cerrar</button>
      </div>

      {venta.estado === 'anulada' && <div className="etiqueta-estado error" style={{ alignSelf: 'start' }}>ANULADA</div>}

      <div>
        <div className="rotulo small muted" style={{ marginBottom: 6 }}>PRODUCTOS</div>
        {items === null ? <div className="muted small">Cargando…</div> : items.length ? items.map((it, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--linea)' }}>
            <span>{it.cantidad > 1 && `${it.cantidad}× `}{it.descripcion}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(it.precio_final)}</span>
          </div>
        )) : <div className="small">{venta.productos ?? 'Sin detalle'} <span className="muted">(venta histórica)</span></div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px' }}>
        <span className="muted">Precio de lista</span><span>{pesos(venta.total_lista)}</span>
        <span className="muted">Cobrado ({venta.medios})</span><span>{pesos(venta.total)}</span>
        <span className="muted">Comisión</span><span>{pesos(venta.comision)}</span>
        <span style={{ fontWeight: 500 }}>Entró</span><span style={{ fontWeight: 500 }}>{pesos(venta.neto)}</span>
      </div>

      <div className="small muted">Vendió: {venta.vendedores ?? '—'}{esAdmin && ` · Factura: ${venta.facturada ? 'sí' : 'no'}`} · Origen: {venta.origen}</div>
      {venta.observacion && <div className="small">{venta.observacion}</div>}

      {esAdmin && venta.estado !== 'anulada' && (
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--beige)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="etiqueta">Anular esta venta (el stock vuelve)
            <input className="campo" placeholder="Motivo (ej: se cargó dos veces)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <button className="boton-sec" style={{ color: 'var(--error)' }} disabled={!motivo.trim() || anulando} onClick={anular}>
            {anulando ? 'Anulando…' : 'Anular venta'}
          </button>
          {error && <div className="small error">{error}</div>}
        </div>
      )}
    </aside>
  )
}
