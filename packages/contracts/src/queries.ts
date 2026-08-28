import { z } from 'zod';
import { CursorQuery, MatchStage, Phase, SeasonYear } from './common.js';

/** Query-string schemas. Coercion happens here, once, for every route. */

export const MatchListQuery = CursorQuery.extend({
  season: SeasonYear.optional(),
  teamId: z.coerce.number().int().positive().optional(),
  venueId: z.coerce.number().int().positive().optional(),
  stage: MatchStage.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
    .optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type MatchListQuery = z.infer<typeof MatchListQuery>;

export const PlayerListQuery = CursorQuery.extend({
  q: z.string().trim().min(1).max(64).optional().describe('Case-insensitive name search'),
  season: SeasonYear.optional(),
  teamId: z.coerce.number().int().positive().optional(),
  role: z.string().max(32).optional(),
});
export type PlayerListQuery = z.infer<typeof PlayerListQuery>;

export const DeliveryListQuery = CursorQuery.extend({
  innings: z.coerce.number().int().min(1).max(6).optional(),
  over: z.coerce.number().int().min(0).max(29).optional(),
});

/**
 * Leaderboard metrics.
 *
 * Rate metrics carry a `minBalls` floor because a leaderboard without one is
 * meaningless — the best strike rate in any season belongs to somebody who
 * faced two balls. The defaults follow the conventional qualification for a
 * T20 league season.
 */
export const LeaderMetric = z.enum([
  'runs',
  'wickets',
  'strike_rate',
  'economy',
  'average',
  'sixes',
  'fours',
  'dots',
]);
export type LeaderMetric = z.infer<typeof LeaderMetric>;

export const LeadersQuery = z.object({
  metric: LeaderMetric.default('runs'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  minBalls: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Qualification floor for rate metrics; defaults per metric'),
});
export type LeadersQuery = z.infer<typeof LeadersQuery>;

/** Conventional qualification floors, applied when `minBalls` is absent. */
export const DEFAULT_MIN_BALLS: Readonly<Record<LeaderMetric, number>> = {
  runs: 0,
  wickets: 0,
  sixes: 0,
  fours: 0,
  dots: 0,
  strike_rate: 200,
  average: 200,
  economy: 240,
};

export const PlayerStatsQuery = z.object({
  season: SeasonYear.optional(),
  opponentId: z.coerce.number().int().positive().optional(),
  venueId: z.coerce.number().int().positive().optional(),
  phase: Phase.optional(),
});

export const FormQuery = z.object({
  last: z.coerce.number().int().min(1).max(20).default(5),
});

export const CompareQuery = z.object({
  playerA: z.coerce.number().int().positive(),
  playerB: z.coerce.number().int().positive(),
  season: SeasonYear.optional(),
});
