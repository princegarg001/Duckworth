/**
 * Coercion helpers.
 *
 * The source types everything loosely: `"0"`, `0`, `"false"`, `false` and `""`
 * all appear where a caller wants a number or a boolean. Rather than sprinkle
 * `Number(x ?? 0)` through the transform, every read goes through a helper that
 * says what it expects and throws when it does not get it. A silently-coerced
 * `NaN` in a run total is far more expensive to find later than a loud failure
 * at ingest.
 */

import type { SourceScalar } from './types.js';

export function asInt(value: SourceScalar | null | undefined, field: string): number {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Expected an integer for ${field}, got ${JSON.stringify(value)}`);
  }
  const n = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Expected an integer for ${field}, got ${JSON.stringify(value)}`);
  }
  return n;
}

/** Like `asInt`, but an empty/absent value means "not present". */
export function asIntOrNull(value: SourceScalar | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/**
 * Foreign keys in this source use `"0"` and `""` interchangeably for "none"
 * (an unfilled `second_fielder_id`, a `bowler_id` on a run-out). Zero is never
 * a real id, so both collapse to null.
 */
export function asIdOrNull(value: SourceScalar | null | undefined): number | null {
  const n = asIntOrNull(value);
  return n === null || n === 0 ? null : n;
}

export function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    if (s === 'true' || s === '1') return true;
    if (s === 'false' || s === '0' || s === '') return false;
  }
  if (typeof value === 'number') return value !== 0;
  throw new Error(`Expected a boolean, got ${JSON.stringify(value)}`);
}

export function asText(value: unknown): string | null {
  if (typeof value !== 'string') return value === undefined || value === null ? null : String(value);
  const t = value.trim();
  return t === '' ? null : t;
}

export function requireText(value: unknown, field: string): string {
  const t = asText(value);
  if (t === null) throw new Error(`Expected a non-empty string for ${field}`);
  return t;
}

/**
 * Parse `"208/6"` or `"117/10"` into runs and wickets.
 * A first-innings score with no wickets column reads as 0 down.
 */
export function parseScore(scores: string): { runs: number; wickets: number } {
  const m = /^(\d+)(?:\/(\d+))?/.exec(scores.trim());
  if (m === null) throw new Error(`Unparseable score: ${JSON.stringify(scores)}`);
  return { runs: Number(m[1]), wickets: m[2] === undefined ? 0 : Number(m[2]) };
}

/**
 * The source's local match timestamps are IST wall-clock with no offset
 * (`"2022-03-26 19:30:00"`). `date_start` is the same instant in UTC and
 * `timestamp_start` is the epoch seconds, so we use the epoch — it is the only
 * one of the three that is unambiguous.
 *
 * Returns an **ISO 8601 string, not a `Date`**, and that is deliberate.
 * `drizzle()` installs identity serializers on the postgres-js client for the
 * timestamp OIDs (1082, 1083, 1114, 1184) so that it can do its own mapping.
 * Because the ingest shares one client between Drizzle and raw `sql` tagged
 * templates, a `Date` handed to a raw query is no longer converted and reaches
 * the wire protocol as an object. Passing the ISO string is unambiguous for
 * both, and Postgres parses it exactly.
 */
export function isoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** `"2022-03-26 14:00:00"` → `2022-03-26`, in IST, for the match date. */
export function matchDateFromIst(istText: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(istText.trim());
  if (m === null) throw new Error(`Unparseable IST datetime: ${JSON.stringify(istText)}`);
  return m[1]!;
}

/**
 * Toss decision codes. The source uses 1/2 with `toss.text` as the prose
 * ("Chennai Super Kings elected to bat"), and the text is the safer reading of
 * the two because it does not depend on guessing the code's polarity.
 */
export function parseTossDecision(text: string | undefined, code: number): 'bat' | 'field' {
  const t = (text ?? '').toLowerCase();
  if (t.includes('elected to bat')) return 'bat';
  if (t.includes('elected to bowl') || t.includes('elected to field')) return 'field';
  if (code === 1) return 'bat';
  if (code === 2) return 'field';
  throw new Error(`Cannot determine toss decision from ${JSON.stringify({ text, code })}`);
}

/**
 * Result kind. `result_type` is 1 for a runs margin and 2 for a wickets
 * margin; `win_margin` reads "91 runs" / "7 wickets".
 */
export function parseResult(
  resultType: number,
  winMargin: string | undefined,
  winnerId: number | null,
): { result: 'runs' | 'wickets' | 'tie' | 'no_result'; margin: number | null } {
  if (winnerId === null) return { result: 'no_result', margin: null };
  const m = /(\d+)/.exec(winMargin ?? '');
  const margin = m === null ? null : Number(m[1]);
  if (resultType === 1) return { result: 'runs', margin };
  if (resultType === 2) return { result: 'wickets', margin };
  throw new Error(`Unrecognised result_type ${resultType}`);
}
