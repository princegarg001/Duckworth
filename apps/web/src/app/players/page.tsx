import Link from 'next/link';

import { api, unwrap, SERVER_CACHE } from '../../lib/api';
import { PlayerSearch } from '../../components/player-search';
import { PageHeader } from '../../components/primitives';
import { EmptyState } from '../../components/states';

export const metadata = { title: 'Players' };
/**
 * Rendered per request rather than prerendered at build time.
 *
 * The container image is built without a database or API to talk to, so
 * prerendering would either fail the build or bake in an empty page. The
 * upstream fetches still carry `next: { revalidate }`, so responses are cached
 * for an hour — the page is dynamic, the data is not re-fetched per visitor.
 */
export const dynamic = 'force-dynamic';

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const q = params['q'];

  const players = await api
    .GET('/v1/players', {
      params: {
        query: {
          limit: 60,
          ...(q !== undefined && q !== '' ? { q } : {}),
          ...(params['cursor'] !== undefined ? { cursor: params['cursor'] } : {}),
        },
      },
      ...SERVER_CACHE,
    })
    .then(unwrap);

  const nextHref = (() => {
    if (players.page.nextCursor === null) return null;
    const sp = new URLSearchParams();
    if (q !== undefined && q !== '') sp.set('q', q);
    sp.set('cursor', players.page.nextCursor);
    return `/players?${sp.toString()}`;
  })();

  return (
    <>
      <PageHeader title="Players" subtitle="247 players appeared in IPL 2022." />

      <PlayerSearch />

      {players.data.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            title="No players match that search"
            description={
              q === undefined ? undefined : `Nothing found for “${q}”. Try a shorter name.`
            }
            action={
              <Link
                href="/players"
                className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium hover:bg-line/40"
              >
                Clear search
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {players.data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/players/${p.id}`}
                className="card block px-4 py-3 transition-colors hover:bg-raised"
              >
                <p className="truncate text-sm font-medium text-ink">{p.fullName}</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  {[p.playingRole, p.battingStyle, p.bowlingStyle]
                    .filter((v): v is string => v !== null && v !== '')
                    .join(' · ') || 'No profile recorded'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {nextHref !== null && (
        <div className="mt-4 flex justify-center">
          <Link
            href={nextHref}
            className="rounded-md border border-line bg-raised px-4 py-2 text-sm font-medium transition-colors hover:bg-line/40"
          >
            Load more
          </Link>
        </div>
      )}
    </>
  );
}
