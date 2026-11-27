import { redirect, notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import Imprimir from './Imprimir'

const COND: Record<number, string> = { 5: 'Consumidor Final', 6: 'Responsable Monotributo', 1: 'IVA Responsable Inscripto', 4: 'IVA Sujeto Exento', 15: 'IVA No Alcanzado' }
const DOC: Record<number, string> = { 80: 'CUIT', 96: 'DNI', 99: '' }
const pesos = (n: number) => '$ ' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '')

/** Comprobante imprimible (Factura C) con CAE y QR de ARCA. Se guarda como PDF desde el navegador. */
export default async function Comprobante({ params }: { params: Promise<{ id: string }> }) {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') redirect('/venta')
  const { id } = await params
  const supabase = await crearClienteServidor()
  const { data: f } = await supabase.from('facturas').select('*').eq('id', Number(id)).single()
  if (!f) notFound()
  const [{ data: em }, { data: items }] = await Promise.all([
    supabase.from('emisores').select('*').eq('id', f.emisor_id).single(),
    f.venta_id ? supabase.from('venta_items').select('descripcion, cantidad, precio_final').eq('venta_id', f.venta_id).order('id') : Promise.resolve({ data: [] }),
  ])
  const nro = `${String(f.punto_venta).padStart(5, '0')}-${String(f.numero ?? 0).padStart(8, '0')}`
  const cuit = String(em?.cuit ?? '').replace(/\D/g, '')
  const qr = f.cae ? await QRCode.toDataURL('https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify({
    ver: 1, fecha: f.fecha, cuit: Number(cuit), ptoVta: f.punto_venta, tipoCmp: f.tipo, nroCmp: f.numero, importe: Number(f.importe),
    moneda: 'PES', ctz: 1, tipoDocRec: f.receptor_doc_tipo, nroDocRec: Number(f.receptor_doc_nro || 0), tipoCodAut: 'E', codAut: Number(f.cae),
  })).toString('base64'), { margin: 1, width: 220 }) : null
  const renglones = (items ?? []).length ? items! : [{ descripcion: 'Venta de mercadería', cantidad: 1, precio_final: f.importe }]
  const faltanDatos = !em?.razon_social || !em?.domicilio

  const celda: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ddd', fontSize: 12 }
  return (
    <div className="comprobante-pagina">
      <style>{`
        @media print { nav, .barra-movil, .no-imprimir, [role=status] { display: none !important; } .contenido-app { padding: 0 !important; } body { background: #fff; } }
        .hoja { background: #fff; color: #111; width: 210mm; min-height: 270mm; padding: 12mm; margin: 0 auto; font-family: Arial, Helvetica, sans-serif; border: 1px solid var(--beige); }
        @media print { .hoja { border: 0; width: auto; min-height: 0; padding: 0; } }
      `}</style>
      <div className="no-imprimir" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <a href="/facturacion" className="boton-sec">Volver</a>
        <Imprimir />
        {faltanDatos && <span className="small" style={{ color: 'var(--alerta)' }}>Faltan los datos del emisor (razón social, domicilio…): cargalos en Facturación › Datos para el comprobante.</span>}
        {!f.cae && <span className="small error">Esta factura no tiene CAE: no es un comprobante válido.</span>}
      </div>
      <div className="hoja">
        <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, border: '1px solid #111', padding: 4 }}>ORIGINAL</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', border: '1px solid #111', borderTop: 0 }}>
          <div style={{ padding: 10, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{em?.razon_social ?? em?.nombre}</div>
            <div><b>Razón social:</b> {em?.razon_social ?? '—'}</div>
            <div><b>Domicilio comercial:</b> {em?.domicilio ?? '—'}</div>
            <div><b>Condición frente al IVA:</b> {em?.condicion_iva ?? 'Responsable Monotributo'}</div>
          </div>
          <div style={{ borderLeft: '1px solid #111', borderRight: '1px solid #111', textAlign: 'center', paddingTop: 6 }}>
            <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>C</div>
            <div style={{ fontSize: 9 }}>COD. 011</div>
          </div>
          <div style={{ padding: 10, fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>FACTURA</div>
            <div><b>Punto de venta:</b> {String(f.punto_venta).padStart(5, '0')} <b style={{ marginLeft: 8 }}>Comp. nro:</b> {String(f.numero ?? '').padStart(8, '0')}</div>
            <div><b>Fecha de emisión:</b> {fecha(f.fecha)}</div>
            <div><b>CUIT:</b> {cuit}</div>
            <div><b>Ingresos brutos:</b> {em?.ingresos_brutos ?? cuit}</div>
            <div><b>Inicio de actividades:</b> {fecha(em?.inicio_actividades ?? null) || '—'}</div>
          </div>
        </div>
        <div style={{ border: '1px solid #111', borderTop: 0, padding: 10, fontSize: 12, lineHeight: 1.6, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div><b>{DOC[f.receptor_doc_tipo] || 'Documento'}:</b> {f.receptor_doc_tipo === 99 ? '—' : f.receptor_doc_nro}</div>
          <div><b>Apellido y nombre / Razón social:</b> {f.receptor_nombre ?? (f.receptor_doc_tipo === 99 ? 'Consumidor final' : '')}</div>
          <div><b>Condición frente al IVA:</b> {COND[f.receptor_cond_iva] ?? 'Consumidor Final'}</div>
          <div><b>Domicilio:</b> {f.receptor_domicilio ?? '—'}</div>
          <div><b>Condición de venta:</b> Contado</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10 }}>
          <thead><tr style={{ background: '#eee' }}>
            <th style={{ ...celda, textAlign: 'left' }}>Producto / servicio</th><th style={{ ...celda, textAlign: 'right' }}>Cantidad</th>
            <th style={{ ...celda, textAlign: 'right' }}>Precio unit.</th><th style={{ ...celda, textAlign: 'right' }}>Subtotal</th>
          </tr></thead>
          <tbody>{renglones.map((r, i) => (
            <tr key={i}><td style={celda}>{r.descripcion}</td><td style={{ ...celda, textAlign: 'right' }}>{r.cantidad}</td>
              <td style={{ ...celda, textAlign: 'right' }}>{pesos(Number(r.precio_final) / (r.cantidad || 1))}</td><td style={{ ...celda, textAlign: 'right' }}>{pesos(Number(r.precio_final))}</td></tr>
          ))}</tbody>
        </table>
        {Math.abs(renglones.reduce((s, r) => s + Number(r.precio_final), 0) - Number(f.importe)) > 0.5 && (
          <div style={{ fontSize: 11, marginTop: 4 }}>Ajuste / redondeo: {pesos(Number(f.importe) - renglones.reduce((s, r) => s + Number(r.precio_final), 0))}</div>
        )}
        <div style={{ marginTop: 16, borderTop: '1px solid #111', paddingTop: 8, display: 'flex', justifyContent: 'flex-end', fontSize: 16, fontWeight: 700 }}>
          Importe total: {pesos(Number(f.importe))}
        </div>
        <div style={{ marginTop: 24, display: 'flex', gap: 16, alignItems: 'center', borderTop: '1px solid #111', paddingTop: 10 }}>
          {qr && <img src={qr} alt="Código QR de ARCA para verificar la factura" width={110} height={110} />}
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>Comprobante autorizado</div>
            <div><b>CAE:</b> {f.cae ?? '—'}</div>
            <div><b>Vencimiento del CAE:</b> {fecha(f.cae_vto)}</div>
            <div style={{ fontSize: 10, color: '#555' }}>Factura C {nro}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
