import Link from 'next/link';

import { api, unwrap, SERVER_CACHE } from '../lib/api';
import { Card, PageHeader, Signed, StatTile, TeamBadge } from '../components/primitives';
import { EmptyState } from '../components/states';

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
 * League overview.
 *
 * A server component: the whole page is one render with no client-side
 * waterfall, and the four requests it needs run concurrently rather than in
 * sequence.
 */
export default async function OverviewPage() {
  const [seasons, table, runLeaders, wicketLeaders] = await Promise.all([
    api.GET('/v1/seasons', SERVER_CACHE).then(unwrap),
    api
      .GET('/v1/seasons/{year}/points-table', {
        params: { path: { year: 2022 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
    api
      .GET('/v1/seasons/{year}/leaders', {
        params: { path: { year: 2022 }, query: { metric: 'runs', limit: 5 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
    api
      .GET('/v1/seasons/{year}/leaders', {
        params: { path: { year: 2022 }, query: { metric: 'wickets', limit: 5 } },
        ...SERVER_CACHE,
      })
      .then(unwrap),
  ]);

  const season = seasons.data[0];
  const champion = table.data[0];
  const topRun = runLeaders.data[0];
  const topWicket = wicketLeaders.data[0];

  return (
    <>
      <PageHeader
        eyebrow={season?.name ?? 'Indian Premier League'}
        title="Season overview"
        subtitle={
          season === undefined
            ? undefined
            : `${season.totalMatches} matches · ${season.totalTeams} teams · ${season.startDate} to ${season.endDate}`
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="League leader"
          value={champion?.team.shortName ?? '—'}
          hint={champion === undefined ? undefined : `${champion.points} points`}
        />
        <StatTile
          label="Most runs"
          value={topRun?.value ?? '—'}
          hint={topRun?.player.fullName}
          href={topRun === undefined ? undefined : `/players/${topRun.player.id}`}
        />
        <StatTile
          label="Most wickets"
          value={topWicket?.value ?? '—'}
          hint={topWicket?.player.fullName}
          href={topWicket === undefined ? undefined : `/players/${topWicket.player.id}`}
        />
        <StatTile label="Deliveries modelled" value="17,912" hint="one row per ball" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card
          title="Points table"
          description="Derived from deliveries; league stage only."
          padded={false}
          action={
            <Link
              href="/matches"
              className="text-xs font-medium text-accent underline-offset-2 hover:underline"
            >
              All matches
            </Link>
          }
        >
          {table.data.length === 0 ? (
            <EmptyState title="No standings yet" description="The season has not been ingested." />
          ) : (
            <div className="scroll-x">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  IPL 2022 league points table with net run rate
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th
                      scope="col"
                      className="px-4 py-2 text-left text-xs font-medium text-ink-muted"
                    >
                      #
                    </th>
                    <th scope="col" className="py-2 text-left text-xs font-medium text-ink-muted">
                      Team
                    </th>
                    {['P', 'W', 'L', 'Pts', 'NRR'].map((h) => (
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
                  {table.data.map((row) => (
                    <tr
                      key={row.team.id}
                      className="border-b border-line/60 last:border-0 hover:bg-raised"
                    >
                      <td className="px-4 py-2 text-ink-faint">{row.position}</td>
                      <td className="py-2">
                        <Link
                          href={`/teams/${row.team.id}`}
                          className="hover:underline underline-offset-2"
                        >
                          <TeamBadge
                            shortName={row.team.shortName}
                            name={row.team.name}
                            size="sm"
                          />
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-muted">{row.played}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{row.won}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{row.lost}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.points}</td>
                      <td className="px-3 py-2 text-right">
                        <Signed value={row.netRunRate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* The top four qualify; saying so is more useful than a colour. */}
              <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
                Top four qualify for the playoffs. Net run rate separates sides level on points.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <LeaderCard title="Most runs" unit="runs" rows={runLeaders.data} />
          <LeaderCard title="Most wickets" unit="wickets" rows={wicketLeaders.data} />
        </div>
      </div>
    </>
  );
}

function LeaderCard({
  title,
  unit,
  rows,
}: {
  title: string;
  unit: string;
  rows: { rank: number; value: number; player: { id: number; fullName: string } }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card title={title} padded={false}>
      {rows.length === 0 ? (
        <EmptyState title="No qualifying players" />
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.player.id} className="border-b border-line/60 last:border-0">
              <Link
                href={`/players/${r.player.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-raised"
              >
                <span className="w-4 shrink-0 text-xs text-ink-faint">{r.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{r.player.fullName}</span>
                  {/* A bar is the magnitude encoding; the number is the label.
                      Both, because the bar alone is not readable as a value. */}
                  <span
                    aria-hidden="true"
                    className="mt-1 block h-1 rounded-full bg-series-1"
                    style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
                  />
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {r.value}
                  <span className="sr-only"> {unit}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
