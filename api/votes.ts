// GET  /api/votes?game=849825      → vote counts (+ your vote, with a session)// POST /api/votes {game, team}     → cast or change your vote (session required,
//                                    only before the game starts)
import { getUser } from '../server/auth.js'
import { castVote, getGameVotes } from '../server/votes.js'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(request: Request): Promise<Response> {
  const game = Number(new URL(request.url).searchParams.get('game'))
  if (!Number.isInteger(game) || game <= 0) return Response.json({ error: 'game es obligatorio' }, { status: 400 })
  try {
    const user = await getUser(request)
    return Response.json(await getGameVotes(game, user?.id ?? null), { headers: noStore })
  } catch (e) {
    console.error('[api/votes GET]', e)
    return Response.json({ error: 'No se pudieron leer los votos' }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getUser(request)
  if (!user) return Response.json({ error: 'not_signed_in' }, { status: 401 })

  let body: { game?: unknown; team?: unknown }
  try { body = await request.json() as typeof body } catch { return Response.json({ error: 'invalid_body' }, { status: 400 }) }
  const game = Number(body.game), team = Number(body.team)
  if (!Number.isInteger(game) || game <= 0 || !Number.isInteger(team) || team <= 0) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  try {
    const error = await castVote(user.id, game, team)
    if (error) return Response.json({ error }, { status: error === 'voting_closed' ? 409 : 400 })
    return Response.json(await getGameVotes(game, user.id), { headers: noStore })
  } catch (e) {
    console.error('[api/votes POST]', e)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
