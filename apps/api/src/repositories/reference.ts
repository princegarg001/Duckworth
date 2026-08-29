import { oversText, num, int, type Sql } from './shared.js';

/** Seasons, teams, venues and the points table. */

export async function listSeasons(sql: Sql) {
  return sql<
    {
      id: number;
      name: string;
      abbr: string;
      year: number;
      start_date: string;
      end_date: string;
      total_matches: number;
      total_teams: number;
    }[]
  >`
    select id, name, abbr, year, start_date, end_date, total_matches, total_teams
    from core.season
    order by year desc
  `.then((rows) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      abbr: r.abbr,
      year: r.year,
      startDate: r.start_date,
      endDate: r.end_date,
      totalMatches: r.total_matches,
      totalTeams: r.total_teams,
    })),
  );
}

export async function findSeasonByYear(sql: Sql, year: number): Promise<number | null> {
  const rows = await sql<{ id: number }[]>`select id from core.season where year = ${year}`;
  return rows[0]?.id ?? null;
}

export async function listTeams(sql: Sql, seasonYear?: number) {
  const rows =
    seasonYear === undefined
      ? await sql<
          {
            id: number;
            name: string;
            short_name: string;
            country: string | null;
            logo_url: string | null;
          }[]
        >`
          select id, name, short_name, country, logo_url from core.team order by name
        `
      : await sql<
          {
            id: number;
            name: string;
            short_name: string;
            country: string | null;
            logo_url: string | null;
          }[]
        >`
          select distinct t.id, t.name, t.short_name, t.country, t.logo_url
          from core.team t
          join core.season_squad ss on ss.team_id = t.id
          join core.season s on s.id = ss.season_id
          where s.year = ${seasonYear}
          order by t.name
        `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    country: r.country,
    logoUrl: r.logo_url,
  }));
}

export async function findTeam(sql: Sql, id: number) {
  const rows = await sql<
    {
      id: number;
      name: string;
      short_name: string;
      country: string | null;
      logo_url: string | null;
    }[]
  >`
    select id, name, short_name, country, logo_url from core.team where id = ${id}
  `;
  const r = rows[0];
  return r === undefined
    ? null
    : { id: r.id, name: r.name, shortName: r.short_name, country: r.country, logoUrl: r.logo_url };
}

export async function listVenues(sql: Sql) {
  const rows = await sql<
    { id: number; name: string; city: string | null; country: string }[]
  >`select id, name, city, country from core.venue order by name`;
  return rows.map((r) => ({ id: r.id, name: r.name, city: r.city, country: r.country }));
}

export async function getPointsTable(sql: Sql, seasonId: number) {
  const rows = await sql<
    {
      position: number;
      played: number;
      won: number;
      lost: number;
      no_result: number;
      points: number;
      net_run_rate: string;
      runs_for: number;
      balls_for: number;
      runs_against: number;
      balls_against: number;
      team_id: number;
      team_name: string;
      team_short_name: string;
      team_country: string | null;
      team_logo_url: string | null;
    }[]
  >`
    select p.position, p.played, p.won, p.lost, p.no_result, p.points, p.net_run_rate,
           p.runs_for, p.balls_for, p.runs_against, p.balls_against,
           t.id as team_id, t.name as team_name, t.short_name as team_short_name,
           t.country as team_country, t.logo_url as team_logo_url
    from marts.points_table p
    join core.team t on t.id = p.team_id
    where p.season_id = ${seasonId}
    order by p.position
  `;
  return rows.map((r) => ({
    position: r.position,
    team: {
      id: r.team_id,
      name: r.team_name,
      shortName: r.team_short_name,
      country: r.team_country,
      logoUrl: r.team_logo_url,
    },
    played: r.played,
    won: r.won,
    lost: r.lost,
    noResult: r.no_result,
    points: r.points,
    netRunRate: num(r.net_run_rate) ?? 0,
    runsFor: r.runs_for,
    oversFor: oversText(r.balls_for),
    runsAgainst: r.runs_against,
    oversAgainst: oversText(r.balls_against),
  }));
}

export async function getVenueProfiles(sql: Sql, seasonId: number, venueId?: number) {
  const rows = await sql<
    {
      venue_id: number;
      venue_name: string;
      city: string | null;
      country: string;
      matches: number;
      avg_first_innings_score: string | null;
      highest_first_innings: number;
      lowest_first_innings: number;
      chases_won: number;
      chase_win_percentage: string | null;
      toss_chose_bat: number;
      toss_chose_field: number;
      toss_winner_win_percentage: string | null;
    }[]
  >`
    select v.id as venue_id, v.name as venue_name, v.city, v.country,
           p.matches, p.avg_first_innings_score, p.highest_first_innings,
           p.lowest_first_innings, p.chases_won, p.chase_win_percentage,
           p.toss_chose_bat, p.toss_chose_field, p.toss_winner_win_percentage
    from marts.venue_profile p
    join core.venue v on v.id = p.venue_id
    where p.season_id = ${seasonId}
      and (${venueId ?? null}::int is null or p.venue_id = ${venueId ?? null}::int)
    order by p.matches desc, v.name
  `;
  return rows.map((r) => ({
    venue: { id: r.venue_id, name: r.venue_name, city: r.city, country: r.country },
    matches: int(r.matches),
    avgFirstInningsScore: num(r.avg_first_innings_score),
    highestFirstInnings: r.highest_first_innings,
    lowestFirstInnings: r.lowest_first_innings,
    chasesWon: r.chases_won,
    chaseWinPercentage: num(r.chase_win_percentage),
    tossChoseBat: r.toss_chose_bat,
    tossChoseField: r.toss_chose_field,
    tossWinnerWinPercentage: num(r.toss_winner_win_percentage),
  }));
}

export async function getHeadToHead(
  sql: Sql,
  seasonId: number,
  teamId: number,
  opponentId: number,
) {
  const rows = await sql<
    {
      played: number;
      won: number;
      lost: number;
      no_result: number;
      win_percentage: string | null;
      last_played: string | null;
    }[]
  >`
    select played, won, lost, no_result, win_percentage, last_played
    from marts.head_to_head
    where season_id = ${seasonId} and team_id = ${teamId} and opponent_id = ${opponentId}
  `;
  const r = rows[0];
  return r === undefined
    ? null
    : {
        played: r.played,
        won: r.won,
        lost: r.lost,
        noResult: r.no_result,
        winPercentage: num(r.win_percentage),
        lastPlayed: r.last_played,
      };
}

export async function getHeadToHeadMatrix(sql: Sql, seasonId: number) {
  return sql<
    {
      team_id: number;
      opponent_id: number;
      played: number;
      won: number;
      lost: number;
      no_result: number;
      win_percentage: string | null;
      last_played: string | null;
    }[]
  >`
    select team_id, opponent_id, played, won, lost, no_result, win_percentage, last_played
    from marts.head_to_head
    where season_id = ${seasonId}
    order by team_id, opponent_id
  `;
}
