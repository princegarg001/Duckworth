import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  numeric,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { checkStatus, quality } from './enums.js';
import { innings, player, season, team } from './core.js';

/**
 * The `quality` schema holds numbers we did NOT compute.
 *
 * The dataset ships pre-aggregated scorecards and an official points table.
 * None of it is served to users — every figure the API returns is derived from
 * `core.delivery`. These tables exist so `ingest verify` can prove the two
 * agree, and fail the pipeline when they do not.
 *
 * This is the difference between "the tests pass" and "the numbers are right".
 */

/** The vendor's per-batter card for an innings. */
export const sourceBattingCard = quality.table(
  'source_batting_card',
  {
    inningsId: integer('innings_id')
      .notNull()
      .references(() => innings.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    runs: smallint('runs').notNull(),
    ballsFaced: smallint('balls_faced').notNull(),
    fours: smallint('fours').notNull(),
    sixes: smallint('sixes').notNull(),
    strikeRate: numeric('strike_rate', { precision: 7, scale: 2 }),
    battingPosition: smallint('batting_position'),
    isOut: boolean('is_out').notNull(),
  },
  (t) => [primaryKey({ columns: [t.inningsId, t.playerId] })],
);

/** The vendor's per-bowler card for an innings. */
export const sourceBowlingCard = quality.table(
  'source_bowling_card',
  {
    inningsId: integer('innings_id')
      .notNull()
      .references(() => innings.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    /** Stored as balls, not the "2.4" notation, so it can be compared safely. */
    ballsBowled: smallint('balls_bowled').notNull(),
    runsConceded: smallint('runs_conceded').notNull(),
    wickets: smallint('wickets').notNull(),
    maidens: smallint('maidens').notNull(),
    wides: smallint('wides').notNull(),
    noballs: smallint('noballs').notNull(),
    economy: numeric('economy', { precision: 6, scale: 2 }),
  },
  (t) => [primaryKey({ columns: [t.inningsId, t.playerId] })],
);

/**
 * The vendor's innings summary, used to reconcile the sum of our deliveries.
 *
 * The extras columns are stored here rather than in `core` because in one
 * innings the vendor's own components (byes 1 + legbyes 1 + wides 8 +
 * noballs 2 = 12) contradict its own stated total of 11 — and the deliveries
 * agree with the total, not the components. `core.innings_extras` is therefore
 * derived from the ball-by-ball, and this row is what it gets checked against.
 */
export const sourceInningsTotal = quality.table('source_innings_total', {
  inningsId: integer('innings_id')
    .primaryKey()
    .references(() => innings.id, { onDelete: 'cascade' }),
  runs: smallint('runs').notNull(),
  wickets: smallint('wickets').notNull(),
  ballsBowled: smallint('balls_bowled').notNull(),
  scoresText: text('scores_text'),
  byes: smallint('byes').notNull().default(0),
  legbyes: smallint('legbyes').notNull().default(0),
  wides: smallint('wides').notNull().default(0),
  noballs: smallint('noballs').notNull().default(0),
  penalty: smallint('penalty').notNull().default(0),
  extrasTotal: smallint('extras_total').notNull().default(0),
});

/** The official league table as published with the dataset. */
export const sourceStanding = quality.table(
  'source_standing',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id),
    position: smallint('position').notNull(),
    played: smallint('played').notNull(),
    won: smallint('won').notNull(),
    lost: smallint('lost').notNull(),
    noResult: smallint('no_result').notNull().default(0),
    points: smallint('points').notNull(),
    netRunRate: numeric('net_run_rate', { precision: 6, scale: 3 }).notNull(),
    runsFor: integer('runs_for').notNull(),
    ballsFor: integer('balls_for').notNull(),
    runsAgainst: integer('runs_against').notNull(),
    ballsAgainst: integer('balls_against').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.teamId] }),
    check(
      'source_standing_played_consistent',
      sql`${t.played} = ${t.won} + ${t.lost} + ${t.noResult}`,
    ),
  ],
);

/**
 * One row per assertion per run. The pipeline fails on any `fail`, and the
 * history is what `/health/ready` reads to report data trustworthiness rather
 * than mere reachability.
 */
export const checkResult = quality.table(
  'check_result',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ingestRunId: integer('ingest_run_id'),
    checkName: text('check_name').notNull(),
    description: text('description').notNull(),
    status: checkStatus('status').notNull(),
    /** How many rows violated the assertion. Zero for a pass. */
    violationCount: integer('violation_count').notNull().default(0),
    /** A few offending rows, as JSON text, to make a failure debuggable. */
    sampleViolations: text('sample_violations'),
    durationMs: integer('duration_ms'),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('check_result_run_idx').on(t.ingestRunId),
    index('check_result_ran_at_idx').on(t.ranAt.desc()),
    check('check_result_pass_has_no_violations', sql`${t.status} <> 'pass' or ${t.violationCount} = 0`),
  ],
);
