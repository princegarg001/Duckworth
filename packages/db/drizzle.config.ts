import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/schema/*.js',
  out: './migrations',
  casing: 'snake_case',
  // Schema is read from the COMPILED output: drizzle-kit bundles as CJS and
  // cannot resolve the NodeNext '.js' specifiers in the TypeScript sources.
  // `pnpm generate` therefore depends on `build`.
  // Drizzle only manages objects inside these schemas. `marts` is intentionally
  // absent: materialised views are hand-authored SQL migrations, because
  // drizzle-kit does not model matviews and a half-managed schema is worse
  // than an explicitly unmanaged one.
  schemaFilter: ['core', 'staging', 'quality'],
  verbose: true,
  strict: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ipl:ipl@localhost:5432/ipl',
  },
});
