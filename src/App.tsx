import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import Layout from '@/components/Layout/Layout'
import SchedulePage from '@/features/schedule/SchedulePage'
import LiveGamePage from '@/features/live-game/LiveGamePage'
import PlayerPage from '@/features/player/PlayerPage'
import TeamPage from '@/features/team/TeamPage'
import LmbSchedulePage from '@/features/lmb/LmbSchedulePage'
import LmbGamePage from '@/features/lmb/LmbGamePage'
import NrfiPage from '@/features/nrfi/NrfiPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/schedule" replace />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="game/:gamePk" element={<LiveGamePage />} />
          <Route path="player/:playerId" element={<PlayerPage />} />
          <Route path="team/:teamId" element={<TeamPage />} />
          <Route path="nrfi" element={<NrfiPage />} />
          <Route path="lmb" element={<LmbSchedulePage />} />
          <Route path="lmb/game/:gameId" element={<LmbGamePage />} />
        </Route>
      </Routes>
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
  )
}
