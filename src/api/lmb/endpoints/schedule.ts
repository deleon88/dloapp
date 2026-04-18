import { lmbApi } from '../client'
import type { LmbGame, LmbScheduleResponse } from '../types'

function lmbDateParams(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  const formatted = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
  // LMB uses CST (UTC-6) year-round — midnight CST = 06:00 UTC
  const startDate = Date.UTC(year, month - 1, day, 6, 0, 0)
  const endDate = startDate + 86_399_999
  return { date: formatted, startDate, endDate }
}

export async function getLmbSchedule(date: string): Promise<LmbGame[]> {
  const params = lmbDateParams(date)
  const data = await lmbApi.get<LmbScheduleResponse>('/calendar', {
    date: params.date,
    daysFromNow: 0,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  return data.games_info ?? []
}
