import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

import { api, unwrap, ApiProblem, SERVER_CACHE } from '../../../lib/api';
import { ManhattanChart, WormChart } from '../../../components/match-charts';
import { Card, PageHeader, Rate, TeamBadge } from '../../../components/primitives';
import { ChartSkeleton } from '../../../components/states';
import { Scorecard } from '../../../components/scorecard';

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
    const m = await api
      .GET('/v1/matches/{id}', { params: { path: { id: Number(id) } }, ...SERVER_CACHE })
      .then(unwrap);
    return { title: m.shortTitle, description: m.statusNote ?? m.title };
  } catch {
    return { title: 'Match' };
  }
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);

  const match = await api
    .GET('/v1/matches/{id}', { params: { path: { id: matchId } }, ...SERVER_CACHE })
    .then(unwrap)
    .catch((err: unknown) => {
      if (err instanceof ApiProblem && err.status === 404) notFound();
      throw err;
    });

  const teamLabels = match.innings.map((i) => ({
    inningsNo: i.inningsNo,
    label: i.battingTeam.shortName,
  }));

  return (
    <>
      <PageHeader
        eyebrow={match.stage === 'league' ? `Match ${match.matchNumber}` : match.stage}
        title={match.title}
        subtitle={`${match.matchDate} · ${match.venue.name}${
          match.venue.city !== null ? `, ${match.venue.city}` : ''
        }`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {match.innings.map((i) => (
          <div key={i.id} className="card px-4 py-3">
            <TeamBadge shortName={i.battingTeam.shortName} name={i.battingTeam.name} size="sm" />
            <p className="mt-1.5 text-xl font-semibold tracking-tight">
              {i.runs}
              <span className="text-ink-muted">/{i.wickets}</span>
              <span className="ml-2 text-sm font-normal text-ink-faint">({i.overs} ov)</span>
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Run rate <Rate value={i.runRate} /> · Extras {i.extras.total}
            </p>
          </div>
        ))}
      </div>

      {match.statusNote !== null && (
        <p className="mb-6 rounded-card border border-line bg-raised px-4 py-2.5 text-sm font-medium">
          {match.statusNote}
        </p>
      )}

      {/* Charts stream in after the scorecard: the scorecard is what the page is
          for, and it must not wait on two more round trips. */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Suspense fallback={<ChartSkeleton height={300} />}>
          <WormSection matchId={matchId} teams={teamLabels} />
        </Suspense>
        <Suspense fallback={<ChartSkeleton height={280} />}>
          <ManhattanSection matchId={matchId} teams={teamLabels} />
        </Suspense>
      </div>

      <div className="space-y-6">
        {match.innings.map((i) => (
          <Scorecard key={i.id} innings={i} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/matches/${matchId}/deliveries`}
          className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm font-medium transition-colors hover:bg-line/40"
        >
          Ball-by-ball
        </Link>
        <Link
          href="/matches"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
        >
          All matches
        </Link>
      </div>

      {match.officials.length > 0 && (
        <Card title="Officials" description="Parsed from a single free-text field.">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {match.officials.map((o) => (
              <li key={`${o.id}-${o.role}`} className="text-ink-muted">
                <span className="text-ink">{o.name}</span>
                <span className="ml-1.5 text-micro uppercase tracking-wider text-ink-faint">
                  {o.role}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

async function WormSection({
  matchId,
  teams,
}: {
  matchId: number;
  teams: { inningsNo: number; label: string }[];
}) {
  const worm = await api
    .GET('/v1/matches/{id}/worm', { params: { path: { id: matchId } }, ...SERVER_CACHE })
    .then(unwrap);
  return <WormChart data={worm.data} teams={teams} />;
}

async function ManhattanSection({
  matchId,
  teams,
}: {
  matchId: number;
  teams: { inningsNo: number; label: string }[];
}) {
  const bars = await api
    .GET('/v1/matches/{id}/manhattan', { params: { path: { id: matchId } }, ...SERVER_CACHE })
    .then(unwrap);
  return <ManhattanChart data={bars.data} teams={teams} />;
}
