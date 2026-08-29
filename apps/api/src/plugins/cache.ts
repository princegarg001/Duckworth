import { createHash } from 'node:crypto';

import type { DbHandle } from '@ipl/db';
import type { FastifyReply } from 'fastify';
import { Redis } from 'ioredis';

/**
 * Cache-aside with version-stamped keys.
 *
 * The interesting part is invalidation. Every cache key is namespaced by the
 * current mart version — `v7:leaders:2022:runs` — and `core.mart_refresh`
 * bumps that integer on every refresh. So a mart refresh invalidates every
 * cached aggregate *atomically*, by changing one number, with no key scanning,
 * no `KEYS *`, and no window where a client can read a value derived from data
 * that has since been replaced. Stale entries simply become unreachable and
 * expire on their own TTL.
 *
 * Redis is optional. With no `REDIS_URL` the cache is a no-op that always
 * misses, because an API that cannot start without its cache has made a
 * nice-to-have into a hard dependency.
 */

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Current mart version; the namespace every key is built on. */
  version(): Promise<number>;
  key(parts: readonly (string | number | undefined)[]): Promise<string>;
  readonly enabled: boolean;
  readonly client: Redis | null;
  close(): Promise<void>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
}

export function createCache(opts: {
  url?: string | undefined;
  db: DbHandle;
  stats?: CacheStats;
  onError?: (err: Error) => void;
}): Cache {
  const stats = opts.stats ?? { hits: 0, misses: 0, errors: 0 };

  const client =
    opts.url === undefined || opts.url === ''
      ? null
      : new Redis(opts.url, {
          maxRetriesPerRequest: 2,
          // Fail fast: a slow cache must never become a slow API.
          connectTimeout: 2_000,
          commandTimeout: 500,
          lazyConnect: false,
          enableOfflineQueue: false,
        });

  if (client !== null && opts.onError !== undefined) {
    client.on('error', opts.onError);
  }

  // The version changes only on a mart refresh, so it is worth a short local
  // TTL to avoid a database round trip on every single request.
  let cachedVersion: { value: number; expiresAt: number } | null = null;

  const version = async (): Promise<number> => {
    const now = Date.now();
    if (cachedVersion !== null && cachedVersion.expiresAt > now) return cachedVersion.value;
    try {
      const rows = await opts.db.sql<{ v: number | null }[]>`
        select max(version) as v from core.mart_refresh
      `;
      const value = rows[0]?.v ?? 1;
      cachedVersion = { value, expiresAt: now + 5_000 };
      return value;
    } catch {
      return cachedVersion?.value ?? 1;
    }
  };

  return {
    enabled: client !== null,
    client,

    async version() {
      return version();
    },

    async key(parts) {
      const v = await version();
      const joined = parts.filter((p) => p !== undefined).join(':');
      // Hash long keys so a query string with many filters cannot produce an
      // unbounded key, while short ones stay readable in redis-cli.
      const suffix =
        joined.length <= 120
          ? joined
          : createHash('sha256').update(joined).digest('hex').slice(0, 32);
      return `v${v}:${suffix}`;
    },

    async get<T>(key: string): Promise<T | null> {
      if (client === null) return null;
      try {
        const raw = await client.get(key);
        if (raw === null) {
          stats.misses += 1;
          return null;
        }
        stats.hits += 1;
        return JSON.parse(raw) as T;
      } catch (err) {
        // A cache failure degrades to a miss. It must never fail the request.
        stats.errors += 1;
        opts.onError?.(err as Error);
        return null;
      }
    },

    async set(key, value, ttlSeconds) {
      if (client === null || ttlSeconds <= 0) return;
      try {
        await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch (err) {
        stats.errors += 1;
        opts.onError?.(err as Error);
      }
    },

    async close() {
      if (client !== null) await client.quit().catch(() => client.disconnect());
    },
  };
}

/**
 * Strong ETag plus `stale-while-revalidate`.
 *
 * The ETag is derived from the response body, so a client that already has the
 * current representation gets a 304 with no body. `stale-while-revalidate`
 * lets a CDN keep serving during a refresh instead of stampeding the origin.
 */
export function applyCacheHeaders(
  reply: FastifyReply,
  body: unknown,
  opts: { maxAge: number; staleWhileRevalidate?: number },
): string {
  const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
  const swr = opts.staleWhileRevalidate ?? opts.maxAge * 5;
  reply.header('etag', etag);
  reply.header('cache-control', `public, max-age=${opts.maxAge}, stale-while-revalidate=${swr}`);
  return etag;
}

/** True when the client already holds this representation. */
export function isNotModified(requestEtag: string | undefined, etag: string): boolean {
  if (requestEtag === undefined) return false;
  return requestEtag
    .split(',')
    .map((s) => s.trim())
    .includes(etag);
}
