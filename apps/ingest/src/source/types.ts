/**
 * Shapes of the source dataset, transcribed from what is actually in the files.
 *
 * Everything the vendor emits as a string stays a string here — `"0"`, `"false"`
 * and `"17.4"` all arrive quoted, and several fields are `string | number`
 * depending on the file. Coercion happens in one place (`parse.ts`) so the rest
 * of the pipeline never has to wonder.
 */

export type SourceScalar = string | number;

export interface SourceCompetition {
  cid: number;
  title: string;
  abbr: string;
  season: string;
  datestart: string;
  dateend: string;
  total_matches: string;
  total_teams: string;
}

export interface SourceTeamRef {
  team_id: number;
  name: string;
  short_name: string;
  logo_url?: string;
  scores?: string;
  scores_full?: string;
  overs?: string;
}

export interface SourceTeam {
  tid: number;
  title: string;
  abbr: string;
  alt_name?: string;
  country?: string;
  logo_url?: string;
  thumb_url?: string;
}

export interface SourcePlayer {
  pid: number;
  title: string;
  short_name: string;
  first_name?: string;
  last_name?: string;
  birthdate?: string;
  birthplace?: string;
  country?: string;
  nationality?: string;
  playing_role?: string;
  batting_style?: string;
  bowling_style?: string;
}

export interface SourceMatchListEntry {
  match_id: number;
  title: string;
  short_title: string;
  subtitle: string;
  match_number: string;
  status: number;
  status_str: string;
  status_note: string;
  competition: SourceCompetition;
  teama: SourceTeamRef;
  teamb: SourceTeamRef;
  winning_team_id?: SourceScalar;
}

export interface SourceMatchInfo extends SourceMatchListEntry {
  date_start: string;
  date_end: string;
  date_start_ist: string;
  timestamp_start: number;
  timestamp_end: number;
  result: string;
  result_type: number;
  win_margin: string;
  match_dls_affected: string;
  umpires: string;
  referee: string;
  venue: {
    venue_id: SourceScalar;
    name: string;
    location: string;
    country: string;
  };
  toss: {
    winner: SourceScalar;
    decision: number;
    text: string;
  };
}

/** One entry in `commentaries[]`. Three `event` kinds share the array. */
export interface SourceCommentaryEntry {
  event: 'ball' | 'wicket' | 'overend';
  /** 0-indexed on `ball`/`wicket`; 1-indexed on `overend`. See parse.ts. */
  over: SourceScalar;
  score: SourceScalar;
  commentary?: string;

  // Present only on `ball` and `wicket` (86.3% of entries).
  event_id?: string;
  batsman_id?: string;
  bowler_id?: string;
  ball?: string;
  run?: number;
  bat_run?: string;
  wide_run?: string;
  noball_run?: string;
  bye_run?: string;
  legbye_run?: string;
  noball?: boolean;
  wideball?: boolean;
  four?: boolean;
  six?: boolean;
  noball_dismissal?: boolean;
  timestamp?: number;
  /** Exactly two entries: the striker and the non-striker, in some order. */
  batsmen?: { batsman_id: SourceScalar }[];
  bowlers?: { bowler_id: SourceScalar }[];

  // Present only on `wicket`.
  wicket_batsman_id?: string;
  how_out?: string;
  batsman_runs?: string;
  batsman_balls?: string;
}

export interface SourceInningsCommentary {
  inning: {
    iid: number;
    number: number;
    issuperover: string;
    batting_team_id: number;
    fielding_team_id: number;
    scores: string;
    scores_full: string;
    max_over: string;
    target: string;
  };
  commentaries: SourceCommentaryEntry[];
  teams: SourceTeam[];
  players: SourcePlayer[];
}

export interface SourceScorecardBatsman {
  batsman_id: string;
  name: string;
  runs: string;
  balls_faced: string;
  fours: string;
  sixes: string;
  strike_rate: string;
  how_out: string;
  dismissal: string;
  bowler_id: string;
  first_fielder_id: string;
  second_fielder_id: string;
  third_fielder_id: string;
  role?: string;
  role_str?: string;
}

export interface SourceScorecardBowler {
  bowler_id: string;
  name: string;
  overs: string;
  runs_conceded: string;
  wickets: string;
  maidens: string;
  wides: string;
  noballs: string;
  econ: string;
}

export interface SourceScorecardFow {
  batsman_id: string;
  bowler_id: string;
  dismissal: string;
  how_out: string;
  name: string;
  number: number;
  overs_at_dismissal: string;
  runs: string;
  balls: string;
  score_at_dismissal: number;
}

export interface SourceScorecardFielder {
  fielder_id: string;
  fielder_name: string;
  catches: number;
  runout_catcher: number;
  runout_direct_hit: number;
  runout_thrower: number;
  stumping: number;
  is_substitute: string;
}

export interface SourceScorecardInnings {
  iid: number;
  number: number;
  name: string;
  short_name: string;
  batting_team_id: number;
  fielding_team_id: number;
  issuperover: string;
  scores: string;
  scores_full: string;
  max_over: string;
  batsmen: SourceScorecardBatsman[];
  bowlers: SourceScorecardBowler[];
  fows: SourceScorecardFow[];
  fielder: SourceScorecardFielder[];
  did_not_bat: { player_id: string; name: string }[];
  extra_runs: {
    byes: number;
    legbyes: number;
    wides: number;
    noballs: number;
    penalty: SourceScalar;
    total: number;
  };
  equations: { runs: number; wickets: number; overs: string; runrate: string };
}

export interface SourceScorecard extends SourceMatchListEntry {
  innings: SourceScorecardInnings[];
}

export interface SourceSquad {
  team_id: number;
  title: string;
  team: SourceTeam;
  players: SourcePlayer[];
}

export interface SourceStandingRow {
  team_id: string;
  team: SourceTeam;
  played: string;
  win: string;
  loss: string;
  draw: string;
  nr: string;
  points: string;
  netrr: string;
  runfor: string;
  overfor: string;
  runagainst: string;
  overagainst: string;
}

export interface SourceStandings {
  standing_type: string;
  standings: { round: { name: string }; standings: SourceStandingRow[] }[];
}
