// Aplica db/schema.sql. Uso: npm run db:migrate
import { readFile } from 'node:fs/promises'
import { sql } from '../../server/db'

const schema = await readFile(new URL('../../db/schema.sql', import.meta.url), 'utf-8')
await sql.unsafe(schema)
const tables = await sql<{ table_name: string }[]>`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`
console.log('Esquema aplicado. Tablas:', tables.map(t => t.table_name).join(', '))
await sql.end()
