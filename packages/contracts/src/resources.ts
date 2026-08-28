import { z } from 'zod';
import { DismissalKind, MatchStage, Phase, Rate } from './common.js';

/** Reference entities. */

export const Season = z.object({
  id: z.number().int(),
  name: z.string(),
  abbr: z.string(),
  year: z.number().int(),
  startDate: z.string(),
  endDate: z.string(),
  totalMatches: z.number().int(),
  totalTeams: z.number().int(),
});

export const Team = z.object({
  id: z.number().int(),
  name: z.string(),
  shortName: z.string(),
  country: z.string().nullable(),
  logoUrl: z.string().nullable(),
});

export const Venue = z.object({
  id: z.number().int(),
  name: z.string(),
  city: z.string().nullable(),
  country: z.string(),
});

export const PlayerSummary = z.object({
  id: z.number().int(),
  fullName: z.string(),
  shortName: z.string(),
  country: z.string().nullable(),
  playingRole: z.string().nullable(),
  battingStyle: z.string().nullable(),
  bowlingStyle: z.string().nullable(),
});

export const Player = PlayerSummary.extend({
  birthdate: z.string().nullable(),
  birthplace: z.string().nullable(),
  nationality: z.string().nullable(),
  teams: z.array(Team),
});

/** Matches. */

export const MatchTeamScore = z.object({
  team: Team,
  runs: z.number().int().nullable(),
  wickets: z.number().int().nullable(),
  overs: z.string().nullable().describe('Cricket over notation, e.g. "17.4"'),
});

export const MatchSummary = z.object({
  id: z.number().int(),
  seasonId: z.number().int(),
  matchNumber: z.number().int(),
  stage: MatchStage,
  title: z.string(),
  shortTitle: z.string(),
  matchDate: z.string(),
  startTime: z.string(),
  venue: Venue,
  teamA: MatchTeamScore,
  teamB: MatchTeamScore,
  tossWinnerId: z.number().int().nullable(),
  tossDecision: z.enum(['bat', 'field']).nullable(),
  result: z.enum(['runs', 'wickets', 'tie', 'no_result', 'super_over']),
  winnerId: z.number().int().nullable(),
  winMargin: z.number().int().nullable(),
  dlsApplied: z.boolean(),
  statusNote: z.string().nullable(),
});

export const MatchOfficial = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().nullable(),
  role: z.enum(['field', 'tv', 'reserve', 'referee']),
});

/** Scorecards. */

export const BattingLine = z.object({
  player: PlayerSummary,
  runs: z.number().int(),
  ballsFaced: z.number().int(),
  fours: z.number().int(),
  sixes: z.number().int(),
  dots: z.number().int(),
  strikeRate: Rate,
  isOut: z.boolean(),
  dismissalKind: DismissalKind.nullable(),
  howOut: z.string().nullable(),
});

export const BowlingLine = z.object({
  player: PlayerSummary,
  overs: z.string().describe('Cricket over notation, e.g. "3.4"'),
  ballsBowled: z.number().int(),
  runsConceded: z.number().int(),
  wickets: z.number().int(),
  maidens: z.number().int(),
  dots: z.number().int(),
  wides: z.number().int(),
  noballs: z.number().int(),
  economy: Rate,
});

export const FallOfWicket = z.object({
  wicketNumber: z.number().int(),
  playerOut: PlayerSummary,
  kind: DismissalKind,
  teamScore: z.number().int().nullable(),
  overs: z.string().nullable(),
});

export const PartnershipLine = z.object({
  wicketNumber: z.number().int(),
  playerA: PlayerSummary,
  playerB: PlayerSummary,
  runs: z.number().int(),
  balls: z.number().int(),
  runRate: Rate,
  wasBroken: z.boolean(),
});

export const InningsScorecard = z.object({
  id: z.number().int(),
  inningsNo: z.number().int(),
  battingTeam: Team,
  bowlingTeam: Team,
  isSuperOver: z.boolean(),
  runs: z.number().int(),
  wickets: z.number().int(),
  overs: z.string(),
  runRate: Rate,
  target: z.number().int().nullable(),
  extras: z.object({
    byes: z.number().int(),
    legbyes: z.number().int(),
    wides: z.number().int(),
    noballs: z.number().int(),
    penalty: z.number().int(),
    total: z.number().int(),
  }),
  batting: z.array(BattingLine),
  bowling: z.array(BowlingLine),
  fallOfWickets: z.array(FallOfWicket),
  partnerships: z.array(PartnershipLine),
});

export const MatchDetail = MatchSummary.extend({
  officials: z.array(MatchOfficial),
  innings: z.array(InningsScorecard),
});

/** Deliveries. */

export const Delivery = z.object({
  id: z.number().int(),
  inningsId: z.number().int(),
  deliverySeq: z.number().int().describe('Monotonic within the innings; the ordering key'),
  over: z.number().int().describe('0-indexed: over 0 is the 1st over'),
  ballInOver: z.number().int(),
  striker: PlayerSummary,
  nonStriker: PlayerSummary,
  bowler: PlayerSummary,
  batRuns: z.number().int(),
  extraRuns: z.number().int(),
  totalRuns: z.number().int(),
  isFour: z.boolean(),
  isSix: z.boolean(),
  isWide: z.boolean(),
  isNoball: z.boolean(),
  isLegalBall: z.boolean(),
  wicket: z
    .object({ kind: DismissalKind, playerOut: PlayerSummary, howOut: z.string().nullable() })
    .nullable(),
  commentary: z.string().nullable(),
});

/** Charts. */

export const WormPoint = z.object({
  inningsNo: z.number().int(),
  ballNumber: z.number().int().describe('Legal balls bowled so far'),
  overs: z.string(),
  runs: z.number().int().describe('Cumulative team score'),
  wickets: z.number().int().describe('Cumulative wickets lost'),
});

export const ManhattanBar = z.object({
  inningsNo: z.number().int(),
  over: z.number().int().describe('1-indexed for display'),
  runs: z.number().int(),
  wickets: z.number().int(),
});

/** Aggregates. */

export const PointsRow = z.object({
  position: z.number().int(),
  team: Team,
  played: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  noResult: z.number().int(),
  points: z.number().int(),
  netRunRate: z.number(),
  runsFor: z.number().int(),
  oversFor: z.string(),
  runsAgainst: z.number().int(),
  oversAgainst: z.string(),
});

export const BattingCareer = z.object({
  player: PlayerSummary,
  matches: z.number().int(),
  innings: z.number().int(),
  runs: z.number().int(),
  ballsFaced: z.number().int(),
  highestScore: z.number().int(),
  average: Rate,
  strikeRate: Rate,
  fifties: z.number().int(),
  hundreds: z.number().int(),
  fours: z.number().int(),
  sixes: z.number().int(),
  ducks: z.number().int(),
  notOuts: z.number().int(),
});

export const BowlingCareer = z.object({
  player: PlayerSummary,
  matches: z.number().int(),
  innings: z.number().int(),
  overs: z.string(),
  ballsBowled: z.number().int(),
  runsConceded: z.number().int(),
  wickets: z.number().int(),
  maidens: z.number().int(),
  bestWickets: z.number().int(),
  economy: Rate,
  average: Rate,
  strikeRate: Rate,
  fourWicketHauls: z.number().int(),
  fiveWicketHauls: z.number().int(),
});

export const PhaseSplit = z.object({
  phase: Phase,
  discipline: z.enum(['batting', 'bowling']),
  runs: z.number().int(),
  balls: z.number().int(),
  fours: z.number().int(),
  sixes: z.number().int(),
  dots: z.number().int(),
  wickets: z.number().int(),
  strikeRate: Rate,
  economy: Rate,
  dotPercentage: Rate,
});

export const HeadToHead = z.object({
  team: Team,
  opponent: Team,
  played: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  noResult: z.number().int(),
  winPercentage: Rate,
  lastPlayed: z.string().nullable(),
});

export const VenueProfile = z.object({
  venue: Venue,
  matches: z.number().int(),
  avgFirstInningsScore: Rate,
  highestFirstInnings: z.number().int(),
  lowestFirstInnings: z.number().int(),
  chasesWon: z.number().int(),
  chaseWinPercentage: Rate,
  tossChoseBat: z.number().int(),
  tossChoseField: z.number().int(),
  tossWinnerWinPercentage: Rate,
});

export const LeaderRow = z.object({
  rank: z.number().int(),
  player: PlayerSummary,
  value: z.number(),
  /** Context for the metric, e.g. balls faced behind a strike rate. */
  support: z.number().int().nullable(),
});

export const FormEntry = z.object({
  match: z.object({
    id: z.number().int(),
    shortTitle: z.string(),
    matchDate: z.string(),
  }),
  opponent: Team,
  runs: z.number().int().nullable(),
  ballsFaced: z.number().int().nullable(),
  wickets: z.number().int().nullable(),
  runsConceded: z.number().int().nullable(),
  ballsBowled: z.number().int().nullable(),
});
