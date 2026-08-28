import type { DbHandle } from '@ipl/db';

/**
 * Materialised-view refresh.
 *
 * `CONCURRENTLY` is not optional here. A plain REFRESH takes an
 * ACCESS EXCLUSIVE lock for its whole duration, so every read of that view
 * blocks — on a live site that is an outage, not a refresh. Concurrent refresh
 * requires a unique index on the view, which is why every matview in
 * `packages/db/marts` declares one.
 *
 * Order matters: `points_table` and the season rollups read the innings cards,
 * so the cards refresh first.
 */

export const MART_ORDER = [
  'marts.innings_summary',
  'marts.batting_innings',
  'marts.bowling_innings',
  'marts.batting_season',
  'marts.bowling_season',
  'marts.phase_splits',
  'marts.partnership',
  'marts.points_table',
  'marts.head_to_head',
  'marts.venue_profile',
] as const;

export interface MartRefreshResult {
  readonly name: string;
  readonly durationMs: number;
  readonly rowCount: number;
}

/** Which of the expected views actually exist, in dependency order. */
async function existingMarts(handle: DbHandle): Promise<string[]> {
  const rows = await handle.sql<{ full_name: string }[]>`
    select (schemaname || '.' || matviewname) as full_name
    from pg_matviews
    where schemaname = 'marts'
  `;
  const present = new Set(rows.map((r) => r.full_name));
  return MART_ORDER.filter((m) => present.has(m));
}

export async function refreshMarts(
  handle: DbHandle,
  opts: { concurrently?: boolean } = {},
): Promise<MartRefreshResult[]> {
  const names = await existingMarts(handle);
  const results: MartRefreshResult[] = [];

  for (const name of names) {
    const started = Date.now();
    // A view that has never been populated cannot be refreshed concurrently,
    // so the first refresh after a rebuild falls back to a plain one.
    const populated = await isPopulated(handle, name);
    const concurrent = opts.concurrently !== false && populated;
    await handle.sql.unsafe(
      `refresh materialized view ${concurrent ? 'concurrently ' : ''}${name}`,
    );
    const durationMs = Date.now() - started;

    const [countRow] = await handle.sql.unsafe<{ n: string }[]>(
      `select count(*)::text as n from ${name}`,
    );
    const rowCount = Number(countRow?.n ?? 0);

    await handle.sql`
      insert into core.mart_refresh (mart_name, refreshed_at, duration_ms, row_count, version)
      values (${name}, now(), ${durationMs}, ${rowCount}, 1)
      on conflict (mart_name) do update set
        refreshed_at = now(),
        duration_ms = ${durationMs},
        row_count = ${rowCount},
        -- Bumping the version invalidates every cached aggregate at once: the
        -- API namespaces its Redis keys by it, so nothing has to be scanned or
        -- deleted on a refresh.
        version = core.mart_refresh.version + 1
    `;

    results.push({ name, durationMs, rowCount });
  }

  return results;
}

async function isPopulated(handle: DbHandle, fullName: string): Promise<boolean> {
  const [schema, view] = fullName.split('.');
  const rows = await handle.sql<{ ispopulated: boolean }[]>`
    select ispopulated from pg_matviews
    where schemaname = ${schema!} and matviewname = ${view!}
  `;
  return rows[0]?.ispopulated ?? false;
}

/** Age of the freshest mart, in seconds — surfaced by `/health/ready`. */
export async function martStalenessSeconds(handle: DbHandle): Promise<number | null> {
  const rows = await handle.sql<{ age: number | null }[]>`
    select extract(epoch from (now() - min(refreshed_at)))::int as age
    from core.mart_refresh
  `;
  return rows[0]?.age ?? null;
}
