import type { DbHandle } from '@ipl/db';

/**
 * Repository layer conventions.
 *
 * This is the only layer that knows the database exists. Routes bind HTTP,
 * services orchestrate, repositories run SQL — enforced by
 * `eslint-plugin-boundaries` so a route physically cannot import from here.
 *
 * Two rules hold everywhere below:
 *
 * 1. **Explicit projections.** No `select *`. A column added to a table must
 *    never appear in an API response by accident, and an unused column must
 *    never be paid for on every read.
 * 2. **Parameterised SQL only.** Every value goes through a tagged-template
 *    placeholder. There is a lint rule banning string-concatenated SQL, and
 *    the two places that legitimately need dynamic SQL — sort direction and
 *    metric column — resolve through the allow-lists below rather than
 *    interpolating anything a client sent.
 */

export type Sql = DbHandle['sql'];

/** Cricket over notation from a ball count: 106 -> "17.4". */
export function oversText(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

/** Postgres `numeric` arrives as a string; nulls stay null. */
export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Postgres `bigint`/`count` arrives as a string. */
export function int(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

export interface PlayerRow {
  player_id: number;
  full_name: string;
  short_name: string;
  country_code: string | null;
  playing_role: string | null;
  batting_style: string | null;
  bowling_style: string | null;
}

export function toPlayerSummary(r: PlayerRow) {
  return {
    id: r.player_id,
    fullName: r.full_name,
    shortName: r.short_name,
    country: r.country_code,
    playingRole: r.playing_role,
    battingStyle: r.batting_style,
    bowlingStyle: r.bowling_style,
  };
}

export interface TeamRow {
  team_id: number;
  team_name: string;
  team_short_name: string;
  team_country: string | null;
  team_logo_url: string | null;
}

export function toTeam(r: TeamRow) {
  return {
    id: r.team_id,
    name: r.team_name,
    shortName: r.team_short_name,
    country: r.team_country,
    logoUrl: r.team_logo_url,
  };
}
