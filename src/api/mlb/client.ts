const MLB_BASE_URL = import.meta.env.VITE_MLB_API_BASE_URL ?? '/api/mlb'

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
  const url = new URL(`${MLB_BASE_URL}${path}`, window.location.origin)

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
