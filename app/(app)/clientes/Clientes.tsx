'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'
import { pesos, fechaCorta, descargarCsv } from '@/lib/formato'

export type Cliente = {
  id: number; nombre: string; doc_tipo: number | null; doc_nro: string | null; condicion_iva: number | null
  email: string | null; telefono: string | null; lista_precio: string | null; domicilio: string | null; notas: string | null
  compras: number; total_comprado: number; ultima_compra: string | null
}
type SinFicha = { clave: string; nombre: string; compras: number; total_comprado: number; ultima_compra: string }
type Compra = { id: number; numero: string; dia: string; total: number; productos: string | null; medios: string | null; estado: string }

export const CONDICIONES_IVA: [number, string][] = [[5, 'Consumidor final'], [6, 'Monotributo'], [1, 'Responsable inscripto'], [4, 'Exento'], [15, 'No alcanzado']]
const LISTAS: [string, string][] = [['', 'Minorista'], ['arquitectos', 'Arquitectos'], ['mayorista', 'Mayorista']]
const doc = (c: Pick<Cliente, 'doc_tipo' | 'doc_nro'>) => (c.doc_nro ? `${c.doc_tipo === 80 ? 'CUIT' : 'DNI'} ${c.doc_nro}` : '')
const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

type Edicion = { id?: number; nombre: string; doc_tipo: string; doc_nro: string; condicion_iva: string; email: string; telefono: string; lista_precio: string; domicilio: string; notas: string; vincular?: string }
const vacio = (nombre = ''): Edicion => ({ nombre, doc_tipo: '96', doc_nro: '', condicion_iva: '5', email: '', telefono: '', lista_precio: '', domicilio: '', notas: '' })

export default function Clientes({ esAdmin }: { esAdmin: boolean }) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const [vista, setVista] = useState<'fichas' | 'historial'>('fichas')
  const [fichas, setFichas] = useState<Cliente[] | null>(null)
  const [sinFicha, setSinFicha] = useState<SinFicha[] | null>(null)
  const [texto, setTexto] = useState('')
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [compras, setCompras] = useState<Compra[] | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase.from('clientes_resumen').select('*').order('nombre').limit(5000),
      supabase.from('clientes_sin_ficha').select('*').order('compras', { ascending: false }).limit(3000),
    ])
    if (a.error) setError('No se pudieron leer los clientes: ' + a.error.message)
    setFichas((a.data ?? []) as Cliente[])
    setSinFicha((b.data ?? []) as SinFicha[])
  }, [supabase])
  useEffect(() => { cargar() }, [cargar])

  const q = normalizar(texto.trim())
  const fichasFiltradas = (fichas ?? []).filter((c) => !q || normalizar(`${c.nombre} ${c.doc_nro ?? ''} ${c.email ?? ''} ${c.telefono ?? ''}`).includes(q))
  const sinFichaFiltrados = (sinFicha ?? []).filter((c) => !q || c.clave.includes(q))

  async function abrir(e: Edicion, nombreVentas: string | null) {
    setError(''); setAviso(''); setEdicion(e); setCompras(null)
    if (nombreVentas) {
      const { data } = await supabase.from('ventas_listado').select('id, numero, dia, total, productos, medios, estado')
        .ilike('cliente', nombreVentas.replace(/[%_]/g, '')).order('fecha', { ascending: false }).limit(200)
      setCompras((data ?? []) as Compra[])
    } else setCompras([])
  }

  const abrirFicha = (c: Cliente) => abrir({
    id: c.id, nombre: c.nombre, doc_tipo: String(c.doc_tipo ?? 96), doc_nro: c.doc_nro ?? '', condicion_iva: String(c.condicion_iva ?? 5),
    email: c.email ?? '', telefono: c.telefono ?? '', lista_precio: c.lista_precio ?? '', domicilio: c.domicilio ?? '', notas: c.notas ?? '',
  }, c.nombre)

  async function guardar() {
    if (!edicion) return
    setError('')
    if (edicion.nombre.trim().length < 2) return setError('Escribí el nombre.')
    const nro = edicion.doc_nro.replace(/\D/g, '')
    if (nro && edicion.doc_tipo === '80' && nro.length !== 11) return setError('El CUIT tiene 11 números.')
    setGuardando(true)
    const { error } = await supabase.rpc('guardar_cliente', { p: { ...edicion, doc_nro: nro } })
    setGuardando(false)
    if (error) return setError(error.message)
    setAviso(edicion.vincular ? `Ficha creada y vinculadas las compras de “${edicion.vincular}”.` : 'Cliente guardado.')
    setEdicion(null)
    cargar()
  }

  const puedeEditar = esAdmin || !edicion?.id
  const campo = (k: keyof Edicion, etiqueta: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="etiqueta">{etiqueta}
      <input className="campo" value={(edicion?.[k] as string) ?? ''} disabled={!puedeEditar} {...extra}
        onChange={(e) => setEdicion((x) => x && { ...x, [k]: e.target.value })} />
    </label>
  )

  return (
    <>
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1>Clientes</h1>
          <div className="muted" style={{ marginTop: 6 }}>
            {fichas ? `${fichas.length} con ficha · ${sinFicha?.length ?? 0} nombres en ventas viejas sin ficha` : 'Cargando…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="boton-sec" disabled={!fichas?.length} onClick={() => descargarCsv('clientes.csv', (fichas ?? []).map((c) => ({
            Nombre: c.nombre, Documento: doc(c), Email: c.email ?? '', Telefono: c.telefono ?? '', Compras: c.compras, Total: Number(c.total_comprado),
            Ultima: c.ultima_compra ? c.ultima_compra.slice(0, 10) : '',
          })))}>Exportar</button>
          <button className="boton" style={{ height: 'auto', padding: '10px 16px' }} onClick={() => abrir(vacio(texto.trim()), null)}>Nuevo cliente</button>
        </div>
      </header>

      {aviso && <div role="status" style={{ background: '#F2F6EF', border: '1px solid #CFDCC6', padding: '12px 16px' }}>{aviso}</div>}
      {error && !edicion && <div role="alert" className="error">{error}</div>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ flex: '1 1 300px', display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid var(--borde)', padding: '0 14px', height: 44 }}>
          <span className="oculto">Buscar</span>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre, documento, mail o teléfono" style={{ flex: 1, border: 0, outline: 'none', background: 'transparent' }} />
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="chip" aria-pressed={vista === 'fichas'} onClick={() => setVista('fichas')}>Con ficha</button>
          <button className="chip" aria-pressed={vista === 'historial'} onClick={() => setVista('historial')}>Nombres de ventas viejas</button>
        </div>
      </div>

      {vista === 'fichas' ? (
        <section className="panel" style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 760 }}>
            <thead><tr>
              <th style={{ width: '28%' }}>Cliente</th><th>Documento</th><th>Contacto</th><th className="num" style={{ width: 80 }}>Compras</th>
              <th className="num" style={{ width: 130 }}>Total comprado</th><th style={{ width: 110 }}>Última</th>
            </tr></thead>
            <tbody>
              {fichas === null && <tr><td colSpan={6} className="muted">Cargando…</td></tr>}
              {fichas && fichasFiltradas.length === 0 && (
                <tr><td colSpan={6} className="muted" style={{ cursor: 'default' }}>
                  {fichas.length === 0 ? 'Todavía no hay fichas. Creá una con “Nuevo cliente”, o pasá las de las ventas viejas desde “Nombres de ventas viejas”.' : 'No hay clientes con esa búsqueda.'}
                </td></tr>
              )}
              {fichasFiltradas.map((c) => (
                <tr key={c.id} onClick={() => abrirFicha(c)}>
                  <td style={{ fontWeight: 500 }}>{c.nombre}{c.lista_precio && <span className="small muted"> · {c.lista_precio}</span>}</td>
                  <td className="muted">{doc(c) || '—'}</td>
                  <td className="muted">{[c.telefono, c.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="num">{c.compras}</td>
                  <td className="num">{pesos(c.total_comprado)}</td>
                  <td className="muted">{c.ultima_compra ? fechaCorta(c.ultima_compra) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="panel" style={{ overflowX: 'auto' }}>
          <div className="small muted" style={{ padding: '12px 16px', borderBottom: '1px solid var(--linea)' }}>
            Son los nombres que se escribieron a mano en las ventas. {esAdmin ? 'Tocá uno para crearle la ficha: sus compras quedan vinculadas.' : 'Joan o Sele pueden pasarlos a ficha.'}
          </div>
          <table className="tabla" style={{ minWidth: 600 }}>
            <thead><tr><th>Nombre escrito en la venta</th><th className="num" style={{ width: 90 }}>Compras</th><th className="num" style={{ width: 140 }}>Total</th><th style={{ width: 110 }}>Última</th></tr></thead>
            <tbody>
              {sinFicha === null && <tr><td colSpan={4} className="muted">Cargando…</td></tr>}
              {sinFichaFiltrados.slice(0, 300).map((c) => (
                <tr key={c.clave} onClick={() => abrir({ ...vacio(c.nombre), ...(esAdmin ? { vincular: c.nombre } : {}) }, c.nombre)}>
                  <td style={{ fontWeight: 500 }}>{c.nombre}</td>
                  <td className="num">{c.compras}</td>
                  <td className="num">{pesos(c.total_comprado)}</td>
                  <td className="muted">{fechaCorta(c.ultima_compra)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sinFichaFiltrados.length > 300 && <div className="small muted" style={{ padding: 12 }}>Mostrando 300 de {sinFichaFiltrados.length}. Buscá para encontrar otros.</div>}
        </section>
      )}

      {edicion && (
        <aside className="lateral" aria-label="Ficha del cliente" onKeyDown={(e) => e.key === 'Escape' && setEdicion(null)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="small muted">{edicion.id ? 'Ficha del cliente' : edicion.vincular ? 'Crear ficha desde ventas viejas' : 'Cliente nuevo'}</div>
              <h2 style={{ marginTop: 4 }}>{edicion.nombre || 'Sin nombre'}</h2>
            </div>
            <button aria-label="Cerrar" onClick={() => setEdicion(null)} style={{ border: 0, background: 'none', fontSize: 22, padding: 4 }}>×</button>
          </div>
          {edicion.vincular && <div className="small" style={{ background: 'var(--crema)', padding: '10px 12px' }}>Al guardar, las ventas con el nombre “{edicion.vincular}” quedan a nombre de esta ficha.</div>}
          {!puedeEditar && <div className="small muted">Solo Joan y Sele pueden cambiar una ficha.</div>}

          {campo('nombre', 'Nombre o razón social', { autoFocus: true })}
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 10 }}>
            <label className="etiqueta">Documento
              <select className="campo" value={edicion.doc_tipo} disabled={!puedeEditar} onChange={(e) => setEdicion((x) => x && { ...x, doc_tipo: e.target.value })}>
                <option value="96">DNI</option><option value="80">CUIT</option>
              </select>
            </label>
            {campo('doc_nro', 'Número', { inputMode: 'numeric' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="etiqueta">Condición frente al IVA
              <select className="campo" value={edicion.condicion_iva} disabled={!puedeEditar} onChange={(e) => setEdicion((x) => x && { ...x, condicion_iva: e.target.value })}>
                {CONDICIONES_IVA.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            <label className="etiqueta">Lista de precios
              <select className="campo" value={edicion.lista_precio} disabled={!puedeEditar} onChange={(e) => setEdicion((x) => x && { ...x, lista_precio: e.target.value })}>
                {LISTAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </label>
            {campo('telefono', 'Teléfono / WhatsApp', { inputMode: 'tel' })}
            {campo('email', 'Mail', { type: 'email' })}
          </div>
          {campo('domicilio', 'Domicilio')}
          <label className="etiqueta">Notas
            <textarea className="campo" rows={3} value={edicion.notas} disabled={!puedeEditar} style={{ height: 'auto', padding: 10 }}
              onChange={(e) => setEdicion((x) => x && { ...x, notas: e.target.value })} />
          </label>
          {error && <div role="alert" className="small error">{error}</div>}
          {puedeEditar && <button className="boton" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : edicion.id ? 'Guardar cambios' : 'Crear ficha'}</button>}

          {compras !== null && compras.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="small muted" style={{ letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Compras ({compras.length})</div>
              {compras.map((v) => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--linea)', fontSize: 13, color: v.estado === 'anulada' ? 'var(--apagado)' : undefined }}>
                  <span style={{ minWidth: 0 }}>
                    <span>{fechaCorta(v.dia)}</span> <span className="muted">· {v.productos ?? v.numero}</span>
                    {v.medios && <span className="small muted"> · {v.medios}</span>}
                  </span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{pesos(v.total)}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}
    </>
  )
}
