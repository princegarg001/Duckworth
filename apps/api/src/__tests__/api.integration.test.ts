import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { json, startHarness, type Harness } from './helpers/harness.js';

/**
 * End-to-end integration tests.
 *
 * These assert **correct cricket**, not merely HTTP 200. A test that only
 * checks a status code passes just as happily against a scorecard with the
 * wrong wickets in it.
 */

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const get = (url: string, headers?: Record<string, string>) =>
  h.ctx.app.inject({ method: 'GET', url, ...(headers === undefined ? {} : { headers }) });

describe('health', () => {
  it('liveness does not touch any dependency', async () => {
    const res = await get('/health/live');
    expect(res.statusCode).toBe(200);
    expect(json<{ status: string }>(res).status).toBe('ok');
  });

  it('readiness reports substance, not just ok', async () => {
    const body = json<{
      status: string;
      checks: Record<string, { status: string }>;
    }>(await get('/health/ready'));

    expect(body.status).toBe('ok');
    expect(body.checks.database?.status).toBe('ok');
    expect(body.checks.migrations?.status).toBe('ok');
    expect(body.checks.martFreshness?.status).toBe('ok');
    // The ingest ran its full contract; readiness must see zero failures.
    expect(body.checks.dataQuality?.status).toBe('ok');
  });

  it('never caches readiness', async () => {
    const res = await get('/health/ready');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('points table', () => {
  it('reproduces the published IPL 2022 standings', async () => {
    const body = json<{
      data: {
        position: number;
        team: { shortName: string };
        played: number;
        won: number;
        lost: number;
        points: number;
        netRunRate: number;
      }[];
    }>(await get('/v1/seasons/2022/points-table'));

    expect(body.data).toHaveLength(10);

    // The real table, in order, with net run rate to three decimals.
    expect(
      body.data.map((r) => [r.team.shortName, r.played, r.won, r.lost, r.points, r.netRunRate]),
    ).toEqual([
      ['GT', 14, 10, 4, 20, 0.316],
      ['RR', 14, 9, 5, 18, 0.298],
      ['LSG', 14, 9, 5, 18, 0.251],
      ['RCB', 14, 8, 6, 16, -0.253],
      ['DC', 14, 7, 7, 14, 0.204],
      ['PBKS', 14, 7, 7, 14, 0.126],
      ['KKR', 14, 6, 8, 12, 0.146],
      ['SRH', 14, 6, 8, 12, -0.379],
      ['CSK', 14, 4, 10, 8, -0.203],
      ['MI', 14, 4, 10, 8, -0.506],
    ]);
  });

  it('404s for a season that was not ingested', async () => {
    const res = await get('/v1/seasons/2019/points-table');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('leaderboards', () => {
  it('names the Orange and Purple cap winners', async () => {
    const runs = json<{ data: { player: { fullName: string }; value: number }[] }>(
      await get('/v1/seasons/2022/leaders?metric=runs&limit=1'),
    );
    expect(runs.data[0]?.player.fullName).toBe('Jos Buttler');
    expect(runs.data[0]?.value).toBe(863);

    const wickets = json<{ data: { player: { fullName: string }; value: number }[] }>(
      await get('/v1/seasons/2022/leaders?metric=wickets&limit=1'),
    );
    expect(wickets.data[0]?.player.fullName).toBe('Yuzvendra Chahal');
    expect(wickets.data[0]?.value).toBe(27);
  });

  it('applies a qualification floor to rate metrics', async () => {
    const body = json<{ data: { support: number }[] }>(
      await get('/v1/seasons/2022/leaders?metric=strike_rate&limit=10'),
    );
    // Without a floor this list is topped by someone who faced two balls.
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((r) => r.support >= 200)).toBe(true);
  });

  it('rejects an unknown metric with a 422 naming the field', async () => {
    const res = await get('/v1/seasons/2022/leaders?metric=vibes');
    expect(res.statusCode).toBe(422);
    const body = json<{ errors: { path: string }[] }>(res, 422);
    expect(body.errors[0]?.path).toContain('metric');
  });
});

describe('matches', () => {
  it('paginates by cursor without repeating or skipping a row', async () => {
    const first = json<{
      data: { id: number }[];
      page: { nextCursor: string | null; hasMore: boolean };
    }>(await get('/v1/matches?limit=10'));

    expect(first.data).toHaveLength(10);
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).not.toBeNull();

    const second = json<{ data: { id: number }[] }>(
      await get(`/v1/matches?limit=10&cursor=${encodeURIComponent(first.page.nextCursor!)}`),
    );

    const firstIds = new Set(first.data.map((m) => m.id));
    expect(second.data.some((m) => firstIds.has(m.id))).toBe(false);
  });

  it('walks the whole season in pages and finds all 74 matches exactly once', async () => {
    const seen = new Set<number>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const url: string =
        cursor === null
          ? '/v1/matches?limit=25'
          : `/v1/matches?limit=25&cursor=${encodeURIComponent(cursor)}`;
      const body = json<{ data: { id: number }[]; page: { nextCursor: string | null } }>(
        await get(url),
      );
      for (const m of body.data) seen.add(m.id);
      cursor = body.page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen.size).toBe(74);
  });

  it('rejects a malformed cursor rather than silently starting over', async () => {
    const res = await get('/v1/matches?cursor=not-a-real-cursor');
    expect(res.statusCode).toBe(422);
  });

  it('filters by team, and every result involves that team', async () => {
    const body = json<{
      data: { teamA: { team: { id: number } }; teamB: { team: { id: number } } }[];
    }>(await get('/v1/matches?teamId=610&limit=50'));

    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((m) => m.teamA.team.id === 610 || m.teamB.team.id === 610)).toBe(true);
  });
});

describe('scorecard', () => {
  it('serves an internally consistent scorecard', async () => {
    // Match 1: CSK v KKR, KKR won by 6 wickets.
    const m = json<{
      innings: {
        runs: number;
        wickets: number;
        extras: { total: number };
        batting: { runs: number; ballsFaced: number; isOut: boolean }[];
        bowling: { runsConceded: number; wickets: number; ballsBowled: number }[];
        fallOfWickets: unknown[];
      }[];
    }>(await get('/v1/matches/53327'));

    expect(m.innings).toHaveLength(2);

    for (const inn of m.innings) {
      // Batter runs plus extras must equal the innings total. This is the
      // property that catches a mis-scoped extra or a double-counted ball.
      const batted = inn.batting.reduce((n, b) => n + b.runs, 0);
      expect(batted + inn.extras.total).toBe(inn.runs);

      // Wickets in the fall-of-wickets list must match the innings wickets.
      expect(inn.fallOfWickets).toHaveLength(inn.wickets);

      // Bowler wickets can never exceed the wickets that actually fell —
      // run-outs are not the bowler's.
      const bowlerWickets = inn.bowling.reduce((n, b) => n + b.wickets, 0);
      expect(bowlerWickets).toBeLessThanOrEqual(inn.wickets);

      // A T20 innings is 20 overs; a bowler is capped at 4.
      const ballsBowled = inn.bowling.reduce((n, b) => n + b.ballsBowled, 0);
      expect(ballsBowled).toBeLessThanOrEqual(120);
      expect(inn.bowling.every((b) => b.ballsBowled <= 24)).toBe(true);
    }
  });

  it('404s for a match that does not exist', async () => {
    const res = await get('/v1/matches/999999');
    expect(res.statusCode).toBe(404);
    const body = json<{ type: string; traceId: string }>(res, 404);
    expect(body.type).toContain('not-found');
    expect(body.traceId).toBeTruthy();
  });
});

describe('deliveries', () => {
  it('orders by delivery sequence, which is unique where (over, ball) is not', async () => {
    const body = json<{
      data: { deliverySeq: number; over: number; ballInOver: number; isWide: boolean }[];
    }>(await get('/v1/matches/53327/deliveries?innings=1&limit=100'));

    const seqs = body.data.map((d) => d.deliverySeq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);

    // The dataset has 729 (over, ball) collisions; at least one innings must
    // demonstrate why delivery_seq exists.
    const pairs = body.data.map((d) => `${d.over}.${d.ballInOver}`);
    expect(new Set(pairs).size).toBeLessThan(pairs.length);
  });
});

describe('charts', () => {
  it('worm data increases monotonically within an innings', async () => {
    const body = json<{ data: { inningsNo: number; runs: number; wickets: number }[] }>(
      await get('/v1/matches/53327/worm'),
    );
    for (const inningsNo of [1, 2]) {
      const series = body.data.filter((p) => p.inningsNo === inningsNo);
      expect(series.length).toBeGreaterThan(0);
      for (let i = 1; i < series.length; i += 1) {
        expect(series[i]!.runs).toBeGreaterThanOrEqual(series[i - 1]!.runs);
        expect(series[i]!.wickets).toBeGreaterThanOrEqual(series[i - 1]!.wickets);
      }
    }
  });

  it('manhattan totals equal the innings totals', async () => {
    const bars = json<{ data: { inningsNo: number; runs: number }[] }>(
      await get('/v1/matches/53327/manhattan'),
    );
    const card = json<{ innings: { inningsNo: number; runs: number }[] }>(
      await get('/v1/matches/53327'),
    );
    for (const inn of card.innings) {
      const summed = bars.data
        .filter((b) => b.inningsNo === inn.inningsNo)
        .reduce((n, b) => n + b.runs, 0);
      expect(summed).toBe(inn.runs);
    }
  });
});

describe('caching', () => {
  it('returns a strong ETag and honours If-None-Match', async () => {
    const first = await get('/v1/seasons/2022/points-table');
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();
    expect(first.headers['cache-control']).toContain('stale-while-revalidate');

    const second = await get('/v1/seasons/2022/points-table', {
      'if-none-match': String(etag),
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
  });
});

describe('correlation and errors', () => {
  it('echoes an inbound x-request-id', async () => {
    const res = await get('/health/live', { 'x-request-id': 'abc-123' });
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('returns problem+json for an unmatched route', async () => {
    const res = await get('/v1/nope');
    expect(res.statusCode).toBe(404);
    const body = json<{ type: string; status: number }>(res, 404);
    expect(body.status).toBe(404);
  });

  it('guards internal endpoints', async () => {
    const res = await h.ctx.app.inject({ method: 'POST', url: '/internal/refresh-marts' });
    expect(res.statusCode).toBe(401);

    const ok = await h.ctx.app.inject({
      method: 'POST',
      url: '/internal/refresh-marts',
      headers: { 'x-internal-token': 'test-token-0123456789abcdef' },
    });
    expect(ok.statusCode).toBe(202);
  });
});

describe('players', () => {
  it('serves a career record that matches the season leaderboard', async () => {
    const leaders = json<{ data: { player: { id: number }; value: number }[] }>(
      await get('/v1/seasons/2022/leaders?metric=runs&limit=1'),
    );
    const id = leaders.data[0]!.player.id;

    const batting = json<{ runs: number; innings: number; highestScore: number }>(
      await get(`/v1/players/${id}/batting`),
    );
    expect(batting.runs).toBe(leaders.data[0]!.value);
    expect(batting.highestScore).toBeLessThanOrEqual(batting.runs);
  });

  it('splits a bowler across the three phases', async () => {
    const search = json<{ data: { id: number }[] }>(await get('/v1/players?q=Chahal'));
    const id = search.data[0]!.id;

    const body = json<{
      data: { phase: string; discipline: string; wickets: number; balls: number }[];
    }>(await get(`/v1/players/${id}/phase-splits`));

    const bowling = body.data.filter((r) => r.discipline === 'bowling');
    expect(bowling.map((r) => r.phase).sort()).toEqual(['death', 'middle', 'powerplay']);

    // Phase wickets must sum to the season total; a phase boundary that drops
    // or double-counts a delivery shows up here.
    const career = json<{ wickets: number; ballsBowled: number }>(
      await get(`/v1/players/${id}/bowling`),
    );
    expect(bowling.reduce((n, r) => n + r.wickets, 0)).toBe(career.wickets);
    expect(bowling.reduce((n, r) => n + r.balls, 0)).toBe(career.ballsBowled);
  });
});
