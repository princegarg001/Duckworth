import { describe, expect, it } from 'vitest';

import { deriveResult, disagreesWithNote } from '../result.js';
import { parseMatchStage } from '../stage.js';
import results from './fixtures/ipl-2022-results.json' with { type: 'json' };
import innings from './fixtures/ipl-2022-innings.json' with { type: 'json' };

/**
 * The margin kind is derived from cricket, not from the source's `result_type`
 * field — which contradicts its own prose in 49 of this season's 74 matches.
 *
 * These tests assert the derivation against the prose for every match in the
 * dataset, which is the evidence the decision rests on.
 */

/** First-innings batting team per match, from the fixture. */
const firstInningsBatting = new Map<number, number>();
for (const i of innings) {
  if (i.inningsNo === 1) firstInningsBatting.set(i.matchId, i.battingTeamId);
}

describe('deriveResult', () => {
  it('a side that bats first and wins, wins by runs', () => {
    expect(
      deriveResult({
        winnerTeamId: 610,
        firstInningsBattingTeamId: 610,
        winMargin: '91 runs',
      }),
    ).toEqual({ kind: 'runs', margin: 91 });
  });

  it('a side that chases and wins, wins by wickets', () => {
    expect(
      deriveResult({
        winnerTeamId: 591,
        firstInningsBattingTeamId: 610,
        winMargin: '6 wickets',
      }),
    ).toEqual({ kind: 'wickets', margin: 6 });
  });

  it('recovers the margin from the prose when win_margin is empty', () => {
    // 11 of 74 matches ship an empty win_margin.
    expect(
      deriveResult({
        winnerTeamId: 646,
        firstInningsBattingTeamId: 646,
        winMargin: '',
        statusNote: 'Royal Challengers Bangalore won by 16 runs.',
      }),
    ).toEqual({ kind: 'runs', margin: 16 });
  });

  it('prefers win_margin over the prose when both are present', () => {
    expect(
      deriveResult({
        winnerTeamId: 1,
        firstInningsBattingTeamId: 1,
        winMargin: '7 runs',
        statusNote: 'Team A won by 7 runs',
      }).margin,
    ).toBe(7);
  });

  it('does not read a digit in a team name as the margin', () => {
    expect(
      deriveResult({
        winnerTeamId: 1,
        firstInningsBattingTeamId: 1,
        winMargin: null,
        statusNote: 'Team 7 won by 3 wickets',
      }).margin,
    ).toBe(3);
  });

  it('reports a no result when there is no winner', () => {
    expect(
      deriveResult({ winnerTeamId: null, firstInningsBattingTeamId: 610 }),
    ).toEqual({ kind: 'no_result', margin: null });
  });

  it('reports a tie when the scores were level', () => {
    expect(
      deriveResult({ winnerTeamId: 610, firstInningsBattingTeamId: 610, tied: true }),
    ).toEqual({ kind: 'tie', margin: null });
  });

  it('leaves the margin null when neither source carries one', () => {
    expect(
      deriveResult({ winnerTeamId: 1, firstInningsBattingTeamId: 1, winMargin: '' }).margin,
    ).toBeNull();
  });

  // ── The evidence for ADR 0004 ──────────────────────────────────────────
  it('agrees with the source prose on all 74 matches of the season', () => {
    const disagreements: string[] = [];

    for (const r of results) {
      const battedFirst = firstInningsBatting.get(r.matchId);
      expect(battedFirst, `no first innings for match ${r.matchId}`).toBeDefined();

      const derived = deriveResult({
        winnerTeamId: r.winnerId,
        firstInningsBattingTeamId: battedFirst!,
        statusNote: r.statusNote,
      });

      const problem = disagreesWithNote(derived, r.statusNote);
      if (problem !== null) disagreements.push(`${r.matchId}: ${problem}`);
    }

    expect(disagreements).toEqual([]);
    expect(results).toHaveLength(74);
  });

  it('covers every match in the season, playoffs included', () => {
    const stages = results.map((r) => parseMatchStage(r.subtitle));
    expect(stages.filter((s) => s === 'league')).toHaveLength(70);
    expect(stages.filter((s) => s !== 'league')).toHaveLength(4);
  });
});

describe('disagreesWithNote', () => {
  it('flags a kind that contradicts the prose', () => {
    expect(
      disagreesWithNote({ kind: 'wickets', margin: 16 }, 'RCB won by 16 runs.'),
    ).toMatch(/derived "wickets"/);
  });

  it('flags a margin that contradicts the prose', () => {
    expect(
      disagreesWithNote({ kind: 'runs', margin: 5 }, 'RCB won by 16 runs.'),
    ).toMatch(/derived margin 5/);
  });

  it('is silent when they agree', () => {
    expect(disagreesWithNote({ kind: 'runs', margin: 16 }, 'RCB won by 16 runs.')).toBeNull();
  });

  it('is silent when there is nothing to compare against', () => {
    expect(disagreesWithNote({ kind: 'runs', margin: 16 }, null)).toBeNull();
    expect(disagreesWithNote({ kind: 'runs', margin: 16 }, 'Match abandoned')).toBeNull();
  });
});
