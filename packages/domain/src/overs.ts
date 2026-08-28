/**
 * Overs arithmetic.
 *
 * Cricket writes overs in a base-6 notation that looks decimal but is not:
 * `17.4` means seventeen complete overs and four balls — 106 balls — and
 * `17.4 + 0.2 = 18.0`, not `17.6`. Every naive `parseFloat` in a cricket
 * codebase is a bug waiting to be found, so all overs maths goes through here
 * in units of *balls* and is only formatted back at the edge.
 */

const BALLS_PER_OVER = 6;

export { BALLS_PER_OVER };

/** `17.4` → 106 balls. Throws on a ball component outside 0..5. */
export function oversToBalls(overs: string | number): number {
  const text = typeof overs === 'number' ? overs.toFixed(1) : overs.trim();
  if (text === '') return 0;
  const [wholeRaw, ballRaw = '0'] = text.split('.');
  const whole = Number(wholeRaw);
  const balls = Number(ballRaw);
  if (!Number.isInteger(whole) || whole < 0 || !Number.isInteger(balls)) {
    throw new Error(`Invalid overs value: ${JSON.stringify(overs)}`);
  }
  if (balls < 0 || balls >= BALLS_PER_OVER) {
    throw new Error(`Invalid ball component in overs value: ${JSON.stringify(overs)}`);
  }
  return whole * BALLS_PER_OVER + balls;
}

/** 106 balls → `"17.4"`. */
export function ballsToOvers(balls: number): string {
  if (!Number.isInteger(balls) || balls < 0) {
    throw new Error(`Invalid ball count: ${balls}`);
  }
  return `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;
}

/**
 * Balls expressed as a true decimal, for rate arithmetic only.
 * 106 balls → 17.6667 overs. Never render this to a user.
 */
export function ballsToDecimalOvers(balls: number): number {
  return balls / BALLS_PER_OVER;
}
