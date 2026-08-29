import { notFound } from 'next/navigation';
import Link from 'next/link';

import { api, unwrap, ApiProblem, SERVER_CACHE } from '../../../lib/api';
import { PhaseChart } from '../../../components/phase-chart';
import { Card, PageHeader, Rate, StatTile } from '../../../components/primitives';
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
    const p = await api
      .GET('/v1/players/{id}', { params: { path: { id: Number(id) } }, ...SERVER_CACHE })
      .then(unwrap);
    return { title: p.fullName };
  } catch {
    return { title: 'Player' };
  }
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);

  const player = await api
    .GET('/v1/players/{id}', { params: { path: { id: playerId } }, ...SERVER_CACHE })
    .then(unwrap)
    .catch((err: unknown) => {
      if (err instanceof ApiProblem && err.status === 404) notFound();
      throw err;
    });

  // A player may have batted, bowled, both or neither; a missing record is a
  // 404 from the API, not an error, so each is resolved independently.
  const [batting, bowling, phases, form] = await Promise.all([
    api
      .GET('/v1/players/{id}/batting', { params: { path: { id: playerId } }, ...SERVER_CACHE })
      .then(unwrap)
      .catch(() => null),
    api
      .GET('/v1/players/{id}/bowling', { params: { path: { id: playerId } }, ...SERVER_CACHE })
      .then(unwrap)
      .catch(() => null),
    api
      .GET('/v1/players/{id}/phase-splits', {
        params: { path: { id: playerId } },
        ...SERVER_CACHE,
      })
      .then(unwrap)
      .catch(() => null),
    api
      .GET('/v1/players/{id}/form', {
        params: { path: { id: playerId }, query: { last: 5 } },
        ...SERVER_CACHE,
      })
      .then(unwrap)
      .catch(() => null),
  ]);

  const profile = [player.playingRole, player.battingStyle, player.bowlingStyle]
    .filter((v): v is string => v !== null && v !== '')
    .join(' · ');

  return (
    <>
      <PageHeader
        eyebrow={player.nationality ?? undefined}
        title={player.fullName}
        subtitle={profile === '' ? undefined : profile}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Runs"
          value={batting?.runs ?? '—'}
          hint={batting === null ? 'did not bat' : `${batting.innings} innings`}
        />
        <StatTile
          label="Strike rate"
          value={batting?.strikeRate?.toFixed(2) ?? '—'}
          hint={batting === null ? undefined : `HS ${batting.highestScore}`}
        />
        <StatTile
          label="Wickets"
          value={bowling?.wickets ?? '—'}
          hint={bowling === null ? 'did not bowl' : `${bowling.overs} overs`}
        />
        <StatTile
          label="Economy"
          value={bowling?.economy?.toFixed(2) ?? '—'}
          hint={bowling === null ? undefined : `best ${bowling.bestWickets} wkts`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {batting !== null && (
          <Card title="Batting" description="IPL 2022, all stages." padded={false}>
            <StatRows
              rows={[
                ['Matches', batting.matches],
                ['Innings', batting.innings],
                ['Not out', batting.notOuts],
                ['Runs', batting.runs],
                ['Balls faced', batting.ballsFaced],
                ['Highest score', batting.highestScore],
                ['Average', <Rate key="a" value={batting.average} />],
                ['Strike rate', <Rate key="s" value={batting.strikeRate} />],
                ['50s / 100s', `${batting.fifties} / ${batting.hundreds}`],
                ['Fours / Sixes', `${batting.fours} / ${batting.sixes}`],
                ['Ducks', batting.ducks],
              ]}
            />
          </Card>
        )}

        {bowling !== null && (
          <Card title="Bowling" description="IPL 2022, all stages." padded={false}>
            <StatRows
              rows={[
                ['Matches', bowling.matches],
                ['Innings', bowling.innings],
                ['Overs', bowling.overs],
                ['Runs conceded', bowling.runsConceded],
                ['Wickets', bowling.wickets],
                ['Best in innings', bowling.bestWickets],
                ['Average', <Rate key="a" value={bowling.average} />],
                ['Economy', <Rate key="e" value={bowling.economy} />],
                ['Strike rate', <Rate key="s" value={bowling.strikeRate} />],
                ['Maidens', bowling.maidens],
                ['4w / 5w', `${bowling.fourWicketHauls} / ${bowling.fiveWicketHauls}`],
              ]}
            />
          </Card>
        )}
      </div>

      {phases !== null && phases.data.length > 0 && (
        <div className="mt-6">
          <PhaseChart data={phases.data} />
        </div>
      )}

      {form !== null && (
        <div className="mt-6">
          <Card title="Recent form" description="Last five appearances." padded={false}>
            {form.data.length === 0 ? (
              <EmptyState title="No recent appearances" />
            ) : (
              <ul>
                {form.data.map((f) => (
                  <li key={f.match.id} className="border-b border-line/60 last:border-0">
                    <Link
                      href={`/matches/${f.match.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-2.5 hover:bg-raised"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">
                          v {f.opponent.name}
                        </span>
                        <span className="text-xs text-ink-faint">{f.match.matchDate}</span>
                      </span>
                      <span className="shrink-0 text-right text-sm tabular-nums">
                        {f.runs !== null && (
                          <span className="text-ink">
                            {f.runs}
                            <span className="text-ink-faint"> ({f.ballsFaced})</span>
                          </span>
                        )}
                        {f.wickets !== null && (
                          <span className="ml-3 text-ink">
                            {f.wickets}/{f.runsConceded}
                          </span>
                        )}
                        {f.runs === null && f.wickets === null && (
                          <span className="text-ink-faint">did not feature</span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function StatRows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-line/60 last:border-0">
            <th scope="row" className="px-4 py-1.5 text-left font-normal text-ink-muted">
              {label}
            </th>
            <td className="px-4 py-1.5 text-right font-medium tabular-nums text-ink">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
