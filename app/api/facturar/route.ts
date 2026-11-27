import { NextResponse } from 'next/server'
import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import { autorizar, ultimoNumero, emitirFacturaC, consultar, configurado, cuitValido, ambiente, RechazoArca, type Receptor } from '@/lib/arca'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const MAX_POR_TANDA = 40
const LIMITE_CF_ANONIMO = Number(process.env.ARCA_LIMITE_CF ?? 10_000_000)   // arriba de esto ARCA pide identificar al consumidor final

type Pedido = { emisor_id: number; ventas: { id: number; total: number }[] }
type Resultado = { venta_id: number; numero_venta: string; estado: 'ok' | 'error' | 'verificar' | 'salteada'; detalle: string; factura?: string }

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba' }).format(new Date())

export async function POST(req: Request) {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') return NextResponse.json({ error: 'Solo Joan y Sele pueden facturar.' }, { status: 403 })
  const pedido = (await req.json()) as Pedido
  if (!pedido?.emisor_id || !Array.isArray(pedido.ventas) || pedido.ventas.length === 0)
    return NextResponse.json({ error: 'No hay ventas para facturar.' }, { status: 400 })
  if (pedido.ventas.length > MAX_POR_TANDA)
    return NextResponse.json({ error: `Máximo ${MAX_POR_TANDA} ventas por tanda.` }, { status: 400 })

  const supabase = await crearClienteServidor()
  const { data: emisor } = await supabase.from('emisores').select('id, nombre, cuit, punto_venta').eq('id', pedido.emisor_id).single()
  if (!emisor) return NextResponse.json({ error: 'Emisor inexistente.' }, { status: 400 })
  // En homologación (pruebas) se usa el CUIT de prueba de Afip SDK y punto de venta 1, y nada queda guardado.
  const prueba = ambiente() !== 'prod'
  const cuitReal = String(emisor.cuit).replace(/\D/g, '')
  const cuit = prueba ? '20409378472' : cuitReal
  const pv = prueba ? 1 : emisor.punto_venta
  const faltan = configurado(cuitReal)
  if (faltan.length) return NextResponse.json({ error: `Falta configurar en Vercel: ${faltan.join(', ')}.` }, { status: 400 })

  const ids = pedido.ventas.map((v) => v.id)
  const { data: ventas, error } = await supabase.from('ventas_por_facturar').select('*').in('id', ids).order('fecha')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const vistos = new Map(pedido.ventas.map((v) => [v.id, Number(v.total)]))

  const resultados: Resultado[] = []
  const reservadas: number[] = []
  for (const id of ids) if (!ventas?.some((v) => v.id === id)) resultados.push({ venta_id: id, numero_venta: '', estado: 'salteada', detalle: 'Ya tiene factura o está anulada.' })

  const inicio = Date.now()
  let auth, ultimo: number
  try {
    auth = await autorizar(cuit)
    ultimo = await ultimoNumero(auth, pv)
  } catch (e) {
    return NextResponse.json({ error: 'No se pudo conectar con ARCA: ' + (e as Error).message }, { status: 502 })
  }

  for (const v of ventas ?? []) {
    const base = { venta_id: v.id as number, numero_venta: v.numero as string }
    if (Date.now() - inicio > 45_000) { resultados.push({ ...base, estado: 'salteada', detalle: 'Quedó para la próxima tanda (tiempo).' }); continue }
    if (Math.abs(Number(v.total) - (vistos.get(v.id) ?? -1)) > 0.009) { resultados.push({ ...base, estado: 'salteada', detalle: 'El importe cambió desde la vista previa.' }); continue }

    // Receptor: CUIT con condición, DNI, o consumidor final anónimo
    let receptor: Receptor = { docTipo: 99, docNro: '0', condIva: 5 }
    const nro = String(v.doc_nro ?? '').replace(/\D/g, '')
    if (v.doc_tipo === 80 && nro) {
      if (!cuitValido(nro)) { resultados.push({ ...base, estado: 'salteada', detalle: `El CUIT ${nro} del cliente no es válido.` }); continue }
      if (!v.condicion_iva) { resultados.push({ ...base, estado: 'salteada', detalle: 'El cliente tiene CUIT pero falta su condición frente al IVA.' }); continue }
      receptor = { docTipo: 80, docNro: nro, condIva: v.condicion_iva }
    } else if (nro) {
      receptor = { docTipo: 96, docNro: nro, condIva: 5 }
    } else if (Number(v.total) >= LIMITE_CF_ANONIMO) {
      resultados.push({ ...base, estado: 'salteada', detalle: 'Por el monto, ARCA pide identificar al cliente: cargale DNI o CUIT en la ficha.' }); continue
    }

    const numero = ultimo + 1
    const { data: facturaId, error: errReserva } = await supabase.rpc('reservar_factura', {
      p_venta: v.id, p_emisor: emisor.id, p_numero: numero, p_doc_tipo: receptor.docTipo, p_doc_nro: receptor.docNro,
      p_cond: receptor.condIva, p_nombre: v.cliente ?? null,
    })
    if (errReserva) { resultados.push({ ...base, estado: 'salteada', detalle: errReserva.message }); continue }
    reservadas.push(facturaId as number)

    const etiqueta = `${prueba ? 'PRUEBA ' : ''}C ${String(pv).padStart(5, '0')}-${String(numero).padStart(8, '0')}`
    try {
      const r = await emitirFacturaC(auth, pv, numero, hoy(), Number(v.total), receptor)
      await supabase.from('facturas').update({ estado: 'ok', cae: r.cae, cae_vto: r.caeVto || null, mensaje: r.observaciones || null }).eq('id', facturaId)
      ultimo = numero
      resultados.push({ ...base, estado: 'ok', detalle: `CAE ${r.cae}`, factura: etiqueta })
    } catch (e) {
      if (e instanceof RechazoArca) {
        await supabase.from('facturas').update({ estado: 'error', numero: null, mensaje: e.message }).eq('id', facturaId)
        resultados.push({ ...base, estado: 'error', detalle: 'ARCA la rechazó: ' + e.message })
        continue
      }
      // No llegó la respuesta: preguntarle a ARCA si ese número salió
      let encontrada = null
      try { encontrada = await consultar(auth, pv, numero) } catch { /* sigue en verificar */ }
      if (encontrada && Math.abs(encontrada.importe - Number(v.total)) < 0.01) {
        await supabase.from('facturas').update({ estado: 'ok', cae: encontrada.cae, cae_vto: encontrada.caeVto || null, mensaje: 'Confirmada consultando a ARCA' }).eq('id', facturaId)
        ultimo = numero
        resultados.push({ ...base, estado: 'ok', detalle: `CAE ${encontrada.cae} (confirmada en ARCA)`, factura: etiqueta })
      } else {
        await supabase.from('facturas').update({ estado: 'verificar', mensaje: 'No llegó la respuesta de ARCA. Revisar en Mis Comprobantes: ' + (e as Error).message }).eq('id', facturaId)
        resultados.push({ ...base, estado: 'verificar', detalle: `No llegó la respuesta de ARCA para ${etiqueta}. Revisalo en Mis Comprobantes antes de seguir.` })
        break   // la numeración quedó en duda: no seguir facturando en esta tanda
      }
    }
  }

  // En pruebas no se guarda nada: se borran las facturas de homologación
  if (prueba && reservadas.length) await supabase.from('facturas').delete().in('id', reservadas)

  // Las que no se llegaron a procesar por el corte
  for (const v of ventas ?? []) if (!resultados.some((r) => r.venta_id === v.id)) resultados.push({ venta_id: v.id, numero_venta: v.numero, estado: 'salteada', detalle: 'No se procesó: se cortó la tanda.' })

  return NextResponse.json({ ambiente: ambiente(), emisor: emisor.nombre, resultados })
}

/** Estado de la configuración (sin mostrar ningún secreto). */
export async function GET() {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  const supabase = await crearClienteServidor()
  const { data } = await supabase.from('emisores').select('id, nombre, cuit')
  return NextResponse.json({
    ambiente: ambiente(),
    emisores: (data ?? []).map((e) => ({ id: e.id, nombre: e.nombre, faltan: configurado(String(e.cuit).replace(/\D/g, '')) })),
  })
}
