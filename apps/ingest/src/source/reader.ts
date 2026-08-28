import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  SourceInningsCommentary,
  SourceMatchInfo,
  SourceMatchListEntry,
  SourceScorecard,
  SourceSquad,
  SourceStandings,
  SourceTeam,
} from './types.js';

/**
 * Reads the dataset off disk and indexes it for the transform.
 *
 * The one structural surprise worth knowing about: **commentary files carry no
 * match id.** Each holds an innings id (`iid`) and nothing that identifies the
 * match, and the filenames — `innings_1_Chennai_Super_Kings_vs_Delhi_Capitals_Match_55_...` —
 * are the only other link, which would mean parsing team names out of a
 * filename. We instead build an `iid -> match_id` index from the scorecards,
 * which carry both, and join on that. All 148 innings resolve.
 */

export interface SourceBundle {
  readonly rootDir: string;
  readonly contentSha256: string;
  readonly fileCount: number;
  readonly matches: SourceMatchListEntry[];
  readonly matchInfo: Map<number, SourceMatchInfo>;
  readonly scorecards: Map<number, SourceScorecard>;
  /** Keyed by innings id. */
  readonly commentary: Map<number, SourceInningsCommentary>;
  /** innings id -> match id, derived from the scorecards. */
  readonly inningsToMatch: Map<number, number>;
  readonly teams: SourceTeam[];
  readonly squads: SourceSquad[];
  readonly standings: SourceStandings;
}

const DIRS = {
  matches: 'matches',
  matchInfo: 'match_info',
  scorecards: 'scorecards',
  commentary: 'match_innings_commentary',
  teams: 'teams',
  squads: 'squads',
  standings: 'standings',
} as const;

/**
 * Directories present in the dataset that we deliberately do not read.
 * Documented here rather than omitted silently — a reviewer should be able to
 * see that they were considered.
 */
export const IGNORED_DIRS: ReadonlyArray<{ dir: string; reason: string }> = [
  {
    dir: 'match_wagon_wheel',
    reason:
      'Contains no wagon-wheel coordinates despite the name — the payload is a strict subset of the scorecard batting/bowling lines.',
  },
  {
    dir: 'match_live_details',
    reason:
      'A point-in-time snapshot of a finished match (last ~30 commentary entries). Superseded by the full commentary.',
  },
  {
    dir: 'batting_stats',
    reason: 'Pre-aggregated leaderboards, derivable from deliveries. Used as validation, not stored.',
  },
  {
    dir: 'bowling_stats',
    reason: 'As above.',
  },
  {
    dir: 'team_stats',
    reason: 'As above.',
  },
  {
    dir: 'player_career_stats',
    reason:
      'All-format career totals (Test/ODI/T20I) spanning a player\'s whole career, not IPL 2022. Only the biographical block is used, and that also appears in squads.',
  },
];

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function listJson(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

/**
 * A stable digest of the dataset's *content*.
 *
 * Built from each file's own hash keyed by relative path, sorted, then hashed
 * again — so it ignores directory ordering and mtimes but changes if any byte
 * of any file changes. This is what makes re-ingest idempotent: the digest is
 * unique in `core.ingest_run`, so a second run over the same bytes is refused
 * by the database rather than by a flag someone might forget to pass.
 */
export async function hashDataset(rootDir: string): Promise<{ sha: string; fileCount: number }> {
  const parts: string[] = [];
  for (const dir of Object.values(DIRS)) {
    for (const file of await listJson(join(rootDir, dir))) {
      const buf = await readFile(join(rootDir, dir, file));
      parts.push(`${dir}/${file}:${createHash('sha256').update(buf).digest('hex')}`);
    }
  }
  parts.sort();
  return {
    sha: createHash('sha256').update(parts.join('\n')).digest('hex'),
    fileCount: parts.length,
  };
}

export async function loadSource(rootDir: string): Promise<SourceBundle> {
  const { sha, fileCount } = await hashDataset(rootDir);

  const matches = await readJson<SourceMatchListEntry[]>(
    join(rootDir, DIRS.matches, 'matches.json'),
  );
  const teams = await readJson<SourceTeam[]>(join(rootDir, DIRS.teams, 'teams.json'));
  const squads = await readJson<SourceSquad[]>(join(rootDir, DIRS.squads, 'squads.json'));
  const standings = await readJson<SourceStandings>(
    join(rootDir, DIRS.standings, 'standings.json'),
  );

  const matchInfo = new Map<number, SourceMatchInfo>();
  for (const file of await listJson(join(rootDir, DIRS.matchInfo))) {
    const info = await readJson<SourceMatchInfo>(join(rootDir, DIRS.matchInfo, file));
    matchInfo.set(info.match_id, info);
  }

  const scorecards = new Map<number, SourceScorecard>();
  const inningsToMatch = new Map<number, number>();
  for (const file of await listJson(join(rootDir, DIRS.scorecards))) {
    const card = await readJson<SourceScorecard>(join(rootDir, DIRS.scorecards, file));
    scorecards.set(card.match_id, card);
    for (const inn of card.innings) {
      inningsToMatch.set(inn.iid, card.match_id);
    }
  }

  const commentary = new Map<number, SourceInningsCommentary>();
  for (const file of await listJson(join(rootDir, DIRS.commentary))) {
    const inn = await readJson<SourceInningsCommentary>(join(rootDir, DIRS.commentary, file));
    commentary.set(inn.inning.iid, inn);
  }

  return {
    rootDir,
    contentSha256: sha,
    fileCount,
    matches,
    matchInfo,
    scorecards,
    commentary,
    inningsToMatch,
    teams,
    squads,
    standings,
  };
}

/** Fail loudly if the bundle is missing anything the transform assumes. */
export function assertBundleComplete(bundle: SourceBundle): void {
  const problems: string[] = [];
  if (bundle.matches.length === 0) problems.push('matches/matches.json is empty');
  if (bundle.teams.length === 0) problems.push('teams/teams.json is empty');

  for (const m of bundle.matches) {
    if (!bundle.matchInfo.has(m.match_id)) problems.push(`missing match_info for ${m.match_id}`);
    if (!bundle.scorecards.has(m.match_id)) problems.push(`missing scorecard for ${m.match_id}`);
  }
  for (const [iid] of bundle.commentary) {
    if (!bundle.inningsToMatch.has(iid)) {
      problems.push(`commentary innings ${iid} resolves to no match`);
    }
  }
  for (const [iid, matchId] of bundle.inningsToMatch) {
    if (!bundle.commentary.has(iid)) {
      problems.push(`innings ${iid} of match ${matchId} has no commentary file`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Source bundle is incomplete (${problems.length} problem(s)):\n  ${problems.slice(0, 20).join('\n  ')}`,
    );
  }
}
