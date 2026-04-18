import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout/Layout'
import SchedulePage from '@/features/schedule/SchedulePage'
import StandingsPage from '@/features/standings/StandingsPage'
import LiveGamePage from '@/features/live-game/LiveGamePage'
import PlayerPage from '@/features/player/PlayerPage'
import TeamPage from '@/features/team/TeamPage'
import LmbSchedulePage from '@/features/lmb/LmbSchedulePage'
import LmbGamePage from '@/features/lmb/LmbGamePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/schedule" replace />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="standings" element={<StandingsPage />} />
          <Route path="game/:gamePk" element={<LiveGamePage />} />
          <Route path="player/:playerId" element={<PlayerPage />} />
          <Route path="team/:teamId" element={<TeamPage />} />
          <Route path="lmb" element={<LmbSchedulePage />} />
          <Route path="lmb/game/:gameId" element={<LmbGamePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
