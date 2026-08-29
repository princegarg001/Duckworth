import { api, unwrap, SERVER_CACHE } from '../../lib/api';
import { Card, PageHeader, Rate } from '../../components/primitives';
import { EmptyState } from '../../components/states';

export const metadata = { title: 'Venues' };
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
 * Venue profiles.
 *
 * The two questions asked at every toss: does this ground favour batting first,
 * and does winning the toss actually matter here? Presented as a table because
 * the comparison is across several measures at once — a chart of one measure
 * would answer a narrower question than the page is for.
 */
export default async function VenuesPage() {
  const profiles = await api
    .GET('/v1/analytics/venues', { params: { query: { season: 2022 } }, ...SERVER_CACHE })
    .then(unwrap);

  return (
    <>
      <PageHeader
        title="Venues"
        subtitle="IPL 2022 was played across six grounds, four of them in Mumbai."
      />

      <Card padded={false}>
        {profiles.data.length === 0 ? (
          <EmptyState title="No venue data" />
        ) : (
          <div className="scroll-x">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Scoring and toss profile for each venue in IPL 2022
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="px-4 py-2 text-left text-xs font-medium text-ink-muted"
                  >
                    Venue
                  </th>
                  {[
                    ['M', 'Matches'],
                    ['Avg 1st', 'Average first-innings score'],
                    ['High', 'Highest first-innings score'],
                    ['Low', 'Lowest first-innings score'],
                    ['Chase %', 'Percentage of matches won by the chasing side'],
                    ['Bat / Field', 'Toss decisions'],
                  ].map(([short, full]) => (
                    <th
                      key={short}
                      scope="col"
                      title={full}
                      className="px-3 py-2 text-right text-xs font-medium text-ink-muted"
                    >
                      {short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profiles.data.map((p) => (
                  <tr key={p.venue.id} className="border-b border-line/60 last:border-0">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      <span className="block font-medium text-ink">{p.venue.name}</span>
                      {p.venue.city !== null && (
                        <span className="text-xs text-ink-faint">{p.venue.city}</span>
                      )}
                    </th>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                      {p.matches}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      <Rate value={p.avgFirstInningsScore} digits={0} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                      {p.highestFirstInnings}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                      {p.lowestFirstInnings}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <Rate value={p.chaseWinPercentage} digits={0} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">
                      {p.tossChoseBat} / {p.tossChoseField}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
              &ldquo;Chase %&rdquo; is the share of matches won by the side batting second.
              &ldquo;Bat / Field&rdquo; counts what the toss winner chose to do.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
