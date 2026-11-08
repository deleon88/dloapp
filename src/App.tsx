import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import Layout from '@/components/Layout/Layout'
import { LeagueRedirect, LeagueScope } from '@/components/LeagueRoutes'
import SchedulePage from '@/features/schedule/SchedulePage'
import LiveGamePage from '@/features/live-game/LiveGamePage'
import PlayerPage from '@/features/player/PlayerPage'
import TeamPage from '@/features/team/TeamPage'
import LmbSchedulePage from '@/features/lmb/LmbSchedulePage'
import LmbGamePage from '@/features/lmb/LmbGamePage'
import NrfiPage from '@/features/nrfi/NrfiPage'
import { OpenAuthRoute } from '@/features/auth/AuthModal'
import AuthCallbackPage from '@/features/auth/AuthCallbackPage'
import ProfilePage from '@/features/auth/ProfilePage'
import RankingsPage from '@/features/rankings/RankingsPage'
import StatsPage from '@/features/stats/StatsPage'
import { supabase } from '@/lib/supabase'
import { rankingEnabled, votingEnabled } from '@/lib/features'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<LeagueRedirect page="games" />} />
          {/* Every league page lives under its league: /lidom/games, /mlb/stats... */}
          <Route path=":league" element={<LeagueScope />}>
            <Route index element={<Navigate to="games" replace />} />
            <Route path="games" element={<SchedulePage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="game/:gamePk" element={<LiveGamePage />} />
            {/* Ranking locked (production without VITE_ENABLE_RANKING): back to the games */}
            {supabase && votingEnabled && <Route path="ranking" element={rankingEnabled ? <RankingsPage /> : <Navigate to="../games" replace />} />}
          </Route>
          {/* Old paths: to the same page of the default league (a game finds its own) */}
          <Route path="schedule" element={<LeagueRedirect page="games" />} />
          <Route path="stats" element={<LeagueRedirect page="stats" />} />
          <Route path="game/:gamePk" element={<LiveGamePage />} />
          <Route path="player/:playerId" element={<PlayerPage />} />
          <Route path="team/:teamId" element={<TeamPage />} />
          <Route path="nrfi" element={<NrfiPage />} />
          <Route path="lmb" element={<LmbSchedulePage />} />
          <Route path="lmb/game/:gameId" element={<LmbGamePage />} />
          {supabase && <>
            <Route path="login" element={<OpenAuthRoute view="login" />} />
            <Route path="signup" element={<OpenAuthRoute view="signup" />} />
            <Route path="forgot-password" element={<OpenAuthRoute view="forgot" />} />
            <Route path="auth/callback" element={<AuthCallbackPage />} />
            <Route path="profile" element={<ProfilePage />} />
            {rankingEnabled && <Route path="rankings" element={<LeagueRedirect page="ranking" />} />}
          </>}
          <Route path="*" element={<LeagueRedirect page="games" />} />
        </Route>
      </Routes>
      <Analytics />
      <SpeedInsights />
    </BrowserRouter>
  )
}
