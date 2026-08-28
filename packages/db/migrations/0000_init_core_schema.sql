CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "marts";
--> statement-breakpoint
CREATE SCHEMA "quality";
--> statement-breakpoint
CREATE SCHEMA "staging";
--> statement-breakpoint
CREATE TYPE "quality"."check_status" AS ENUM('pass', 'fail', 'warn');--> statement-breakpoint
CREATE TYPE "core"."dismissal_kind" AS ENUM('bowled', 'caught', 'caught_and_bowled', 'lbw', 'stumped', 'run_out', 'hit_wicket', 'retired_out', 'retired_hurt', 'obstructing_the_field', 'hit_the_ball_twice', 'timed_out');--> statement-breakpoint
CREATE TYPE "core"."ingest_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "core"."innings_phase" AS ENUM('powerplay', 'middle', 'death');--> statement-breakpoint
CREATE TYPE "core"."match_stage" AS ENUM('league', 'qualifier1', 'eliminator', 'qualifier2', 'final');--> statement-breakpoint
CREATE TYPE "core"."official_role" AS ENUM('field', 'tv', 'reserve', 'referee');--> statement-breakpoint
CREATE TYPE "core"."result_kind" AS ENUM('runs', 'wickets', 'tie', 'no_result', 'super_over');--> statement-breakpoint
CREATE TYPE "core"."toss_decision" AS ENUM('bat', 'field');--> statement-breakpoint
CREATE TABLE "core"."delivery" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"innings_id" integer NOT NULL,
	"delivery_seq" integer NOT NULL,
	"over_no" smallint NOT NULL,
	"ball_in_over" smallint NOT NULL,
	"striker_id" integer NOT NULL,
	"non_striker_id" integer NOT NULL,
	"bowler_id" integer NOT NULL,
	"bat_runs" smallint DEFAULT 0 NOT NULL,
	"wide_runs" smallint DEFAULT 0 NOT NULL,
	"noball_runs" smallint DEFAULT 0 NOT NULL,
	"bye_runs" smallint DEFAULT 0 NOT NULL,
	"legbye_runs" smallint DEFAULT 0 NOT NULL,
	"total_runs" smallint NOT NULL,
	"is_four" boolean DEFAULT false NOT NULL,
	"is_six" boolean DEFAULT false NOT NULL,
	"commentary" text,
	"source_event_id" bigint NOT NULL,
	"ball_timestamp" timestamp with time zone,
	"extra_runs" smallint GENERATED ALWAYS AS (wide_runs + noball_runs + bye_runs + legbye_runs) STORED,
	"is_wide" boolean GENERATED ALWAYS AS (wide_runs > 0) STORED,
	"is_noball" boolean GENERATED ALWAYS AS (noball_runs > 0) STORED,
	"is_legal_ball" boolean GENERATED ALWAYS AS (wide_runs = 0 and noball_runs = 0) STORED,
	"counts_as_ball_faced" boolean GENERATED ALWAYS AS (wide_runs = 0) STORED,
	CONSTRAINT "delivery_seq_positive" CHECK ("core"."delivery"."delivery_seq" >= 1),
	CONSTRAINT "delivery_over_range" CHECK ("core"."delivery"."over_no" between 0 and 29),
	CONSTRAINT "delivery_ball_range" CHECK ("core"."delivery"."ball_in_over" between 1 and 12),
	CONSTRAINT "delivery_runs_non_negative" CHECK ("core"."delivery"."bat_runs" >= 0 and "core"."delivery"."wide_runs" >= 0 and "core"."delivery"."noball_runs" >= 0 and "core"."delivery"."bye_runs" >= 0 and "core"."delivery"."legbye_runs" >= 0 and "core"."delivery"."total_runs" >= 0),
	CONSTRAINT "delivery_not_wide_and_noball" CHECK (not ("core"."delivery"."wide_runs" > 0 and "core"."delivery"."noball_runs" > 0)),
	CONSTRAINT "delivery_striker_differs" CHECK ("core"."delivery"."striker_id" <> "core"."delivery"."non_striker_id"),
	CONSTRAINT "delivery_boundary_exclusive" CHECK (not ("core"."delivery"."is_four" and "core"."delivery"."is_six"))
);
--> statement-breakpoint
CREATE TABLE "core"."dismissal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"innings_id" integer NOT NULL,
	"delivery_id" bigint,
	"player_out_id" integer NOT NULL,
	"kind" "core"."dismissal_kind" NOT NULL,
	"bowler_id" integer,
	"wicket_number" smallint NOT NULL,
	"team_score_at_dismissal" smallint,
	"batter_runs" smallint,
	"batter_balls" smallint,
	"how_out" text,
	"credits_bowler" boolean NOT NULL,
	"counts_as_wicket_lost" boolean DEFAULT true NOT NULL,
	CONSTRAINT "dismissal_wicket_number_range" CHECK ("core"."dismissal"."wicket_number" between 1 and 11),
	CONSTRAINT "dismissal_credit_requires_bowler" CHECK ("core"."dismissal"."credits_bowler" = ("core"."dismissal"."bowler_id" is not null)),
	CONSTRAINT "dismissal_delivery_required" CHECK ("core"."dismissal"."delivery_id" is not null or "core"."dismissal"."kind" = 'retired_hurt')
);
--> statement-breakpoint
CREATE TABLE "core"."dismissal_fielder" (
	"dismissal_id" bigint NOT NULL,
	"player_id" integer NOT NULL,
	"ordinal" smallint NOT NULL,
	"is_substitute" boolean DEFAULT false NOT NULL,
	CONSTRAINT "dismissal_fielder_dismissal_id_player_id_ordinal_pk" PRIMARY KEY("dismissal_id","player_id","ordinal"),
	CONSTRAINT "dismissal_fielder_ordinal_range" CHECK ("core"."dismissal_fielder"."ordinal" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "core"."ingest_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_label" text NOT NULL,
	"content_sha256" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "core"."ingest_status" DEFAULT 'running' NOT NULL,
	"files_read" integer,
	"rows_loaded" bigint,
	"duration_ms" integer,
	"git_sha" text,
	"error" text,
	CONSTRAINT "ingest_run_duration_non_negative" CHECK ("core"."ingest_run"."duration_ms" is null or "core"."ingest_run"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."innings" (
	"id" integer PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"innings_no" smallint NOT NULL,
	"batting_team_id" integer NOT NULL,
	"bowling_team_id" integer NOT NULL,
	"is_super_over" boolean DEFAULT false NOT NULL,
	"allotted_overs" smallint DEFAULT 20 NOT NULL,
	"target" smallint,
	CONSTRAINT "innings_teams_differ" CHECK ("core"."innings"."batting_team_id" <> "core"."innings"."bowling_team_id"),
	CONSTRAINT "innings_no_positive" CHECK ("core"."innings"."innings_no" >= 1),
	CONSTRAINT "innings_target_positive" CHECK ("core"."innings"."target" is null or "core"."innings"."target" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."innings_extras" (
	"innings_id" integer PRIMARY KEY NOT NULL,
	"byes" smallint DEFAULT 0 NOT NULL,
	"legbyes" smallint DEFAULT 0 NOT NULL,
	"wides" smallint DEFAULT 0 NOT NULL,
	"noballs" smallint DEFAULT 0 NOT NULL,
	"penalty" smallint DEFAULT 0 NOT NULL,
	"total" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "innings_extras_sum" CHECK ("core"."innings_extras"."total" = "core"."innings_extras"."byes" + "core"."innings_extras"."legbyes" + "core"."innings_extras"."wides" + "core"."innings_extras"."noballs" + "core"."innings_extras"."penalty")
);
--> statement-breakpoint
CREATE TABLE "core"."mart_refresh" (
	"mart_name" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"row_count" bigint,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."match" (
	"id" integer PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"match_number" smallint NOT NULL,
	"stage" "core"."match_stage" DEFAULT 'league' NOT NULL,
	"title" text NOT NULL,
	"short_title" text NOT NULL,
	"subtitle" text NOT NULL,
	"venue_id" integer NOT NULL,
	"team_a_id" integer NOT NULL,
	"team_b_id" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"match_date" date NOT NULL,
	"toss_winner_id" integer,
	"toss_decision" "core"."toss_decision",
	"result" "core"."result_kind" NOT NULL,
	"winner_id" integer,
	"win_margin" smallint,
	"dls_applied" boolean DEFAULT false NOT NULL,
	"referee_id" integer,
	"status_note" text,
	CONSTRAINT "match_teams_differ" CHECK ("core"."match"."team_a_id" <> "core"."match"."team_b_id"),
	CONSTRAINT "match_winner_is_participant" CHECK ("core"."match"."winner_id" is null or "core"."match"."winner_id" in ("core"."match"."team_a_id", "core"."match"."team_b_id")),
	CONSTRAINT "match_toss_winner_is_participant" CHECK ("core"."match"."toss_winner_id" is null or "core"."match"."toss_winner_id" in ("core"."match"."team_a_id", "core"."match"."team_b_id")),
	CONSTRAINT "match_margin_matches_result" CHECK (("core"."match"."result" in ('runs','wickets')) = ("core"."match"."winner_id" is not null and "core"."match"."win_margin" is not null)),
	CONSTRAINT "match_margin_positive" CHECK ("core"."match"."win_margin" is null or "core"."match"."win_margin" > 0)
);
--> statement-breakpoint
CREATE TABLE "core"."match_official" (
	"match_id" integer NOT NULL,
	"official_id" integer NOT NULL,
	"role" "core"."official_role" NOT NULL,
	CONSTRAINT "match_official_match_id_official_id_role_pk" PRIMARY KEY("match_id","official_id","role")
);
--> statement-breakpoint
CREATE TABLE "core"."official" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "core"."player" (
	"id" integer PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"short_name" text NOT NULL,
	"birthdate" date,
	"birthplace" text,
	"country_code" text,
	"nationality" text,
	"playing_role" text,
	"batting_style" text,
	"bowling_style" text
);
--> statement-breakpoint
CREATE TABLE "core"."season" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abbr" text NOT NULL,
	"year" smallint NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"total_matches" smallint NOT NULL,
	"total_teams" smallint NOT NULL,
	CONSTRAINT "season_dates_ordered" CHECK ("core"."season"."start_date" <= "core"."season"."end_date"),
	CONSTRAINT "season_year_sane" CHECK ("core"."season"."year" between 2008 and 2100)
);
--> statement-breakpoint
CREATE TABLE "core"."season_squad" (
	"season_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	CONSTRAINT "season_squad_season_id_team_id_player_id_pk" PRIMARY KEY("season_id","team_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "core"."team" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"alt_name" text,
	"country" text,
	"logo_url" text
);
--> statement-breakpoint
CREATE TABLE "core"."venue" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country" text DEFAULT 'India' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality"."check_result" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ingest_run_id" integer,
	"check_name" text NOT NULL,
	"description" text NOT NULL,
	"status" "quality"."check_status" NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"sample_violations" text,
	"duration_ms" integer,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_result_pass_has_no_violations" CHECK ("quality"."check_result"."status" <> 'pass' or "quality"."check_result"."violation_count" = 0)
);
--> statement-breakpoint
CREATE TABLE "quality"."source_batting_card" (
	"innings_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"runs" smallint NOT NULL,
	"balls_faced" smallint NOT NULL,
	"fours" smallint NOT NULL,
	"sixes" smallint NOT NULL,
	"strike_rate" numeric(7, 2),
	"batting_position" smallint,
	"is_out" boolean NOT NULL,
	CONSTRAINT "source_batting_card_innings_id_player_id_pk" PRIMARY KEY("innings_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "quality"."source_bowling_card" (
	"innings_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"balls_bowled" smallint NOT NULL,
	"runs_conceded" smallint NOT NULL,
	"wickets" smallint NOT NULL,
	"maidens" smallint NOT NULL,
	"wides" smallint NOT NULL,
	"noballs" smallint NOT NULL,
	"economy" numeric(6, 2),
	CONSTRAINT "source_bowling_card_innings_id_player_id_pk" PRIMARY KEY("innings_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "quality"."source_innings_total" (
	"innings_id" integer PRIMARY KEY NOT NULL,
	"runs" smallint NOT NULL,
	"wickets" smallint NOT NULL,
	"balls_bowled" smallint NOT NULL,
	"scores_text" text,
	"byes" smallint DEFAULT 0 NOT NULL,
	"legbyes" smallint DEFAULT 0 NOT NULL,
	"wides" smallint DEFAULT 0 NOT NULL,
	"noballs" smallint DEFAULT 0 NOT NULL,
	"penalty" smallint DEFAULT 0 NOT NULL,
	"extras_total" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality"."source_standing" (
	"season_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"position" smallint NOT NULL,
	"played" smallint NOT NULL,
	"won" smallint NOT NULL,
	"lost" smallint NOT NULL,
	"no_result" smallint DEFAULT 0 NOT NULL,
	"points" smallint NOT NULL,
	"net_run_rate" numeric(6, 3) NOT NULL,
	"runs_for" integer NOT NULL,
	"balls_for" integer NOT NULL,
	"runs_against" integer NOT NULL,
	"balls_against" integer NOT NULL,
	CONSTRAINT "source_standing_season_id_team_id_pk" PRIMARY KEY("season_id","team_id"),
	CONSTRAINT "source_standing_played_consistent" CHECK ("quality"."source_standing"."played" = "quality"."source_standing"."won" + "quality"."source_standing"."lost" + "quality"."source_standing"."no_result")
);
--> statement-breakpoint
ALTER TABLE "core"."delivery" ADD CONSTRAINT "delivery_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."delivery" ADD CONSTRAINT "delivery_striker_id_player_id_fk" FOREIGN KEY ("striker_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."delivery" ADD CONSTRAINT "delivery_non_striker_id_player_id_fk" FOREIGN KEY ("non_striker_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."delivery" ADD CONSTRAINT "delivery_bowler_id_player_id_fk" FOREIGN KEY ("bowler_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal" ADD CONSTRAINT "dismissal_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal" ADD CONSTRAINT "dismissal_delivery_id_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "core"."delivery"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal" ADD CONSTRAINT "dismissal_player_out_id_player_id_fk" FOREIGN KEY ("player_out_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal" ADD CONSTRAINT "dismissal_bowler_id_player_id_fk" FOREIGN KEY ("bowler_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal_fielder" ADD CONSTRAINT "dismissal_fielder_dismissal_id_dismissal_id_fk" FOREIGN KEY ("dismissal_id") REFERENCES "core"."dismissal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."dismissal_fielder" ADD CONSTRAINT "dismissal_fielder_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."innings" ADD CONSTRAINT "innings_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "core"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."innings" ADD CONSTRAINT "innings_batting_team_id_team_id_fk" FOREIGN KEY ("batting_team_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."innings" ADD CONSTRAINT "innings_bowling_team_id_team_id_fk" FOREIGN KEY ("bowling_team_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."innings_extras" ADD CONSTRAINT "innings_extras_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "core"."venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_team_a_id_team_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_team_b_id_team_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_toss_winner_id_team_id_fk" FOREIGN KEY ("toss_winner_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_winner_id_team_id_fk" FOREIGN KEY ("winner_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match" ADD CONSTRAINT "match_referee_id_official_id_fk" FOREIGN KEY ("referee_id") REFERENCES "core"."official"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match_official" ADD CONSTRAINT "match_official_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "core"."match"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."match_official" ADD CONSTRAINT "match_official_official_id_official_id_fk" FOREIGN KEY ("official_id") REFERENCES "core"."official"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."season_squad" ADD CONSTRAINT "season_squad_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."season_squad" ADD CONSTRAINT "season_squad_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."season_squad" ADD CONSTRAINT "season_squad_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_batting_card" ADD CONSTRAINT "source_batting_card_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_batting_card" ADD CONSTRAINT "source_batting_card_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_bowling_card" ADD CONSTRAINT "source_bowling_card_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_bowling_card" ADD CONSTRAINT "source_bowling_card_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "core"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_innings_total" ADD CONSTRAINT "source_innings_total_innings_id_innings_id_fk" FOREIGN KEY ("innings_id") REFERENCES "core"."innings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_standing" ADD CONSTRAINT "source_standing_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "core"."season"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality"."source_standing" ADD CONSTRAINT "source_standing_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "core"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_innings_seq_uq" ON "core"."delivery" USING btree ("innings_id","delivery_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_source_event_uq" ON "core"."delivery" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "delivery_striker_idx" ON "core"."delivery" USING btree ("striker_id");--> statement-breakpoint
CREATE INDEX "delivery_bowler_idx" ON "core"."delivery" USING btree ("bowler_id");--> statement-breakpoint
CREATE INDEX "delivery_bowler_over_idx" ON "core"."delivery" USING btree ("bowler_id","over_no");--> statement-breakpoint
CREATE INDEX "delivery_striker_over_idx" ON "core"."delivery" USING btree ("striker_id","over_no");--> statement-breakpoint
CREATE UNIQUE INDEX "dismissal_innings_player_uq" ON "core"."dismissal" USING btree ("innings_id","player_out_id");--> statement-breakpoint
CREATE INDEX "dismissal_delivery_idx" ON "core"."dismissal" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "dismissal_bowler_idx" ON "core"."dismissal" USING btree ("bowler_id");--> statement-breakpoint
CREATE INDEX "dismissal_player_out_idx" ON "core"."dismissal" USING btree ("player_out_id");--> statement-breakpoint
CREATE INDEX "dismissal_fielder_player_idx" ON "core"."dismissal_fielder" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_run_source_hash_uq" ON "core"."ingest_run" USING btree ("source_label","content_sha256");--> statement-breakpoint
CREATE INDEX "ingest_run_started_idx" ON "core"."ingest_run" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "innings_match_no_uq" ON "core"."innings" USING btree ("match_id","innings_no");--> statement-breakpoint
CREATE INDEX "innings_batting_team_idx" ON "core"."innings" USING btree ("batting_team_id");--> statement-breakpoint
CREATE INDEX "innings_bowling_team_idx" ON "core"."innings" USING btree ("bowling_team_id");--> statement-breakpoint
CREATE INDEX "match_season_date_idx" ON "core"."match" USING btree ("season_id","match_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "match_venue_idx" ON "core"."match" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "match_team_a_idx" ON "core"."match" USING btree ("team_a_id");--> statement-breakpoint
CREATE INDEX "match_team_b_idx" ON "core"."match" USING btree ("team_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_season_number_uq" ON "core"."match" USING btree ("season_id","match_number");--> statement-breakpoint
CREATE UNIQUE INDEX "official_name_uq" ON "core"."official" USING btree ("name");--> statement-breakpoint
CREATE INDEX "player_full_name_idx" ON "core"."player" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "season_year_uq" ON "core"."season" USING btree ("year");--> statement-breakpoint
CREATE INDEX "season_squad_player_idx" ON "core"."season_squad" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_name_city_uq" ON "core"."venue" USING btree ("name","city");--> statement-breakpoint
CREATE INDEX "check_result_run_idx" ON "quality"."check_result" USING btree ("ingest_run_id");--> statement-breakpoint
CREATE INDEX "check_result_ran_at_idx" ON "quality"."check_result" USING btree ("ran_at" DESC NULLS LAST);