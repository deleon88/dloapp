import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface Profile {
  id: string
  username: string | null
  favorite_team_id: number | null
}

export type AuthView = 'login' | 'signup' | 'forgot'

interface AuthStore {
  /** true hasta saber si hay sesión guardada (evita parpadeos de "Entrar"). */
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** Vista abierta del modal de acceso; null = cerrado. */
  authView: AuthView | null
  openAuth: (view?: AuthView) => void
  closeAuth: () => void
  init: () => () => void
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, username, favorite_team_id')
    .eq('id', userId)
    .maybeSingle()
  return data
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  loading: true,
  session: null,
  profile: null,
  authView: null,
  openAuth: (view = 'login') => set({ authView: view }),
  closeAuth: () => set({ authView: null }),

  init: () => {
    if (!supabase) {
      set({ loading: false })
      return () => {}
    }
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, loading: false })
      // Entró: cerrar el modal de acceso si estaba abierto.
      if (session) set({ authView: null })
      if (!session) {
        set({ profile: null })
        return
      }
      // Fuera del callback: Supabase no permite otra llamada a la API dentro de él.
      setTimeout(() => { void get().refreshProfile() }, 0)
    })
    return () => data.subscription.unsubscribe()
  },

  refreshProfile: async () => {
    const userId = get().session?.user.id
    set({ profile: userId ? await fetchProfile(userId) : null })
  },

  signOut: async () => {
    await supabase?.auth.signOut()
    set({ session: null, profile: null })
  },
}))
