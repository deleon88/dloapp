import { supabase } from './supabase'

/**
 * Game votes, rankings and the picks history: on in local development; in a
 * deployment only with VITE_ENABLE_VOTES=true. They need login (Supabase) too.
 */
export const votingEnabled =
  supabase != null && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_VOTES === 'true')

/**
 * The picks ranking: on in local development; in a deployment only with
 * VITE_ENABLE_RANKING=true. Off, the nav shows it locked and its page sends
 * back to the games.
 */
export const rankingEnabled =
  votingEnabled && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_RANKING === 'true')
