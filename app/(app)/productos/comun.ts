export type FilaCatalogo = {
  producto_id: number; producto_codigo: string; producto: string; categoria: string | null; en_web: boolean
  variante_id: number; codigo: string; atributos: Record<string, string>; precio: number | null
  stock_minimo: number; activo: boolean; stock: number; foto_url?: string | null
}
export type InfoProducto = { id: number; nombre: string; categoria_id: number | null; revisar: boolean }
export type Opcion = { id: number; nombre: string }

export const textoVariante = (a: Record<string, string> | null | undefined) => Object.values(a ?? {}).filter(Boolean).join(' · ')

/** "19.500" / "19500,5" -> número (NaN si está vacío o mal). */
export const leerNumero = (t: string) => {
  const limpio = t.replace(/\$/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  return limpio === '' ? NaN : Number(limpio)
}

/** El precio terminado en 900 más cercano (42.960 -> 42.900), como en la web. */
export const redondear900 = (x: number) => Math.max(900, Math.round((x - 900) / 1000) * 1000 + 900)

export const margenTexto = (m: number) => '× ' + m.toLocaleString('es-AR', { maximumFractionDigits: 2 })

export const MOTIVOS: Record<string, string> = {
  conteo_inicial: 'Conteo inicial', ingreso: 'Ingreso de mercadería', venta: 'Venta', venta_web: 'Venta web',
  ajuste: 'Ajuste por conteo', devolucion: 'Devolución',
}
