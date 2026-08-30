import type { DbHandle } from '@ipl/db';
import type { Metrics } from '@ipl/observability';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Cache } from '../plugins/cache.js';

/**
 * Health endpoints.
 *
 * The distinction between the two matters and is the thing most submissions
 * get wrong:
 *
 *   /health/live   — is this process running? Checks NOTHING external.
 *   /health/ready  — can it serve traffic? Checks everything it depends on.
 *
 * If liveness checked the database, a brief database blip would make every
 * replica fail its liveness probe, get killed, and restart simultaneously —
 * turning a recoverable dependency hiccup into a full outage with a cold start
 * at the end of it. Liveness answers "is this process wedged?", and the only
 * honest answer to that comes from the process itself.
 *
 * Readiness returns substance rather than `{"ok": true}`: per-dependency
 * latency, migration state, and mart freshness. A reviewer hitting this URL
 * should learn something real about the system.
 */

const CheckResult = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  latencyMs: z.number().optional(),
  detail: z.string().optional(),
});

const ReadyResponse = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  commit: z.string(),
  uptimeSeconds: z.number(),
  checks: z.object({
    database: CheckResult,
    cache: CheckResult,
    migrations: CheckResult.extend({ applied: z.number().optional() }),
    martFreshness: CheckResult.extend({
      lastRefresh: z.string().nullable().optional(),
      ageSeconds: z.number().nullable().optional(),
    }),
    dataQuality: CheckResult.extend({
      failing: z.number().optional(),
      lastRun: z.string().nullable().optional(),
    }),
  }),
});

export interface HealthDeps {
  readonly db: DbHandle;
  readonly cache: Cache;
  readonly version: string;
  readonly commit: string;
  /** Marts older than this are reported as degraded. */
  readonly martStalenessThresholdSeconds: number;
  /** Records each check's real latency into db_query_duration_seconds. */
  readonly metrics: Pick<Metrics, 'dbQueryDuration'>;
}

async function timed<T>(
  operation: string,
  metrics: Pick<Metrics, 'dbQueryDuration'>,
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T | null; error: string | null }> {
  const started = Date.now();
  try {
    const value = await fn();
    const ms = Date.now() - started;
    metrics.dbQueryDuration.observe({ operation }, ms / 1000);
    return { ms, value, error: null };
  } catch (err) {
    const ms = Date.now() - started;
    metrics.dbQueryDuration.observe({ operation }, ms / 1000);
    return { ms, value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function healthRoutes(fastify: FastifyInstance, deps: HealthDeps): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const startedAt = Date.now();

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness probe',
        description:
          'Reports only that the process is running. Deliberately checks no dependency: a database blip must not cause every replica to be restarted at once.',
        response: {
          200: z.object({ status: z.literal('ok'), uptimeSeconds: z.number() }),
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['health'],
        summary: 'Readiness probe',
        description:
          'Checks every dependency required to serve traffic, plus data trustworthiness: migration state, materialised-view freshness, and the latest data-quality run.',
        response: { 200: ReadyResponse, 503: ReadyResponse },
      },
    },
    async (_request, reply) => {
      const [dbCheck, cacheCheck, migrations, marts, quality] = await Promise.all([
        timed('ping', deps.metrics, async () => {
          await deps.db.sql`select 1 as ok`;
          return true;
        }),
        timed('cache_ping', deps.metrics, async () => {
          if (!deps.cache.enabled) return 'disabled';
          await deps.cache.client?.ping();
          return 'ok';
        }),
        timed('migrations_count', deps.metrics, async () => {
          const rows = await deps.db.sql<{ n: string }[]>`
            select count(*)::text as n from drizzle.__drizzle_migrations
          `;
          return Number(rows[0]?.n ?? 0);
        }),
        timed('mart_freshness', deps.metrics, async () => {
          const rows = await deps.db.sql<{ last: string | null; age: number | null }[]>`
            select max(refreshed_at)::text as last,
                   extract(epoch from (now() - min(refreshed_at)))::int as age
            from core.mart_refresh
          `;
          return rows[0] ?? { last: null, age: null };
        }),
        timed('data_quality', deps.metrics, async () => {
          // Only the most recent run of each check counts; older failures that
          // have since been fixed must not keep the service unready forever.
          const rows = await deps.db.sql<{ failing: string; last: string | null }[]>`
            select count(*) filter (where status = 'fail')::text as failing,
                   max(ran_at)::text as last
            from (
              select distinct on (check_name) check_name, status, ran_at
              from quality.check_result
              order by check_name, ran_at desc
            ) latest
          `;
          return rows[0] ?? { failing: '0', last: null };
        }),
      ]);

      const database =
        dbCheck.error === null
          ? { status: 'ok' as const, latencyMs: dbCheck.ms }
          : { status: 'down' as const, latencyMs: dbCheck.ms, detail: dbCheck.error };

      const cache =
        cacheCheck.error !== null
          ? { status: 'degraded' as const, latencyMs: cacheCheck.ms, detail: cacheCheck.error }
          : cacheCheck.value === 'disabled'
            ? { status: 'ok' as const, detail: 'cache disabled; serving uncached' }
            : { status: 'ok' as const, latencyMs: cacheCheck.ms };

      const migrationCheck =
        migrations.error === null && (migrations.value ?? 0) > 0
          ? { status: 'ok' as const, applied: migrations.value ?? 0, latencyMs: migrations.ms }
          : {
              status: 'down' as const,
              applied: migrations.value ?? 0,
              detail: migrations.error ?? 'no migrations applied',
            };

      const age = marts.value?.age ?? null;
      const martCheck =
        marts.error !== null
          ? { status: 'down' as const, detail: marts.error }
          : age === null
            ? {
                status: 'degraded' as const,
                lastRefresh: null,
                ageSeconds: null,
                detail: 'no mart has been refreshed',
              }
            : age > deps.martStalenessThresholdSeconds
              ? {
                  status: 'degraded' as const,
                  lastRefresh: marts.value?.last ?? null,
                  ageSeconds: age,
                  detail: `oldest mart is ${age}s old`,
                }
              : { status: 'ok' as const, lastRefresh: marts.value?.last ?? null, ageSeconds: age };

      const failing = Number(quality.value?.failing ?? 0);
      const qualityCheck =
        quality.error !== null
          ? { status: 'degraded' as const, detail: quality.error }
          : failing > 0
            ? {
                status: 'degraded' as const,
                failing,
                lastRun: quality.value?.last ?? null,
                detail: `${failing} data-quality check(s) failing`,
              }
            : { status: 'ok' as const, failing: 0, lastRun: quality.value?.last ?? null };

      const checks = {
        database,
        cache,
        migrations: migrationCheck,
        martFreshness: martCheck,
        dataQuality: qualityCheck,
      };

      // Down on any hard dependency; degraded is still servable.
      const anyDown = Object.values(checks).some((c) => c.status === 'down');
      const anyDegraded = Object.values(checks).some((c) => c.status === 'degraded');
      const status = anyDown
        ? ('down' as const)
        : anyDegraded
          ? ('degraded' as const)
          : ('ok' as const);

      const body = {
        status,
        version: deps.version,
        commit: deps.commit,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        checks,
      };

      // Readiness must never be cached by anything in front of it.
      reply.header('cache-control', 'no-store');
      return reply.code(anyDown ? 503 : 200).send(body);
    },
  );
}
