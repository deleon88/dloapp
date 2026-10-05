import { supabase } from './supabase'

/**
 * Game votes, rankings and the picks history: on in local development; in a
 * deployment only with VITE_ENABLE_VOTES=true. They need login (Supabase) too.
 */
export const votingEnabled =
  supabase != null && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_VOTES === 'true')
