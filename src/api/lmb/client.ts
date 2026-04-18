const LMB_BASE = '/api/lmb'

export const lmbApi = {
  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(LMB_BASE + path, window.location.origin)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v))
      }
    }
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`LMB API ${res.status}: ${path}`)
    return res.json()
  },
}
