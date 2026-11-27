'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, hoyCordoba, fechaCorta, horaCordoba, descargarCsv } from '@/lib/formato'

type Emisor = { id: number; nombre: string; punto_venta: number; faltan: string[] }
type PorFacturar = { id: number; numero: string; fecha: string; dia: string; total: number; cliente: string | null; doc_tipo: number | null; doc_nro: string | null; condicion_iva: number | null; medios: string | null; vendedores: string | null; productos: string | null }
type Factura = { id: number; venta_id: number | null; emisor: string; tipo: number; punto_venta: number; numero: number | null; fecha: string; importe: number; cae: string | null; cae_vto: string | null; receptor_doc_tipo: number; receptor_doc_nro: string; receptor_nombre: string | null; pdf_url: string | null; estado: 'ok' | 'error' | 'verificar'; mensaje: string | null; venta_numero: string | null; cliente: string | null }
type Resultado = { venta_id: number; numero_venta: string; estado: 'ok' | 'error' | 'verificar' | 'salteada'; detalle: string; factura?: string }

const MAX = 40
type DatosEmisor = { id: number; nombre: string; razon_social: string | null; domicilio: string | null; condicion_iva: string | null; ingresos_brutos: string | null; inicio_actividades: string | null }
const mesAtras = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
const nroFactura = (f: Pick<Factura, 'punto_venta' | 'numero'>) => (f.numero ? `${String(f.punto_venta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}` : 'sin número')
const ESTADOS: Record<string, [string, string]> = { ok: ['Emitida', 'var(--ok)'], error: ['Rechazada', 'var(--error)'], verificar: ['Verificar en ARCA', 'var(--alerta)'], salteada: ['No se facturó', 'var(--tinta-suave)'] }

export default function Facturacion({ emisores, emisorInicial, ambiente }: { emisores: Emisor[]; emisorInicial?: number; ambiente: string }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [vista, setVista] = useState<'pendientes' | 'emitidas'>('pendientes')
  const [desde, setDesde] = useState(mesAtras())
  const [hasta, setHasta] = useState(hoyCordoba())
  const [pendientes, setPendientes] = useState<PorFacturar[] | null>(null)
  const [emitidas, setEmitidas] = useState<Factura[] | null>(null)
  const [elegidas, setElegidas] = useState<Set<number>>(new Set())
  const [emisorId, setEmisorId] = useState<number | undefined>(emisorInicial)
  const [confirmando, setConfirmando] = useState(false)
  const [facturando, setFacturando] = useState(false)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)
  const [manual, setManual] = useState<{ venta: PorFacturar; numero: string; emisor: string } | null>(null)
  const [error, setError] = useState('')
  const [datos, setDatos] = useState<DatosEmisor[] | null>(null)

  async function abrirDatos() {
    const { data } = await supabase.from('emisores').select('id, nombre, razon_social, domicilio, condicion_iva, ingresos_brutos, inicio_actividades').order('id')
    setDatos((data ?? []) as DatosEmisor[])
  }
  async function guardarDatos() {
    if (!datos) return
    for (const d of datos) {
      const { id, nombre: _n, ...resto } = d
      void _n
      const { error } = await supabase.from('emisores').update({ ...resto, inicio_actividades: resto.inicio_actividades || null }).eq('id', id)
      if (error) return setError('No se pudieron guardar los datos: ' + error.message)
    }
    setDatos(null)
  }

  const cargar = useCallback(async () => {
    setError('')
    const [a, b] = await Promise.all([
      supabase.from('ventas_por_facturar').select('*').gte('dia', desde).lte('dia', hasta).order('fecha', { ascending: false }).limit(2000),
      supabase.from('facturas_listado').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).order('numero', { ascending: false }).limit(2000),
    ])
    if (a.error || b.error) setError((a.error ?? b.error)!.message)
    setPendientes((a.data ?? []) as PorFacturar[])
    setEmitidas((b.data ?? []) as Factura[])
  }, [supabase, desde, hasta])
  useEffect(() => { cargar() }, [cargar])

  const emisor = emisores.find((e) => e.id === emisorId)
  const seleccion = (pendientes ?? []).filter((v) => elegidas.has(v.id))
  const totalSel = seleccion.reduce((s, v) => s + Number(v.total), 0)
  const verificar = (emitidas ?? []).filter((f) => f.estado === 'verificar')

  const alternar = (id: number) => setElegidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < MAX) n.add(id); return n })
  const todas = () => setElegidas((s) => (s.size ? new Set() : new Set((pendientes ?? []).slice(0, MAX).map((v) => v.id))))

  async function facturar() {
    if (!emisor) return
    setFacturando(true); setError(''); setResultados(null)
    try {
      const r = await fetch('/api/facturar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emisor_id: emisor.id, ventas: seleccion.map((v) => ({ id: v.id, total: Number(v.total) })) }) })
      const j = await r.json()
      if (!r.ok) setError(j.error ?? 'No se pudo facturar.')
      else setResultados(j.resultados as Resultado[])
    } catch {
      setError('Se cortó la conexión mientras se facturaba. Antes de volver a intentar, mirá “Facturas emitidas”: lo que quedó en “Verificar en ARCA” hay que revisarlo en Mis Comprobantes.')
    }
    setFacturando(false); setConfirmando(false); setElegidas(new Set())
    cargar()
  }

  async function guardarManual() {
    if (!manual) return
    setError('')
    const { error } = await supabase.rpc('factura_manual', { p: { venta_id: manual.venta.id, emisor_id: Number(manual.emisor), numero: manual.numero.replace(/\D/g, '') } })
    if (error) return setError(error.message)
    setManual(null); cargar()
  }

  async function marcarRevisada(f: Factura, emitida: boolean) {
    const cambios = emitida ? { estado: 'ok', mensaje: 'Verificada a mano en ARCA' } : { estado: 'error', numero: null, mensaje: 'No estaba en ARCA (verificada a mano)' }
    const { error } = await supabase.from('facturas').update(cambios).eq('id', f.id)
    if (error) setError(error.message); else cargar()
  }

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Facturación</h1>
          <div className="muted" style={{ marginTop: 6 }}>Factura C · siempre con botón, nunca automática</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="boton-sec" onClick={abrirDatos}>Datos para el comprobante</button>
          <label className="etiqueta" style={{ flexDirection: 'row', alignItems: 'center' }}>Desde
            <input className="campo" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={{ width: 150 }} />
          </label>
          <label className="etiqueta" style={{ flexDirection: 'row', alignItems: 'center' }}>Hasta
            <input className="campo" type="date" value={hasta} max={hoyCordoba()} onChange={(e) => setHasta(e.target.value)} style={{ width: 150 }} />
          </label>
        </div>
      </header>

      {ambiente !== 'prod' && (
        <div style={{ background: 'var(--crema)', border: '1px solid var(--dorado)', padding: '12px 16px' }}>
          <b>Modo prueba (homologación de ARCA).</b> <span className="muted">Las facturas se piden a ARCA de prueba, con un CUIT de prueba, y no queda nada guardado. Para facturar de verdad hay que cargar en Vercel <code>ARCA_AMBIENTE=prod</code> y los certificados (ver HANDOFF). Mientras tanto, seguí facturando con el Facturador de la planilla.</span>
        </div>
      )}
      {emisores.some((e) => e.faltan.length) && (
        <div className="small" style={{ background: '#FBEFEC', padding: '10px 14px', color: 'var(--error)' }}>
          Falta configurar en Vercel: {emisores.filter((e) => e.faltan.length).map((e) => `${e.nombre} (${e.faltan.join(', ')})`).join(' · ')}.
        </div>
      )}
      {verificar.length > 0 && (
        <div role="alert" style={{ background: '#FBF5EC', border: '1px solid #E5C9A3', padding: '12px 16px' }}>
          <b style={{ color: 'var(--alerta)' }}>{verificar.length} factura(s) para verificar en ARCA.</b> La respuesta no llegó: revisalas en Mis Comprobantes y marcá si salieron o no (pestaña “Facturas emitidas”). Hasta que lo hagas, esas ventas no se vuelven a facturar.
        </div>
      )}
      {error && <div role="alert" className="error">{error}</div>}

      {resultados && (
        <section className="panel" aria-label="Resultado de la facturación">
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--linea)', display: 'flex', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 18 }}>Resultado: {resultados.filter((r) => r.estado === 'ok').length} emitidas de {resultados.length}</h2>
            <button className="boton-sec" onClick={() => setResultados(null)}>Cerrar</button>
          </div>
          {resultados.map((r) => (
            <div key={r.venta_id} style={{ display: 'flex', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--linea)', fontSize: 13 }}>
              <span style={{ width: 130, color: ESTADOS[r.estado][1], fontWeight: 500 }}>{ESTADOS[r.estado][0]}</span>
              <span style={{ width: 140 }}>{r.numero_venta}</span>
              <span style={{ width: 190 }}>{r.factura ?? ''}</span>
              <span className="muted" style={{ flex: 1 }}>{r.detalle}</span>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="chip" aria-pressed={vista === 'pendientes'} onClick={() => setVista('pendientes')}>Por facturar ({pendientes?.length ?? '…'})</button>
        <button className="chip" aria-pressed={vista === 'emitidas'} onClick={() => setVista('emitidas')}>Facturas emitidas ({emitidas?.length ?? '…'})</button>
      </div>

      {vista === 'pendientes' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 20, alignItems: 'start' }} className="grilla-venta">
          <section className="panel" style={{ overflowX: 'auto' }}>
            <table className="tabla" style={{ minWidth: 700 }}>
              <thead><tr>
                <th style={{ width: 40 }}><input type="checkbox" aria-label="Elegir todas" checked={elegidas.size > 0} onChange={todas} /></th>
                <th style={{ width: 120 }}>Fecha</th><th>Cliente / productos</th><th style={{ width: 160 }}>Cobro</th><th className="num" style={{ width: 120 }}>Total</th><th style={{ width: 90 }} />
              </tr></thead>
              <tbody>
                {pendientes === null && <tr><td colSpan={6} className="muted">Cargando…</td></tr>}
                {pendientes?.length === 0 && <tr><td colSpan={6} className="muted" style={{ cursor: 'default' }}>No hay ventas sin facturar en esas fechas.</td></tr>}
                {pendientes?.map((v) => (
                  <tr key={v.id} onClick={() => alternar(v.id)} style={{ background: elegidas.has(v.id) ? 'var(--crema)' : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={'Elegir venta ' + v.numero} checked={elegidas.has(v.id)} onChange={() => alternar(v.id)} /></td>
                    <td>{fechaCorta(v.dia)} <span className="small muted">{horaCordoba(v.fecha)}</span></td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{v.cliente ?? 'Consumidor final'}</span>
                      {v.doc_nro && <span className="small muted"> · {v.doc_tipo === 80 ? 'CUIT' : 'DNI'} {v.doc_nro}</span>}
                      <span className="small muted"> · {v.productos ?? v.numero}</span>
                    </td>
                    <td className="muted">{v.medios ?? '—'}</td>
                    <td className="num" style={{ fontWeight: 500 }}>{pesos(v.total)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="small" style={{ border: 0, background: 'none', textDecoration: 'underline', color: 'var(--dorado-texto)', padding: 0 }}
                        onClick={() => setManual({ venta: v, numero: '', emisor: String(emisorId ?? '') })}>Ya la hice</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel" style={{ position: 'sticky', top: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 20 }}>Facturar</h2>
            <label className="etiqueta">Factura
              <select className="campo" value={emisorId ?? ''} onChange={(e) => setEmisorId(Number(e.target.value))}>
                {emisores.map((e) => <option key={e.id} value={e.id}>{e.nombre} · punto de venta {String(e.punto_venta).padStart(4, '0')}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Ventas elegidas</span><b>{seleccion.length}{seleccion.length >= MAX ? ' (máx.)' : ''}</b></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span className="muted">Total</span><span style={{ fontFamily: 'var(--titulos)', fontSize: 26 }}>{pesos(totalSel)}</span></div>
            {!confirmando ? (
              <button className="boton" disabled={!seleccion.length || !emisor || !!emisor.faltan.length} onClick={() => setConfirmando(true)}>Revisar y facturar</button>
            ) : (
              <div style={{ background: 'var(--fondo)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="small">Se van a emitir <b>{seleccion.length} Facturas C</b> a nombre de <b>{emisor?.nombre}</b> por <b>{pesos(totalSel)}</b>{ambiente !== 'prod' ? ' (prueba, no se guardan)' : ''}. Una por venta, con fecha de hoy.</div>
                <button className="boton" disabled={facturando} onClick={facturar}>{facturando ? 'Facturando… no cierres la página' : 'Sí, facturar'}</button>
                <button className="boton-sec" disabled={facturando} onClick={() => setConfirmando(false)}>Cancelar</button>
              </div>
            )}
            <div className="small muted">Máximo {MAX} por tanda. Si la venta tiene cliente con CUIT o DNI en su ficha, la factura sale a su nombre; si no, a consumidor final.</div>
          </section>
        </div>
      ) : (
        <section className="panel" style={{ overflowX: 'auto' }}>
          <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', borderBottom: '1px solid var(--linea)' }}>
            <button className="boton-sec" disabled={!emitidas?.length} onClick={() => descargarCsv(`facturas_${desde}_a_${hasta}.csv`, (emitidas ?? []).map((f) => ({
              Fecha: f.fecha, Emisor: f.emisor, Numero: nroFactura(f), Importe: Number(f.importe), CAE: f.cae ?? '', Estado: ESTADOS[f.estado][0], Venta: f.venta_numero ?? '', Cliente: f.receptor_nombre ?? f.cliente ?? '',
            })))}>Exportar</button>
          </div>
          <table className="tabla" style={{ minWidth: 800 }}>
            <thead><tr><th style={{ width: 90 }}>Fecha</th><th style={{ width: 80 }}>Emisor</th><th style={{ width: 160 }}>Número</th><th>Cliente</th><th className="num" style={{ width: 120 }}>Importe</th><th style={{ width: 150 }}>CAE</th><th style={{ width: 200 }}>Estado</th></tr></thead>
            <tbody>
              {emitidas?.length === 0 && <tr><td colSpan={7} className="muted" style={{ cursor: 'default' }}>No hay facturas en esas fechas.</td></tr>}
              {emitidas?.map((f) => (
                <tr key={f.id} style={{ cursor: 'default' }}>
                  <td>{fechaCorta(f.fecha)}</td>
                  <td>{f.emisor}</td>
                  <td>C {nroFactura(f)}</td>
                  <td className="muted">{f.receptor_nombre ?? f.cliente ?? 'Consumidor final'}{f.venta_numero && <span className="small"> · {f.venta_numero}</span>}</td>
                  <td className="num">{pesos(f.importe)}</td>
                  <td className="muted">{f.cae ?? '—'}
                    {f.pdf_url ? <> · <a href={f.pdf_url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>PDF</a></>
                      : f.cae && f.estado === 'ok' ? <> · <a href={`/facturacion/${f.id}`} style={{ textDecoration: 'underline' }}>Ver / PDF</a></> : null}
                  </td>
                  <td title={f.mensaje ?? ''} style={{ whiteSpace: 'normal' }}>
                    <span style={{ color: ESTADOS[f.estado][1], fontWeight: 500 }}>{ESTADOS[f.estado][0]}</span>
                    {f.estado === 'verificar' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <button className="chip" style={{ padding: '3px 8px' }} onClick={() => marcarRevisada(f, true)}>Salió</button>
                        <button className="chip" style={{ padding: '3px 8px' }} onClick={() => marcarRevisada(f, false)}>No salió</button>
                      </div>
                    )}
                    {f.estado === 'error' && f.mensaje && <div className="small muted">{f.mensaje}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {datos && (
        <aside className="lateral" aria-label="Datos para el comprobante">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2>Datos para el comprobante</h2>
            <button aria-label="Cerrar" onClick={() => setDatos(null)} style={{ border: 0, background: 'none', fontSize: 22, padding: 4 }}>×</button>
          </div>
          <div className="small muted">Son los datos de quien factura que salen impresos en el PDF (los mismos de la constancia de ARCA).</div>
          {datos.map((d, i) => {
            const cambiar = (k: keyof DatosEmisor, v: string) => setDatos((ds) => ds && ds.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
            return (
              <fieldset key={d.id} style={{ border: '1px solid var(--beige)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <legend style={{ fontWeight: 600, padding: '0 6px' }}>{d.nombre}</legend>
                <label className="etiqueta">Razón social (nombre como figura en ARCA)<input className="campo" value={d.razon_social ?? ''} onChange={(e) => cambiar('razon_social', e.target.value)} /></label>
                <label className="etiqueta">Domicilio comercial<input className="campo" value={d.domicilio ?? ''} onChange={(e) => cambiar('domicilio', e.target.value)} /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="etiqueta">Condición frente al IVA<input className="campo" value={d.condicion_iva ?? ''} onChange={(e) => cambiar('condicion_iva', e.target.value)} /></label>
                  <label className="etiqueta">Ingresos brutos<input className="campo" value={d.ingresos_brutos ?? ''} placeholder="si está vacío, el CUIT" onChange={(e) => cambiar('ingresos_brutos', e.target.value)} /></label>
                  <label className="etiqueta">Inicio de actividades<input className="campo" type="date" value={d.inicio_actividades ?? ''} onChange={(e) => cambiar('inicio_actividades', e.target.value)} /></label>
                </div>
              </fieldset>
            )
          })}
          <button className="boton" onClick={guardarDatos}>Guardar</button>
        </aside>
      )}

      {manual && (
        <aside className="lateral" aria-label="Factura hecha a mano">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2>Factura hecha a mano</h2>
            <button aria-label="Cerrar" onClick={() => setManual(null)} style={{ border: 0, background: 'none', fontSize: 22, padding: 4 }}>×</button>
          </div>
          <div className="muted">Para marcar como facturada una venta que hiciste en la web de ARCA o con el Facturador de la planilla.</div>
          <div><b>{manual.venta.cliente ?? 'Consumidor final'}</b> · {fechaCorta(manual.venta.dia)} · {pesos(manual.venta.total)}</div>
          <label className="etiqueta">La hizo
            <select className="campo" value={manual.emisor} onChange={(e) => setManual((m) => m && { ...m, emisor: e.target.value })}>
              {emisores.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label className="etiqueta">Número de factura (opcional)
            <input className="campo" inputMode="numeric" value={manual.numero} onChange={(e) => setManual((m) => m && { ...m, numero: e.target.value })} placeholder="Ej: 1234" />
          </label>
          {error && <div className="small error">{error}</div>}
          <button className="boton" onClick={guardarManual}>Marcar como facturada</button>
        </aside>
      )}
    </>
  )
}
