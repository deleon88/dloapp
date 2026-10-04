import postgres from 'postgres'

// POSTGRES_URL la crea la integración de Supabase en Vercel: apunta al pooler
// en modo transacción (puerto 6543), que es el adecuado para funciones serverless.
const raw = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
if (!raw) throw new Error('POSTGRES_URL no está definida (ver .env.example)')

// La URL trae parámetros propios de Supabase/Prisma (supa, pgbouncer) que
// postgres.js mandaría al servidor como parámetros de conexión.
const url = new URL(raw)
url.searchParams.delete('supa')
url.searchParams.delete('pgbouncer')

// prepare: false porque el pooler en modo transacción no soporta sentencias
// preparadas; max bajo porque scripts y funciones abren pocas conexiones.
export const sql = postgres(url.toString(), {
  ssl: 'require',
  prepare: false,
  max: 5,
  onnotice: () => {},
})
