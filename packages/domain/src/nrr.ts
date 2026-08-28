/**
 * Net Run Rate.
 *
 *   NRR = (runs scored / overs faced) − (runs conceded / overs bowled)
 *
 * The rule that catches people out: **a side dismissed for less than its full
 * quota is charged the full quota anyway**. Bowl a team out in 14.2 overs and
 * you get credit for 20 overs of bowling, not 14.2 — otherwise taking wickets
 * would *hurt* your net run rate, which is obviously not the intent.
 *
 * Two further rules, both verified against the official IPL 2022 table:
 *
 *  - Only **league-stage** matches count. Playoffs are excluded; including
 *    them moves all four qualifiers' NRR and matches nothing.
 *  - A **retired hurt** is not a wicket lost, so it cannot trigger the
 *    all-out rule.
 *
 * `packages/domain/src/__tests__/nrr.test.ts` asserts this implementation
 * reproduces the published 2022 standings for all ten teams to three decimal
 * places, including the run and over subtotals.
 */

import { BALLS_PER_OVER, ballsToDecimalOvers } from './overs.js';

/** One completed innings, from the batting side's point of view. */
export interface InningsLine {
  readonly battingTeamId: number;
  readonly bowlingTeamId: number;
  /** Total runs scored, extras included. */
  readonly runs: number;
  /** Legal deliveries faced — wides and no-balls excluded. */
  readonly legalBalls: number;
  /** Wickets lost. Retired hurt must already be excluded by the caller. */
  readonly wicketsLost: number;
  /** Scheduled quota for the innings, in overs. 20 for a full T20 innings. */
  readonly allottedOvers: number;
}

export interface NrrComponents {
  readonly teamId: number;
  readonly runsFor: number;
  readonly ballsFor: number;
  readonly runsAgainst: number;
  readonly ballsAgainst: number;
  readonly netRunRate: number;
}

const ALL_OUT_WICKETS = 10;

/**
 * Balls an innings is charged for NRR purposes: the full quota if the side was
 * bowled out, otherwise the balls actually faced.
 */
export function chargeableBalls(line: InningsLine): number {
  if (line.wicketsLost >= ALL_OUT_WICKETS) {
    return line.allottedOvers * BALLS_PER_OVER;
  }
  return line.legalBalls;
}

/**
 * Aggregate innings lines into per-team NRR components.
 *
 * Each match contributes each innings twice — once to the batting side's
 * `for` column and once to the bowling side's `against` column.
 */
export function computeNetRunRates(lines: readonly InningsLine[]): Map<number, NrrComponents> {
  const acc = new Map<number, { rf: number; bf: number; ra: number; ba: number }>();

  const bucket = (teamId: number) => {
    let b = acc.get(teamId);
    if (b === undefined) {
      b = { rf: 0, bf: 0, ra: 0, ba: 0 };
      acc.set(teamId, b);
    }
    return b;
  };

  for (const line of lines) {
    const balls = chargeableBalls(line);
    const batting = bucket(line.battingTeamId);
    batting.rf += line.runs;
    batting.bf += balls;
    const bowling = bucket(line.bowlingTeamId);
    bowling.ra += line.runs;
    bowling.ba += balls;
  }

  const out = new Map<number, NrrComponents>();
  for (const [teamId, b] of acc) {
    const scored = b.bf > 0 ? b.rf / ballsToDecimalOvers(b.bf) : 0;
    const conceded = b.ba > 0 ? b.ra / ballsToDecimalOvers(b.ba) : 0;
    out.set(teamId, {
      teamId,
      runsFor: b.rf,
      ballsFor: b.bf,
      runsAgainst: b.ra,
      ballsAgainst: b.ba,
      netRunRate: scored - conceded,
    });
  }
  return out;
}
