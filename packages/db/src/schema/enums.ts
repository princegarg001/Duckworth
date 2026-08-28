import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Four schemas, four different guarantees:
 *
 *   staging  raw landed source rows, all text, no constraints — disposable
 *   core     the normalised truth, at one-row-per-delivery grain
 *   marts    materialised views, denormalised for reads
 *   quality  vendor-supplied aggregates kept ONLY so `ingest verify` can prove
 *            that what we derived from `core` matches what the source claims
 *
 * The `quality` schema is the unusual one and it is deliberate. The dataset
 * ships pre-computed scorecards and an official points table. Storing those as
 * application tables would mean serving numbers we did not compute; throwing
 * them away would mean discarding the only independent check we have. Keeping
 * them quarantined in `quality` lets us do the third thing: derive everything
 * from ball-by-ball, then assert equality against the vendor and fail the
 * pipeline on any drift.
 */
export const staging = pgSchema('staging');
export const core = pgSchema('core');
export const marts = pgSchema('marts');
export const quality = pgSchema('quality');

export const tossDecision = core.enum('toss_decision', ['bat', 'field']);

export const resultKind = core.enum('result_kind', [
  'runs',
  'wickets',
  'tie',
  'no_result',
  'super_over',
]);

export const matchStage = core.enum('match_stage', [
  'league',
  'qualifier1',
  'eliminator',
  'qualifier2',
  'final',
]);

/**
 * Twelve kinds, of which this dataset exercises eight. The unused four are
 * declared anyway because they are laws of cricket, not properties of IPL 2022,
 * and adding an enum value later requires a migration.
 */
export const dismissalKind = core.enum('dismissal_kind', [
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'run_out',
  'hit_wicket',
  'retired_out',
  'retired_hurt',
  'obstructing_the_field',
  'hit_the_ball_twice',
  'timed_out',
]);

export const officialRole = core.enum('official_role', ['field', 'tv', 'reserve', 'referee']);

export const inningsPhase = core.enum('innings_phase', ['powerplay', 'middle', 'death']);

export const ingestStatus = core.enum('ingest_status', [
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

export const checkStatus = quality.enum('check_status', ['pass', 'fail', 'warn']);
