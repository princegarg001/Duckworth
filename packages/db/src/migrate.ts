import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createDb, type DbHandle } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));

/** `dist/` sits one level deeper than `migrations/`, so resolve both cases. */
function migrationsDir(): string {
  return join(here, here.endsWith('dist') ? '..' : '..', 'migrations');
}

function martsDir(): string {
  return join(here, here.endsWith('dist') ? '..' : '..', 'marts');
}

/**
 * Apply schema migrations, then (re)define the materialised views.
 *
 * The split is deliberate. Table migrations are **forward-only and ordered** —
 * drizzle-kit generates them and the journal tracks what has run. Matviews are
 * **idempotent definitions**: each file drops and recreates its view, so the
 * analytics layer can be reshaped without inventing a migration for every
 * change to a SELECT. Views hold no durable state; the tables do.
 */
export async function runMigrations(url: string, opts: { marts?: boolean } = {}): Promise<void> {
  const handle = createDb({ url, max: 1, statementTimeoutMs: 120_000 });
  try {
    // All four schemas are created by the generated migration itself — a
    // declared `pgSchema` is emitted even when `schemaFilter` excludes its
    // tables — so nothing needs pre-creating here.
    await migrate(handle.db, {
      migrationsFolder: migrationsDir(),
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });

    if (opts.marts !== false) {
      await applyMarts(handle);
    }
  } finally {
    await handle.close();
  }
}

/** Apply every `marts/*.sql` file in lexical order. */
export async function applyMarts(handle: DbHandle): Promise<string[]> {
  const dir = martsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const body = await readFile(join(dir, file), 'utf8');
    await handle.sql.unsafe(body);
  }
  return files;
}

/** Count applied migrations — surfaced by `/health/ready`. */
export async function appliedMigrationCount(handle: DbHandle): Promise<number> {
  const rows = await handle.sql<{ n: string }[]>`
    select count(*)::text as n from drizzle.__drizzle_migrations
  `;
  return Number(rows[0]?.n ?? 0);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('migrate.ts')) {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(78);
  }
  const started = Date.now();
  await runMigrations(url);
  process.stdout.write(`migrations applied in ${Date.now() - started}ms\n`);
}
