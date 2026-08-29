import Link from 'next/link';

import { api, unwrap, SERVER_CACHE } from '../../lib/api';
import { MatchFilters } from '../../components/match-filters';
import { PageHeader, TeamBadge } from '../../components/primitives';
import { EmptyState } from '../../components/states';

export const metadata = { title: 'Matches' };
/**
 * Rendered per request rather than prerendered at build time.
 *
 * The container image is built without a database or API to talk to, so
 * prerendering would either fail the build or bake in an empty page. The
 * upstream fetches still carry `next: { revalidate }`, so responses are cached
 * for an hour — the page is dynamic, the data is not re-fetched per visitor.
 */
export const dynamic = 'force-dynamic';

/**
 * Match list.
 *
 * **The URL is the state.** Every filter and the pagination cursor live in the
 * query string, so a filtered view is shareable, the back button does the right
 * thing, and the server can render the filtered page directly rather than
 * shipping an empty shell that fetches on mount.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const [teams, venues] = await Promise.all([
    api.GET('/v1/teams', SERVER_CACHE).then(unwrap),
    api.GET('/v1/venues', SERVER_CACHE).then(unwrap),
  ]);

  const query = {
    limit: 25,
    ...(params['teamId'] !== undefined ? { teamId: Number(params['teamId']) } : {}),
    ...(params['venueId'] !== undefined ? { venueId: Number(params['venueId']) } : {}),
    ...(params['stage'] !== undefined
      ? { stage: params['stage'] as 'league' | 'final' }
      : {}),
    ...(params['cursor'] !== undefined ? { cursor: params['cursor'] } : {}),
  };

  const matches = await api
    .GET('/v1/matches', { params: { query }, ...SERVER_CACHE })
    .then(unwrap);

  const nextHref = (() => {
    if (matches.page.nextCursor === null) return null;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== 'cursor') sp.set(k, v);
    }
    sp.set('cursor', matches.page.nextCursor);
    return `/matches?${sp.toString()}`;
  })();

  return (
    <>
      <PageHeader
        title="Matches"
        subtitle={`${matches.data.length} shown${matches.page.hasMore ? ' · more available' : ''}`}
      />

      <MatchFilters teams={teams.data} venues={venues.data} />

      {matches.data.length === 0 ? (
        <div className="card mt-4">
          <EmptyState
            title="No matches found"
            description="No fixture matches these filters. Try clearing one."
            action={
              <Link
                href="/matches"
                className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium hover:bg-line/40"
              >
                Clear filters
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {matches.data.map((m) => {
            const aWon = m.winnerId === m.teamA.team.id;
            const bWon = m.winnerId === m.teamB.team.id;
            return (
              <li key={m.id}>
                <Link
                  href={`/matches/${m.id}`}
                  className="card block px-4 py-3 transition-colors hover:bg-raised"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-micro font-medium uppercase tracking-wider text-ink-faint">
                      {m.stage === 'league' ? `Match ${m.matchNumber}` : m.stage}
                    </span>
                    <span className="text-xs text-ink-faint">
                      {m.matchDate} · {m.venue.name}
                    </span>
                  </div>

                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    <ScoreLine side={m.teamA} won={aWon} />
                    <ScoreLine side={m.teamB} won={bWon} />
                  </div>

                  {m.statusNote !== null && (
                    <p className="mt-2 text-xs text-ink-muted">{m.statusNote}</p>
                  )}
                </Link>
              </li>
            );
          })}
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

function ScoreLine({
  side,
  won,
}: {
  side: {
    team: { id: number; shortName: string; name: string };
    runs: number | null;
    wickets: number | null;
    overs: string | null;
  };
  won: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={won ? 'font-semibold text-ink' : 'text-ink-muted'}>
        <TeamBadge shortName={side.team.shortName} name={side.team.name} size="sm" />
      </span>
      <span className={won ? 'shrink-0 font-semibold tabular-nums' : 'shrink-0 tabular-nums text-ink-muted'}>
        {side.runs === null ? (
          <span className="text-ink-faint">did not bat</span>
        ) : (
          <>
            {side.runs}/{side.wickets}
            {side.overs !== null && (
              <span className="ml-1 text-xs font-normal text-ink-faint">({side.overs})</span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
