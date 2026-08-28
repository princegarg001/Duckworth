/**
 * Batting and bowling rate metrics.
 *
 * Every function here returns `null` rather than `NaN`/`Infinity` for an
 * undefined result. A bowler who has never taken a wicket has no average — not
 * an infinite one — and letting `Infinity` reach JSON turns into `null`
 * silently at `JSON.stringify` anyway, but only after it has already poisoned
 * any sort or comparison it passed through.
 */

import { ballsToDecimalOvers } from './overs.js';

/** Runs per 100 balls faced. Undefined when no ball has been faced. */
export function strikeRate(runs: number, ballsFaced: number): number | null {
  if (ballsFaced <= 0) return null;
  return (runs / ballsFaced) * 100;
}

/** Runs per dismissal. Undefined for a batter who has never been out. */
export function battingAverage(runs: number, dismissals: number): number | null {
  if (dismissals <= 0) return null;
  return runs / dismissals;
}

/**
 * Runs conceded per over.
 *
 * Deliberately takes *balls*, not overs: a bowler who has bowled 2.3 overs has
 * bowled 15 balls, and dividing by 2.3 is wrong by 6%.
 */
export function economyRate(runsConceded: number, legalBallsBowled: number): number | null {
  if (legalBallsBowled <= 0) return null;
  return runsConceded / ballsToDecimalOvers(legalBallsBowled);
}

/** Runs conceded per wicket. Undefined with no wickets. */
export function bowlingAverage(runsConceded: number, wickets: number): number | null {
  if (wickets <= 0) return null;
  return runsConceded / wickets;
}

/** Balls per wicket. Undefined with no wickets. */
export function bowlingStrikeRate(legalBallsBowled: number, wickets: number): number | null {
  if (wickets <= 0) return null;
  return legalBallsBowled / wickets;
}

/** Runs per over for a completed innings. */
export function runRate(runs: number, legalBalls: number): number | null {
  if (legalBalls <= 0) return null;
  return runs / ballsToDecimalOvers(legalBalls);
}

/**
 * Round for presentation. Cricket convention is 2dp for rates and strike
 * rates, 3dp for net run rate.
 */
export function round(value: number | null, dp: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
