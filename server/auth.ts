// Who is calling: verifies the Supabase access token sent by the app
// (Authorization: Bearer …) against Supabase Auth and returns the user id.
// Used by the endpoints that write for a user (votes).

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

export interface AuthUser { id: string }

/** The signed-in user, or null if there's no valid session token. */
export async function getUser(request: Request): Promise<AuthUser | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const user = await res.json() as { id?: string }
    return user.id ? { id: user.id } : null
  } catch {
    return null
  }
}
