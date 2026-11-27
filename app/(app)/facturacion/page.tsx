import { redirect } from 'next/navigation'
import { crearClienteServidor, obtenerPerfil } from '@/lib/supabase/server'
import { ambiente, configurado } from '@/lib/arca'
import Facturacion from './Facturacion'

export default async function PaginaFacturacion() {
  const perfil = await obtenerPerfil()
  if (perfil?.rol !== 'admin') redirect('/venta')
  const supabase = await crearClienteServidor()
  const { data } = await supabase.from('emisores').select('id, nombre, cuit, punto_venta').order('id')
  const emisores = (data ?? []).map((e) => ({ id: e.id, nombre: e.nombre, punto_venta: e.punto_venta, faltan: configurado(String(e.cuit).replace(/\D/g, '')) }))
  const propio = emisores.find((e) => e.nombre.toLowerCase() === perfil.nombre.toLowerCase())?.id ?? emisores[0]?.id
  return <Facturacion emisores={emisores} emisorInicial={propio} ambiente={ambiente()} />
}
