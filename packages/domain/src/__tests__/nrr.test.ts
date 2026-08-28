/**
 * NRR and points-table validation against the *published* IPL 2022 standings.
 *
 * The fixtures are two independent things:
 *
 *   `ipl-2022-innings.json`   — derived from ball-by-ball commentary
 *   `ipl-2022-standings.json` — the official table shipped with the dataset
 *
 * Nothing in this test compares our output to our own output. If the phase
 * logic, the all-out rule, the retired-hurt exclusion or the league-stage
 * filter is wrong, the numbers stop matching the real tournament.
 */

import { describe, expect, it } from 'vitest';
import { buildPointsTable, type TeamMatchResult } from '../points-table.js';
import { chargeableBalls, computeNetRunRates, type InningsLine } from '../nrr.js';
import { ballsToOvers } from '../overs.js';
import { parseMatchStage } from '../stage.js';
import { round } from '../metrics.js';

import innings from './fixtures/ipl-2022-innings.json' with { type: 'json' };
import results from './fixtures/ipl-2022-results.json' with { type: 'json' };
import standings from './fixtures/ipl-2022-standings.json' with { type: 'json' };

const leagueInnings: InningsLine[] = innings
  .filter((i) => parseMatchStage(i.subtitle) === 'league')
  .map((i) => ({
    battingTeamId: i.battingTeamId,
    bowlingTeamId: i.bowlingTeamId,
    runs: i.runs,
    legalBalls: i.legalBalls,
    wicketsLost: i.wicketsLost,
    allottedOvers: i.allottedOvers,
  }));

const leagueResults: TeamMatchResult[] = results
  .filter((r) => parseMatchStage(r.subtitle) === 'league')
  .flatMap((r) => {
    const outcome = (teamId: number) =>
      r.winnerId === null ? ('no_result' as const) : r.winnerId === teamId ? 'win' : 'loss';
    return [
      { teamId: r.teamAId, opponentId: r.teamBId, outcome: outcome(r.teamAId) },
      { teamId: r.teamBId, opponentId: r.teamAId, outcome: outcome(r.teamBId) },
    ];
  });

describe('chargeableBalls — the all-out rule', () => {
  const base: InningsLine = {
    battingTeamId: 1,
    bowlingTeamId: 2,
    runs: 100,
    legalBalls: 86,
    wicketsLost: 4,
    allottedOvers: 20,
  };

  it('charges the balls actually faced when the side is not bowled out', () => {
    expect(chargeableBalls(base)).toBe(86);
  });

  it('charges the full quota when the side is bowled out early', () => {
    // Bowled out in 14.2 overs: charged 20 overs, not 14.2. Otherwise taking
    // the tenth wicket would make the bowling side's NRR worse.
    expect(chargeableBalls({ ...base, legalBalls: 86, wicketsLost: 10 })).toBe(120);
  });

  it('does not shorten a full-quota innings that also ended all out', () => {
    expect(chargeableBalls({ ...base, legalBalls: 120, wicketsLost: 10 })).toBe(120);
  });
});

describe('IPL 2022 league standings', () => {
  const computed = computeNetRunRates(leagueInnings);

  it('covers exactly the ten franchises', () => {
    expect(computed.size).toBe(10);
  });

  it.each(standings)(
    'reproduces $abbr run and over subtotals from ball-by-ball',
    ({ teamId, runsFor, runsAgainst, oversFor, oversAgainst }) => {
      const c = computed.get(teamId);
      expect(c, `no computed row for team ${teamId}`).toBeDefined();
      expect(c!.runsFor).toBe(runsFor);
      expect(c!.runsAgainst).toBe(runsAgainst);
      // The source drops a trailing ".0"; compare numerically in over notation.
      expect(Number(ballsToOvers(c!.ballsFor))).toBe(Number(oversFor));
      expect(Number(ballsToOvers(c!.ballsAgainst))).toBe(Number(oversAgainst));
    },
  );

  it.each(standings)('reproduces $abbr net run rate to 3dp', ({ teamId, netRunRate }) => {
    expect(round(computed.get(teamId)!.netRunRate, 3)).toBe(netRunRate);
  });

  it('excludes playoffs — including them breaks every qualifier', () => {
    const all = computeNetRunRates(
      innings.map((i) => ({
        battingTeamId: i.battingTeamId,
        bowlingTeamId: i.bowlingTeamId,
        runs: i.runs,
        legalBalls: i.legalBalls,
        wicketsLost: i.wicketsLost,
        allottedOvers: i.allottedOvers,
      })),
    );
    const gt = standings.find((s) => s.abbr === 'GT')!;
    expect(round(all.get(gt.teamId)!.netRunRate, 3)).not.toBe(gt.netRunRate);
  });
});

describe('buildPointsTable', () => {
  const table = buildPointsTable(leagueResults, leagueInnings);

  it('produces the published finishing order', () => {
    expect(table.map((r) => r.teamId)).toEqual(standings.map((s) => s.teamId));
  });

  it.each(standings)(
    'matches $abbr on played/won/lost/points',
    ({ teamId, played, won, lost, points }) => {
      const row = table.find((r) => r.teamId === teamId)!;
      expect({
        played: row.played,
        won: row.won,
        lost: row.lost,
        points: row.points,
      }).toEqual({ played, won, lost, points });
    },
  );

  it('every side plays 14 league matches', () => {
    expect(table.every((r) => r.played === 14)).toBe(true);
    expect(table.reduce((n, r) => n + r.played, 0)).toBe(140);
  });

  it('separates equal-points sides on net run rate', () => {
    // KKR and SRH both finish on 12; KKR is placed above on NRR alone.
    const kkr = table.find((r) => r.teamId === standings.find((s) => s.abbr === 'KKR')!.teamId)!;
    const srh = table.find((r) => r.teamId === standings.find((s) => s.abbr === 'SRH')!.teamId)!;
    expect(kkr.points).toBe(srh.points);
    expect(kkr.position).toBeLessThan(srh.position);
    expect(kkr.netRunRate).toBeGreaterThan(srh.netRunRate);
  });

  it('awards 2 points per win across the whole league stage', () => {
    const totalPoints = table.reduce((n, r) => n + r.points, 0);
    const totalWins = table.reduce((n, r) => n + r.won, 0);
    expect(totalWins).toBe(70);
    expect(totalPoints).toBe(140);
  });
});
