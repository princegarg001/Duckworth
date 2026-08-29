import {
  DEFAULT_MIN_BALLS,
  decodeCursor,
  type LeaderMetric,
  type PlayerListQuery,
} from '@ipl/contracts';

import { int, num, oversText, toPlayerSummary, type PlayerRow, type Sql } from './shared.js';

/** Players, careers, phase splits and leaderboards. */

export async function listPlayers(sql: Sql, q: PlayerListQuery) {
  const cursor = decodeCursor(q.cursor);
  return sql<(PlayerRow & { sort_name: string })[]>`
    select distinct p.id as player_id, p.full_name, p.short_name, p.country_code,
           p.playing_role, p.batting_style, p.bowling_style,
           p.full_name as sort_name
    from core.player p
    left join core.season_squad ss on ss.player_id = p.id
    left join core.season s on s.id = ss.season_id
    where (${q.q ?? null}::text is null
           or p.full_name ilike '%' || ${q.q ?? null}::text || '%'
           or p.short_name ilike '%' || ${q.q ?? null}::text || '%')
      and (${q.season ?? null}::int is null or s.year = ${q.season ?? null}::int)
      and (${q.teamId ?? null}::int is null or ss.team_id = ${q.teamId ?? null}::int)
      and (${q.role ?? null}::text is null or p.playing_role = ${q.role ?? null}::text)
      and (
        ${cursor === null ? null : String(cursor.k)}::text is null
        or (p.full_name, p.id) > (${cursor === null ? null : String(cursor.k)}::text,
                                  ${cursor?.id ?? null}::int)
      )
    order by p.full_name, p.id
    limit ${q.limit + 1}
  `;
}

export async function findPlayer(sql: Sql, id: number) {
  const rows = await sql<
    (PlayerRow & {
      birthdate: string | null;
      birthplace: string | null;
      nationality: string | null;
    })[]
  >`
    select p.id as player_id, p.full_name, p.short_name, p.country_code,
           p.playing_role, p.batting_style, p.bowling_style,
           p.birthdate, p.birthplace, p.nationality
    from core.player p
    where p.id = ${id}
  `;
  const r = rows[0];
  if (r === undefined) return null;

  const teams = await sql<
    {
      id: number;
      name: string;
      short_name: string;
      country: string | null;
      logo_url: string | null;
    }[]
  >`
    select distinct t.id, t.name, t.short_name, t.country, t.logo_url
    from core.season_squad ss
    join core.team t on t.id = ss.team_id
    where ss.player_id = ${id}
    order by t.name
  `;

  return {
    ...toPlayerSummary(r),
    birthdate: r.birthdate,
    birthplace: r.birthplace,
    nationality: r.nationality,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.short_name,
      country: t.country,
      logoUrl: t.logo_url,
    })),
  };
}

export async function getBattingCareer(sql: Sql, playerId: number, seasonId: number | null) {
  const rows = await sql<
    (PlayerRow & {
      matches: number;
      innings: number;
      runs: number;
      balls_faced: number;
      highest_score: number;
      average: string | null;
      strike_rate: string | null;
      fifties: number;
      hundreds: number;
      fours: number;
      sixes: number;
      ducks: number;
      not_outs: number;
    })[]
  >`
    select b.matches, b.innings, b.runs, b.balls_faced, b.highest_score,
           b.average, b.strike_rate, b.fifties, b.hundreds, b.fours, b.sixes,
           b.ducks, b.not_outs,
           p.id as player_id, p.full_name, p.short_name, p.country_code,
           p.playing_role, p.batting_style, p.bowling_style
    from marts.batting_season b
    join core.player p on p.id = b.player_id
    where b.player_id = ${playerId}
      and (${seasonId}::int is null or b.season_id = ${seasonId}::int)
  `;
  const r = rows[0];
  return r === undefined
    ? null
    : {
        player: toPlayerSummary(r),
        matches: int(r.matches),
        innings: int(r.innings),
        runs: int(r.runs),
        ballsFaced: int(r.balls_faced),
        highestScore: int(r.highest_score),
        average: num(r.average),
        strikeRate: num(r.strike_rate),
        fifties: int(r.fifties),
        hundreds: int(r.hundreds),
        fours: int(r.fours),
        sixes: int(r.sixes),
        ducks: int(r.ducks),
        notOuts: int(r.not_outs),
      };
}

export async function getBowlingCareer(sql: Sql, playerId: number, seasonId: number | null) {
  const rows = await sql<
    (PlayerRow & {
      matches: number;
      innings: number;
      balls_bowled: number;
      runs_conceded: number;
      wickets: number;
      maidens: number;
      best_wickets: number;
      economy: string | null;
      average: string | null;
      strike_rate: string | null;
      four_wicket_hauls: number;
      five_wicket_hauls: number;
    })[]
  >`
    select w.matches, w.innings, w.balls_bowled, w.runs_conceded, w.wickets,
           w.maidens, w.best_wickets, w.economy, w.average, w.strike_rate,
           w.four_wicket_hauls, w.five_wicket_hauls,
           p.id as player_id, p.full_name, p.short_name, p.country_code,
           p.playing_role, p.batting_style, p.bowling_style
    from marts.bowling_season w
    join core.player p on p.id = w.player_id
    where w.player_id = ${playerId}
      and (${seasonId}::int is null or w.season_id = ${seasonId}::int)
  `;
  const r = rows[0];
  return r === undefined
    ? null
    : {
        player: toPlayerSummary(r),
        matches: int(r.matches),
        innings: int(r.innings),
        overs: oversText(int(r.balls_bowled)),
        ballsBowled: int(r.balls_bowled),
        runsConceded: int(r.runs_conceded),
        wickets: int(r.wickets),
        maidens: int(r.maidens),
        bestWickets: int(r.best_wickets),
        economy: num(r.economy),
        average: num(r.average),
        strikeRate: num(r.strike_rate),
        fourWicketHauls: int(r.four_wicket_hauls),
        fiveWicketHauls: int(r.five_wicket_hauls),
      };
}

export async function getPhaseSplits(sql: Sql, playerId: number, seasonId: number | null) {
  const rows = await sql<
    {
      phase: string;
      discipline: string;
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      dots: number;
      wickets: number;
      strike_rate: string | null;
      economy: string | null;
      dot_percentage: string | null;
    }[]
  >`
    select phase::text, discipline, runs, balls, fours, sixes, dots, wickets,
           strike_rate, economy, dot_percentage
    from marts.phase_splits
    where player_id = ${playerId}
      and (${seasonId}::int is null or season_id = ${seasonId}::int)
    order by discipline,
             case phase::text when 'powerplay' then 1 when 'middle' then 2 else 3 end
  `;
  return rows.map((r) => ({
    phase: r.phase as 'powerplay',
    discipline: r.discipline as 'batting',
    runs: int(r.runs),
    balls: int(r.balls),
    fours: int(r.fours),
    sixes: int(r.sixes),
    dots: int(r.dots),
    wickets: int(r.wickets),
    strikeRate: num(r.strike_rate),
    economy: num(r.economy),
    dotPercentage: num(r.dot_percentage),
  }));
}

/**
 * Leaderboards.
 *
 * `metric` selects a column, which is the one place this API builds SQL from
 * client input. It is resolved through a closed `Record` keyed by the Zod enum,
 * so an unlisted value cannot reach the query — the type checker rejects a
 * missing key and Zod rejects an unknown one at the edge. No string is ever
 * concatenated in.
 *
 * Rate metrics carry a qualification floor. Without one the best strike rate of
 * any season belongs to a number eleven who faced two balls, which is a
 * leaderboard nobody wants.
 */
interface MetricSpec {
  readonly source: 'batting' | 'bowling';
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly support: string;
}

const METRICS: Readonly<Record<LeaderMetric, MetricSpec>> = {
  runs: { source: 'batting', column: 'runs', direction: 'desc', support: 'balls_faced' },
  fours: { source: 'batting', column: 'fours', direction: 'desc', support: 'balls_faced' },
  sixes: { source: 'batting', column: 'sixes', direction: 'desc', support: 'balls_faced' },
  strike_rate: {
    source: 'batting',
    column: 'strike_rate',
    direction: 'desc',
    support: 'balls_faced',
  },
  average: { source: 'batting', column: 'average', direction: 'desc', support: 'balls_faced' },
  wickets: { source: 'bowling', column: 'wickets', direction: 'desc', support: 'balls_bowled' },
  economy: { source: 'bowling', column: 'economy', direction: 'asc', support: 'balls_bowled' },
  dots: { source: 'bowling', column: 'dots', direction: 'desc', support: 'balls_bowled' },
};

export async function getLeaders(
  sql: Sql,
  seasonId: number,
  metric: LeaderMetric,
  limit: number,
  minBalls?: number,
) {
  const spec = METRICS[metric];
  const floor = minBalls ?? DEFAULT_MIN_BALLS[metric];
  const table = spec.source === 'batting' ? 'marts.batting_season' : 'marts.bowling_season';

  // `spec` comes from the closed map above, never from the request, so these
  // identifiers are ours. Values remain bound parameters.
  const query = `
    select m.player_id, m.${spec.column} as value, m.${spec.support} as support,
           p.id as player_id2, p.full_name, p.short_name, p.country_code,
           p.playing_role, p.batting_style, p.bowling_style
    from ${table} m
    join core.player p on p.id = m.player_id
    where m.season_id = $1
      and m.${spec.support} >= $2
      and m.${spec.column} is not null
    order by m.${spec.column} ${spec.direction === 'desc' ? 'desc' : 'asc'}, m.player_id
    limit $3
  `;

  const rows = await sql.unsafe<(PlayerRow & { value: string | number; support: number })[]>(
    query,
    [seasonId, floor, limit],
  );

  return rows.map((r, i) => ({
    rank: i + 1,
    player: toPlayerSummary(r),
    value: num(r.value) ?? 0,
    support: int(r.support),
  }));
}

/** Recent form: the player's last N appearances with both disciplines. */
export async function getForm(sql: Sql, playerId: number, last: number) {
  return sql<
    {
      match_id: number;
      short_title: string;
      match_date: string;
      opp_id: number;
      opp_name: string;
      opp_short: string;
      opp_country: string | null;
      opp_logo: string | null;
      runs: number | null;
      balls_faced: number | null;
      wickets: number | null;
      runs_conceded: number | null;
      balls_bowled: number | null;
    }[]
  >`
    select m.id as match_id, m.short_title, m.match_date,
           t.id as opp_id, t.name as opp_name, t.short_name as opp_short,
           t.country as opp_country, t.logo_url as opp_logo,
           b.runs, b.balls_faced,
           w.wickets, w.runs_conceded, w.balls_bowled
    from core.match m
    left join marts.batting_innings b on b.match_id = m.id and b.player_id = ${playerId}
    left join marts.bowling_innings w on w.match_id = m.id and w.player_id = ${playerId}
    join core.team t on t.id = coalesce(b.opponent_team_id, w.opponent_team_id)
    where b.player_id is not null or w.player_id is not null
    order by m.match_date desc, m.id desc
    limit ${last}
  `;
}
