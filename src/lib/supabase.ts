import { createClient } from '@supabase/supabase-js'

// Llave publicable: está hecha para ir en el navegador. Lo que cada usuario
// puede leer o escribir lo controlan las políticas RLS de la base (db/schema.sql).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

// Login oculto en producción por ahora: siempre activo en dev; en un deploy,
// solo con VITE_ENABLE_AUTH=true. Sin cliente, el botón, el modal y las rutas
// de cuenta desaparecen.
export const authEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_AUTH === 'true'

export const supabase = authEnabled && url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

if (authEnabled && !supabase) console.warn('[auth] Falta VITE_SUPABASE_URL o la llave publicable: el login queda desactivado.')

/** URL a la que vuelven los enlaces de confirmación, recuperación y OAuth. */
export function authRedirectUrl(path = '/auth/callback'): string {
  return `${window.location.origin}${path}`
}
