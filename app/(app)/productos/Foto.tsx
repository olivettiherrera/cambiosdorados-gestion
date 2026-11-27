'use client'

import { useMemo, useRef, useState } from 'react'
import { crearClienteNavegador } from '@/lib/supabase/client'

/** Achica la foto (máx. 1200 px, JPEG) antes de subirla: las del celular pesan varios MB. */
async function achicar(archivo: File): Promise<Blob> {
  const img = await createImageBitmap(archivo)
  const escala = Math.min(1, 1200 / Math.max(img.width, img.height))
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return await new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.85))
}

/** Miniatura de producto (o un recuadro vacío si no tiene foto). */
export function Miniatura({ url, tam = 40, alt = '' }: { url?: string | null; tam?: number; alt?: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} width={tam} height={tam} loading="lazy" style={{ width: tam, height: tam, objectFit: 'cover', flex: 'none', background: 'var(--linea)' }} />
  ) : (
    <span aria-hidden="true" style={{ width: tam, height: tam, flex: 'none', background: 'var(--linea)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={tam * 0.45} height={tam * 0.45} viewBox="0 0 24 24" fill="none" stroke="#B9B2A8" strokeWidth="1.6"><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 8" /></svg>
    </span>
  )
}

/** Foto grande en la ficha, con subir / sacar con la cámara / quitar. */
export default function Foto({ varianteId, url, tieneVariantes, esAdmin, alt, onCambio }: {
  varianteId: number; url: string | null; tieneVariantes: boolean; esAdmin: boolean; alt: string; onCambio: () => void
}) {
  const supabase = useMemo(() => crearClienteNavegador(), [])
  const entrada = useRef<HTMLInputElement>(null)
  const [soloVariante, setSoloVariante] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  async function subir(archivo: File | undefined) {
    if (!archivo) return
    setError(''); setSubiendo(true)
    try {
      const blob = await achicar(archivo)
      const ruta = `productos/${varianteId}-${Date.now()}.jpg`
      const { error: e1 } = await supabase.storage.from('fotos').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false })
      if (e1) throw new Error(e1.message)
      const publica = supabase.storage.from('fotos').getPublicUrl(ruta).data.publicUrl
      const { error: e2 } = await supabase.rpc('poner_foto', { p_variante: varianteId, p_url: publica, p_solo_variante: soloVariante })
      if (e2) throw new Error(e2.message)
      onCambio()
    } catch (e) {
      setError('No se pudo subir la foto: ' + (e as Error).message)
    }
    setSubiendo(false)
    if (entrada.current) entrada.current.value = ''
  }

  async function quitar() {
    setError('')
    const { error } = await supabase.rpc('poner_foto', { p_variante: varianteId, p_url: null, p_solo_variante: soloVariante })
    if (error) setError(error.message); else onCambio()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--fondo)', border: '1px solid var(--linea)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <button type="button" onClick={() => entrada.current?.click()} disabled={subiendo}
              style={{ border: 0, background: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--tinta-suave)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              <span>{subiendo ? 'Subiendo…' : 'Agregar foto'}</span>
            </button>}
        {subiendo && url && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Subiendo…</div>}
      </div>
      <input ref={entrada} type="file" accept="image/*" capture="environment" className="oculto" aria-label="Elegir foto del producto"
        onChange={(e) => subir(e.target.files?.[0])} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        {url && <button type="button" onClick={() => entrada.current?.click()} disabled={subiendo} style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--dorado-texto)' }}>Cambiar foto</button>}
        {url && esAdmin && <button type="button" onClick={quitar} style={{ border: 0, background: 'none', padding: 0, textDecoration: 'underline', color: 'var(--tinta-suave)' }}>Quitar</button>}
        {tieneVariantes && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }} className="small">
            <input type="checkbox" checked={soloVariante} onChange={(e) => setSoloVariante(e.target.checked)} /> Solo para esta variante
          </label>
        )}
      </div>
      {error && <div role="alert" className="small error">{error}</div>}
    </div>
  )
}
