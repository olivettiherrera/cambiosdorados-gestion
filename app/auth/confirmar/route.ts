import { NextResponse } from 'next/server'
import { crearClienteServidor } from '@/lib/supabase/server'

// Link del mail de "olvidé mi contraseña": canjea el código por una sesión y lleva a poner la clave nueva.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (code) {
    const supabase = await crearClienteServidor()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL('/nueva-clave', url.origin))
  }
  return NextResponse.redirect(new URL('/login?link-vencido=1', url.origin))
}
