import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  core,
  dismissalKind,
  ingestStatus,
  matchStage,
  officialRole,
  resultKind,
  tossDecision,
} from './enums.js';

/**
 * On primary keys: the source assigns stable integer ids to seasons, teams,
 * venues, players, matches and innings, and reuses them across its whole
 * catalogue. We adopt them as primary keys rather than minting our own.
 *
 * The trade-off is deliberate and documented in ADR 0003. Adopting them buys
 * idempotent re-ingest for free (an upsert on the natural key is the whole
 * story) and keeps every row traceable to a source file without a lookup
 * table. What it costs is a coupling to one vendor's id space — so every table
 * that does it carries the source id in its own column name (`source_*`) where
 * ambiguity is possible, and `delivery`, which has no natural key we control,
 * uses a surrogate with the source event id kept as a unique column.
 */

export const season = core.table(
  'season',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    abbr: text('abbr').notNull(),
    year: smallint('year').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    totalMatches: smallint('total_matches').notNull(),
    totalTeams: smallint('total_teams').notNull(),
  },
  (t) => [
    uniqueIndex('season_year_uq').on(t.year),
    check('season_dates_ordered', sql`${t.startDate} <= ${t.endDate}`),
    check('season_year_sane', sql`${t.year} between 2008 and 2100`),
  ],
);

export const team = core.table('team', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  altName: text('alt_name'),
  country: text('country'),
  logoUrl: text('logo_url'),
});

export const venue = core.table(
  'venue',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    city: text('city'),
    country: text('country').notNull().default('India'),
  },
  (t) => [uniqueIndex('venue_name_city_uq').on(t.name, t.city)],
);

export const player = core.table(
  'player',
  {
    id: integer('id').primaryKey(),
    fullName: text('full_name').notNull(),
    /** Scorecard form, e.g. "RD Gaikwad". Used to render dismissal text. */
    shortName: text('short_name').notNull(),
    birthdate: date('birthdate'),
    birthplace: text('birthplace'),
    countryCode: text('country_code'),
    nationality: text('nationality'),
    playingRole: text('playing_role'),
    battingStyle: text('batting_style'),
    bowlingStyle: text('bowling_style'),
  },
  (t) => [index('player_full_name_idx').on(t.fullName)],
);

export const official = core.table(
  'official',
  {
    id: serial('id').primaryKey(),
    /**
     * Whitespace-normalised. The source spells the same person both
     * "Nitin Menon(India)" and "Nitin Menon (India)"; both resolve here.
     */
    name: text('name').notNull(),
    country: text('country'),
  },
  (t) => [uniqueIndex('official_name_uq').on(t.name)],
);

export const match = core.table(
  'match',
  {
    id: integer('id').primaryKey(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    matchNumber: smallint('match_number').notNull(),
    stage: matchStage('stage').notNull().default('league'),
    title: text('title').notNull(),
    shortTitle: text('short_title').notNull(),
    subtitle: text('subtitle').notNull(),
    venueId: integer('venue_id')
      .notNull()
      .references(() => venue.id),
    teamAId: integer('team_a_id')
      .notNull()
      .references(() => team.id),
    teamBId: integer('team_b_id')
      .notNull()
      .references(() => team.id),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }),
    matchDate: date('match_date').notNull(),
    tossWinnerId: integer('toss_winner_id').references(() => team.id),
    tossDecision: tossDecision('toss_decision'),
    result: resultKind('result').notNull(),
    winnerId: integer('winner_id').references(() => team.id),
    /** Runs for a `runs` result, wickets for a `wickets` result. */
    winMargin: smallint('win_margin'),
    dlsApplied: boolean('dls_applied').notNull().default(false),
    refereeId: integer('referee_id').references(() => official.id),
    statusNote: text('status_note'),
  },
  (t) => [
    index('match_season_date_idx').on(t.seasonId, t.matchDate.desc()),
    index('match_venue_idx').on(t.venueId),
    index('match_team_a_idx').on(t.teamAId),
    index('match_team_b_idx').on(t.teamBId),
    uniqueIndex('match_season_number_uq').on(t.seasonId, t.matchNumber),
    check('match_teams_differ', sql`${t.teamAId} <> ${t.teamBId}`),
    check(
      'match_winner_is_participant',
      sql`${t.winnerId} is null or ${t.winnerId} in (${t.teamAId}, ${t.teamBId})`,
    ),
    check(
      'match_toss_winner_is_participant',
      sql`${t.tossWinnerId} is null or ${t.tossWinnerId} in (${t.teamAId}, ${t.teamBId})`,
    ),
    /**
     * A decided match has a winner and a margin; an undecided one has neither.
     * Expressed as an equality between two booleans so both directions are
     * enforced by a single constraint.
     */
    check(
      'match_margin_matches_result',
      sql`(${t.result} in ('runs','wickets')) = (${t.winnerId} is not null and ${t.winMargin} is not null)`,
    ),
    check('match_margin_positive', sql`${t.winMargin} is null or ${t.winMargin} > 0`),
  ],
);

export const matchOfficial = core.table(
  'match_official',
  {
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id, { onDelete: 'cascade' }),
    officialId: integer('official_id')
      .notNull()
      .references(() => official.id),
    role: officialRole('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.officialId, t.role] })],
);

export const seasonSquad = core.table(
  'season_squad',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
  },
  (t) => [
    primaryKey({ columns: [t.seasonId, t.teamId, t.playerId] }),
    index('season_squad_player_idx').on(t.playerId),
  ],
);

export const innings = core.table(
  'innings',
  {
    id: integer('id').primaryKey(),
    matchId: integer('match_id')
      .notNull()
      .references(() => match.id, { onDelete: 'cascade' }),
    inningsNo: smallint('innings_no').notNull(),
    battingTeamId: integer('batting_team_id')
      .notNull()
      .references(() => team.id),
    bowlingTeamId: integer('bowling_team_id')
      .notNull()
      .references(() => team.id),
    /**
     * No super over occurs in IPL 2022, but the column is not optional: every
     * mart filters on it, and a future season that ships one must not silently
     * pollute career strike rates.
     */
    isSuperOver: boolean('is_super_over').notNull().default(false),
    allottedOvers: smallint('allotted_overs').notNull().default(20),
    /** Null in the first innings; the chase target in the second. */
    target: smallint('target'),
  },
  (t) => [
    uniqueIndex('innings_match_no_uq').on(t.matchId, t.inningsNo),
    index('innings_batting_team_idx').on(t.battingTeamId),
    index('innings_bowling_team_idx').on(t.bowlingTeamId),
    check('innings_teams_differ', sql`${t.battingTeamId} <> ${t.bowlingTeamId}`),
    check('innings_no_positive', sql`${t.inningsNo} >= 1`),
    check('innings_target_positive', sql`${t.target} is null or ${t.target} > 0`),
  ],
);

export const delivery = core.table(
  'delivery',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    inningsId: integer('innings_id')
      .notNull()
      .references(() => innings.id, { onDelete: 'cascade' }),
    /**
     * Monotonic 1..N within the innings, and THE ordering key.
     *
     * `(over_no, ball_in_over)` is not unique: on a wide or no-ball the source
     * repeats the ball number, and in this dataset 729 pairs collide — 688
     * twice, 37 three times and 4 four times. Anything that sorts or paginates
     * deliveries must use this column.
     */
    deliverySeq: integer('delivery_seq').notNull(),
    /** 0-indexed, matching the source's `ball` events. Over 0 is the 1st over. */
    overNo: smallint('over_no').notNull(),
    ballInOver: smallint('ball_in_over').notNull(),
    strikerId: integer('striker_id')
      .notNull()
      .references(() => player.id),
    /** Derived from the two-element `batsmen` array on each commentary entry. */
    nonStrikerId: integer('non_striker_id')
      .notNull()
      .references(() => player.id),
    bowlerId: integer('bowler_id')
      .notNull()
      .references(() => player.id),
    batRuns: smallint('bat_runs').notNull().default(0),
    wideRuns: smallint('wide_runs').notNull().default(0),
    noballRuns: smallint('noball_runs').notNull().default(0),
    byeRuns: smallint('bye_runs').notNull().default(0),
    legbyeRuns: smallint('legbye_runs').notNull().default(0),
    /**
     * The authoritative total, taken from the source's `run` field rather than
     * summed from the components.
     *
     * Three of 17,912 deliveries have components that do not add up to `run`
     * (a no-ball where the off-the-bat runs were not carried into `bat_run`).
     * Innings totals reconcile against the published scorecard on `run` and
     * not on the component sum, so `run` wins and the discrepancy is recorded
     * by the `delivery_runs_reconcile` quality check rather than hidden by a
     * generated column that would make these three rows unstorable.
     */
    totalRuns: smallint('total_runs').notNull(),
    isFour: boolean('is_four').notNull().default(false),
    isSix: boolean('is_six').notNull().default(false),
    commentary: text('commentary'),
    /** Unique across all 17,912 deliveries; the traceability key to the source. */
    sourceEventId: bigint('source_event_id', { mode: 'number' }).notNull(),
    ballTimestamp: timestamp('ball_timestamp', { withTimezone: true }),

    // ── Generated columns ────────────────────────────────────────────────
    // Computed by the database so no application code path — ingest, backfill
    // or a future writer — can produce a row that disagrees with itself.
    extraRuns: smallint('extra_runs').generatedAlwaysAs(
      sql`wide_runs + noball_runs + bye_runs + legbye_runs`,
    ),
    isWide: boolean('is_wide').generatedAlwaysAs(sql`wide_runs > 0`),
    isNoball: boolean('is_noball').generatedAlwaysAs(sql`noball_runs > 0`),
    /** A wide or no-ball does not count toward the over. */
    isLegalBall: boolean('is_legal_ball').generatedAlwaysAs(sql`wide_runs = 0 and noball_runs = 0`),
    /** Balls faced by the striker: everything except a wide. */
    countsAsBallFaced: boolean('counts_as_ball_faced').generatedAlwaysAs(sql`wide_runs = 0`),
  },
  (t) => [
    uniqueIndex('delivery_innings_seq_uq').on(t.inningsId, t.deliverySeq),
    uniqueIndex('delivery_source_event_uq').on(t.sourceEventId),
    index('delivery_striker_idx').on(t.strikerId),
    index('delivery_bowler_idx').on(t.bowlerId),
    /** Serves the phase-split scans, which filter by bowler then bucket by over. */
    index('delivery_bowler_over_idx').on(t.bowlerId, t.overNo),
    index('delivery_striker_over_idx').on(t.strikerId, t.overNo),
    check('delivery_seq_positive', sql`${t.deliverySeq} >= 1`),
    check('delivery_over_range', sql`${t.overNo} between 0 and 29`),
    check('delivery_ball_range', sql`${t.ballInOver} between 1 and 12`),
    check(
      'delivery_runs_non_negative',
      sql`${t.batRuns} >= 0 and ${t.wideRuns} >= 0 and ${t.noballRuns} >= 0 and ${t.byeRuns} >= 0 and ${t.legbyeRuns} >= 0 and ${t.totalRuns} >= 0`,
    ),
    /** A delivery cannot be both a wide and a no-ball. */
    check('delivery_not_wide_and_noball', sql`not (${t.wideRuns} > 0 and ${t.noballRuns} > 0)`),
    check('delivery_striker_differs', sql`${t.strikerId} <> ${t.nonStrikerId}`),
    check('delivery_boundary_exclusive', sql`not (${t.isFour} and ${t.isSix})`),
  ],
);

export const dismissal = core.table(
  'dismissal',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    inningsId: integer('innings_id')
      .notNull()
      .references(() => innings.id, { onDelete: 'cascade' }),
    /**
     * Nullable — and this is the whole reason the table is not a column on
     * `delivery`.
     *
     * Of 912 dismissals in the season exactly one, a retired hurt, happened
     * between deliveries and belongs to no ball. Modelling dismissals as an
     * attribute of a delivery would have forced that row to be invented,
     * dropped, or attached to the wrong ball.
     */
    deliveryId: bigint('delivery_id', { mode: 'number' }).references(() => delivery.id, {
      onDelete: 'cascade',
    }),
    playerOutId: integer('player_out_id')
      .notNull()
      .references(() => player.id),
    kind: dismissalKind('kind').notNull(),
    /** Null for run-outs and retirements: no bowler is credited. */
    bowlerId: integer('bowler_id').references(() => player.id),
    /** 1..10 — the fall-of-wicket number within the innings. */
    wicketNumber: smallint('wicket_number').notNull(),
    teamScoreAtDismissal: smallint('team_score_at_dismissal'),
    batterRuns: smallint('batter_runs'),
    batterBalls: smallint('batter_balls'),
    /** The source's rendering, e.g. "c A Patel b A Nortje". Display only. */
    howOut: text('how_out'),
    /**
     * Materialised from the domain rule rather than recomputed per query:
     * run-outs and retirements are dismissals but not the bowler's wicket.
     */
    creditsBowler: boolean('credits_bowler').notNull(),
    countsAsWicketLost: boolean('counts_as_wicket_lost').notNull().default(true),
  },
  (t) => [
    uniqueIndex('dismissal_innings_player_uq').on(t.inningsId, t.playerOutId),
    index('dismissal_delivery_idx').on(t.deliveryId),
    index('dismissal_bowler_idx').on(t.bowlerId),
    index('dismissal_player_out_idx').on(t.playerOutId),
    check('dismissal_wicket_number_range', sql`${t.wicketNumber} between 1 and 11`),
    /** If the bowler is credited there must be a bowler, and vice versa. */
    check(
      'dismissal_credit_requires_bowler',
      sql`${t.creditsBowler} = (${t.bowlerId} is not null)`,
    ),
    /** Only a retired hurt may exist without a delivery. */
    check(
      'dismissal_delivery_required',
      sql`${t.deliveryId} is not null or ${t.kind} = 'retired_hurt'`,
    ),
  ],
);

export const dismissalFielder = core.table(
  'dismissal_fielder',
  {
    dismissalId: bigint('dismissal_id', { mode: 'number' })
      .notNull()
      .references(() => dismissal.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => player.id),
    /** 1 = catcher / primary; 2,3 = the other ends of a run-out. */
    ordinal: smallint('ordinal').notNull(),
    isSubstitute: boolean('is_substitute').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.dismissalId, t.playerId, t.ordinal] }),
    index('dismissal_fielder_player_idx').on(t.playerId),
    check('dismissal_fielder_ordinal_range', sql`${t.ordinal} between 1 and 3`),
  ],
);

export const inningsExtras = core.table(
  'innings_extras',
  {
    inningsId: integer('innings_id')
      .primaryKey()
      .references(() => innings.id, { onDelete: 'cascade' }),
    byes: smallint('byes').notNull().default(0),
    legbyes: smallint('legbyes').notNull().default(0),
    wides: smallint('wides').notNull().default(0),
    noballs: smallint('noballs').notNull().default(0),
    penalty: smallint('penalty').notNull().default(0),
    total: smallint('total').notNull().default(0),
  },
  (t) => [
    check(
      'innings_extras_sum',
      sql`${t.total} = ${t.byes} + ${t.legbyes} + ${t.wides} + ${t.noballs} + ${t.penalty}`,
    ),
  ],
);

/**
 * Ingest provenance.
 *
 * The unique constraint on the content hash is what makes re-ingest a no-op:
 * a second run over identical bytes cannot insert a second row, so the CLI
 * short-circuits instead of double-loading.
 */
export const ingestRun = core.table(
  'ingest_run',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceLabel: text('source_label').notNull(),
    contentSha256: text('content_sha256').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: ingestStatus('status').notNull().default('running'),
    filesRead: integer('files_read'),
    rowsLoaded: bigint('rows_loaded', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    gitSha: text('git_sha'),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('ingest_run_source_hash_uq').on(t.sourceLabel, t.contentSha256),
    index('ingest_run_started_idx').on(t.startedAt.desc()),
    check('ingest_run_duration_non_negative', sql`${t.durationMs} is null or ${t.durationMs} >= 0`),
  ],
);

/** Refresh bookkeeping for the materialised views; drives `/health/ready`. */
export const martRefresh = core.table('mart_refresh', {
  martName: text('mart_name').primaryKey(),
  refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer('duration_ms'),
  rowCount: bigint('row_count', { mode: 'number' }),
  /**
   * Bumped on every refresh and used as the Redis key namespace, so a mart
   * refresh invalidates every cached aggregate atomically by changing one
   * integer instead of scanning for keys to delete.
   */
  version: integer('version').notNull().default(1),
});

/**
 * There is deliberately no `core.standing`. The points table is derived from
 * deliveries and lives in `marts.points_table`; the vendor's published table
 * lives in `quality.source_standing` and exists only to be asserted against.
 * Storing a third, hand-maintained copy is how the three drift apart.
 */
