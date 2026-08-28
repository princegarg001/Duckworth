import {
  collection,
  paginated,
  BattingCareer,
  BowlingCareer,
  CompareQuery,
  Delivery,
  DeliveryListQuery,
  encodeCursor,
  decodeCursor,
  FormEntry,
  HeadToHead,
  LeaderRow,
  LeadersQuery,
  ManhattanBar,
  MatchDetail,
  MatchListQuery,
  MatchSummary,
  PartnershipLine,
  PhaseSplit,
  Player,
  PlayerListQuery,
  PlayerStatsQuery,
  PlayerSummary,
  PointsRow,
  Problem,
  Season,
  SeasonYear,
  Team,
  toPage,
  Venue,
  VenueProfile,
  WormPoint,
} from '@ipl/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ApiError } from '../plugins/errors.js';
import { applyCacheHeaders, isNotModified, type Cache } from '../plugins/cache.js';
import * as matchesRepo from '../repositories/matches.js';
import * as playersRepo from '../repositories/players.js';
import * as refRepo from '../repositories/reference.js';
import { int, oversText, toPlayerSummary } from '../repositories/shared.js';
import type { DbHandle } from '@ipl/db';

/**
 * Versioned API surface.
 *
 * Routes do three things and nothing else: bind a schema, call a service or
 * repository, and choose a status code. There is no business logic here — the
 * cricket lives in `@ipl/domain` and the SQL in `repositories/`, and
 * `eslint-plugin-boundaries` enforces the direction of every import.
 */

export interface RouteDeps {
  readonly db: DbHandle;
  readonly cache: Cache;
  readonly cacheTtlSeconds: number;
}

export async function v1Routes(fastify: FastifyInstance, deps: RouteDeps): Promise<void> {
  // Re-apply the type provider inside the plugin scope: an encapsulated
  // Fastify instance does not inherit it, and without this every `request.query`
  // below would be `unknown`.
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { db, cache } = deps;
  const sql = db.sql;

  /**
   * Serve an aggregate through the cache with an ETag.
   *
   * Wrapping the pattern once keeps every aggregate endpoint consistent: same
   * key namespace, same TTL, same conditional-request behaviour. Getting this
   * subtly different per route is how a caching bug hides.
   */
  async function cached<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    keyParts: readonly (string | number | undefined)[],
    load: () => Promise<T>,
    opts: { maxAge?: number } = {},
  ): Promise<void> {
    const key = await cache.key(keyParts);
    const hit = await cache.get<T>(key);
    const body = hit ?? (await load());
    if (hit === null) await cache.set(key, body, deps.cacheTtlSeconds);

    const etag = applyCacheHeaders(reply, body, {
      maxAge: opts.maxAge ?? deps.cacheTtlSeconds,
    });
    const ifNoneMatch = request.headers['if-none-match'];
    if (isNotModified(typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined, etag)) {
      // 304 carries no body, so the response schema does not apply.
      await reply.code(304).send();
      return;
    }
    await reply.send(body);
  }

  /** Resolve a season year to its id, 404-ing when absent. */
  async function seasonIdOrThrow(year: number): Promise<number> {
    const id = await refRepo.findSeasonByYear(sql, year);
    if (id === null) throw ApiError.notFound('season', year);
    return id;
  }

  // ── Seasons ─────────────────────────────────────────────────────────────

  app.get(
    '/v1/seasons',
    {
      schema: {
        tags: ['seasons'],
        summary: 'List seasons',
        response: { 200: collection(Season) },
      },
    },
    async (request, reply) => {
      await cached(request, reply, ['seasons'], async () => ({ data: await refRepo.listSeasons(sql) }), {
        maxAge: 300,
      });
    },
  );

  app.get(
    '/v1/seasons/:year/points-table',
    {
      schema: {
        tags: ['seasons'],
        summary: 'League points table',
        description:
          'Derived from ball-by-ball deliveries, not copied from the source. League-stage matches only; a side bowled out is charged its full over quota for net run rate. Asserted equal to the published standings by the `points_table_matches_published_standings` data-quality check.',
        params: z.object({ year: SeasonYear }),
        response: { 200: collection(PointsRow), 404: Problem },
      },
    },
    async (request, reply) => {
      const { year } = request.params;
      const seasonId = await seasonIdOrThrow(year);
      await cached(request, reply, ['points-table', year], async () => ({
        data: await refRepo.getPointsTable(sql, seasonId),
      }));
    },
  );

  app.get(
    '/v1/seasons/:year/leaders',
    {
      schema: {
        tags: ['seasons'],
        summary: 'Season leaderboards',
        description:
          'Rate metrics (strike rate, average, economy) apply a qualification floor so a leaderboard is not topped by someone who faced two balls. Override with `minBalls`.',
        params: z.object({ year: SeasonYear }),
        querystring: LeadersQuery,
        response: { 200: collection(LeaderRow), 404: Problem, 422: Problem },
      },
    },
    async (request, reply) => {
      const { year } = request.params;
      const { metric, limit, minBalls } = request.query;
      const seasonId = await seasonIdOrThrow(year);
      await cached(request, reply, ['leaders', year, metric, limit, minBalls], async () => ({
        data: await playersRepo.getLeaders(sql, seasonId, metric, limit, minBalls),
      }));
    },
  );

  // ── Teams ───────────────────────────────────────────────────────────────

  app.get(
    '/v1/teams',
    {
      schema: {
        tags: ['teams'],
        summary: 'List teams',
        querystring: z.object({ season: SeasonYear.optional() }),
        response: { 200: collection(Team) },
      },
    },
    async (request, reply) => {
      await cached(request, reply, ['teams', request.query.season], async () => ({
        data: await refRepo.listTeams(sql, request.query.season),
      }));
    },
  );

  app.get(
    '/v1/teams/:id',
    {
      schema: {
        tags: ['teams'],
        summary: 'Get a team',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: Team, 404: Problem },
      },
    },
    async (request) => {
      const team = await refRepo.findTeam(sql, request.params.id);
      if (team === null) throw ApiError.notFound('team', request.params.id);
      return team;
    },
  );

  app.get(
    '/v1/teams/:a/head-to-head/:b',
    {
      schema: {
        tags: ['teams'],
        summary: 'Head-to-head record between two teams',
        params: z.object({
          a: z.coerce.number().int().positive(),
          b: z.coerce.number().int().positive(),
        }),
        querystring: z.object({ season: SeasonYear }),
        response: { 200: HeadToHead, 404: Problem, 422: Problem },
      },
    },
    async (request) => {
      const { a, b } = request.params;
      if (a === b) throw ApiError.badRequest('A team cannot play itself');
      const seasonId = await seasonIdOrThrow(request.query.season);
      const [teamA, teamB, record] = await Promise.all([
        refRepo.findTeam(sql, a),
        refRepo.findTeam(sql, b),
        refRepo.getHeadToHead(sql, seasonId, a, b),
      ]);
      if (teamA === null) throw ApiError.notFound('team', a);
      if (teamB === null) throw ApiError.notFound('team', b);
      return {
        team: teamA,
        opponent: teamB,
        played: record?.played ?? 0,
        won: record?.won ?? 0,
        lost: record?.lost ?? 0,
        noResult: record?.noResult ?? 0,
        winPercentage: record?.winPercentage ?? null,
        lastPlayed: record?.lastPlayed ?? null,
      };
    },
  );

  // ── Venues ──────────────────────────────────────────────────────────────

  app.get(
    '/v1/venues',
    {
      schema: { tags: ['venues'], summary: 'List venues', response: { 200: collection(Venue) } },
    },
    async (request, reply) => {
      await cached(request, reply, ['venues'], async () => ({ data: await refRepo.listVenues(sql) }), {
        maxAge: 300,
      });
    },
  );

  app.get(
    '/v1/venues/:id/profile',
    {
      schema: {
        tags: ['venues'],
        summary: 'Venue profile',
        description:
          'Average first-innings score, chase success rate and toss impact — the questions asked at the toss.',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: z.object({ season: SeasonYear }),
        response: { 200: VenueProfile, 404: Problem, 422: Problem },
      },
    },
    async (request, reply) => {
      const seasonId = await seasonIdOrThrow(request.query.season);
      const rows = await refRepo.getVenueProfiles(sql, seasonId, request.params.id);
      const profile = rows[0];
      if (profile === undefined) throw ApiError.notFound('venue profile', request.params.id);
      await cached(request, reply, ['venue', request.params.id, request.query.season], async () => profile);
    },
  );

  // ── Matches ─────────────────────────────────────────────────────────────

  app.get(
    '/v1/matches',
    {
      schema: {
        tags: ['matches'],
        summary: 'List matches',
        description:
          'Keyset-paginated. Pass `page.nextCursor` back as `cursor` verbatim; the cursor is opaque and must not be constructed by clients.',
        querystring: MatchListQuery,
        response: { 200: paginated(MatchSummary), 422: Problem },
      },
    },
    async (request) => {
      if (request.query.cursor !== undefined && decodeCursor(request.query.cursor) === null) {
        throw ApiError.invalidCursor();
      }
      const rows = await matchesRepo.listMatches(sql, request.query);
      const page = toPage(rows, request.query.limit, (r) => ({
        k: r.raw.match_date,
        id: r.raw.id,
      }));
      return { data: page.data.map((r) => r.value), page: page.page };
    },
  );

  app.get(
    '/v1/matches/:id',
    {
      schema: {
        tags: ['matches'],
        summary: 'Full scorecard',
        description:
          'Both innings with batting, bowling, fall of wickets and partnerships. Assembled in a fixed number of queries regardless of how many innings the match had.',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: MatchDetail, 404: Problem },
      },
    },
    async (request, reply) => {
      const detail = await matchesRepo.getMatchDetail(sql, request.params.id);
      if (detail === null) throw ApiError.notFound('match', request.params.id);
      await cached(request, reply, ['match', request.params.id], async () => detail, {
        maxAge: 300,
      });
    },
  );

  app.get(
    '/v1/matches/:id/deliveries',
    {
      schema: {
        tags: ['matches'],
        summary: 'Ball-by-ball',
        description:
          'Ordered by `deliverySeq`, which is monotonic within an innings. `(over, ballInOver)` is deliberately NOT unique — the source repeats the ball number on a wide or no-ball.',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: DeliveryListQuery,
        response: { 200: paginated(Delivery), 404: Problem, 422: Problem },
      },
    },
    async (request) => {
      const cursor = request.query.cursor === undefined ? null : decodeCursor(request.query.cursor);
      if (request.query.cursor !== undefined && cursor === null) throw ApiError.invalidCursor();

      const match = await matchesRepo.findMatch(sql, request.params.id);
      if (match === null) throw ApiError.notFound('match', request.params.id);

      const rows = await matchesRepo.listDeliveries(sql, request.params.id, {
        innings: request.query.innings,
        over: request.query.over,
        cursor,
        limit: request.query.limit,
      });

      const page = toPage(rows, request.query.limit, (r) => ({
        k: r.innings_no,
        id: r.delivery_seq,
      }));

      return {
        data: page.data.map((r) => ({
          id: Number(r.id),
          inningsId: r.innings_id,
          deliverySeq: r.delivery_seq,
          over: r.over_no,
          ballInOver: r.ball_in_over,
          striker: toPlayerSummary({
            player_id: r.s_id, full_name: r.s_full, short_name: r.s_short,
            country_code: r.s_country, playing_role: r.s_role,
            batting_style: r.s_bat, bowling_style: r.s_bowl,
          }),
          nonStriker: toPlayerSummary({
            player_id: r.n_id, full_name: r.n_full, short_name: r.n_short,
            country_code: r.n_country, playing_role: r.n_role,
            batting_style: r.n_bat, bowling_style: r.n_bowl,
          }),
          bowler: toPlayerSummary({
            player_id: r.b_id, full_name: r.b_full, short_name: r.b_short,
            country_code: r.b_country, playing_role: r.b_role,
            batting_style: r.b_bat, bowling_style: r.b_bowl,
          }),
          batRuns: r.bat_runs,
          extraRuns: r.extra_runs,
          totalRuns: r.total_runs,
          isFour: r.is_four,
          isSix: r.is_six,
          isWide: r.is_wide,
          isNoball: r.is_noball,
          isLegalBall: r.is_legal_ball,
          wicket:
            r.wicket_kind === null || r.o_id === null
              ? null
              : {
                  kind: r.wicket_kind as 'caught',
                  playerOut: toPlayerSummary({
                    player_id: r.o_id, full_name: r.o_full ?? '', short_name: r.o_short ?? '',
                    country_code: r.o_country, playing_role: r.o_role,
                    batting_style: r.o_bat, bowling_style: r.o_bowl,
                  }),
                  howOut: r.wicket_how_out,
                },
          commentary: r.commentary,
        })),
        page: page.page,
      };
    },
  );

  app.get(
    '/v1/matches/:id/worm',
    {
      schema: {
        tags: ['matches'],
        summary: 'Cumulative score by ball (worm chart)',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: collection(WormPoint), 404: Problem },
      },
    },
    async (request, reply) => {
      const match = await matchesRepo.findMatch(sql, request.params.id);
      if (match === null) throw ApiError.notFound('match', request.params.id);
      await cached(request, reply, ['worm', request.params.id], async () => {
        const rows = await matchesRepo.getWorm(sql, request.params.id);
        return {
          data: rows.map((r) => ({
            inningsNo: r.innings_no,
            ballNumber: int(r.ball_number),
            overs: oversText(int(r.ball_number)),
            runs: int(r.runs),
            wickets: int(r.wickets),
          })),
        };
      }, { maxAge: 300 });
    },
  );

  app.get(
    '/v1/matches/:id/manhattan',
    {
      schema: {
        tags: ['matches'],
        summary: 'Runs and wickets per over (manhattan chart)',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: collection(ManhattanBar), 404: Problem },
      },
    },
    async (request, reply) => {
      const match = await matchesRepo.findMatch(sql, request.params.id);
      if (match === null) throw ApiError.notFound('match', request.params.id);
      await cached(request, reply, ['manhattan', request.params.id], async () => {
        const rows = await matchesRepo.getManhattan(sql, request.params.id);
        return {
          data: rows.map((r) => ({
            inningsNo: r.innings_no,
            over: r.over_no + 1,
            runs: int(r.runs),
            wickets: int(r.wickets),
          })),
        };
      }, { maxAge: 300 });
    },
  );

  app.get(
    '/v1/matches/:id/partnerships',
    {
      schema: {
        tags: ['matches'],
        summary: 'Partnerships by wicket',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: {
          200: collection(PartnershipLine.extend({ inningsNo: z.number().int() })),
          404: Problem,
        },
      },
    },
    async (request) => {
      const detail = await matchesRepo.getMatchDetail(sql, request.params.id);
      if (detail === null) throw ApiError.notFound('match', request.params.id);
      return {
        data: detail.innings.flatMap((i) =>
          i.partnerships.map((p) => ({ ...p, inningsNo: i.inningsNo })),
        ),
      };
    },
  );

  // ── Players ─────────────────────────────────────────────────────────────

  app.get(
    '/v1/players',
    {
      schema: {
        tags: ['players'],
        summary: 'Search players',
        querystring: PlayerListQuery,
        response: { 200: paginated(PlayerSummary), 422: Problem },
      },
    },
    async (request) => {
      if (request.query.cursor !== undefined && decodeCursor(request.query.cursor) === null) {
        throw ApiError.invalidCursor();
      }
      const rows = await playersRepo.listPlayers(sql, request.query);
      const page = toPage(rows, request.query.limit, (r) => ({
        k: r.sort_name,
        id: r.player_id,
      }));
      return { data: page.data.map(toPlayerSummary), page: page.page };
    },
  );

  app.get(
    '/v1/players/:id',
    {
      schema: {
        tags: ['players'],
        summary: 'Get a player',
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: Player, 404: Problem },
      },
    },
    async (request) => {
      const player = await playersRepo.findPlayer(sql, request.params.id);
      if (player === null) throw ApiError.notFound('player', request.params.id);
      return player;
    },
  );

  app.get(
    '/v1/players/:id/batting',
    {
      schema: {
        tags: ['players'],
        summary: 'Batting record',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: PlayerStatsQuery,
        response: { 200: BattingCareer, 404: Problem },
      },
    },
    async (request) => {
      const seasonId =
        request.query.season === undefined ? null : await seasonIdOrThrow(request.query.season);
      const career = await playersRepo.getBattingCareer(sql, request.params.id, seasonId);
      if (career === null) throw ApiError.notFound('batting record for player', request.params.id);
      return career;
    },
  );

  app.get(
    '/v1/players/:id/bowling',
    {
      schema: {
        tags: ['players'],
        summary: 'Bowling record',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: PlayerStatsQuery,
        response: { 200: BowlingCareer, 404: Problem },
      },
    },
    async (request) => {
      const seasonId =
        request.query.season === undefined ? null : await seasonIdOrThrow(request.query.season);
      const career = await playersRepo.getBowlingCareer(sql, request.params.id, seasonId);
      if (career === null) throw ApiError.notFound('bowling record for player', request.params.id);
      return career;
    },
  );

  app.get(
    '/v1/players/:id/phase-splits',
    {
      schema: {
        tags: ['players'],
        summary: 'Powerplay / middle / death splits',
        description:
          'Overs 1–6, 7–15 and 16–20. Answers the question every T20 discussion turns into: is this a death bowler?',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: PlayerStatsQuery,
        response: { 200: collection(PhaseSplit), 404: Problem },
      },
    },
    async (request) => {
      const seasonId =
        request.query.season === undefined ? null : await seasonIdOrThrow(request.query.season);
      const player = await playersRepo.findPlayer(sql, request.params.id);
      if (player === null) throw ApiError.notFound('player', request.params.id);
      return { data: await playersRepo.getPhaseSplits(sql, request.params.id, seasonId) };
    },
  );

  app.get(
    '/v1/players/:id/form',
    {
      schema: {
        tags: ['players'],
        summary: 'Recent form',
        params: z.object({ id: z.coerce.number().int().positive() }),
        querystring: z.object({ last: z.coerce.number().int().min(1).max(20).default(5) }),
        response: { 200: collection(FormEntry), 404: Problem },
      },
    },
    async (request) => {
      const player = await playersRepo.findPlayer(sql, request.params.id);
      if (player === null) throw ApiError.notFound('player', request.params.id);
      const rows = await playersRepo.getForm(sql, request.params.id, request.query.last);
      return {
        data: rows.map((r) => ({
          match: { id: r.match_id, shortTitle: r.short_title, matchDate: r.match_date },
          opponent: {
            id: r.opp_id,
            name: r.opp_name,
            shortName: r.opp_short,
            country: r.opp_country,
            logoUrl: r.opp_logo,
          },
          runs: r.runs,
          ballsFaced: r.balls_faced,
          wickets: r.wickets,
          runsConceded: r.runs_conceded,
          ballsBowled: r.balls_bowled,
        })),
      };
    },
  );

  // ── Analytics ───────────────────────────────────────────────────────────

  app.get(
    '/v1/analytics/compare',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Compare two players',
        querystring: CompareQuery,
        response: {
          200: z.object({
            a: z.object({
              player: PlayerSummary,
              batting: BattingCareer.nullable(),
              bowling: BowlingCareer.nullable(),
              phases: z.array(PhaseSplit),
            }),
            b: z.object({
              player: PlayerSummary,
              batting: BattingCareer.nullable(),
              bowling: BowlingCareer.nullable(),
              phases: z.array(PhaseSplit),
            }),
          }),
          404: Problem,
          422: Problem,
        },
      },
    },
    async (request) => {
      const { playerA, playerB, season } = request.query;
      if (playerA === playerB) throw ApiError.badRequest('Pick two different players to compare');
      const seasonId = season === undefined ? null : await seasonIdOrThrow(season);

      const load = async (id: number) => {
        const player = await playersRepo.findPlayer(sql, id);
        if (player === null) throw ApiError.notFound('player', id);
        const [batting, bowling, phases] = await Promise.all([
          playersRepo.getBattingCareer(sql, id, seasonId),
          playersRepo.getBowlingCareer(sql, id, seasonId),
          playersRepo.getPhaseSplits(sql, id, seasonId),
        ]);
        const { teams: _teams, birthdate: _b, birthplace: _p, nationality: _n, ...summary } = player;
        return { player: summary, batting, bowling, phases };
      };

      const [a, b] = await Promise.all([load(playerA), load(playerB)]);
      return { a, b };
    },
  );

  app.get(
    '/v1/analytics/venues',
    {
      schema: {
        tags: ['analytics'],
        summary: 'All venue profiles for a season',
        querystring: z.object({ season: SeasonYear }),
        response: { 200: collection(VenueProfile), 404: Problem },
      },
    },
    async (request, reply) => {
      const seasonId = await seasonIdOrThrow(request.query.season);
      await cached(request, reply, ['venue-profiles', request.query.season], async () => ({
        data: await refRepo.getVenueProfiles(sql, seasonId),
      }));
    },
  );

  app.get(
    '/v1/analytics/head-to-head',
    {
      schema: {
        tags: ['analytics'],
        summary: 'Full head-to-head matrix for a season',
        querystring: z.object({ season: SeasonYear }),
        response: {
          200: collection(
            z.object({
              teamId: z.number().int(),
              opponentId: z.number().int(),
              played: z.number().int(),
              won: z.number().int(),
              lost: z.number().int(),
              noResult: z.number().int(),
              winPercentage: z.number().nullable(),
            }),
          ),
          404: Problem,
        },
      },
    },
    async (request, reply) => {
      const seasonId = await seasonIdOrThrow(request.query.season);
      await cached(request, reply, ['h2h-matrix', request.query.season], async () => {
        const rows = await refRepo.getHeadToHeadMatrix(sql, seasonId);
        return {
          data: rows.map((r) => ({
            teamId: r.team_id,
            opponentId: r.opponent_id,
            played: r.played,
            won: r.won,
            lost: r.lost,
            noResult: r.no_result,
            winPercentage: r.win_percentage === null ? null : Number(r.win_percentage),
          })),
        };
      });
    },
  );
}

export { encodeCursor };
