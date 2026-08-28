import {
  isBowlerCredited,
  countsAsWicketLost,
  occursOnDelivery,
  parseDismissalKind,
  refineCaught,
  type DismissalKind,
} from '@ipl/domain';

import { asIdOrNull, asInt, asText } from '../source/parse.js';
import type { SourceScorecardInnings } from '../source/types.js';
import type { DeliveryRow } from './deliveries.js';

/**
 * Build dismissal rows by joining two source views of the same event.
 *
 * The **commentary** knows which ball a wicket fell on. The **scorecard** knows
 * what kind of dismissal it was and who fielded it, as ids rather than as the
 * free text `"c A Patel b A Nortje"`. Neither alone is enough, so they are
 * joined on `(innings, player dismissed)` — a batter cannot be dismissed twice
 * in an innings, which makes that pair a key. All 911 ball-linked dismissals
 * join cleanly.
 *
 * The 912th is the interesting one: a **retired hurt** that appears on the
 * scorecard with no corresponding ball, because it did not happen on one. It is
 * emitted with a null `deliveryId` rather than dropped or misattached.
 */

export interface DismissalRow {
  inningsId: number;
  deliveryId: number | null;
  /** Resolved to a real `delivery.id` after the deliveries are inserted. */
  deliverySeq: number | null;
  playerOutId: number;
  kind: DismissalKind;
  bowlerId: number | null;
  wicketNumber: number;
  teamScoreAtDismissal: number | null;
  batterRuns: number | null;
  batterBalls: number | null;
  howOut: string | null;
  creditsBowler: boolean;
  countsAsWicketLost: boolean;
  fielders: { playerId: number; ordinal: number; isSubstitute: boolean }[];
}

export function transformDismissals(
  card: SourceScorecardInnings,
  deliveries: readonly DeliveryRow[],
): DismissalRow[] {
  const inningsId = card.iid;

  // player -> the delivery they were dismissed on
  const dismissalSeqByPlayer = new Map<number, number>();
  for (const d of deliveries) {
    if (d.dismissedPlayerId !== null) {
      dismissalSeqByPlayer.set(d.dismissedPlayerId, d.deliverySeq);
    }
  }

  // Fall-of-wicket order gives the wicket number and the score at the fall.
  const fowByPlayer = new Map<number, (typeof card.fows)[number]>();
  for (const f of card.fows) {
    const pid = asIdOrNull(f.batsman_id);
    if (pid !== null) fowByPlayer.set(pid, f);
  }

  // Substitute fielders are flagged on the fielding list, not on the dismissal.
  const substitutes = new Set<number>();
  for (const f of card.fielder ?? []) {
    const pid = asIdOrNull(f.fielder_id);
    if (pid !== null && f.is_substitute === 'true') substitutes.add(pid);
  }

  const rows: DismissalRow[] = [];
  let fallbackWicketNumber = 0;

  for (const b of card.batsmen) {
    const rawKind = parseDismissalKind(b.dismissal);
    if (rawKind === null) continue; // not out

    const playerOutId = asInt(b.batsman_id, 'batsman_id');
    const bowlerId = asIdOrNull(b.bowler_id);
    const firstFielderId = asIdOrNull(b.first_fielder_id);
    const kind = refineCaught(rawKind, bowlerId, firstFielderId);

    const credits = isBowlerCredited(kind);
    const fow = fowByPlayer.get(playerOutId);
    fallbackWicketNumber += 1;

    const fielders: DismissalRow['fielders'] = [];
    const fielderIds = [firstFielderId, asIdOrNull(b.second_fielder_id), asIdOrNull(b.third_fielder_id)];
    for (const [i, pid] of fielderIds.entries()) {
      if (pid === null) continue;
      // For a caught-and-bowled the "fielder" is the bowler, already credited
      // with the wicket; recording them again would double-count the catch.
      if (kind === 'caught_and_bowled' && pid === bowlerId) continue;
      fielders.push({ playerId: pid, ordinal: i + 1, isSubstitute: substitutes.has(pid) });
    }

    const seq = dismissalSeqByPlayer.get(playerOutId) ?? null;
    if (seq === null && occursOnDelivery(kind)) {
      throw new Error(
        `Dismissal of player ${playerOutId} in innings ${inningsId} is a ${kind} but has no delivery`,
      );
    }

    rows.push({
      inningsId,
      deliveryId: null,
      deliverySeq: seq,
      playerOutId,
      kind,
      // The credit rule is the domain's, not the source's: the scorecard lists
      // a bowler id on some run-outs (the bowler at the time), which must not
      // become a wicket in their figures.
      bowlerId: credits ? bowlerId : null,
      wicketNumber: fow?.number ?? fallbackWicketNumber,
      teamScoreAtDismissal: fow?.score_at_dismissal ?? null,
      batterRuns: Number.isFinite(Number(b.runs)) ? Number(b.runs) : null,
      batterBalls: Number.isFinite(Number(b.balls_faced)) ? Number(b.balls_faced) : null,
      howOut: asText(b.how_out),
      creditsBowler: credits && bowlerId !== null,
      countsAsWicketLost: countsAsWicketLost(kind),
      fielders,
    });
  }

  rows.sort((a, b) => a.wicketNumber - b.wicketNumber);
  return rows;
}
