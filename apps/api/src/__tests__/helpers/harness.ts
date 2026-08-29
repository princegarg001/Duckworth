import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiEnvSchema } from '@ipl/config';
import { createDb, runMigrations, type DbHandle } from '@ipl/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { buildApp, type AppContext } from '../../app.js';

/**
 * Integration harness.
 *
 * Starts a **real Postgres 17**, runs the real migrations, loads the real
 * dataset through the real ingest, and drives the real Fastify app.
 *
 * Nothing here is mocked, and that is the point. A mocked database cannot tell
 * you that a generated column disagrees with its check constraint, that a
 * materialised view refreshes concurrently, that `(over, ball)` collides, or
 * that the points table still reconciles. Those are the failures worth
 * catching, and they only exist against a real engine.
 *
 * The app is driven via `app.inject()` rather than over a socket: no port to
 * bind, no listener to leak, and no flake from a race between test and server.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');

export interface Harness {
  readonly ctx: AppContext;
  readonly db: DbHandle;
  readonly container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/** Where the dataset lives, if it has been downloaded. */
export function datasetDir(): string {
  return join(repoRoot, 'data', 'raw');
}

export async function startHarness(opts: { seed?: boolean } = {}): Promise<Harness> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('ipl_test')
    .withUsername('ipl')
    .withPassword('ipl')
    // tmpfs for the data directory: these databases are thrown away, and not
    // touching the disk roughly halves the suite's runtime.
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=512m' })
    .start();

  const url = container.getConnectionUri();
  await runMigrations(url);

  if (opts.seed !== false) {
    // Run the ingest as a subprocess, exactly as the container entrypoint and
    // CI do. Testing the CLI through its own interface means the thing that
    // runs in production is the thing under test.
    const ingestDir = join(repoRoot, 'apps', 'ingest');
    execFileSync(
      process.execPath,
      ['--import', 'tsx', join(ingestDir, 'src', 'cli.ts'), 'all', '--source', datasetDir()],
      {
        env: { ...process.env, DATABASE_URL: url, LOG_LEVEL: 'silent' },
        stdio: 'pipe',
        // Run from the ingest package so `tsx` resolves against its own
        // dependencies rather than the workspace root, which does not have it.
        cwd: ingestDir,
      },
    );
  }

  const db = createDb({ url, max: 4, statementTimeoutMs: 30_000 });

  const env = ApiEnvSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    LOG_LEVEL: 'silent',
    METRICS_ENABLED: 'false',
    INTERNAL_API_TOKEN: 'test-token-0123456789abcdef',
    // No Redis: the API must work without one, and the tests should exercise
    // the uncached path so a cache hit can never mask a broken query.
  });

  const ctx = await buildApp(env, { db });

  return {
    ctx,
    db,
    container,
    async stop() {
      await ctx.close();
      await db.close();
      await container.stop();
    },
  };
}

/** Parse a JSON response body, failing loudly on an unexpected status. */
export function json<T = unknown>(res: { statusCode: number; body: string }, expected = 200): T {
  if (res.statusCode !== expected) {
    throw new Error(
      `Expected HTTP ${expected} but got ${res.statusCode}. Body:\n${res.body.slice(0, 800)}`,
    );
  }
  return JSON.parse(res.body) as T;
}
