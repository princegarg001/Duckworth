import { decodeCursor, type CursorPayload, type MatchListQuery } from '@ipl/contracts';

import { int, num, oversText, toPlayerSummary, type Sql, type PlayerRow } from './shared.js';

/**
 * Matches, scorecards and deliveries.
 *
 * The scorecard is the interesting one. A naive implementation fetches the
 * match, then each innings, then each innings' batting lines, bowling lines,
 * fall of wickets and partnerships — 1 + 2 + 2×4 = eleven round trips for one
 * page, and worse as innings are added. `getMatchDetail` instead issues six
 * queries total, each covering *all* innings of the match, and stitches them
 * in memory. The query count is constant in the number of innings.
 */

export interface MatchListRow {
  id: number;
  season_id: number;
  match_number: number;
  stage: string;
  title: string;
  short_title: string;
  match_date: string;
  start_time: string;
  result: string;
  winner_id: number | null;
  win_margin: number | null;
  dls_applied: boolean;
  status_note: string | null;
  toss_winner_id: number | null;
  toss_decision: string | null;
  venue_id: number;
  venue_name: string;
  venue_city: string | null;
  venue_country: string;
  team_a_id: number;
  team_a_name: string;
  team_a_short: string;
  team_a_country: string | null;
  team_a_logo: string | null;
  team_b_id: number;
  team_b_name: string;
  team_b_short: string;
  team_b_country: string | null;
  team_b_logo: string | null;
  a_runs: number | null;
  a_wickets: number | null;
  a_balls: number | null;
  b_runs: number | null;
  b_wickets: number | null;
  b_balls: number | null;
}

function toMatchSummary(r: MatchListRow) {
  const side = (
    id: number,
    name: string,
    short: string,
    country: string | null,
    logo: string | null,
    runs: number | null,
    wickets: number | null,
    balls: number | null,
  ) => ({
    team: { id, name, shortName: short, country, logoUrl: logo },
    runs,
    wickets,
    overs: balls === null ? null : oversText(balls),
  });

  return {
    id: r.id,
    seasonId: r.season_id,
    matchNumber: r.match_number,
    stage: r.stage as 'league',
    title: r.title,
    shortTitle: r.short_title,
    matchDate: r.match_date,
    startTime: new Date(r.start_time).toISOString(),
    venue: { id: r.venue_id, name: r.venue_name, city: r.venue_city, country: r.venue_country },
    teamA: side(
      r.team_a_id,
      r.team_a_name,
      r.team_a_short,
      r.team_a_country,
      r.team_a_logo,
      r.a_runs,
      r.a_wickets,
      r.a_balls,
    ),
    teamB: side(
      r.team_b_id,
      r.team_b_name,
      r.team_b_short,
      r.team_b_country,
      r.team_b_logo,
      r.b_runs,
      r.b_wickets,
      r.b_balls,
    ),
    tossWinnerId: r.toss_winner_id,
    tossDecision: r.toss_decision as 'bat' | 'field' | null,
    result: r.result as 'runs',
    winnerId: r.winner_id,
    winMargin: r.win_margin,
    dlsApplied: r.dls_applied,
    statusNote: r.status_note,
  };
}

/**
 * Keyset-paginated match list.
 *
 * The sort key is `(match_date, id)`. Both directions are handled by a single
 * query using a comparison that flips on `order`, rather than by concatenating
 * `ASC`/`DESC` into the SQL string — the direction is a bound parameter's
 * effect, not string surgery.
 */
export async function listMatches(sql: Sql, q: MatchListQuery) {
  const cursor: CursorPayload | null = decodeCursor(q.cursor);
  const desc = q.order === 'desc';
  const cursorDate = cursor === null ? null : String(cursor.k);
  const cursorId = cursor?.id ?? null;

  const rows = await sql<MatchListRow[]>`
    select
      m.id, m.season_id, m.match_number, m.stage, m.title, m.short_title,
      m.match_date, m.start_time, m.result, m.winner_id, m.win_margin,
      m.dls_applied, m.status_note, m.toss_winner_id, m.toss_decision,
      v.id as venue_id, v.name as venue_name, v.city as venue_city, v.country as venue_country,
      ta.id as team_a_id, ta.name as team_a_name, ta.short_name as team_a_short,
      ta.country as team_a_country, ta.logo_url as team_a_logo,
      tb.id as team_b_id, tb.name as team_b_name, tb.short_name as team_b_short,
      tb.country as team_b_country, tb.logo_url as team_b_logo,
      sa.runs as a_runs, sa.wickets as a_wickets, sa.legal_balls as a_balls,
      sb.runs as b_runs, sb.wickets as b_wickets, sb.legal_balls as b_balls
    from core.match m
    join core.venue v on v.id = m.venue_id
    join core.team ta on ta.id = m.team_a_id
    join core.team tb on tb.id = m.team_b_id
    left join core.innings ia on ia.match_id = m.id and ia.batting_team_id = m.team_a_id
                             and not ia.is_super_over
    left join marts.innings_summary sa on sa.innings_id = ia.id
    left join core.innings ib on ib.match_id = m.id and ib.batting_team_id = m.team_b_id
                             and not ib.is_super_over
    left join marts.innings_summary sb on sb.innings_id = ib.id
    join core.season s on s.id = m.season_id
    where (${q.season ?? null}::int is null or s.year = ${q.season ?? null}::int)
      and (${q.teamId ?? null}::int is null
           or m.team_a_id = ${q.teamId ?? null}::int
           or m.team_b_id = ${q.teamId ?? null}::int)
      and (${q.venueId ?? null}::int is null or m.venue_id = ${q.venueId ?? null}::int)
      and (${q.stage ?? null}::text is null or m.stage::text = ${q.stage ?? null}::text)
      and (${q.from ?? null}::date is null or m.match_date >= ${q.from ?? null}::date)
      and (${q.to ?? null}::date is null or m.match_date <= ${q.to ?? null}::date)
      and (
        ${cursorDate}::date is null
        or (${desc}
              and (m.match_date, m.id) < (${cursorDate}::date, ${cursorId}::int))
        or (not ${desc}
              and (m.match_date, m.id) > (${cursorDate}::date, ${cursorId}::int))
      )
    order by
      case when ${desc} then m.match_date end desc,
      case when ${desc} then m.id end desc,
      case when not ${desc} then m.match_date end asc,
      case when not ${desc} then m.id end asc
    limit ${q.limit + 1}
  `;

  return rows.map((r) => ({ raw: r, value: toMatchSummary(r) }));
}

export async function findMatch(sql: Sql, id: number) {
  const rows = await sql<MatchListRow[]>`
    select
      m.id, m.season_id, m.match_number, m.stage, m.title, m.short_title,
      m.match_date, m.start_time, m.result, m.winner_id, m.win_margin,
      m.dls_applied, m.status_note, m.toss_winner_id, m.toss_decision,
      v.id as venue_id, v.name as venue_name, v.city as venue_city, v.country as venue_country,
      ta.id as team_a_id, ta.name as team_a_name, ta.short_name as team_a_short,
      ta.country as team_a_country, ta.logo_url as team_a_logo,
      tb.id as team_b_id, tb.name as team_b_name, tb.short_name as team_b_short,
      tb.country as team_b_country, tb.logo_url as team_b_logo,
      sa.runs as a_runs, sa.wickets as a_wickets, sa.legal_balls as a_balls,
      sb.runs as b_runs, sb.wickets as b_wickets, sb.legal_balls as b_balls
    from core.match m
    join core.venue v on v.id = m.venue_id
    join core.team ta on ta.id = m.team_a_id
    join core.team tb on tb.id = m.team_b_id
    left join core.innings ia on ia.match_id = m.id and ia.batting_team_id = m.team_a_id
                             and not ia.is_super_over
    left join marts.innings_summary sa on sa.innings_id = ia.id
    left join core.innings ib on ib.match_id = m.id and ib.batting_team_id = m.team_b_id
                             and not ib.is_super_over
    left join marts.innings_summary sb on sb.innings_id = ib.id
    where m.id = ${id}
  `;
  const r = rows[0];
  return r === undefined ? null : toMatchSummary(r);
}

/**
 * A complete scorecard in six queries, regardless of how many innings the
 * match had. Each query covers every innings at once; the stitching is done
 * here rather than by asking the database eleven times.
 */
export async function getMatchDetail(sql: Sql, matchId: number) {
  const summary = await findMatch(sql, matchId);
  if (summary === null) return null;

  const [officials, inningsRows, batting, bowling, fows, partnerships] = await Promise.all([
    sql<{ id: number; name: string; country: string | null; role: string }[]>`
      select o.id, o.name, o.country, mo.role
      from core.match_official mo
      join core.official o on o.id = mo.official_id
      where mo.match_id = ${matchId}
      order by case mo.role when 'field' then 1 when 'tv' then 2
                            when 'reserve' then 3 else 4 end, o.name
    `,
    sql<
      {
        innings_id: number;
        innings_no: number;
        is_super_over: boolean;
        runs: number;
        wickets: number;
        legal_balls: number;
        run_rate: string | null;
        target: number | null;
        bat_id: number;
        bat_name: string;
        bat_short: string;
        bat_country: string | null;
        bat_logo: string | null;
        bowl_id: number;
        bowl_name: string;
        bowl_short: string;
        bowl_country: string | null;
        bowl_logo: string | null;
        byes: number;
        legbyes: number;
        wides: number;
        noballs: number;
        penalty: number;
        extras_total: number;
      }[]
    >`
      select s.innings_id, s.innings_no, s.is_super_over, s.runs, s.wickets,
             s.legal_balls, s.run_rate, s.target,
             bt.id as bat_id, bt.name as bat_name, bt.short_name as bat_short,
             bt.country as bat_country, bt.logo_url as bat_logo,
             wt.id as bowl_id, wt.name as bowl_name, wt.short_name as bowl_short,
             wt.country as bowl_country, wt.logo_url as bowl_logo,
             coalesce(e.byes,0) as byes, coalesce(e.legbyes,0) as legbyes,
             coalesce(e.wides,0) as wides, coalesce(e.noballs,0) as noballs,
             coalesce(e.penalty,0) as penalty, coalesce(e.total,0) as extras_total
      from marts.innings_summary s
      join core.team bt on bt.id = s.batting_team_id
      join core.team wt on wt.id = s.bowling_team_id
      left join core.innings_extras e on e.innings_id = s.innings_id
      where s.match_id = ${matchId}
      order by s.innings_no
    `,
    sql<
      (PlayerRow & {
        innings_id: number;
        runs: number;
        balls_faced: number;
        fours: number;
        sixes: number;
        dots: number;
        strike_rate: string | null;
        is_out: boolean;
        dismissal_kind: string | null;
        how_out: string | null;
        first_delivery_seq: number;
      })[]
    >`
      select b.innings_id, b.runs, b.balls_faced, b.fours, b.sixes, b.dots,
             b.strike_rate, b.is_out, b.dismissal_kind, b.first_delivery_seq,
             ds.how_out,
             p.id as player_id, p.full_name, p.short_name, p.country_code,
             p.playing_role, p.batting_style, p.bowling_style
      from marts.batting_innings b
      join core.player p on p.id = b.player_id
      left join core.dismissal ds
             on ds.innings_id = b.innings_id and ds.player_out_id = b.player_id
      where b.match_id = ${matchId}
      order by b.innings_id, b.first_delivery_seq
    `,
    sql<
      (PlayerRow & {
        innings_id: number;
        balls_bowled: number;
        runs_conceded: number;
        wickets: number;
        maidens: number;
        dots: number;
        wides: number;
        noballs: number;
        economy: string | null;
      })[]
    >`
      select w.innings_id, w.balls_bowled, w.runs_conceded, w.wickets, w.maidens,
             w.dots, w.wides, w.noballs, w.economy,
             p.id as player_id, p.full_name, p.short_name, p.country_code,
             p.playing_role, p.batting_style, p.bowling_style
      from marts.bowling_innings w
      join core.player p on p.id = w.player_id
      where w.match_id = ${matchId}
      order by w.innings_id, w.balls_bowled desc
    `,
    sql<
      (PlayerRow & {
        innings_id: number;
        wicket_number: number;
        kind: string;
        team_score_at_dismissal: number | null;
        balls_at_fall: number | null;
      })[]
    >`
      select ds.innings_id, ds.wicket_number, ds.kind, ds.team_score_at_dismissal,
             (select count(*) filter (where d2.is_legal_ball)
              from core.delivery d2
              where d2.innings_id = ds.innings_id
                and d2.delivery_seq <= coalesce(d.delivery_seq, 0)) as balls_at_fall,
             p.id as player_id, p.full_name, p.short_name, p.country_code,
             p.playing_role, p.batting_style, p.bowling_style
      from core.dismissal ds
      join core.innings i on i.id = ds.innings_id
      join core.player p on p.id = ds.player_out_id
      left join core.delivery d on d.id = ds.delivery_id
      where i.match_id = ${matchId} and ds.counts_as_wicket_lost
      order by ds.innings_id, ds.wicket_number
    `,
    sql<
      {
        innings_id: number;
        wicket_number: number;
        runs: number;
        balls: number;
        run_rate: string | null;
        was_broken: boolean;
        a_id: number;
        a_full: string;
        a_short: string;
        a_country: string | null;
        a_role: string | null;
        a_bat: string | null;
        a_bowl: string | null;
        b_id: number;
        b_full: string;
        b_short: string;
        b_country: string | null;
        b_role: string | null;
        b_bat: string | null;
        b_bowl: string | null;
      }[]
    >`
      select pt.innings_id, pt.wicket_number, pt.runs, pt.balls, pt.run_rate, pt.was_broken,
             pa.id as a_id, pa.full_name as a_full, pa.short_name as a_short,
             pa.country_code as a_country, pa.playing_role as a_role,
             pa.batting_style as a_bat, pa.bowling_style as a_bowl,
             pb.id as b_id, pb.full_name as b_full, pb.short_name as b_short,
             pb.country_code as b_country, pb.playing_role as b_role,
             pb.batting_style as b_bat, pb.bowling_style as b_bowl
      from marts.partnership pt
      join core.player pa on pa.id = pt.player_a_id
      join core.player pb on pb.id = pt.player_b_id
      where pt.match_id = ${matchId}
      order by pt.innings_id, pt.wicket_number
    `,
  ]);

  const byInnings = <T extends { innings_id: number }>(rows: readonly T[], id: number) =>
    rows.filter((r) => r.innings_id === id);

  return {
    ...summary,
    officials: officials.map((o) => ({
      id: o.id,
      name: o.name,
      country: o.country,
      role: o.role as 'field',
    })),
    innings: inningsRows.map((i) => ({
      id: i.innings_id,
      inningsNo: i.innings_no,
      battingTeam: {
        id: i.bat_id,
        name: i.bat_name,
        shortName: i.bat_short,
        country: i.bat_country,
        logoUrl: i.bat_logo,
      },
      bowlingTeam: {
        id: i.bowl_id,
        name: i.bowl_name,
        shortName: i.bowl_short,
        country: i.bowl_country,
        logoUrl: i.bowl_logo,
      },
      isSuperOver: i.is_super_over,
      runs: int(i.runs),
      wickets: int(i.wickets),
      overs: oversText(int(i.legal_balls)),
      runRate: num(i.run_rate),
      target: i.target,
      extras: {
        byes: int(i.byes),
        legbyes: int(i.legbyes),
        wides: int(i.wides),
        noballs: int(i.noballs),
        penalty: int(i.penalty),
        total: int(i.extras_total),
      },
      batting: byInnings(batting, i.innings_id).map((b) => ({
        player: toPlayerSummary(b),
        runs: int(b.runs),
        ballsFaced: int(b.balls_faced),
        fours: int(b.fours),
        sixes: int(b.sixes),
        dots: int(b.dots),
        strikeRate: num(b.strike_rate),
        isOut: b.is_out,
        dismissalKind: b.dismissal_kind as 'caught' | null,
        howOut: b.how_out,
      })),
      bowling: byInnings(bowling, i.innings_id).map((w) => ({
        player: toPlayerSummary(w),
        overs: oversText(int(w.balls_bowled)),
        ballsBowled: int(w.balls_bowled),
        runsConceded: int(w.runs_conceded),
        wickets: int(w.wickets),
        maidens: int(w.maidens),
        dots: int(w.dots),
        wides: int(w.wides),
        noballs: int(w.noballs),
        economy: num(w.economy),
      })),
      fallOfWickets: byInnings(fows, i.innings_id).map((f) => ({
        wicketNumber: f.wicket_number,
        playerOut: toPlayerSummary(f),
        kind: f.kind as 'caught',
        teamScore: f.team_score_at_dismissal,
        overs: f.balls_at_fall === null ? null : oversText(int(f.balls_at_fall)),
      })),
      partnerships: byInnings(partnerships, i.innings_id).map((p) => ({
        wicketNumber: p.wicket_number,
        playerA: toPlayerSummary({
          player_id: p.a_id,
          full_name: p.a_full,
          short_name: p.a_short,
          country_code: p.a_country,
          playing_role: p.a_role,
          batting_style: p.a_bat,
          bowling_style: p.a_bowl,
        }),
        playerB: toPlayerSummary({
          player_id: p.b_id,
          full_name: p.b_full,
          short_name: p.b_short,
          country_code: p.b_country,
          playing_role: p.b_role,
          batting_style: p.b_bat,
          bowling_style: p.b_bowl,
        }),
        runs: int(p.runs),
        balls: int(p.balls),
        runRate: num(p.run_rate),
        wasBroken: p.was_broken,
      })),
    })),
  };
}

/** Ball-by-ball, keyset-paginated on `delivery_seq`. */
export async function listDeliveries(
  sql: Sql,
  matchId: number,
  opts: {
    innings?: number | undefined;
    over?: number | undefined;
    cursor: CursorPayload | null;
    limit: number;
  },
) {
  return sql<
    {
      id: string;
      innings_id: number;
      innings_no: number;
      delivery_seq: number;
      over_no: number;
      ball_in_over: number;
      bat_runs: number;
      extra_runs: number;
      total_runs: number;
      is_four: boolean;
      is_six: boolean;
      is_wide: boolean;
      is_noball: boolean;
      is_legal_ball: boolean;
      commentary: string | null;
      wicket_kind: string | null;
      wicket_how_out: string | null;
      s_id: number;
      s_full: string;
      s_short: string;
      s_country: string | null;
      s_role: string | null;
      s_bat: string | null;
      s_bowl: string | null;
      n_id: number;
      n_full: string;
      n_short: string;
      n_country: string | null;
      n_role: string | null;
      n_bat: string | null;
      n_bowl: string | null;
      b_id: number;
      b_full: string;
      b_short: string;
      b_country: string | null;
      b_role: string | null;
      b_bat: string | null;
      b_bowl: string | null;
      o_id: number | null;
      o_full: string | null;
      o_short: string | null;
      o_country: string | null;
      o_role: string | null;
      o_bat: string | null;
      o_bowl: string | null;
    }[]
  >`
    select d.id, d.innings_id, i.innings_no, d.delivery_seq, d.over_no, d.ball_in_over,
           d.bat_runs, d.extra_runs, d.total_runs, d.is_four, d.is_six,
           d.is_wide, d.is_noball, d.is_legal_ball, d.commentary,
           ds.kind as wicket_kind, ds.how_out as wicket_how_out,
           ps.id as s_id, ps.full_name as s_full, ps.short_name as s_short,
           ps.country_code as s_country, ps.playing_role as s_role,
           ps.batting_style as s_bat, ps.bowling_style as s_bowl,
           pn.id as n_id, pn.full_name as n_full, pn.short_name as n_short,
           pn.country_code as n_country, pn.playing_role as n_role,
           pn.batting_style as n_bat, pn.bowling_style as n_bowl,
           pb.id as b_id, pb.full_name as b_full, pb.short_name as b_short,
           pb.country_code as b_country, pb.playing_role as b_role,
           pb.batting_style as b_bat, pb.bowling_style as b_bowl,
           po.id as o_id, po.full_name as o_full, po.short_name as o_short,
           po.country_code as o_country, po.playing_role as o_role,
           po.batting_style as o_bat, po.bowling_style as o_bowl
    from core.delivery d
    join core.innings i on i.id = d.innings_id
    join core.player ps on ps.id = d.striker_id
    join core.player pn on pn.id = d.non_striker_id
    join core.player pb on pb.id = d.bowler_id
    left join core.dismissal ds on ds.delivery_id = d.id
    left join core.player po on po.id = ds.player_out_id
    where i.match_id = ${matchId}
      and (${opts.innings ?? null}::int is null or i.innings_no = ${opts.innings ?? null}::int)
      and (${opts.over ?? null}::int is null or d.over_no = ${opts.over ?? null}::int)
      and (
        ${opts.cursor === null ? null : Number(opts.cursor.k)}::int is null
        or (i.innings_no, d.delivery_seq)
           > (${opts.cursor === null ? null : Number(opts.cursor.k)}::int,
              ${opts.cursor?.id ?? null}::int)
      )
    order by i.innings_no, d.delivery_seq
    limit ${opts.limit + 1}
  `;
}

/** Cumulative score by ball — the worm chart. */
export async function getWorm(sql: Sql, matchId: number) {
  return sql<{ innings_no: number; ball_number: string; runs: string; wickets: string }[]>`
    select i.innings_no,
           count(*) filter (where d.is_legal_ball)
             over (partition by i.innings_no order by d.delivery_seq)      as ball_number,
           sum(d.total_runs)
             over (partition by i.innings_no order by d.delivery_seq)      as runs,
           count(ds.id)
             over (partition by i.innings_no order by d.delivery_seq)      as wickets
    from core.delivery d
    join core.innings i on i.id = d.innings_id
    left join core.dismissal ds on ds.delivery_id = d.id and ds.counts_as_wicket_lost
    where i.match_id = ${matchId} and not i.is_super_over
    order by i.innings_no, d.delivery_seq
  `;
}

/** Runs and wickets per over — the manhattan chart. */
export async function getManhattan(sql: Sql, matchId: number) {
  return sql<{ innings_no: number; over_no: number; runs: string; wickets: string }[]>`
    select i.innings_no, d.over_no,
           sum(d.total_runs)                                as runs,
           count(*) filter (where ds.id is not null)        as wickets
    from core.delivery d
    join core.innings i on i.id = d.innings_id
    left join core.dismissal ds on ds.delivery_id = d.id and ds.counts_as_wicket_lost
    where i.match_id = ${matchId} and not i.is_super_over
    group by i.innings_no, d.over_no
    order by i.innings_no, d.over_no
  `;
}
