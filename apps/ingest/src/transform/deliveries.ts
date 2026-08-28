import type { SourceCommentaryEntry, SourceInningsCommentary } from '../source/types.js';
import { asIdOrNull, asInt, asText, isoFromEpochSeconds } from '../source/parse.js';

/**
 * Turn a commentary stream into delivery rows.
 *
 * Three things happen here that are easy to get wrong and expensive to get
 * wrong quietly:
 *
 * 1. **`overend` entries are not deliveries.** The `commentaries` array mixes
 *    three event kinds: 17,001 `ball`, 911 `wicket` and 2,837 `overend`. A
 *    `wicket` *is* a delivery (it carries a bowler, a striker and runs); an
 *    `overend` is an over summary carrying none of that. Counting all three
 *    inflates the ball count by 16%.
 *
 * 2. **`over` is indexed differently per event kind.** `ball` and `wicket`
 *    number overs 0–19; `overend` numbers them 1–20. We keep the 0-indexed
 *    convention and simply never read an `overend`'s over.
 *
 * 3. **`(over, ball)` is not unique.** On a wide or no-ball the source reuses
 *    the ball number, and 729 pairs collide in this season alone. `deliverySeq`
 *    is assigned here, monotonically in array order, and is the only safe
 *    ordering key downstream.
 */

export interface DeliveryRow {
  inningsId: number;
  deliverySeq: number;
  overNo: number;
  ballInOver: number;
  strikerId: number;
  nonStrikerId: number;
  bowlerId: number;
  batRuns: number;
  wideRuns: number;
  noballRuns: number;
  byeRuns: number;
  legbyeRuns: number;
  totalRuns: number;
  isFour: boolean;
  isSix: boolean;
  commentary: string | null;
  sourceEventId: number;
  /** ISO 8601; see `isoFromEpochSeconds` for why this is not a `Date`. */
  ballTimestamp: string | null;
  /** Set when this entry was a `wicket` event; used to link the dismissal. */
  dismissedPlayerId: number | null;
}

export interface DeliveryComponentRepair {
  inningsId: number;
  deliverySeq: number;
  sourceEventId: number;
  componentSum: number;
  reportedTotal: number;
  /** Runs recovered and attributed to byes. */
  residual: number;
  commentary: string | null;
}

export interface TransformedInnings {
  readonly deliveries: DeliveryRow[];
  /**
   * Deliveries whose run components did not sum to the reported total, and
   * what we did about it. Three exist in this dataset; see `repairResidual`.
   */
  readonly componentRepairs: DeliveryComponentRepair[];
}

/**
 * Recover runs the source failed to attribute.
 *
 * Three deliveries in the season read `run: 5` with `noball_run: 1` and every
 * other component zero — the commentary calls them "5 no ball". One run is the
 * no-ball penalty; the other four were run without the bat and the source
 * simply dropped them.
 *
 * By elimination those runs are byes: they are not off the bat (the scorecard's
 * batting figures agree with our `bat_runs`, so adding them there would break
 * that reconciliation), and they are not the no-ball penalty (the scorecard's
 * bowling figures charge the bowler only the single penalty run). Byes are
 * exactly the category for "runs to the batting side, not off the bat, not
 * charged to the bowler".
 *
 * We cannot tell byes from leg-byes here, and it does not matter: both are
 * scored identically in every aggregate this platform computes. The repair is
 * recorded on the ingest run and asserted by a quality check, so it stays
 * visible rather than becoming folklore.
 */
function repairResidual(residual: number, byeRuns: number): number {
  return byeRuns + residual;
}

function isDelivery(e: SourceCommentaryEntry): boolean {
  return e.event === 'ball' || e.event === 'wicket';
}

/**
 * The non-striker.
 *
 * The source never names one, but every delivery carries a two-element
 * `batsmen` array holding both batters at the crease; the one that is not the
 * striker is the non-striker. That resolves 17,910 of 17,912 deliveries.
 *
 * The remaining two are a source glitch where the array lists the striker
 * twice. Cricket makes them recoverable: the pair at the crease only changes
 * on a wicket or between overs, so the previous delivery's pair still holds and
 * the non-striker is whichever of those two is not on strike now.
 */
function resolveNonStriker(
  e: SourceCommentaryEntry,
  strikerId: number,
  previousPair: readonly number[] | null,
): number {
  const ids = (e.batsmen ?? []).map((b) => asInt(b.batsman_id, 'batsmen[].batsman_id'));
  const other = ids.find((id) => id !== strikerId);
  if (other !== undefined) return other;

  const recovered = previousPair?.find((id) => id !== strikerId);
  if (recovered !== undefined) return recovered;

  throw new Error(
    `Cannot resolve non-striker for event ${e.event_id ?? '?'}: batsmen=${JSON.stringify(ids)}, striker=${strikerId}, previousPair=${JSON.stringify(previousPair)}`,
  );
}

export function transformInnings(src: SourceInningsCommentary): TransformedInnings {
  const inningsId = src.inning.iid;
  const deliveries: DeliveryRow[] = [];
  const componentRepairs: DeliveryComponentRepair[] = [];
  let seq = 0;
  /** The last known pair at the crease, for the glitch case above. */
  let previousPair: number[] | null = null;

  for (const e of src.commentaries) {
    if (!isDelivery(e)) continue;

    seq += 1;
    const strikerId = asInt(e.batsman_id, 'batsman_id');
    const batRuns = asInt(e.bat_run ?? 0, 'bat_run');
    const wideRuns = asInt(e.wide_run ?? 0, 'wide_run');
    const noballRuns = asInt(e.noball_run ?? 0, 'noball_run');
    const legbyeRuns = asInt(e.legbye_run ?? 0, 'legbye_run');
    let byeRunsValue = asInt(e.bye_run ?? 0, 'bye_run');
    const totalRuns = asInt(e.run ?? 0, 'run');

    const nonStrikerId = resolveNonStriker(e, strikerId, previousPair);
    previousPair = [strikerId, nonStrikerId];

    const componentSum = batRuns + wideRuns + noballRuns + byeRunsValue + legbyeRuns;
    const sourceEventId = asInt(e.event_id, 'event_id');
    if (componentSum !== totalRuns) {
      const residual = totalRuns - componentSum;
      if (residual < 0) {
        // Components exceeding the reported total is a contradiction we cannot
        // resolve by attribution; refuse rather than invent a reading.
        throw new Error(
          `Delivery ${sourceEventId} reports ${totalRuns} runs but its components sum to ${componentSum}`,
        );
      }
      componentRepairs.push({
        inningsId,
        deliverySeq: seq,
        sourceEventId,
        componentSum,
        reportedTotal: totalRuns,
        residual,
        commentary: asText(e.commentary),
      });
      byeRunsValue = repairResidual(residual, byeRunsValue);
    }

    deliveries.push({
      inningsId,
      deliverySeq: seq,
      overNo: asInt(e.over, 'over'),
      ballInOver: asInt(e.ball, 'ball'),
      strikerId,
      nonStrikerId: nonStrikerId,
      bowlerId: asInt(e.bowler_id, 'bowler_id'),
      batRuns,
      wideRuns,
      noballRuns,
      byeRuns: byeRunsValue,
      legbyeRuns,
      totalRuns,
      isFour: e.four === true,
      isSix: e.six === true,
      commentary: asText(e.commentary),
      sourceEventId,
      ballTimestamp: e.timestamp === undefined ? null : isoFromEpochSeconds(e.timestamp),
      dismissedPlayerId: e.event === 'wicket' ? asIdOrNull(e.wicket_batsman_id) : null,
    });
  }

  return { deliveries, componentRepairs };
}
