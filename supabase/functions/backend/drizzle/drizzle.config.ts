import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: '.',
  schema: './schema.ts',
  driver: 'pg',
  dbCredentials: {
    user: 'postgres',
    password: '',
    host: '',
    port: 5432,
    database: 'postgres',
  },
  verbose: true,
  strict: true,
})
