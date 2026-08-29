import Link from 'next/link';

import { api, unwrap, SERVER_CACHE } from '../../lib/api';
import { PageHeader, Signed, TeamBadge } from '../../components/primitives';

export const metadata = { title: 'Teams' };
/**
 * Rendered per request rather than prerendered at build time.
 *
 * The container image is built without a database or API to talk to, so
 * prerendering would either fail the build or bake in an empty page. The
 * upstream fetches still carry `next: { revalidate }`, so responses are cached
 * for an hour — the page is dynamic, the data is not re-fetched per visitor.
 */
export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const [teams, table] = await Promise.all([
    api.GET('/v1/teams', SERVER_CACHE).then(unwrap),
    api
      .GET('/v1/seasons/{year}/points-table', {
        params: { path: { year: 2022 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
  ]);

  const byId = new Map(table.data.map((r) => [r.team.id, r]));
  const ordered = [...teams.data].sort(
    (a, b) => (byId.get(a.id)?.position ?? 99) - (byId.get(b.id)?.position ?? 99),
  );

  return (
    <>
      <PageHeader title="Teams" subtitle="Ten franchises contested IPL 2022." />

      <ul className="grid gap-2 sm:grid-cols-2">
        {ordered.map((t) => {
          const row = byId.get(t.id);
          return (
            <li key={t.id}>
              <Link
                href={`/teams/${t.id}`}
                className="card flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-raised"
              >
                <span className="min-w-0">
                  <TeamBadge shortName={t.shortName} name={t.name} />
                  {row !== undefined && (
                    <span className="mt-1 block text-xs text-ink-muted">
                      {row.won}W {row.lost}L · {row.points} pts
                    </span>
                  )}
                </span>
                {row !== undefined && (
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-ink-faint">#{row.position}</span>
                    <span className="block text-sm">
                      <Signed value={row.netRunRate} />
                    </span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
