// GET /api/votes/history → your picks, newest first, with their result (session required).
import { getUser } from '../../server/auth.js'
import { getPickHistory, refreshRecentResults } from '../../server/votes.js'

export async function GET(request: Request): Promise<Response> {
  const user = await getUser(request)
  if (!user) return Response.json({ error: 'not_signed_in' }, { status: 401 })
  try {
    await refreshRecentResults()
    return Response.json({ picks: await getPickHistory(user.id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[api/votes/history]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
