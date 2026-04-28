export const translations = {
  en: {
    // Nav
    games: 'Games',
    // Lineup comparison
    comparison: 'Comparison',
    fieldingAlignment: 'Fielding Alignment',
    loadingLineup: 'Loading lineup…',
    batter: 'Batter',
    confirmed: 'Confirmed',
    projected: 'Projected',
    // Schedule
    mlbGames: 'MLB Games',
    statsLineups: 'Dlo',
    mlbData: 'Data from MLB Stats API · Dlo',
    // LMB
    lmbGames: 'LMB Games',
    lmbSub: 'Liga Mexicana de Béisbol · Dlo',
    lmbData: 'LMB Data · Dlo',
    // State messages
    couldNotLoadGames: 'Could not load games',
    checkConnection: 'Check your connection and try again',
    noGamesScheduled: 'No games scheduled',
    tryDifferentDate: 'Try a different date',
    couldNotLoadGame: 'Failed to load game.',
    loading: 'Loading…',
    back: '← Back',
    // GameCard stat bars
    starters: 'Starters',
    offense: 'Offense',
    bullpen: 'Bullpen',
    lineupConfirmed: 'Confirmed Lineup',
    lineupProjected: 'Projected Lineup',
    // Weather
    expectedWeather: 'Expected Weather',
    wind: 'Wind',
    // Stat periods
    season: '2026 Season',
    '60days': 'Last 60 Days',
    '30days': 'Last 30 Days',
    '14days': 'Last 14 Days',
    '7days': 'Last 7 Days',
  },
  es: {
    // Nav
    games: 'Juegos',
    // Lineup comparison
    comparison: 'Comparación',
    fieldingAlignment: 'Alineación',
    loadingLineup: 'Cargando lineup…',
    batter: 'Bateador',
    confirmed: 'Confirmado',
    projected: 'Proyectado',
    // Schedule
    mlbGames: 'Juegos MLB',
    statsLineups: 'Stats & Lineups · Dlo',
    mlbData: 'Datos de MLB Stats API · Dlo',
    // LMB
    lmbGames: 'Juegos LMB',
    lmbSub: 'Liga Mexicana de Béisbol · Dlo',
    lmbData: 'Datos de LMB · Dlo',
    // State messages
    couldNotLoadGames: 'No se pudieron cargar los juegos',
    checkConnection: 'Verifica tu conexión e intenta de nuevo',
    noGamesScheduled: 'Sin juegos programados',
    tryDifferentDate: 'Intenta otra fecha',
    couldNotLoadGame: 'No se pudo cargar el juego.',
    loading: 'Cargando…',
    back: '← Atrás',
    // GameCard stat bars
    starters: 'Abridores',
    offense: 'Ofensiva',
    bullpen: 'Bullpen',
    lineupConfirmed: 'Lineup Confirmado',
    lineupProjected: 'Lineup Proyectado',
    // Weather
    expectedWeather: 'Clima esperado',
    wind: 'Viento',
    // Stat periods
    season: 'Temp. 2026',
    '60days': 'Últ. 60 días',
    '30days': 'Últ. 30 días',
    '14days': 'Últ. 14 días',
    '7days': 'Últ. 7 días',
  },
} as const

export type Lang = keyof typeof translations
export type TKey = keyof typeof translations.en
