'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, hoyCordoba, fechaCorta, horaCordoba } from '@/lib/formato'

type Medio = { id: number; nombre: string; ventas: number; monto: number; comision: number; neto: number }
type Cierre = { efectivo_inicio: number; efectivo_contado: number; efectivo_esperado: number; efectivo_queda: number; nota: string | null; creado_en: string; detalle: { salidas?: number } }
type Resumen = { dia: string; medios: Medio[]; efectivo_inicio: number; cierre: Cierre | null }
type VentaDia = { id: number; fecha: string; cliente: string | null; productos: string | null; medios: string | null; total: number; estado: string }

const numero = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0

export default function CajaDelDia() {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [dia, setDia] = useState(hoyCordoba())
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [ventas, setVentas] = useState<VentaDia[]>([])
  const [contado, setContado] = useState('')
  const [salidas, setSalidas] = useState('')
  const [queda, setQueda] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    const [r, v] = await Promise.all([
      supabase.rpc('resumen_caja', { p_dia: dia }),
      supabase.from('ventas_listado').select('id, fecha, cliente, productos, medios, total, estado').eq('dia', dia).order('fecha'),
    ])
    if (r.error) setError(r.error.message)
    setResumen(r.data as Resumen)
    setVentas((v.data ?? []) as VentaDia[])
  }, [supabase, dia])

  useEffect(() => { cargar(); setContado(''); setSalidas(''); setQueda(''); setNota('') }, [cargar])

  if (!resumen) return <h1>Caja del día</h1>

  const medios = resumen.medios
  const total = medios.reduce((a, m) => a + Number(m.monto), 0)
  const comision = medios.reduce((a, m) => a + Number(m.comision), 0)
  const efectivoVentas = Number(medios.find((m) => m.nombre === 'Efectivo')?.neto ?? 0)
  const esperado = Number(resumen.efectivo_inicio) + efectivoVentas - numero(salidas)
  const diferencia = contado ? numero(contado) - esperado : null
  const cierre = resumen.cierre
  const esHoy = dia === hoyCordoba()

  const cerrar = async () => {
    setGuardando(true); setError('')
    const { error } = await supabase.rpc('cerrar_caja', { p: {
      dia, efectivo_contado: numero(contado), salidas: numero(salidas),
      efectivo_queda: queda ? numero(queda) : numero(contado), nota,
    } })
    setGuardando(false)
    if (error) setError(error.message); else cargar()
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1>Caja del día</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="campo" type="date" value={dia} max={hoyCordoba()} onChange={(e) => e.target.value && setDia(e.target.value)} style={{ width: 160 }} />
          {!esHoy && <button className="boton-sec" onClick={() => setDia(hoyCordoba())}>Hoy</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="panel">
            <table className="tabla" style={{ tableLayout: 'auto' }}>
              <thead><tr><th>Medio de pago</th><th className="num">Ventas</th><th className="num">Cobrado</th><th className="num">Comisión</th><th className="num">Entra</th></tr></thead>
              <tbody>
                {medios.map((m) => (
                  <tr key={m.id} style={{ cursor: 'default' }}>
                    <td>{m.nombre}</td><td className="num">{m.ventas}</td><td className="num">{pesos(m.monto)}</td>
                    <td className="num muted">{Number(m.comision) ? pesos(m.comision) : '—'}</td><td className="num">{pesos(m.neto)}</td>
                  </tr>
                ))}
                {!medios.length && <tr style={{ cursor: 'default' }}><td colSpan={5} className="muted" style={{ padding: 20, textAlign: 'center' }}>Todavía no hay ventas este día.</td></tr>}
              </tbody>
              {medios.length > 0 && <tfoot><tr>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>Total</td>
                <td className="num" style={{ padding: '10px 12px' }}>{ventas.filter((v) => v.estado !== 'anulada').length}</td>
                <td className="num" style={{ padding: '10px 12px', fontWeight: 500 }}>{pesos(total)}</td>
                <td className="num muted" style={{ padding: '10px 12px' }}>{pesos(comision)}</td>
                <td className="num" style={{ padding: '10px 12px', fontWeight: 500 }}>{pesos(total - comision)}</td>
              </tr></tfoot>}
            </table>
          </div>

          <div className="panel" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="tabla">
              <colgroup><col style={{ width: 64 }} /><col style={{ width: 130 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 110 }} /></colgroup>
              <thead><tr><th>Hora</th><th>Cliente</th><th>Productos</th><th>Medio</th><th className="num">Cobrado</th></tr></thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className={v.estado === 'anulada' ? 'anulada' : ''} style={{ cursor: 'default' }}>
                    <td>{horaCordoba(v.fecha)}</td><td>{v.cliente || '—'}</td><td title={v.productos ?? ''}>{v.productos}</td>
                    <td>{v.medios}</td><td className="num">{pesos(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>Efectivo</h2>
          {cierre ? (
            <>
              <div className="etiqueta-estado" style={{ alignSelf: 'start', color: 'var(--ok)' }}>Caja cerrada · {horaCordoba(cierre.creado_en)}</div>
              <Linea t="Arrancó con" v={cierre.efectivo_inicio} />
              <Linea t="Ventas en efectivo" v={efectivoVentas} />
              <Linea t="Salidas de caja" v={-(cierre.detalle?.salidas ?? 0)} />
              <Linea t="Esperado" v={cierre.efectivo_esperado} fuerte />
              <Linea t="Contado" v={cierre.efectivo_contado} fuerte />
              <Diferencia d={Number(cierre.efectivo_contado) - Number(cierre.efectivo_esperado)} />
              <Linea t="Quedó en caja para mañana" v={cierre.efectivo_queda} />
              {cierre.nota && <div className="small muted">{cierre.nota}</div>}
            </>
          ) : (
            <>
              <Linea t="Arrancó con (lo que quedó en el último cierre)" v={resumen.efectivo_inicio} />
              <Linea t="Ventas en efectivo" v={efectivoVentas} />
              <label className="etiqueta">Salidas de caja (pagos, retiros)
                <input className="campo" inputMode="decimal" placeholder="0" value={salidas} onChange={(e) => setSalidas(e.target.value)} />
              </label>
              <Linea t="Debería haber" v={esperado} fuerte />
              <label className="etiqueta">Efectivo contado
                <input className="campo" inputMode="decimal" placeholder="Contá la caja y anotalo" value={contado} onChange={(e) => setContado(e.target.value)} />
              </label>
              {diferencia !== null && <Diferencia d={diferencia} />}
              <label className="etiqueta">Queda en caja para mañana
                <input className="campo" inputMode="decimal" placeholder={contado ? `${numero(contado).toLocaleString('es-AR')} (todo)` : 'Si retirás algo, poné lo que queda'} value={queda} onChange={(e) => setQueda(e.target.value)} />
              </label>
              <label className="etiqueta">Nota
                <input className="campo" placeholder="Opcional" value={nota} onChange={(e) => setNota(e.target.value)} />
              </label>
              <button className="boton" disabled={!contado || guardando} onClick={cerrar}>
                {guardando ? 'Cerrando…' : `Cerrar caja del ${fechaCorta(dia)}`}
              </button>
              <div className="small muted">Una vez cerrada no se puede volver a cerrar ese día.</div>
            </>
          )}
          {error && <div className="small error">{error}</div>}
        </div>
      </div>
    </>
  )
}

function Linea({ t, v, fuerte }: { t: string; v: number; fuerte?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: fuerte ? 500 : 400 }}>
      <span className={fuerte ? '' : 'muted'}>{t}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{pesos(v)}</span>
    </div>
  )
}

function Diferencia({ d }: { d: number }) {
  const ok = Math.abs(d) < 1
  return (
    <div style={{ padding: '8px 12px', background: ok ? '#EEF3EC' : '#F8EEE8', color: ok ? 'var(--ok)' : 'var(--error)', display: 'flex', justifyContent: 'space-between' }}>
      <span>{ok ? 'Cierra justo' : d > 0 ? 'Sobra' : 'Falta'}</span><span>{ok ? '' : pesos(Math.abs(d))}</span>
    </div>
  )
}
