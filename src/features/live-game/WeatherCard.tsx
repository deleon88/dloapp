import type { ViewMode } from './LineupComparison'
import CardBgLayers from './CardBgLayers'
import styles from './WeatherCard.module.css'

interface Weather {
  condition: string
  temp: string
  wind: string
}

interface Props {
  weather: Weather
  awayColor: string
  homeColor: string
  mode: ViewMode
}

function weatherIcon(condition: string | undefined): string {
  if (!condition) return '🌤️'
  const c = condition.toLowerCase()
  if (c.includes('sunny') || c.includes('clear') || c.includes('soleado')) return '☀️'
  if (c.includes('cloud') || c.includes('nublado') || c.includes('overcast')) return '☁️'
  if (c.includes('rain') || c.includes('lluvia') || c.includes('shower')) return '🌧️'
  if (c.includes('drizzle') || c.includes('llovizna')) return '🌦️'
  if (c.includes('thunder') || c.includes('tormenta')) return '⛈️'
  if (c.includes('snow') || c.includes('nieve')) return '❄️'
  if (c.includes('fog') || c.includes('niebla')) return '🌫️'
  if (c.includes('wind') || c.includes('viento')) return '💨'
  return '🌤️'
}

export default function WeatherCard({ weather, awayColor, homeColor, mode }: Props) {
  return (
    <div className={styles.card}>
      <CardBgLayers awayColor={awayColor} homeColor={homeColor} mode={mode} />
      <span className={styles.title}>Clima esperado</span>
      <div className={styles.items}>
        <div className={styles.item}>
          <span className={styles.icon}>{weatherIcon(weather.condition)}</span>
          <span className={styles.value}>{weather.condition} {weather.temp}°F</span>
        </div>
        {weather.wind && (
          <div className={styles.item}>
            <span className={styles.icon}>💨</span>
            <span className={styles.value}>Viento {weather.wind}</span>
          </div>
        )}
      </div>
    </div>
  )
}
