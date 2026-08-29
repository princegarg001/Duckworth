import { notFound } from 'next/navigation';
import Link from 'next/link';

import { api, unwrap, ApiProblem, SERVER_CACHE } from '../../../../lib/api';
import { DeliveryList } from '../../../../components/delivery-list';
import { PageHeader } from '../../../../components/primitives';

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
  return { title: `Ball-by-ball · match ${id}` };
}

/**
 * Ball-by-ball.
 *
 * The first page is rendered on the server so there is content immediately;
 * the rest is fetched and virtualised on the client. An innings is roughly 130
 * deliveries and a match around 260, which is not enough to need virtualisation
 * on its own — but this endpoint is cursor-paginated and unbounded in principle,
 * and a list component that only works below a row count is a latent bug.
 */
export default async function DeliveriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);

  const match = await api
    .GET('/v1/matches/{id}', { params: { path: { id: matchId } }, ...SERVER_CACHE })
    .then(unwrap)
    .catch((err: unknown) => {
      if (err instanceof ApiProblem && err.status === 404) notFound();
      throw err;
    });

  const first = await api
    .GET('/v1/matches/{id}/deliveries', {
      params: { path: { id: matchId }, query: { limit: 100 } },
      ...SERVER_CACHE,
    })
    .then(unwrap);

  return (
    <>
      <PageHeader
        eyebrow={match.shortTitle}
        title="Ball by ball"
        subtitle="Ordered by delivery sequence. Wides and no-balls repeat the ball number in the source, so sequence — not (over, ball) — is the ordering key."
        actions={
          <Link
            href={`/matches/${matchId}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            Scorecard
          </Link>
        }
      />

      <DeliveryList
        matchId={matchId}
        initial={first.data}
        initialCursor={first.page.nextCursor}
        innings={match.innings.map((i) => ({
          inningsNo: i.inningsNo,
          label: i.battingTeam.shortName,
        }))}
      />
    </>
  );
}
