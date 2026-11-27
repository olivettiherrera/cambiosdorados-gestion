'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, hoyCordoba, fechaCorta, descargarCsv } from '@/lib/formato'

type Tipo = { id: number; nombre: string; grupo: Grupo }
type Opcion = { id: number; nombre: string }
type Grupo = 'mercaderia' | 'fijos' | 'variables' | 'mejoras' | 'retiros'
type Egreso = {
  id: number; fecha: string; proveedor: string | null; tipo_gasto_id: number | null; tipo: string | null; grupo: Grupo | null
  cuenta_id: number | null; cuenta: string | null; importe: number; observaciones: string | null; confirmado: boolean
}
type Edicion = { id?: number; fecha: string; proveedor: string; tipo_gasto_id: string; cuenta_id: string; importe: string; observaciones: string }

export const GRUPOS: Record<Grupo, string> = { mercaderia: 'Mercadería', fijos: 'Fijos', variables: 'Variables', mejoras: 'Mejoras', retiros: 'Retiros' }
const NO_PARA_NUEVOS = ['Cuenta Joan (extra)', 'Sin dato']   // CHO EXTRA no entra al sistema

const mesDe = (f: string) => f.slice(0, 7)
const nombreMes = (m: string) => {
  const [a, n] = m.split('-').map(Number)
  const t = new Date(Date.UTC(a, n - 1, 15)).toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
const moverMes = (m: string, d: number) => {
  const [a, n] = m.split('-').map(Number)
  const x = new Date(Date.UTC(a, n - 1 + d, 1))
  return x.toISOString().slice(0, 7)
}
const finDeMes = (m: string) => { const [a, n] = m.split('-').map(Number); return new Date(Date.UTC(a, n, 0)).toISOString().slice(0, 10) }
const leer = (t: string) => Number(t.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'))

export default function Gastos({ tipos, cuentas, proveedores }: { tipos: Tipo[]; cuentas: Opcion[]; proveedores: string[] }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [mes, setMes] = useState(mesDe(hoyCordoba()))
  const [filas, setFilas] = useState<Egreso[] | null>(null)
  const [grupo, setGrupo] = useState<Grupo | ''>('')
  const [cuentaId, setCuentaId] = useState('')
  const [texto, setTexto] = useState('')
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [borrar, setBorrar] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    setFilas(null)
    const { data, error } = await supabase.from('egresos_listado').select('*')
      .gte('fecha', mes + '-01').lte('fecha', finDeMes(mes)).order('fecha', { ascending: false }).order('id', { ascending: false }).limit(3000)
    if (error) setError('No se pudieron leer los gastos: ' + error.message)
    setFilas((data ?? []) as Egreso[])
  }, [supabase, mes])
  useEffect(() => { cargar() }, [cargar])

  const visibles = useMemo(() => {
    const q = texto.trim().toLowerCase()
    return (filas ?? []).filter((e) => (!grupo || e.grupo === grupo) && (!cuentaId || e.cuenta_id === Number(cuentaId)) &&
      (!q || [e.proveedor, e.tipo, e.observaciones].some((x) => x?.toLowerCase().includes(q))))
  }, [filas, grupo, cuentaId, texto])

  const porGrupo = useMemo(() => {
    const t: Record<string, number> = {}
    for (const e of filas ?? []) t[e.grupo ?? 'sin'] = (t[e.grupo ?? 'sin'] ?? 0) + Number(e.importe)
    return t
  }, [filas])
  const totalMes = Object.entries(porGrupo).filter(([g]) => g !== 'retiros').reduce((s, [, v]) => s + v, 0)
  const totalVisible = visibles.reduce((s, e) => s + Number(e.importe), 0)

  const nuevo = () => {
    setError(''); setBorrar(false)
    setEdicion({ fecha: mes === mesDe(hoyCordoba()) ? hoyCordoba() : mes + '-01', proveedor: '', tipo_gasto_id: '', cuenta_id: '', importe: '', observaciones: '' })
  }
  const editar = (e: Egreso) => {
    setError(''); setBorrar(false)
    setEdicion({ id: e.id, fecha: e.fecha, proveedor: e.proveedor ?? '', tipo_gasto_id: e.tipo_gasto_id ? String(e.tipo_gasto_id) : '',
      cuenta_id: e.cuenta_id ? String(e.cuenta_id) : '', importe: Math.round(Number(e.importe)).toLocaleString('es-AR'), observaciones: e.observaciones ?? '' })
  }

  async function guardar(seguir: boolean) {
    if (!edicion) return
    setError('')
    const importe = leer(edicion.importe)
    if (!edicion.fecha) return setError('Poné la fecha.')
    if (!(importe > 0)) return setError('Poné el importe.')
    if (!edicion.tipo_gasto_id) return setError('Elegí el tipo de gasto.')
    setGuardando(true)
    const { error } = await supabase.rpc('guardar_egreso', { p: { ...edicion, importe } })
    setGuardando(false)
    if (error) return setError(error.message)
    setAviso(`Gasto ${edicion.id ? 'actualizado' : 'cargado'}: ${edicion.proveedor || 'sin proveedor'} · ${pesos(importe)}.`)
    if (mesDe(edicion.fecha) !== mes) setMes(mesDe(edicion.fecha)); else cargar()
    setEdicion(seguir ? { ...edicion, id: undefined, proveedor: '', importe: '', observaciones: '' } : null)
  }

  async function eliminar() {
    if (!edicion?.id) return
    setGuardando(true)
    const { error } = await supabase.from('egresos').delete().eq('id', edicion.id)
    setGuardando(false)
    if (error) return setError('No se pudo borrar: ' + error.message)
    setAviso('Gasto borrado.'); setEdicion(null); cargar()
  }

  const cuentasNuevas = cuentas.filter((c) => !NO_PARA_NUEVOS.includes(c.nombre))
  const tiposPorGrupo = (Object.keys(GRUPOS) as Grupo[]).map((g) => [g, tipos.filter((t) => t.grupo === g)] as const)

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Gastos</h1>
          <div className="muted" style={{ marginTop: 6 }}>Solo lo ven Joan y Sele</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="boton-sec" disabled={!visibles.length} onClick={() => descargarCsv(`gastos_${mes}.csv`, visibles.map((e) => ({
            Fecha: e.fecha, Proveedor: e.proveedor ?? '', Tipo: e.tipo ?? '', Grupo: e.grupo ? GRUPOS[e.grupo] : '', Cuenta: e.cuenta ?? '',
            Importe: Number(e.importe), Observaciones: e.observaciones ?? '',
          })))}>Exportar</button>
          <button className="boton" style={{ height: 'auto', padding: '10px 16px' }} onClick={nuevo}>Cargar gasto</button>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="boton-sec" aria-label="Mes anterior" onClick={() => setMes((m) => moverMes(m, -1))}>‹</button>
        <div style={{ fontFamily: 'var(--titulos)', fontSize: 22, minWidth: 200, textAlign: 'center' }}>{nombreMes(mes)}</div>
        <button className="boton-sec" aria-label="Mes siguiente" onClick={() => setMes((m) => moverMes(m, 1))} disabled={mes >= mesDe(hoyCordoba())}>›</button>
        <input type="month" className="campo" aria-label="Elegir mes" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} style={{ width: 160, marginLeft: 8 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div className="tarjeta" style={{ borderColor: 'var(--tinta)' }}>
          <span className="rotulo">Gastos del mes</span><span className="valor">{pesos(totalMes)}</span><span className="small muted">sin contar retiros</span>
        </div>
        {(Object.keys(GRUPOS) as Grupo[]).map((g) => (
          <button key={g} className="tarjeta" onClick={() => setGrupo((x) => (x === g ? '' : g))} aria-pressed={grupo === g}
            style={{ textAlign: 'left', cursor: 'pointer', outline: grupo === g ? '1.5px solid var(--dorado)' : undefined, background: grupo === g ? 'var(--crema)' : '#fff' }}>
            <span className="rotulo">{GRUPOS[g]}</span><span className="valor" style={{ fontSize: 22 }}>{pesos(porGrupo[g] ?? 0)}</span>
          </button>
        ))}
      </div>

      {aviso && <div role="status" style={{ background: '#F2F6EF', border: '1px solid #CFDCC6', padding: '12px 16px' }}>{aviso}</div>}
      {error && !edicion && <div role="alert" className="error">{error}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor, tipo u observación" style={{ flex: '1 1 260px', height: 44 }} aria-label="Buscar" />
        <select className="campo" aria-label="Cuenta" value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ width: 200, height: 44 }}>
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {grupo && <button className="chip" onClick={() => setGrupo('')}>{GRUPOS[grupo]} ×</button>}
      </div>

      <section className="panel" style={{ overflowX: 'auto' }}>
        <table className="tabla" style={{ minWidth: 760 }}>
          <thead><tr>
            <th style={{ width: 90 }}>Fecha</th><th style={{ width: '24%' }}>Proveedor</th><th>Tipo</th><th style={{ width: 150 }}>Cuenta</th>
            <th className="num" style={{ width: 130 }}>Importe</th><th style={{ width: '22%' }}>Observaciones</th>
          </tr></thead>
          <tbody>
            {filas === null && <tr><td colSpan={6} className="muted">Cargando…</td></tr>}
            {filas && visibles.length === 0 && <tr><td colSpan={6} className="muted" style={{ cursor: 'default' }}>No hay gastos con ese filtro en {nombreMes(mes).toLowerCase()}.</td></tr>}
            {visibles.map((e) => (
              <tr key={e.id} onClick={() => editar(e)}>
                <td>{fechaCorta(e.fecha)}</td>
                <td style={{ fontWeight: 500 }}>{e.proveedor ?? '—'}{!e.confirmado && <span className="etiqueta-estado" style={{ marginLeft: 6, color: 'var(--alerta)' }}>revisar</span>}</td>
                <td className="muted">{e.tipo ?? '—'}</td>
                <td className="muted">{e.cuenta ?? '—'}</td>
                <td className="num" style={{ fontWeight: 500 }}>{pesos(e.importe)}</td>
                <td className="muted">{e.observaciones ?? ''}</td>
              </tr>
            ))}
          </tbody>
          {visibles.length > 0 && (
            <tfoot><tr>
              <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 600 }}>{visibles.length} gastos</td>
              <td className="num" style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>{pesos(totalVisible)}</td><td />
            </tr></tfoot>
          )}
        </table>
      </section>

      {edicion && (
        <aside className="lateral" aria-label="Gasto" onKeyDown={(e) => e.key === 'Escape' && setEdicion(null)}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <h2>{edicion.id ? 'Editar gasto' : 'Cargar gasto'}</h2>
            <button aria-label="Cerrar" onClick={() => setEdicion(null)} style={{ border: 0, background: 'none', fontSize: 22, padding: 4 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="etiqueta">Fecha
              <input className="campo" type="date" value={edicion.fecha} max={hoyCordoba()} onChange={(e) => setEdicion((x) => x && { ...x, fecha: e.target.value })} />
            </label>
            <label className="etiqueta">Importe
              <input className="campo" inputMode="decimal" autoFocus placeholder="$" value={edicion.importe} style={{ fontWeight: 600 }}
                onChange={(e) => setEdicion((x) => x && { ...x, importe: e.target.value })} />
            </label>
          </div>
          <label className="etiqueta">Proveedor
            <input className="campo" list="lista-proveedores" value={edicion.proveedor} placeholder="Ej: Badeco, contadora…"
              onChange={(e) => setEdicion((x) => x && { ...x, proveedor: e.target.value })} />
            <datalist id="lista-proveedores">{proveedores.map((p) => <option key={p} value={p} />)}</datalist>
          </label>
          <label className="etiqueta">Tipo de gasto
            <select className="campo" value={edicion.tipo_gasto_id} onChange={(e) => setEdicion((x) => x && { ...x, tipo_gasto_id: e.target.value })}>
              <option value="">Elegí…</option>
              {tiposPorGrupo.map(([g, ts]) => (
                <optgroup key={g} label={GRUPOS[g]}>{ts.map((t) => <option key={t.id} value={t.id}>{t.nombre.charAt(0) + t.nombre.slice(1).toLowerCase()}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <label className="etiqueta">Cuenta de donde salió
            <select className="campo" value={edicion.cuenta_id} onChange={(e) => setEdicion((x) => x && { ...x, cuenta_id: e.target.value })}>
              <option value="">Sin dato</option>
              {(edicion.id ? cuentas : cuentasNuevas).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="etiqueta">Observaciones
            <textarea className="campo" rows={2} value={edicion.observaciones} style={{ height: 'auto', padding: 10 }}
              onChange={(e) => setEdicion((x) => x && { ...x, observaciones: e.target.value })} />
          </label>
          {error && <div role="alert" className="small error">{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="boton" style={{ flex: 1 }} disabled={guardando} onClick={() => guardar(false)}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            {!edicion.id && <button className="boton-sec" disabled={guardando} onClick={() => guardar(true)}>Guardar y cargar otro</button>}
          </div>
          {edicion.id && (
            <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--linea)' }}>
              {!borrar ? (
                <button onClick={() => setBorrar(true)} style={{ border: 0, background: 'none', padding: 0, color: 'var(--error)', textDecoration: 'underline' }}>Borrar este gasto</button>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="small">¿Seguro? Queda registrado en el historial de cambios.</span>
                  <button className="boton" style={{ background: 'var(--error)', height: 36 }} disabled={guardando} onClick={eliminar}>Sí, borrar</button>
                  <button className="boton-sec" onClick={() => setBorrar(false)}>No</button>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  )
}
