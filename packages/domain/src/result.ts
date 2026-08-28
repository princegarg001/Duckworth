/**
 * Match result.
 *
 * The source ships a `result_type` field (1 = runs, 2 = wickets). **It is
 * wrong in 49 of this season's 74 matches** — it disagrees with the same
 * file's own `status_note` prose. Trusting it would mislabel two thirds of the
 * season.
 *
 * Cricket does not need the field. A side that bats first and wins, wins *by
 * runs* — it defended a total. A side that bats second and wins, wins *by
 * wickets* — it reached the target with wickets in hand. The margin kind is a
 * function of which innings the winner batted in, and nothing else.
 *
 * Deriving it that way agrees with `status_note` on all 74 matches. The
 * `result_type` field is ignored entirely; see ADR 0004.
 */

export type ResultKind = 'runs' | 'wickets' | 'tie' | 'no_result' | 'super_over';

export interface ResultInput {
  /** Null when the match had no result. */
  readonly winnerTeamId: number | null;
  /** The team that batted in the first innings. */
  readonly firstInningsBattingTeamId: number;
  /** The source's `win_margin`, e.g. "6 wickets". Empty in 11 matches. */
  readonly winMargin?: string | null | undefined;
  /** The prose note, e.g. "Kolkata Knight Riders won by 6 wickets". */
  readonly statusNote?: string | null | undefined;
  /** True when the scores were level. */
  readonly tied?: boolean | undefined;
}

export interface MatchResult {
  readonly kind: ResultKind;
  /** Runs for a `runs` result, wickets for a `wickets` result; null otherwise. */
  readonly margin: number | null;
}

/** Pull the first integer out of "won by 16 runs." / "6 wickets". */
function firstInteger(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const m = /(\d+)/.exec(text);
  return m === null ? null : Number(m[1]);
}

export function deriveResult(input: ResultInput): MatchResult {
  if (input.tied === true) return { kind: 'tie', margin: null };
  if (input.winnerTeamId === null) return { kind: 'no_result', margin: null };

  const kind: ResultKind =
    input.winnerTeamId === input.firstInningsBattingTeamId ? 'runs' : 'wickets';

  // `win_margin` is authoritative where present and agrees with the prose on
  // every match that has both; 11 matches leave it empty, and for those the
  // note is the only place the number survives.
  const margin = firstInteger(input.winMargin) ?? firstInteger(marginClause(input.statusNote));

  return { kind, margin };
}

/**
 * Isolate the "won by N ..." clause before pulling a number out of the note,
 * so a team name containing a digit could never be read as the margin.
 */
function marginClause(note: string | null | undefined): string | null {
  if (note === null || note === undefined) return null;
  const m = /won by\s+(\d+)/i.exec(note);
  return m === null ? null : m[1]!;
}

/**
 * Cross-check a derived result against the prose, for the ingest's quality
 * report. Returns null when they agree.
 */
export function disagreesWithNote(
  result: MatchResult,
  statusNote: string | null | undefined,
): string | null {
  if (statusNote === null || statusNote === undefined) return null;
  const note = statusNote.toLowerCase();
  const noteKind = /\bwickets?\b/.test(note) ? 'wickets' : /\bruns?\b/.test(note) ? 'runs' : null;
  if (noteKind === null) return null;
  if (noteKind !== result.kind) {
    return `derived "${result.kind}" but note reads "${statusNote}"`;
  }
  const noteMargin = firstInteger(marginClause(statusNote));
  if (noteMargin !== null && result.margin !== null && noteMargin !== result.margin) {
    return `derived margin ${result.margin} but note reads "${statusNote}"`;
  }
  return null;
}
