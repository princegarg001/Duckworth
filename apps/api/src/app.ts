import { randomUUID } from 'node:crypto';

import type { ApiEnv } from '@ipl/config';
import { Problem } from '@ipl/contracts';
import { createDb, type DbHandle } from '@ipl/db';
import { activeTraceId, createLogger, createMetrics } from '@ipl/observability';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { z } from 'zod';

import { createCache, type CacheStats } from './plugins/cache.js';
import { ApiError, errorHandler } from './plugins/errors.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1.js';

/**
 * The wired application, as returned by `buildApp`.
 *
 * Inferred rather than declared: `buildApp` passes a pino instance as
 * `loggerInstance` and applies the Zod type provider, so the concrete
 * `FastifyInstance` generics are narrower than the defaults. Writing them out
 * by hand means keeping four type parameters in sync with Fastify's, and
 * getting one wrong turns every `request.query` in the app into `unknown`.
 */
export type AppContext = Awaited<ReturnType<typeof buildApp>>;

/**
 * Build the application.
 *
 * Exported separately from `server.ts` so integration tests can construct a
 * fully-wired app against a Testcontainers database and drive it through
 * `app.inject()` — no port binding, no sockets, no flake.
 */
export async function buildApp(env: ApiEnv, overrides: { db?: DbHandle } = {}) {
  const logger = createLogger({
    level: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    gitSha: env.GIT_SHA,
  });

  const metrics = createMetrics({ serviceName: env.SERVICE_NAME });
  const cacheStats: CacheStats = { hits: 0, misses: 0, errors: 0 };

  const db =
    overrides.db ??
    createDb({
      url: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
      connectTimeoutMs: env.DATABASE_CONNECT_TIMEOUT_MS,
      ssl: env.DATABASE_SSL,
    });

  const cache = createCache({
    url: env.REDIS_URL,
    db,
    stats: cacheStats,
    onError: (err) => logger.warn({ err }, 'cache error; serving uncached'),
  });

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    // Accept an inbound correlation id so a request can be followed across
    // services; mint one when the caller did not supply it.
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 && header.length <= 128
        ? header
        : randomUUID();
    },
    // Fastify's built-in request/response log *pair* is replaced by the single
    // structured line emitted in the onResponse hook below, which carries the
    // route template, duration and trace id together.
    //
    // Deprecated in favour of a `logController` class in Fastify 6; the
    // replacement is a class-based API not worth adopting for one boolean
    // until the upgrade actually lands.
    disableRequestLogging: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandler);

  // ── Security ────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // the API serves JSON; Swagger UI needs its own
    crossOriginEmbedderPolicy: false,
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    // An explicit allowlist. `origin: '*'` on a credentialed API is the
    // default that quietly becomes a finding.
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'if-none-match', 'x-request-id', 'x-internal-token'],
    exposedHeaders: ['etag', 'x-request-id', 'ratelimit-limit', 'ratelimit-remaining'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    // Shared across replicas when Redis is available; per-process otherwise,
    // which is a weaker guarantee but never a startup failure.
    ...(cache.client !== null ? { redis: cache.client } : {}),
    // Probes and metrics must never be limited: a scraper hitting the limit
    // would make the service look down.
    allowList: (req) => req.url.startsWith('/health') || req.url.startsWith('/metrics'),
    keyGenerator: (req) => req.ip,
  });

  // ── Correlation and RED metrics ─────────────────────────────────────────
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    // Label by the route TEMPLATE, never the resolved URL: one time series per
    // match id would make the metrics backend the most expensive component.
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };
    metrics.httpRequestsTotal.inc(labels);
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);

    const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info';
    request.log[level](
      {
        req: request,
        res: reply,
        route,
        durationMs: Math.round(reply.elapsedTime * 100) / 100,
        traceId: activeTraceId(),
      },
      'request completed',
    );
  });

  // ── OpenAPI ─────────────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'IPL Data Platform API',
        version: env.SERVICE_VERSION,
        description: [
          'Ball-by-ball IPL data, modelled at one row per delivery.',
          '',
          'Every figure this API returns is **derived from deliveries**, not copied from',
          'the source feed. The vendor-supplied scorecards and league table are stored',
          'separately and used only to assert that the derivation is correct — 23',
          'data-quality checks run after every ingest, including one that requires the',
          'points table to equal the published standings exactly, net run rate included.',
          '',
          '**Conventions**',
          '',
          '- Errors are RFC 9457 `application/problem+json`, always, with a `traceId`.',
          '- List endpoints use **keyset pagination**. Treat `page.nextCursor` as opaque.',
          '- Rates that are undefined (a strike rate off no balls) are `null`, never',
          '  `Infinity` or omitted.',
          '- Aggregates carry a strong `ETag`; send `If-None-Match` to get a 304.',
        ].join('\n'),
        license: { name: 'MIT' },
      },
      servers: [{ url: '/', description: 'This server' }],
      tags: [
        { name: 'health', description: 'Liveness, readiness and metrics' },
        { name: 'seasons', description: 'Seasons, standings and leaderboards' },
        { name: 'teams', description: 'Teams and head-to-head records' },
        { name: 'matches', description: 'Fixtures, scorecards, ball-by-ball and charts' },
        { name: 'players', description: 'Players, career records and phase splits' },
        { name: 'venues', description: 'Grounds and their scoring profiles' },
        { name: 'analytics', description: 'Cross-cutting comparisons' },
        { name: 'internal', description: 'Operational endpoints; service-token guarded' },
      ],
      components: {
        securitySchemes: {
          internalToken: {
            type: 'apiKey',
            name: 'x-internal-token',
            in: 'header',
            description: 'Shared secret guarding operational endpoints.',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true, displayRequestDuration: true },
    staticCSP: true,
  });

  // ── Routes ──────────────────────────────────────────────────────────────
  await app.register(async (instance) => {
    await healthRoutes(instance, {
      db,
      cache,
      version: env.SERVICE_VERSION,
      commit: env.GIT_SHA,
      // Marts are refreshed by the ingest job, which for this dataset runs
      // once. A day is the point at which silence means something is wrong.
      martStalenessThresholdSeconds: 86_400,
      metrics,
    });
  });

  if (env.METRICS_ENABLED) {
    app.get(
      '/metrics',
      { schema: { tags: ['health'], summary: 'Prometheus metrics', hide: true } },
      async (_request, reply) => {
        // Sampled at scrape time rather than on a timer: no work happens when
        // nobody is looking.
        metrics.cacheOperations.reset();
        metrics.cacheOperations.inc({ result: 'hit' }, cacheStats.hits);
        metrics.cacheOperations.inc({ result: 'miss' }, cacheStats.misses);
        metrics.cacheOperations.inc({ result: 'error' }, cacheStats.errors);

        try {
          const rows = await db.sql<{ mart_name: string; age: number }[]>`
            select mart_name, extract(epoch from (now() - refreshed_at))::int as age
            from core.mart_refresh
          `;
          for (const r of rows) metrics.martStalenessSeconds.set({ mart: r.mart_name }, r.age);
        } catch {
          // Metrics must not fail because the database is briefly unavailable.
        }

        try {
          // The same eight entities the README's own headline banner counts —
          // one UNION ALL, not eight round trips.
          const rows = await db.sql<{ entity: string; n: string }[]>`
            select 'match' as entity, count(*)::text as n from core.match
            union all select 'innings', count(*)::text from core.innings
            union all select 'delivery', count(*)::text from core.delivery
            union all select 'dismissal', count(*)::text from core.dismissal
            union all select 'player', count(*)::text from core.player
            union all select 'team', count(*)::text from core.team
            union all select 'venue', count(*)::text from core.venue
            union all select 'official', count(*)::text from core.official
          `;
          for (const r of rows) metrics.coreRowsCurrent.set({ entity: r.entity }, Number(r.n));
        } catch {
          // Metrics must not fail because the database is briefly unavailable.
        }

        try {
          const rows = await db.sql<{ check_name: string; status: string }[]>`
            select distinct on (check_name) check_name, status
            from quality.check_result
            order by check_name, ran_at desc
          `;
          metrics.dataQualityCheckStatus.reset();
          for (const r of rows) {
            metrics.dataQualityCheckStatus.set({ check: r.check_name, status: r.status }, 1);
          }
        } catch {
          // Metrics must not fail because the database is briefly unavailable.
        }

        reply.header('content-type', metrics.registry.contentType);
        return reply.send(await metrics.registry.metrics());
      },
    );
  }

  await app.register(async (instance) => {
    await v1Routes(instance, { db, cache, cacheTtlSeconds: env.CACHE_TTL_SECONDS });
  });

  // ── Internal ────────────────────────────────────────────────────────────
  app.post(
    '/internal/refresh-marts',
    {
      schema: {
        tags: ['internal'],
        summary: 'Refresh materialised views',
        description:
          'Refreshes every mart concurrently and bumps the cache version, invalidating all cached aggregates atomically. Guarded by `x-internal-token`.',
        security: [{ internalToken: [] }],
        response: {
          202: z.object({ status: z.literal('accepted'), marts: z.array(z.string()) }),
          401: Problem,
        },
      },
    },
    async (request, reply) => {
      const token = request.headers['x-internal-token'];
      if (
        env.INTERNAL_API_TOKEN === undefined ||
        typeof token !== 'string' ||
        token !== env.INTERNAL_API_TOKEN
      ) {
        throw ApiError.unauthorized('A valid x-internal-token header is required');
      }

      const rows = await db.sql<{ full_name: string }[]>`
        select (schemaname || '.' || matviewname) as full_name
        from pg_matviews where schemaname = 'marts'
      `;
      const names = rows.map((r) => r.full_name);

      // Returns 202 and refreshes in the background: a concurrent refresh of
      // every mart takes longer than any sensible HTTP timeout, and holding
      // the connection open buys the caller nothing.
      void (async () => {
        for (const name of names) {
          try {
            await db.sql.unsafe(`refresh materialized view concurrently ${name}`);
            await db.sql`
              insert into core.mart_refresh (mart_name, refreshed_at, version)
              values (${name}, now(), 1)
              on conflict (mart_name) do update
                set refreshed_at = now(), version = core.mart_refresh.version + 1
            `;
          } catch (err) {
            logger.error({ err, mart: name }, 'mart refresh failed');
          }
        }
      })();

      return reply.code(202).send({ status: 'accepted' as const, marts: names });
    },
  );

  // @fastify/swagger-ui serves the document at /docs/json. Exposing it at the
  // conventional /openapi.json as well means the URL in the README, the CI
  // contract job and any client generator all point at the same place.
  app.get('/openapi.json', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return reply.send(app.swagger());
  });

  app.get('/', { schema: { hide: true } }, async (_request, reply) => reply.redirect('/docs', 302));

  await app.ready();

  return {
    app,
    db,
    cache,
    metrics,
    async close() {
      await app.close();
      await cache.close();
      if (overrides.db === undefined) await db.close();
    },
  };
}
