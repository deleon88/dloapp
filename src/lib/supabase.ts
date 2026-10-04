import { createClient } from '@supabase/supabase-js'

// Llave publicable: está hecha para ir en el navegador. Lo que cada usuario
// puede leer o escribir lo controlan las políticas RLS de la base (db/schema.sql).
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null

if (!supabase) console.warn('[auth] Falta VITE_SUPABASE_URL o la llave publicable: el login queda desactivado.')

/** URL a la que vuelven los enlaces de confirmación, recuperación y OAuth. */
export function authRedirectUrl(path = '/auth/callback'): string {
  return `${window.location.origin}${path}`
}
