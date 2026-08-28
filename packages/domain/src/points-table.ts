/**
 * League points table.
 *
 * IPL awards 2 points for a win, 1 each for a tie or no-result, 0 for a loss.
 * Ties resolved in a Super Over still count as a win for the Super Over winner.
 *
 * Ordering is points first, then NRR. (The real tournament has further
 * tie-breakers — head-to-head, then wins — which are only reachable when
 * points *and* NRR are identical; NRR to three decimals has never tied in IPL
 * history, but the comparator implements the next rung anyway rather than
 * leaving the order non-deterministic.)
 */

import { computeNetRunRates, type InningsLine, type NrrComponents } from './nrr.js';

export const WIN_POINTS = 2;
export const TIE_OR_NO_RESULT_POINTS = 1;
export const LOSS_POINTS = 0;

export type MatchOutcome = 'win' | 'loss' | 'tie' | 'no_result';

export interface TeamMatchResult {
  readonly teamId: number;
  readonly opponentId: number;
  readonly outcome: MatchOutcome;
}

export interface PointsRow {
  readonly teamId: number;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly noResult: number;
  readonly tied: number;
  readonly points: number;
  readonly netRunRate: number;
  readonly runsFor: number;
  readonly ballsFor: number;
  readonly runsAgainst: number;
  readonly ballsAgainst: number;
  readonly position: number;
}

function pointsFor(outcome: MatchOutcome): number {
  switch (outcome) {
    case 'win':
      return WIN_POINTS;
    case 'tie':
    case 'no_result':
      return TIE_OR_NO_RESULT_POINTS;
    case 'loss':
      return LOSS_POINTS;
  }
}

/**
 * Build the ordered points table.
 *
 * `results` and `lines` must already be filtered to league-stage matches; this
 * function has no view of the fixture list and cannot do it for you.
 */
export function buildPointsTable(
  results: readonly TeamMatchResult[],
  lines: readonly InningsLine[],
): PointsRow[] {
  const nrr = computeNetRunRates(lines);

  interface Tally {
    played: number;
    won: number;
    lost: number;
    tied: number;
    noResult: number;
    points: number;
    headToHead: Map<number, number>;
  }
  const tallies = new Map<number, Tally>();

  for (const r of results) {
    let t = tallies.get(r.teamId);
    if (t === undefined) {
      t = {
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        points: 0,
        headToHead: new Map(),
      };
      tallies.set(r.teamId, t);
    }
    t.played += 1;
    t.points += pointsFor(r.outcome);
    if (r.outcome === 'win') {
      t.won += 1;
      t.headToHead.set(r.opponentId, (t.headToHead.get(r.opponentId) ?? 0) + 1);
    } else if (r.outcome === 'loss') {
      t.lost += 1;
    } else if (r.outcome === 'tie') {
      t.tied += 1;
    } else {
      t.noResult += 1;
    }
  }

  const empty: NrrComponents = {
    teamId: 0,
    runsFor: 0,
    ballsFor: 0,
    runsAgainst: 0,
    ballsAgainst: 0,
    netRunRate: 0,
  };

  const rows = [...tallies.entries()].map(([teamId, t]) => {
    const n = nrr.get(teamId) ?? empty;
    return {
      teamId,
      played: t.played,
      won: t.won,
      lost: t.lost,
      tied: t.tied,
      noResult: t.noResult,
      points: t.points,
      netRunRate: n.netRunRate,
      runsFor: n.runsFor,
      ballsFor: n.ballsFor,
      runsAgainst: n.runsAgainst,
      ballsAgainst: n.ballsAgainst,
      _h2h: t.headToHead,
    };
  });

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.netRunRate !== a.netRunRate) return b.netRunRate - a.netRunRate;
    const aOverB = a._h2h.get(b.teamId) ?? 0;
    const bOverA = b._h2h.get(a.teamId) ?? 0;
    if (aOverB !== bOverA) return bOverA - aOverB;
    return b.won - a.won;
  });

  return rows.map(({ _h2h: _ignored, ...row }, i) => ({ ...row, position: i + 1 }));
}
