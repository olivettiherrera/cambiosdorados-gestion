/**
 * ARCA (factura electrónica) a través de la API de Afip SDK, igual que el Facturador de Apps Script.
 * Variables de entorno (en Vercel, nunca en el código ni en el chat):
 *   AFIPSDK_TOKEN          access_token de app.afipsdk.com
 *   ARCA_AMBIENTE          "prod" para facturar de verdad; cualquier otra cosa = homologación (pruebas)
 *   ARCA_CERT_<CUIT>       certificado del emisor (PEM; los saltos de línea pueden ir como \n)
 *   ARCA_KEY_<CUIT>        clave privada del emisor (PEM)
 */

const BASE = 'https://app.afipsdk.com/api/v1/afip'

export const ambiente = () => (process.env.ARCA_AMBIENTE === 'prod' ? 'prod' : 'dev')
const pem = (v: string | undefined) => v?.replace(/\\n/g, '\n')

export function configurado(cuit: string) {
  const faltan: string[] = []
  if (!process.env.AFIPSDK_TOKEN) faltan.push('AFIPSDK_TOKEN')   // en pruebas alcanza con el token
  if (ambiente() === 'prod') {
    if (!process.env[`ARCA_CERT_${cuit}`]) faltan.push(`ARCA_CERT_${cuit}`)
    if (!process.env[`ARCA_KEY_${cuit}`]) faltan.push(`ARCA_KEY_${cuit}`)
  }
  return faltan
}

async function llamar(ruta: string, cuerpo: unknown) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AFIPSDK_TOKEN}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(45_000),
    cache: 'no-store',
  })
  const texto = await r.text()
  let json: unknown
  try { json = JSON.parse(texto) } catch { json = { mensaje: texto } }
  if (!r.ok) {
    const j = json as { message?: string; mensaje?: string; data_errors?: unknown }
    throw new ErrorArca(`ARCA/Afip SDK respondió ${r.status}: ${j.message ?? j.mensaje ?? texto.slice(0, 300)}`, r.status)
  }
  return json as Record<string, unknown>
}

export class ErrorArca extends Error {
  constructor(msg: string, public status?: number) { super(msg) }
}

type Auth = { Token: string; Sign: string; Cuit: number }

export async function autorizar(cuit: string): Promise<Auth> {
  const cuerpo: Record<string, unknown> = { environment: ambiente(), tax_id: cuit, wsid: 'wsfe' }
  if (ambiente() === 'prod') { cuerpo.cert = pem(process.env[`ARCA_CERT_${cuit}`]); cuerpo.key = pem(process.env[`ARCA_KEY_${cuit}`]) }
  const r = await llamar('auth', cuerpo) as { token: string; sign: string }
  return { Token: r.token, Sign: r.sign, Cuit: Number(cuit) }
}

async function wsfe(metodo: string, params: Record<string, unknown>) {
  return llamar('requests', { environment: ambiente(), method: metodo, wsid: 'wsfe', params })
}

export async function ultimoNumero(auth: Auth, puntoVenta: number, tipo = 11): Promise<number> {
  const r = await wsfe('FECompUltimoAutorizado', { Auth: auth, PtoVta: puntoVenta, CbteTipo: tipo })
  const res = r.FECompUltimoAutorizadoResult as { CbteNro?: number; Errors?: unknown } | undefined
  if (res?.CbteNro == null) throw new ErrorArca('No se pudo leer el último número de ARCA: ' + JSON.stringify(res?.Errors ?? r).slice(0, 300))
  return Number(res.CbteNro)
}

export type Receptor = { docTipo: number; docNro: string; condIva: number }
export type Emitida = { cae: string; caeVto: string; observaciones: string }

const aaaammdd = (iso: string) => iso.replace(/-/g, '')
const deAaaammdd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`

/** Pide el CAE de una Factura C. Devuelve null si ARCA la rechazó (con el motivo en el error). */
export async function emitirFacturaC(auth: Auth, puntoVenta: number, numero: number, fecha: string, importe: number, receptor: Receptor): Promise<Emitida> {
  const total = Math.round(importe * 100) / 100
  const r = await wsfe('FECAESolicitar', {
    Auth: auth,
    FeCAEReq: {
      FeCabReq: { CantReg: 1, PtoVta: puntoVenta, CbteTipo: 11 },
      FeDetReq: {
        FECAEDetRequest: [{
          Concepto: 1, DocTipo: receptor.docTipo, DocNro: Number(receptor.docNro || 0),
          CbteDesde: numero, CbteHasta: numero, CbteFch: aaaammdd(fecha),
          ImpTotal: total, ImpTotConc: 0, ImpNeto: total, ImpOpEx: 0, ImpIVA: 0, ImpTrib: 0,
          MonId: 'PES', MonCotiz: 1, CondicionIVAReceptorId: receptor.condIva,
        }],
      },
    },
  })
  const res = r.FECAESolicitarResult as {
    FeCabResp?: { Resultado?: string }; Errors?: { Err?: { Code: number; Msg: string }[] | { Code: number; Msg: string } }
    FeDetResp?: { FECAEDetResponse?: Det[] | Det }
  } | undefined
  type Det = { Resultado?: string; CAE?: string; CAEFchVto?: string; Observaciones?: { Obs?: { Code: number; Msg: string }[] | { Code: number; Msg: string } } }
  const det = ([] as Det[]).concat(res?.FeDetResp?.FECAEDetResponse ?? [])[0]
  const obs = ([] as { Code: number; Msg: string }[]).concat(det?.Observaciones?.Obs ?? []).map((o) => `${o.Code}: ${o.Msg}`).join(' · ')
  if (det?.Resultado === 'A' && det.CAE) return { cae: det.CAE, caeVto: deAaaammdd(String(det.CAEFchVto)), observaciones: obs }
  const errs = ([] as { Code: number; Msg: string }[]).concat(res?.Errors?.Err ?? []).map((e) => `${e.Code}: ${e.Msg}`).join(' · ')
  throw new RechazoArca(errs || obs || 'ARCA rechazó la factura sin explicar el motivo')
}

export class RechazoArca extends Error {}

/** Busca en ARCA si un número ya fue emitido (para cuando la respuesta se perdió). */
export async function consultar(auth: Auth, puntoVenta: number, numero: number): Promise<{ cae: string; caeVto: string; importe: number } | null> {
  const r = await wsfe('FECompConsultar', { Auth: auth, FeCompConsReq: { CbteTipo: 11, CbteNro: numero, PtoVta: puntoVenta } })
  const res = r.FECompConsultarResult as { ResultGet?: { CodAutorizacion?: string; FchVto?: string; ImpTotal?: number } } | undefined
  const g = res?.ResultGet
  if (!g?.CodAutorizacion) return null
  return { cae: String(g.CodAutorizacion), caeVto: g.FchVto ? deAaaammdd(String(g.FchVto)) : '', importe: Number(g.ImpTotal) }
}

/** Valida el dígito verificador de un CUIT. */
export function cuitValido(c: string) {
  const d = c.replace(/\D/g, '')
  if (d.length !== 11) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const s = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0)
  let v = 11 - (s % 11)
  if (v === 11) v = 0
  if (v === 10) v = 9
  return v === Number(d[10])
}
