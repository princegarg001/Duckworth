/**
 * Dismissal taxonomy.
 *
 * The source dataset exposes two representations of the same event:
 *   - `scorecards[].innings[].batsmen[].dismissal` — a compact enum
 *   - `commentaries[].how_out`                    — free text ("c A Patel b A Nortje")
 *
 * We treat the enum as authoritative and keep the free text only for display,
 * because the enum is the one the fielder-id columns are aligned with.
 */

export const DISMISSAL_KINDS = [
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'run_out',
  'hit_wicket',
  'retired_out',
  'retired_hurt',
  'obstructing_the_field',
  'hit_the_ball_twice',
  'timed_out',
] as const;

export type DismissalKind = (typeof DISMISSAL_KINDS)[number];

/** Raw `dismissal` values observed in this dataset, mapped to our canonical enum. */
const SOURCE_DISMISSAL_MAP: Readonly<Record<string, DismissalKind>> = {
  bowled: 'bowled',
  caught: 'caught',
  lbw: 'lbw',
  stumped: 'stumped',
  runout: 'run_out',
  'run out': 'run_out',
  hitwicket: 'hit_wicket',
  'hit wicket': 'hit_wicket',
  retiredout: 'retired_out',
  'retired out': 'retired_out',
  retired: 'retired_hurt',
  'retired hurt': 'retired_hurt',
  obstructingthefield: 'obstructing_the_field',
  timedout: 'timed_out',
  hittheballtwice: 'hit_the_ball_twice',
};

/**
 * Normalise a source dismissal string. Returns `null` for an empty value
 * (a not-out batter) and throws on an unrecognised one — a new dismissal
 * string is a schema change, not a row to silently drop.
 */
export function parseDismissalKind(raw: string | null | undefined): DismissalKind | null {
  if (raw === null || raw === undefined) return null;
  const key = raw.trim().toLowerCase();
  if (key === '') return null;
  const mapped = SOURCE_DISMISSAL_MAP[key];
  if (mapped === undefined) {
    throw new Error(`Unrecognised dismissal kind: ${JSON.stringify(raw)}`);
  }
  return mapped;
}

/**
 * Wickets credited to the bowler.
 *
 * Run-outs, retirements, obstruction and timed-out are dismissals but are NOT
 * the bowler's wicket. Getting this wrong inflates every bowling average and
 * economy-adjacent stat in the platform, so it lives here with tests rather
 * than being re-derived in SQL at each call site.
 */
const BOWLER_CREDITED: ReadonlySet<DismissalKind> = new Set<DismissalKind>([
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'hit_wicket',
]);

export function isBowlerCredited(kind: DismissalKind): boolean {
  return BOWLER_CREDITED.has(kind);
}

/**
 * Dismissals that cost the batting side a wicket in the scorecard sense.
 *
 * `retired_hurt` does not: the batter may return, the innings is not one down,
 * and — uniquely — it is not attached to any delivery.
 */
export function countsAsWicketLost(kind: DismissalKind): boolean {
  return kind !== 'retired_hurt';
}

/**
 * Whether the dismissal is attached to a delivery.
 *
 * Verified against the dataset: of 912 scorecard dismissals, exactly one — a
 * `retired hurt` — has no corresponding ball event. R Ashwin's `retired out`
 * (the first in IPL history) *does* sit on a delivery, so the two retirements
 * must not be collapsed into one case.
 *
 * This is why `dismissal.delivery_id` is nullable in the schema.
 */
export function occursOnDelivery(kind: DismissalKind): boolean {
  return kind !== 'retired_hurt';
}

/**
 * The source encodes caught-and-bowled as a plain `caught` whose sole fielder
 * happens to be the bowler. We promote it to its own kind so bowling cards can
 * render "c & b" and fielding stats do not credit a phantom catch to a fielder
 * who is already credited with the wicket.
 */
export function refineCaught(
  kind: DismissalKind,
  bowlerId: number | null,
  firstFielderId: number | null,
): DismissalKind {
  if (kind === 'caught' && bowlerId !== null && bowlerId === firstFielderId) {
    return 'caught_and_bowled';
  }
  return kind;
}
