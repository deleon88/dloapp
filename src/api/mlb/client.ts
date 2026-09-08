// import.meta.env is Vite-injected (browser build); falls back to process.env
// for Node/tsx scripts (e.g. scripts/refresh-go-to-lineups.ts), which have no
// Vercel rewrite proxy and must point straight at the real MLB Stats API host.
const MLB_BASE_URL =
  import.meta.env?.VITE_MLB_API_BASE_URL ??
  (typeof process !== 'undefined' ? process.env?.VITE_MLB_API_BASE_URL : undefined) ??
  '/api/mlb'

// window doesn't exist outside the browser — only used here to resolve a
// relative MLB_BASE_URL against the current origin.
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'

export class MlbApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string,
  ) {
    super(message)
    this.name = 'MlbApiError'
  }
}

async function request<T>(
  path: string,
  params?: Record<string, string | number | boolean | string[]>,
): Promise<T> {
  const url = new URL(`${MLB_BASE_URL}${path}`, ORIGIN)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        url.searchParams.set(key, value.join(','))
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new MlbApiError(
      response.status,
      response.statusText,
      `MLB API request failed: ${response.status} ${response.statusText} — ${path}`,
    )
  }

  return response.json() as Promise<T>
}

export const mlbApi = {
  get: request,
}
