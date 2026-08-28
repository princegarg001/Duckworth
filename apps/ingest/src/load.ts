import {
  deriveResult,
  disagreesWithNote,
  normaliseName,
  oversToBalls,
  parseMatchStage,
  parseReferee,
  parseUmpires,
} from '@ipl/domain';
import type { DbHandle } from '@ipl/db';
import type { Sql, TransactionSql } from 'postgres';

import {
  asBool,
  asIdOrNull,
  asInt,
  asIntOrNull,
  asText,
  isoFromEpochSeconds,
  matchDateFromIst,
  parseScore,
  parseTossDecision,
  requireText,
} from './source/parse.js';
import type { SourceBundle } from './source/reader.js';
import type { SourceScorecardInnings } from './source/types.js';
import { transformInnings, type DeliveryComponentRepair } from './transform/deliveries.js';
import { transformDismissals } from './transform/dismissals.js';

export interface LoadStats {
  seasons: number;
  teams: number;
  venues: number;
  players: number;
  officials: number;
  matches: number;
  innings: number;
  deliveries: number;
  dismissals: number;
  componentRepairs: DeliveryComponentRepair[];
  /** Matches where the derived result disagreed with the source's prose. */
  resultDisagreements: string[];
}

/** Chunk helper — keeps a single INSERT's parameter count well under the limit. */
function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Load a source bundle into `core` and `quality`.
 *
 * Ordering follows the foreign keys: dimensions first, then matches, then the
 * innings/delivery/dismissal chain. Everything is upserted on the natural key,
 * so a re-run over the same bundle converges on the same rows rather than
 * duplicating them — the `ingest_run` digest short-circuits before we get here
 * in the normal case, but the loader does not *depend* on that guard.
 */
export async function loadBundle(handle: DbHandle, bundle: SourceBundle): Promise<LoadStats> {
  const { sql } = handle;
  const stats: LoadStats = {
    seasons: 0,
    teams: 0,
    venues: 0,
    players: 0,
    officials: 0,
    matches: 0,
    innings: 0,
    deliveries: 0,
    dismissals: 0,
    componentRepairs: [],
    resultDisagreements: [],
  };

  const firstMatch = bundle.matches[0];
  if (firstMatch === undefined) throw new Error('Source bundle contains no matches');
  const comp = firstMatch.competition;
  const seasonId = comp.cid;

  // ── Season ──────────────────────────────────────────────────────────────
  await sql`
    insert into core.season (id, name, abbr, year, start_date, end_date, total_matches, total_teams)
    values (${seasonId}, ${comp.title}, ${comp.abbr}, ${Number(comp.season)},
            ${comp.datestart}, ${comp.dateend}, ${Number(comp.total_matches)},
            ${Number(comp.total_teams)})
    on conflict (id) do update set
      name = excluded.name, abbr = excluded.abbr, year = excluded.year,
      start_date = excluded.start_date, end_date = excluded.end_date,
      total_matches = excluded.total_matches, total_teams = excluded.total_teams
  `;
  stats.seasons = 1;

  // ── Teams ───────────────────────────────────────────────────────────────
  const teamRows = bundle.teams.map((t) => ({
    id: t.tid,
    name: t.title,
    short_name: t.abbr,
    alt_name: asText(t.alt_name),
    country: asText(t.country),
    logo_url: asText(t.logo_url),
  }));
  await sql`
    insert into core.team ${sql(teamRows)}
    on conflict (id) do update set
      name = excluded.name, short_name = excluded.short_name,
      alt_name = excluded.alt_name, country = excluded.country, logo_url = excluded.logo_url
  `;
  stats.teams = teamRows.length;

  // ── Venues ──────────────────────────────────────────────────────────────
  const venueMap = new Map<number, { id: number; name: string; city: string | null; country: string }>();
  for (const info of bundle.matchInfo.values()) {
    const id = asInt(info.venue.venue_id, 'venue.venue_id');
    venueMap.set(id, {
      id,
      name: requireText(info.venue.name, 'venue.name'),
      city: asText(info.venue.location),
      country: asText(info.venue.country) ?? 'India',
    });
  }
  const venueRows = [...venueMap.values()];
  await sql`
    insert into core.venue ${sql(venueRows)}
    on conflict (id) do update set
      name = excluded.name, city = excluded.city, country = excluded.country
  `;
  stats.venues = venueRows.length;

  // ── Players ─────────────────────────────────────────────────────────────
  // Union of squads and the per-innings player blocks; both carry the same
  // 247 stable ids, but taking the union means a player who appears only in a
  // match (a replacement signing) is still known.
  const playerMap = new Map<number, Record<string, unknown>>();
  const addPlayer = (p: {
    pid: number;
    title: string;
    short_name: string;
    birthdate?: string;
    birthplace?: string;
    country?: string;
    nationality?: string;
    playing_role?: string;
    batting_style?: string;
    bowling_style?: string;
  }) => {
    playerMap.set(p.pid, {
      id: p.pid,
      full_name: requireText(p.title, 'player.title'),
      short_name: asText(p.short_name) ?? p.title,
      birthdate: asText(p.birthdate),
      birthplace: asText(p.birthplace),
      country_code: asText(p.country),
      nationality: asText(p.nationality),
      playing_role: asText(p.playing_role),
      batting_style: asText(p.batting_style),
      bowling_style: asText(p.bowling_style),
    });
  };
  for (const squad of bundle.squads) for (const p of squad.players) addPlayer(p);
  for (const inn of bundle.commentary.values()) for (const p of inn.players) addPlayer(p);

  const playerRows = [...playerMap.values()];
  for (const batch of chunks(playerRows, 500)) {
    await sql`
      insert into core.player ${sql(batch)}
      on conflict (id) do update set
        full_name = excluded.full_name, short_name = excluded.short_name,
        birthdate = excluded.birthdate, birthplace = excluded.birthplace,
        country_code = excluded.country_code, nationality = excluded.nationality,
        playing_role = excluded.playing_role, batting_style = excluded.batting_style,
        bowling_style = excluded.bowling_style
    `;
  }
  stats.players = playerRows.length;

  // ── Officials ───────────────────────────────────────────────────────────
  // Names are whitespace-normalised so "Nitin Menon(India)" and
  // "Nitin Menon (India)" resolve to one row rather than two.
  const officialByName = new Map<string, { name: string; country: string | null }>();
  const matchOfficialLinks: { matchId: number; name: string; role: string }[] = [];
  const refereeByMatch = new Map<number, string>();

  for (const info of bundle.matchInfo.values()) {
    for (const o of parseUmpires(info.umpires)) {
      const key = normaliseName(o.name);
      if (!officialByName.has(key)) officialByName.set(key, { name: key, country: o.country });
      matchOfficialLinks.push({ matchId: info.match_id, name: key, role: o.role });
    }
    const ref = parseReferee(info.referee);
    if (ref !== null) {
      const key = normaliseName(ref.name);
      if (!officialByName.has(key)) officialByName.set(key, { name: key, country: ref.country });
      refereeByMatch.set(info.match_id, key);
      matchOfficialLinks.push({ matchId: info.match_id, name: key, role: 'referee' });
    }
  }

  const officialRows = [...officialByName.values()];
  if (officialRows.length > 0) {
    await sql`
      insert into core.official ${sql(officialRows)}
      on conflict (name) do update set country = coalesce(excluded.country, core.official.country)
    `;
  }
  const officialIds = new Map<string, number>();
  for (const row of await sql<{ id: number; name: string }[]>`select id, name from core.official`) {
    officialIds.set(row.name, row.id);
  }
  stats.officials = officialIds.size;

  // ── Season squads ───────────────────────────────────────────────────────
  const squadRows = bundle.squads.flatMap((s) =>
    s.players.map((p) => ({ season_id: seasonId, team_id: s.team_id, player_id: p.pid })),
  );
  if (squadRows.length > 0) {
    for (const batch of chunks(squadRows, 1000)) {
      await sql`
        insert into core.season_squad ${sql(batch)}
        on conflict (season_id, team_id, player_id) do nothing
      `;
    }
  }

  // ── Matches ─────────────────────────────────────────────────────────────
  const resultDisagreements = stats.resultDisagreements;
  const matchRows = bundle.matches.map((m) => {
    const info = bundle.matchInfo.get(m.match_id);
    if (info === undefined) throw new Error(`No match_info for match ${m.match_id}`);
    const card = bundle.scorecards.get(m.match_id);
    const firstInnings = card?.innings.find((i) => i.number === 1);
    if (firstInnings === undefined) {
      throw new Error(`No first innings on the scorecard for match ${m.match_id}`);
    }
    const winnerId = asIdOrNull(m.winning_team_id ?? info.winning_team_id);

    // The source's `result_type` is ignored: it contradicts its own prose in
    // 49 of 74 matches. The margin kind follows from which innings the winner
    // batted in. See packages/domain/src/result.ts.
    const derived = deriveResult({
      winnerTeamId: winnerId,
      firstInningsBattingTeamId: firstInnings.batting_team_id,
      winMargin: info.win_margin,
      statusNote: m.status_note,
    });
    const disagreement = disagreesWithNote(derived, m.status_note);
    if (disagreement !== null) {
      resultDisagreements.push(`match ${m.match_id} (${m.short_title}): ${disagreement}`);
    }
    const result = derived.kind;
    const margin = derived.margin;
    const refName = refereeByMatch.get(m.match_id);
    return {
      id: m.match_id,
      season_id: seasonId,
      match_number: asInt(m.match_number, 'match_number'),
      stage: parseMatchStage(m.subtitle),
      title: m.title,
      short_title: m.short_title,
      subtitle: m.subtitle,
      venue_id: asInt(info.venue.venue_id, 'venue_id'),
      team_a_id: m.teama.team_id,
      team_b_id: m.teamb.team_id,
      start_time: isoFromEpochSeconds(info.timestamp_start),
      end_time: info.timestamp_end > 0 ? isoFromEpochSeconds(info.timestamp_end) : null,
      match_date: matchDateFromIst(info.date_start_ist),
      toss_winner_id: asIdOrNull(info.toss?.winner),
      toss_decision: info.toss === undefined ? null : parseTossDecision(info.toss.text, info.toss.decision),
      result,
      winner_id: winnerId,
      win_margin: margin,
      dls_applied: asBool(info.match_dls_affected),
      referee_id: refName === undefined ? null : (officialIds.get(refName) ?? null),
      status_note: asText(m.status_note),
    };
  });

  for (const batch of chunks(matchRows, 200)) {
    await sql`
      insert into core.match ${sql(batch)}
      on conflict (id) do update set
        season_id = excluded.season_id, match_number = excluded.match_number,
        stage = excluded.stage, title = excluded.title, short_title = excluded.short_title,
        subtitle = excluded.subtitle, venue_id = excluded.venue_id,
        team_a_id = excluded.team_a_id, team_b_id = excluded.team_b_id,
        start_time = excluded.start_time, end_time = excluded.end_time,
        match_date = excluded.match_date, toss_winner_id = excluded.toss_winner_id,
        toss_decision = excluded.toss_decision, result = excluded.result,
        winner_id = excluded.winner_id, win_margin = excluded.win_margin,
        dls_applied = excluded.dls_applied, referee_id = excluded.referee_id,
        status_note = excluded.status_note
    `;
  }
  stats.matches = matchRows.length;

  const officialLinkRows = matchOfficialLinks
    .map((l) => ({
      match_id: l.matchId,
      official_id: officialIds.get(l.name),
      role: l.role,
    }))
    .filter((r): r is { match_id: number; official_id: number; role: string } => r.official_id !== undefined);
  for (const batch of chunks(officialLinkRows, 1000)) {
    await sql`
      insert into core.match_official ${sql(batch)}
      on conflict (match_id, official_id, role) do nothing
    `;
  }

  // ── Innings, deliveries, dismissals ─────────────────────────────────────
  for (const [matchId, card] of bundle.scorecards) {
    await sql.begin(async (tx) => {
      for (const cardInnings of card.innings) {
        const commentary = bundle.commentary.get(cardInnings.iid);
        if (commentary === undefined) {
          throw new Error(`No commentary for innings ${cardInnings.iid} of match ${matchId}`);
        }

        const target = asIntOrNull(commentary.inning.target);
        await tx`
          insert into core.innings
            (id, match_id, innings_no, batting_team_id, bowling_team_id, is_super_over,
             allotted_overs, target)
          values (${cardInnings.iid}, ${matchId}, ${cardInnings.number},
                  ${cardInnings.batting_team_id}, ${cardInnings.fielding_team_id},
                  ${asBool(cardInnings.issuperover)},
                  ${asInt(cardInnings.max_over || '20', 'max_over')},
                  ${target === null || target === 0 ? null : target})
          on conflict (id) do update set
            match_id = excluded.match_id, innings_no = excluded.innings_no,
            batting_team_id = excluded.batting_team_id,
            bowling_team_id = excluded.bowling_team_id,
            is_super_over = excluded.is_super_over,
            allotted_overs = excluded.allotted_overs, target = excluded.target
        `;
        stats.innings += 1;

        const { deliveries, componentRepairs } = transformInnings(commentary);
        stats.componentRepairs.push(...componentRepairs);

        // Deliveries are replaced wholesale per innings: it is simpler to
        // reason about than a row-wise upsert, and the cascade cleans up the
        // dismissals that reference them.
        await tx`delete from core.delivery where innings_id = ${cardInnings.iid}`;
        for (const batch of chunks(deliveries, 1000)) {
          await tx`
            insert into core.delivery ${tx(
              batch.map((d) => ({
                innings_id: d.inningsId,
                delivery_seq: d.deliverySeq,
                over_no: d.overNo,
                ball_in_over: d.ballInOver,
                striker_id: d.strikerId,
                non_striker_id: d.nonStrikerId,
                bowler_id: d.bowlerId,
                bat_runs: d.batRuns,
                wide_runs: d.wideRuns,
                noball_runs: d.noballRuns,
                bye_runs: d.byeRuns,
                legbye_runs: d.legbyeRuns,
                total_runs: d.totalRuns,
                is_four: d.isFour,
                is_six: d.isSix,
                commentary: d.commentary,
                source_event_id: d.sourceEventId,
                ball_timestamp: d.ballTimestamp,
              })),
            )}
          `;
        }
        stats.deliveries += deliveries.length;

        // Map delivery_seq -> the generated delivery id for this innings.
        const idRows = await tx<{ delivery_seq: number; id: string }[]>`
          select delivery_seq, id from core.delivery where innings_id = ${cardInnings.iid}
        `;
        const idBySeq = new Map<number, number>();
        for (const r of idRows) idBySeq.set(r.delivery_seq, Number(r.id));

        const dismissals = transformDismissals(cardInnings, deliveries);
        for (const d of dismissals) {
          const deliveryId = d.deliverySeq === null ? null : (idBySeq.get(d.deliverySeq) ?? null);
          const inserted = await tx<{ id: string }[]>`
            insert into core.dismissal
              (innings_id, delivery_id, player_out_id, kind, bowler_id, wicket_number,
               team_score_at_dismissal, batter_runs, batter_balls, how_out,
               credits_bowler, counts_as_wicket_lost)
            values (${d.inningsId}, ${deliveryId}, ${d.playerOutId}, ${d.kind}, ${d.bowlerId},
                    ${d.wicketNumber}, ${d.teamScoreAtDismissal}, ${d.batterRuns},
                    ${d.batterBalls}, ${d.howOut}, ${d.creditsBowler}, ${d.countsAsWicketLost})
            on conflict (innings_id, player_out_id) do update set
              delivery_id = excluded.delivery_id, kind = excluded.kind,
              bowler_id = excluded.bowler_id, wicket_number = excluded.wicket_number,
              team_score_at_dismissal = excluded.team_score_at_dismissal,
              batter_runs = excluded.batter_runs, batter_balls = excluded.batter_balls,
              how_out = excluded.how_out, credits_bowler = excluded.credits_bowler,
              counts_as_wicket_lost = excluded.counts_as_wicket_lost
            returning id
          `;
          const dismissalId = Number(inserted[0]!.id);
          await tx`delete from core.dismissal_fielder where dismissal_id = ${dismissalId}`;
          if (d.fielders.length > 0) {
            await tx`
              insert into core.dismissal_fielder ${tx(
                d.fielders.map((f) => ({
                  dismissal_id: dismissalId,
                  player_id: f.playerId,
                  ordinal: f.ordinal,
                  is_substitute: f.isSubstitute,
                })),
              )}
              on conflict do nothing
            `;
          }
          stats.dismissals += 1;
        }

        // ── Extras ────────────────────────────────────────────────────────
        // Derived from the deliveries, not copied from the scorecard: in one
        // innings the vendor's extras components sum to 12 against its own
        // stated total of 11, and the ball-by-ball agrees with the total. The
        // vendor's version goes to `quality` to be checked against.
        const sum = (pick: (d: (typeof deliveries)[number]) => number) =>
          deliveries.reduce((n, d) => n + pick(d), 0);
        const byes = sum((d) => d.byeRuns);
        const legbyes = sum((d) => d.legbyeRuns);
        const wides = sum((d) => d.wideRuns);
        const noballs = sum((d) => d.noballRuns);
        await tx`
          insert into core.innings_extras (innings_id, byes, legbyes, wides, noballs, penalty, total)
          values (${cardInnings.iid}, ${byes}, ${legbyes}, ${wides}, ${noballs}, 0,
                  ${byes + legbyes + wides + noballs})
          on conflict (innings_id) do update set
            byes = excluded.byes, legbyes = excluded.legbyes, wides = excluded.wides,
            noballs = excluded.noballs, penalty = excluded.penalty, total = excluded.total
        `;

        // ── Quality reference rows ────────────────────────────────────────
        await loadQualityCards(tx, cardInnings);
      }
    });
  }

  await loadSourceStandings(sql, bundle, seasonId);
  return stats;
}

/**
 * Both the pool (`Sql`) and a transaction (`TransactionSql`) extend the same
 * underlying interface, so helpers accept either and can be called from inside
 * or outside a transaction without casting.
 */
type Tx = Sql | TransactionSql;

/** Vendor scorecard lines, stored only so `verify` can assert against them. */
async function loadQualityCards(tx: Tx, card: SourceScorecardInnings): Promise<void> {
  const batting = card.batsmen.map((b, i) => ({
    innings_id: card.iid,
    player_id: asInt(b.batsman_id, 'batsman_id'),
    runs: asInt(b.runs || '0', 'runs'),
    balls_faced: asInt(b.balls_faced || '0', 'balls_faced'),
    fours: asInt(b.fours || '0', 'fours'),
    sixes: asInt(b.sixes || '0', 'sixes'),
    strike_rate: b.strike_rate === '' ? null : b.strike_rate,
    batting_position: i + 1,
    is_out: asText(b.dismissal) !== null,
  }));
  if (batting.length > 0) {
    await tx`
      insert into quality.source_batting_card ${tx(batting)}
      on conflict (innings_id, player_id) do update set
        runs = excluded.runs, balls_faced = excluded.balls_faced, fours = excluded.fours,
        sixes = excluded.sixes, strike_rate = excluded.strike_rate,
        batting_position = excluded.batting_position, is_out = excluded.is_out
    `;
  }

  const bowling = card.bowlers.map((b) => ({
    innings_id: card.iid,
    player_id: asInt(b.bowler_id, 'bowler_id'),
    balls_bowled: oversToBalls(b.overs || '0'),
    runs_conceded: asInt(b.runs_conceded || '0', 'runs_conceded'),
    wickets: asInt(b.wickets || '0', 'wickets'),
    maidens: asInt(b.maidens || '0', 'maidens'),
    wides: asInt(b.wides || '0', 'wides'),
    noballs: asInt(b.noballs || '0', 'noballs'),
    economy: b.econ === '' ? null : b.econ,
  }));
  if (bowling.length > 0) {
    await tx`
      insert into quality.source_bowling_card ${tx(bowling)}
      on conflict (innings_id, player_id) do update set
        balls_bowled = excluded.balls_bowled, runs_conceded = excluded.runs_conceded,
        wickets = excluded.wickets, maidens = excluded.maidens, wides = excluded.wides,
        noballs = excluded.noballs, economy = excluded.economy
    `;
  }

  const { runs, wickets } = parseScore(card.scores);
  const ex = card.extra_runs;
  await tx`
    insert into quality.source_innings_total
      (innings_id, runs, wickets, balls_bowled, scores_text,
       byes, legbyes, wides, noballs, penalty, extras_total)
    values (${card.iid}, ${runs}, ${wickets}, ${oversToBalls(card.equations?.overs ?? '0')},
            ${card.scores_full ?? card.scores},
            ${ex.byes}, ${ex.legbyes}, ${ex.wides}, ${ex.noballs},
            ${asInt(ex.penalty ?? 0, 'penalty')}, ${ex.total})
    on conflict (innings_id) do update set
      runs = excluded.runs, wickets = excluded.wickets,
      balls_bowled = excluded.balls_bowled, scores_text = excluded.scores_text,
      byes = excluded.byes, legbyes = excluded.legbyes, wides = excluded.wides,
      noballs = excluded.noballs, penalty = excluded.penalty,
      extras_total = excluded.extras_total
  `;
}

/** The published league table — the independent check on our own points table. */
async function loadSourceStandings(
  sql: Tx,
  bundle: SourceBundle,
  seasonId: number,
): Promise<void> {
  const group = bundle.standings.standings[0];
  if (group === undefined) return;

  const rows = group.standings
    .map((r) => ({
      season_id: seasonId,
      team_id: asInt(r.team_id, 'team_id'),
      played: asInt(r.played, 'played'),
      won: asInt(r.win, 'win'),
      lost: asInt(r.loss, 'loss'),
      no_result: asInt(r.nr || '0', 'nr'),
      points: asInt(r.points, 'points'),
      net_run_rate: r.netrr,
      runs_for: asInt(r.runfor, 'runfor'),
      balls_for: oversToBalls(r.overfor),
      runs_against: asInt(r.runagainst, 'runagainst'),
      balls_against: oversToBalls(r.overagainst),
    }))
    .sort((a, b) => b.points - a.points || Number(b.net_run_rate) - Number(a.net_run_rate))
    .map((r, i) => ({ ...r, position: i + 1 }));

  await sql`
    insert into quality.source_standing ${sql(rows)}
    on conflict (season_id, team_id) do update set
      position = excluded.position, played = excluded.played, won = excluded.won,
      lost = excluded.lost, no_result = excluded.no_result, points = excluded.points,
      net_run_rate = excluded.net_run_rate, runs_for = excluded.runs_for,
      balls_for = excluded.balls_for, runs_against = excluded.runs_against,
      balls_against = excluded.balls_against
  `;
}
