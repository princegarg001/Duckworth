/**
 * Tournament stage.
 *
 * The dataset carries the stage only as a free-text `subtitle`
 * ("Match 42", "Qualifier 1", "Eliminator", "Final"). Stage matters because
 * **the points table is league-stage only** — including the four playoff
 * matches changes the NRR of every qualifier and reconciles against nothing.
 */

export const MATCH_STAGES = ['league', 'qualifier1', 'eliminator', 'qualifier2', 'final'] as const;
export type MatchStage = (typeof MATCH_STAGES)[number];

/** Stages that contribute to the points table. */
export function countsTowardStandings(stage: MatchStage): boolean {
  return stage === 'league';
}

/**
 * League fixtures are labelled two different ways in the same file:
 * `"Match 24"` for 68 of the 70, and the ordinal `"21st Match"` / `"24th Match"`
 * for the other two. A parser that only knew the first form would have thrown;
 * one that defaulted to `league` on anything unrecognised would have quietly
 * mislabelled the playoffs and corrupted the points table. Hence: match both
 * shapes explicitly, and still refuse anything else.
 */
const LEAGUE_PATTERNS = [/^match\s*\d+$/, /^\d+(st|nd|rd|th)\s+match$/] as const;

export function parseMatchStage(subtitle: string | null | undefined): MatchStage {
  const s = (subtitle ?? '').trim().toLowerCase();
  if (/^qualifier\s*1$/.test(s)) return 'qualifier1';
  if (/^qualifier\s*2$/.test(s)) return 'qualifier2';
  if (/^eliminator$/.test(s)) return 'eliminator';
  if (/^(final|the final)$/.test(s)) return 'final';
  if (LEAGUE_PATTERNS.some((re) => re.test(s))) return 'league';
  // An unknown subtitle is a data change worth surfacing, but defaulting to
  // `league` would silently corrupt the points table, so refuse instead.
  throw new Error(`Unrecognised match subtitle: ${JSON.stringify(subtitle)}`);
}
