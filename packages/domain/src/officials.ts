/**
 * Match-official parsing.
 *
 * `match_info.umpires` is a single string holding three officials:
 *
 *   "Nitin Menon(India), Rohan Pandit(India), Saiyed Khalid(India, TV)"
 *   "Virender Sharma (India), Rohan Pandit (India), Chris Gaffaney (New Zealand, TV)"
 *
 * Two traps:
 *
 *  1. **You cannot split on comma.** The third official's parenthetical is
 *     itself comma-separated (`(India, TV)`), so a naive split yields a fourth
 *     phantom official named `TV)` — which is exactly what a first pass at this
 *     dataset produces, 74 times.
 *  2. **Spacing before the bracket is inconsistent** between rows, so
 *     `"Nitin Menon(India)"` and `"Nitin Menon (India)"` are the same person
 *     and must resolve to one `core.official` row.
 *
 * We therefore split on commas *outside* parentheses, then parse each segment.
 */

export const OFFICIAL_ROLES = ['field', 'tv', 'reserve', 'referee'] as const;
export type OfficialRole = (typeof OFFICIAL_ROLES)[number];

export interface ParsedOfficial {
  readonly name: string;
  readonly country: string | null;
  readonly role: OfficialRole;
}

/** Split on top-level commas only — commas inside `(...)` are left alone. */
export function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const ROLE_TOKENS: ReadonlyArray<readonly [RegExp, OfficialRole]> = [
  [/\btv\b/i, 'tv'],
  [/\breserve\b|\b4th\b|\bfourth\b/i, 'reserve'],
  [/\breferee\b|\bmatch referee\b/i, 'referee'],
];

/**
 * Collapse internal whitespace so `"Nitin  Menon"` and `"Nitin Menon"` are the
 * same key. Used for entity resolution, not for display.
 */
export function normaliseName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** Parse one segment such as `"Chris Gaffaney (New Zealand, TV)"`. */
export function parseOfficialSegment(segment: string, fallbackRole: OfficialRole): ParsedOfficial {
  const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(segment.trim());
  if (match === null) {
    return { name: normaliseName(segment), country: null, role: fallbackRole };
  }
  const name = normaliseName(match[1] ?? '');
  const inner = (match[2] ?? '').split(',').map((s) => s.trim());

  let role: OfficialRole = fallbackRole;
  const countryParts: string[] = [];
  for (const token of inner) {
    const hit = ROLE_TOKENS.find(([re]) => re.test(token));
    if (hit !== undefined) {
      role = hit[1];
    } else if (token.length > 0) {
      countryParts.push(token);
    }
  }
  const country = countryParts.length > 0 ? countryParts.join(', ') : null;
  return { name, country, role };
}

/**
 * Parse the full `umpires` string.
 *
 * Officials are `field` unless their parenthetical says otherwise; the dataset
 * consistently lists two field umpires followed by the TV umpire.
 */
export function parseUmpires(raw: string | null | undefined): ParsedOfficial[] {
  if (raw === null || raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed === '') return [];
  return splitTopLevel(trimmed)
    .map((seg) => parseOfficialSegment(seg, 'field'))
    .filter((o) => o.name.length > 0);
}

/** `match_info.referee` is a single official in the same `Name (Country)` shape. */
export function parseReferee(raw: string | null | undefined): ParsedOfficial | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = parseOfficialSegment(trimmed, 'referee');
  return parsed.name.length > 0 ? { ...parsed, role: 'referee' } : null;
}
