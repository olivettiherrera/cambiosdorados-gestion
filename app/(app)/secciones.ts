export type Seccion = { ruta: string; nombre: string; soloAdmin?: boolean; lista?: boolean }

export const SECCIONES: Seccion[] = [
  { ruta: 'venta', nombre: 'Nueva venta', lista: true },
  { ruta: 'ventas', nombre: 'Ventas' },
  { ruta: 'caja', nombre: 'Caja del día' },
  { ruta: 'productos', nombre: 'Productos y stock' },
  { ruta: 'facturacion', nombre: 'Facturación', soloAdmin: true },
  { ruta: 'clientes', nombre: 'Clientes' },
  { ruta: 'gastos', nombre: 'Gastos', soloAdmin: true },
  { ruta: 'tablero', nombre: 'Tablero', soloAdmin: true },
]
