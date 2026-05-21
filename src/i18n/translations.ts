export const translations = {
  en: {
    // Nav
    games: 'Games',
    // Lineup comparison
    comparison: 'Comparison',
    fieldingAlignment: 'Fielding',
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
    starters: 'Starter',
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
    // Game results
    resultW: 'W',
    resultL: 'L',
    // Stat bars glossary (schedule page)
    statBarsGuide: 'Stat Bars Guide',
    fipPlusLabel: 'FIP+ — Starters & Bullpen',
    fipPlusDesc: 'Park-adjusted pitcher quality. Higher is better — 100 is league average. Strips out defense and luck, keeping only strikeouts, walks, and home runs.',
    wrcPlusLabel: 'wRC+ — Offense',
    wrcPlusDesc: 'Park-adjusted lineup offense per plate appearance. Higher is better — 100 is league average. Accounts for ballpark effects and puts all hitters on equal footing.',
    // Pitcher matchup glossary
    statGlossary: 'Stat Glossary',
    glossaryEraDesc: 'Earned runs allowed per 9 innings. Affected by defense and luck.',
    glossaryFipDesc: 'Like ERA but built only from strikeouts, walks, and home runs — strips out defense.',
    glossaryWhipDesc: 'Walks plus hits per inning pitched. Measures baserunners allowed.',
    glossaryKbbDesc: 'Strikeout rate minus walk rate. Net command and swing-and-miss ability.',
    glossaryXfipDesc: 'FIP with home run rate normalized to league average. Best predictor of future ERA.',
    glossaryXwobaDesc: 'Expected wOBA on contact based on exit velocity and launch angle — removes luck and defense.',
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
    starters: 'Abridor',
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
    // Game results
    resultW: 'G',
    resultL: 'P',
    // Stat bars glossary (schedule page)
    statBarsGuide: 'Guía de barras',
    fipPlusLabel: 'FIP+ — Abridores y Bullpen',
    fipPlusDesc: 'Calidad del lanzador ajustada por parque. Mayor es mejor — 100 es el promedio de la liga. Elimina la defensa y la suerte, usando solo ponches, bases y jonrones.',
    wrcPlusLabel: 'wRC+ — Ofensiva',
    wrcPlusDesc: 'Ofensiva del lineup por turno al bate, ajustada por parque. Mayor es mejor — 100 es el promedio de la liga. Pone a todos los bateadores en igualdad de condiciones.',
    // Pitcher matchup glossary
    statGlossary: 'Glosario',
    glossaryEraDesc: 'Carreras ganadas permitidas por 9 entradas. Depende de la defensa y la suerte.',
    glossaryFipDesc: 'Como el ERA pero solo con ponches, bases por bola y jonrones — elimina la defensa.',
    glossaryWhipDesc: 'Bases por bola más hits por entrada. Mide los corredores permitidos.',
    glossaryKbbDesc: 'Tasa de ponches menos tasa de bases por bola. Mide el control neto del lanzador.',
    glossaryXfipDesc: 'FIP con la tasa de jonrones normalizada al promedio de la liga. Mejor predictor del ERA futuro.',
    glossaryXwobaDesc: 'wOBA esperada en contacto según velocidad de salida y ángulo de lanzamiento — elimina la suerte y la defensa.',
  },
} as const

export type Lang = keyof typeof translations
export type TKey = keyof typeof translations.en
