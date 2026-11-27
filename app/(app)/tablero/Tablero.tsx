'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, hoyCordoba } from '@/lib/formato'

type Mes = { mes: string; total: number; neto: number; cantidad: number; gastos: number; retiros: number; mercaderia: number }
type Fila = { nombre: string; cantidad?: number; total: number; comision?: number; unidades?: number; grupo?: string }
type Datos = {
  ventas: { cantidad: number; total: number; neto: number; comision: number; descuento: number; sin_facturar: number; sin_facturar_monto: number }
  gastos: Record<string, number> | null
  por_mes: Mes[]; por_canal: Fila[]; por_medio: Fila[]; por_vendedor: Fila[]; top_productos: Fila[]; top_gastos: Fila[]
}

// Paleta validada (scripts/validate_palette.js del skill de gráficos): azul = lo que entra, naranja = gastos
const AZUL = '#257de0'
const NARANJA = '#f47230'

const PERIODOS: [string, string][] = [['mes', 'Este mes'], ['3m', 'Últimos 3 meses'], ['6m', 'Últimos 6 meses'], ['anio', 'Este año'], ['12m', 'Últimos 12 meses']]
const rango = (p: string): [string, string] => {
  const hoy = hoyCordoba()
  const [a, m] = hoy.split('-').map(Number)
  const inicio = (meses: number) => new Date(Date.UTC(a, m - 1 - meses, 1)).toISOString().slice(0, 10)
  switch (p) {
    case '3m': return [inicio(2), hoy]
    case '6m': return [inicio(5), hoy]
    case 'anio': return [`${a}-01-01`, hoy]
    case '12m': return [inicio(11), hoy]
    default: return [inicio(0), hoy]
  }
}
const mesCorto = (m: string) => {
  const [a, n] = m.split('-').map(Number)
  return new Date(Date.UTC(a, n - 1, 15)).toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' }).replace('.', '') + ' ' + String(a).slice(2)
}
const millones = (n: number) => (Math.abs(n) >= 1e6 ? '$ ' + (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M' : pesos(n))
const GRUPOS: Record<string, string> = { mercaderia: 'Mercadería', fijos: 'Fijos', variables: 'Variables', mejoras: 'Mejoras', retiros: 'Retiros', sin_tipo: 'Sin tipo' }

export default function Tablero() {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [periodo, setPeriodo] = useState('3m')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [desde, hasta] = rango(periodo)

  useEffect(() => {
    let vigente = true
    setDatos(null); setError('')
    supabase.rpc('tablero', { p_desde: desde, p_hasta: hasta }).then(({ data, error }) => {
      if (!vigente) return
      if (error) setError('No se pudo armar el tablero: ' + error.message)
      else setDatos(data as Datos)
    })
    return () => { vigente = false }
  }, [supabase, desde, hasta])

  const g = datos?.gastos ?? {}
  const gastosSinRetiros = Object.entries(g).filter(([k]) => k !== 'retiros').reduce((s, [, v]) => s + Number(v), 0)
  const resultado = Number(datos?.ventas.neto ?? 0) - gastosSinRetiros
  const ticket = datos && datos.ventas.cantidad ? Number(datos.ventas.total) / datos.ventas.cantidad : 0

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Tablero</h1>
          <div className="muted" style={{ marginTop: 6 }}>Solo lo ven Joan y Sele · del {desde.split('-').reverse().join('/')} al {hasta.split('-').reverse().join('/')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PERIODOS.map(([k, t]) => <button key={k} className="chip" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}>{t}</button>)}
        </div>
      </header>

      {error && <div role="alert" className="error">{error}</div>}
      {!datos && !error && <div className="muted">Calculando…</div>}

      {datos && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
            <Tarjeta rotulo="Vendido" valor={millones(Number(datos.ventas.total))} nota={`${datos.ventas.cantidad} ventas`} />
            <Tarjeta rotulo="Entró (sin comisiones)" valor={millones(Number(datos.ventas.neto))} nota={`${pesos(datos.ventas.comision)} de comisiones`} />
            <Tarjeta rotulo="Gastos" valor={millones(gastosSinRetiros)} nota="sin contar retiros" />
            <Tarjeta rotulo="Resultado" valor={millones(resultado)} nota="entró − gastos" destacado color={resultado < 0 ? 'var(--error)' : 'var(--ok)'} />
            <Tarjeta rotulo="Retiros" valor={millones(Number(g.retiros ?? 0))} nota="retiros y casa" />
            <Tarjeta rotulo="Ticket promedio" valor={pesos(ticket)} nota={`${pesos(datos.ventas.descuento)} en descuentos`} />
          </div>

          <section className="panel" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h2>Lo que entra y lo que se gasta, por mes</h2>
              <div style={{ display: 'flex', gap: 16 }} className="small">
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: AZUL, borderRadius: 2 }} />Entró</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: NARANJA, borderRadius: 2 }} />Gastos (sin retiros)</span>
              </div>
            </div>
            <GraficoMeses meses={datos.por_mes} />
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <Lista titulo="Por canal" filas={datos.por_canal} total={Number(datos.ventas.total)} />
            <Lista titulo="Por medio de pago" filas={datos.por_medio} total={Number(datos.ventas.total)} extra={(f) => (Number(f.comision) > 0 ? `comisión ${pesos(f.comision)}` : '')} />
            <Lista titulo="Por vendedora" filas={datos.por_vendedor} total={Number(datos.ventas.total)} nota="Una venta compartida se reparte entre las que la hicieron." />
            <Lista titulo="Gastos que más pesan" filas={datos.top_gastos.map((f) => ({ ...f, nombre: f.nombre.charAt(0) + f.nombre.slice(1).toLowerCase() }))}
              total={Object.values(g).reduce((s, v) => s + Number(v), 0)} extra={(f) => GRUPOS[f.grupo ?? ''] ?? ''} />
            <Lista titulo="Productos más vendidos" filas={datos.top_productos} total={Number(datos.ventas.total)} extra={(f) => `${f.unidades} u.`}
              nota={datos.top_productos.length === 0 ? 'Las ventas viejas no tienen el detalle por producto; esto se llena con las ventas cargadas en el sistema.' : undefined} />
            <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 style={{ fontSize: 18 }}>Facturación</h2>
              <div style={{ fontFamily: 'var(--titulos)', fontSize: 28 }}>{datos.ventas.sin_facturar} ventas sin facturar</div>
              <div className="muted">{pesos(datos.ventas.sin_facturar_monto)} en el período</div>
              <a href="/facturacion" className="small" style={{ color: 'var(--dorado-texto)', textDecoration: 'underline' }}>Ir a Facturación</a>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function Tarjeta({ rotulo, valor, nota, destacado, color }: { rotulo: string; valor: string; nota?: string; destacado?: boolean; color?: string }) {
  return (
    <div className="tarjeta" style={destacado ? { borderColor: 'var(--tinta)' } : undefined}>
      <span className="rotulo">{rotulo}</span>
      <span className="valor" style={color ? { color } : undefined}>{valor}</span>
      {nota && <span className="small muted">{nota}</span>}
    </div>
  )
}

function Lista({ titulo, filas, total, extra, nota }: { titulo: string; filas: Fila[]; total: number; extra?: (f: Fila) => string; nota?: string }) {
  return (
    <section className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 18 }}>{titulo}</h2>
      {filas.length === 0 && <div className="muted small">Sin datos en el período.</div>}
      {filas.map((f) => {
        const pct = total > 0 ? Number(f.total) / total : 0
        return (
          <div key={f.nombre} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.nombre}{f.cantidad != null && <span className="muted"> · {f.cantidad}</span>}{extra && extra(f) && <span className="muted"> · {extra(f)}</span>}
              </span>
              <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{pesos(f.total)} <span className="muted small">{Math.round(pct * 100)}%</span></span>
            </div>
            <div style={{ height: 6, background: 'var(--linea)', borderRadius: 3 }} aria-hidden="true">
              <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: 'var(--dorado)', borderRadius: 3 }} />
            </div>
          </div>
        )
      })}
      {nota && <div className="small muted">{nota}</div>}
    </section>
  )
}

export function GraficoMeses({ meses }: { meses: Mes[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [tabla, setTabla] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  const [disponible, setDisponible] = useState(800)
  useEffect(() => {
    if (!caja.current) return
    const ro = new ResizeObserver(([e]) => setDisponible(Math.floor(e.contentRect.width)))
    ro.observe(caja.current)
    return () => ro.disconnect()
  }, [tabla])
  const alto = 240, izq = 64, abajo = 28
  const max = Math.max(1, ...meses.flatMap((m) => [Number(m.neto), Number(m.gastos)]))
  const paso = 10 ** Math.floor(Math.log10(max)); const tope = Math.ceil(max / paso) * paso
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope)
  const ancho = Math.max(disponible, meses.length * 56)
  const col = (ancho - izq) / Math.max(meses.length, 1)
  const barra = Math.min(26, col * 0.3)
  const y = (v: number) => alto - abajo - (v / tope) * (alto - abajo - 10)

  if (tabla) {
    return (
      <>
        <table className="tabla">
          <thead><tr><th>Mes</th><th className="num">Ventas</th><th className="num">Entró</th><th className="num">Gastos</th><th className="num">Resultado</th><th className="num">Retiros</th></tr></thead>
          <tbody>{meses.map((m) => (
            <tr key={m.mes} style={{ cursor: 'default' }}><td>{mesCorto(m.mes)}</td><td className="num">{m.cantidad}</td><td className="num">{pesos(m.neto)}</td>
              <td className="num">{pesos(m.gastos)}</td><td className="num">{pesos(Number(m.neto) - Number(m.gastos))}</td><td className="num">{pesos(m.retiros)}</td></tr>
          ))}</tbody>
        </table>
        <button className="small" onClick={() => setTabla(false)} style={{ marginTop: 8, border: 0, background: 'none', textDecoration: 'underline' }}>Ver gráfico</button>
      </>
    )
  }

  return (
    <div style={{ position: 'relative' }} ref={caja}>
      <div style={{ overflowX: 'auto' }}>
        <svg width={ancho} height={alto} role="img" aria-label="Gráfico de barras: lo que entró y los gastos de cada mes" style={{ display: 'block' }}>
          {marcas.map((v) => (
            <g key={v}>
              <line x1={izq} x2={ancho} y1={y(v)} y2={y(v)} stroke="#EFEBE5" />
              <text x={izq - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6B6560">{millones(v)}</text>
            </g>
          ))}
          {meses.map((m, i) => {
            const cx = izq + col * i + col / 2
            const hNeto = y(0) - y(Number(m.neto)), hGas = y(0) - y(Number(m.gastos))
            return (
              <g key={m.mes} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={izq + col * i} y={0} width={col} height={alto - abajo} fill={hover === i ? '#F7F5F2' : 'transparent'} />
                <path d={barraRedondeada(cx - barra - 1, y(0), barra, hNeto)} fill={AZUL} />
                <path d={barraRedondeada(cx + 1, y(0), barra, hGas)} fill={NARANJA} />
                <text x={cx} y={alto - 8} textAnchor="middle" fontSize="12" fill="#2B2B2B">{mesCorto(m.mes)}</text>
              </g>
            )
          })}
          <line x1={izq} x2={ancho} y1={y(0)} y2={y(0)} stroke="#CFC8BE" />
        </svg>
      </div>
      {hover !== null && meses[hover] && (
        <div role="tooltip" style={{ position: 'absolute', top: 4, left: Math.min(izq + col * hover + col / 2 + 10, ancho - 220), background: '#fff', border: '1px solid var(--beige)', boxShadow: '0 6px 18px rgba(0,0,0,.08)', padding: '10px 12px', fontSize: 13, pointerEvents: 'none', minWidth: 200 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{mesCorto(meses[hover].mes)} · {meses[hover].cantidad} ventas</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><span style={{ display: 'inline-block', width: 8, height: 8, background: AZUL, marginRight: 6 }} />Entró</span><b>{pesos(meses[hover].neto)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span><span style={{ display: 'inline-block', width: 8, height: 8, background: NARANJA, marginRight: 6 }} />Gastos</span><b>{pesos(meses[hover].gastos)}</b></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: '1px solid var(--linea)', marginTop: 6, paddingTop: 6 }}><span>Resultado</span><b>{pesos(Number(meses[hover].neto) - Number(meses[hover].gastos))}</b></div>
          <div className="small muted">Mercadería {pesos(meses[hover].mercaderia)} · retiros {pesos(meses[hover].retiros)}</div>
        </div>
      )}
      <button className="small" onClick={() => setTabla(true)} style={{ marginTop: 8, border: 0, background: 'none', textDecoration: 'underline' }}>Ver como tabla</button>
    </div>
  )
}

/** Barra con las puntas de arriba redondeadas (4px) y apoyada en la base. */
function barraRedondeada(x: number, base: number, w: number, h: number) {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`
}
