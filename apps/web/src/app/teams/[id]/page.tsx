import { notFound } from 'next/navigation';
import Link from 'next/link';

import { api, unwrap, ApiProblem, SERVER_CACHE } from '../../../lib/api';
import {
  Card,
  PageHeader,
  Rate,
  Signed,
  StatTile,
  TeamBadge,
} from '../../../components/primitives';
import { EmptyState } from '../../../components/states';

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The container image is built without a database or API to talk to, so
 * prerendering would either fail the build or bake in an empty page. The
 * upstream fetches still carry `next: { revalidate }`, so responses are cached
 * for an hour — the page is dynamic, the data is not re-fetched per visitor.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const t = await api
      .GET('/v1/teams/{id}', { params: { path: { id: Number(id) } }, ...SERVER_CACHE })
      .then(unwrap);
    return { title: t.name };
  } catch {
    return { title: 'Team' };
  }
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);

  const team = await api
    .GET('/v1/teams/{id}', { params: { path: { id: teamId } }, ...SERVER_CACHE })
    .then(unwrap)
    .catch((err: unknown) => {
      if (err instanceof ApiProblem && err.status === 404) notFound();
      throw err;
    });

  const [table, h2h, teams, matches] = await Promise.all([
    api
      .GET('/v1/seasons/{year}/points-table', {
        params: { path: { year: 2022 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
    api
      .GET('/v1/analytics/head-to-head', {
        params: { query: { season: 2022 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
    api.GET('/v1/teams', SERVER_CACHE).then(unwrap),
    api
      .GET('/v1/matches', {
        params: { query: { teamId, limit: 20, order: 'asc' } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
  ]);

  const row = table.data.find((r) => r.team.id === teamId);
  const teamById = new Map(teams.data.map((t) => [t.id, t]));
  const opponents = h2h.data
    .filter((r) => r.teamId === teamId)
    .sort((a, b) => b.won - a.won || a.opponentId - b.opponentId);

  return (
    <>
      <PageHeader
        eyebrow={team.shortName}
        title={team.name}
        subtitle={
          row === undefined ? undefined : `Finished ${ordinal(row.position)} in the league stage`
        }
      />

      {row !== undefined && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Points" value={row.points} hint={`${row.won}W ${row.lost}L`} />
          <StatTile label="Net run rate" value={row.netRunRate.toFixed(3)} />
          <StatTile label="Runs for" value={row.runsFor} hint={`${row.oversFor} overs`} />
          <StatTile
            label="Runs against"
            value={row.runsAgainst}
            hint={`${row.oversAgainst} overs`}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Head to head" description="League and playoff meetings." padded={false}>
          {opponents.length === 0 ? (
            <EmptyState title="No fixtures recorded" />
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Head-to-head record against each opponent</caption>
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="px-4 py-2 text-left text-xs font-medium text-ink-muted"
                  >
                    Opponent
                  </th>
                  {['P', 'W', 'L', 'Win %'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-3 py-2 text-right text-xs font-medium text-ink-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {opponents.map((o) => {
                  const opp = teamById.get(o.opponentId);
                  return (
                    <tr key={o.opponentId} className="border-b border-line/60 last:border-0">
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        {opp === undefined ? (
                          o.opponentId
                        ) : (
                          <Link
                            href={`/teams/${opp.id}`}
                            className="hover:underline underline-offset-2"
                          >
                            <TeamBadge shortName={opp.shortName} name={opp.name} size="sm" />
                          </Link>
                        )}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {o.played}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{o.won}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{o.lost}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <Rate value={o.winPercentage} digits={0} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Season results" padded={false}>
          {matches.data.length === 0 ? (
            <EmptyState title="No matches" />
          ) : (
            <ul>
              {matches.data.map((m) => {
                const won = m.winnerId === teamId;
                const decided = m.winnerId !== null;
                const opponentSide = m.teamA.team.id === teamId ? m.teamB : m.teamA;
                const ownSide = m.teamA.team.id === teamId ? m.teamA : m.teamB;
                return (
                  <li key={m.id} className="border-b border-line/60 last:border-0">
                    <Link
                      href={`/matches/${m.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-raised"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          !decided
                            ? 'grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-bold bg-ink/10 text-ink-muted'
                            : won
                              ? 'grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-bold bg-status-good/15 text-status-good'
                              : 'grid h-5 w-5 shrink-0 place-items-center rounded text-[10px] font-bold bg-status-critical/15 text-status-critical'
                        }
                      >
                        {!decided ? 'N' : won ? 'W' : 'L'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">v {opponentSide.team.name}</span>
                        <span className="text-xs text-ink-faint">{m.matchDate}</span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                        {ownSide.runs ?? '—'}
                        {ownSide.runs !== null && `/${ownSide.wickets}`}
                        <span className="mx-1 text-ink-faint">v</span>
                        {opponentSide.runs ?? '—'}
                        {opponentSide.runs !== null && `/${opponentSide.wickets}`}
                      </span>
                      <span className="sr-only">
                        {won ? 'Won' : decided ? 'Lost' : 'No result'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
