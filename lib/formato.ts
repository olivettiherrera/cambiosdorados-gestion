export const pesos = (n: number | null | undefined) => '$ ' + Math.round(Number(n ?? 0)).toLocaleString('es-AR')

/** Fecha de hoy en Córdoba, como AAAA-MM-DD. */
export const hoyCordoba = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Cordoba' }).format(new Date())

export const fechaCorta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

export const horaCordoba = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** Descarga filas como CSV que Excel / Sheets abren bien (separador ; y BOM). */
export function descargarCsv(nombre: string, filas: Record<string, unknown>[]) {
  if (!filas.length) return
  const cols = Object.keys(filas[0])
  const celda = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const texto = [cols.join(';'), ...filas.map((f) => cols.map((c) => celda(f[c])).join(';'))].join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre })
  a.click()
  URL.revokeObjectURL(url)
}
