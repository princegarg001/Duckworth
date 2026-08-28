import { describe, expect, it } from 'vitest';
import { countsTowardStandings, parseMatchStage } from '../stage.js';
import { buildPointsTable, type TeamMatchResult } from '../points-table.js';
import type { InningsLine } from '../nrr.js';

describe('parseMatchStage', () => {
  it('accepts both league labellings present in the dataset', () => {
    expect(parseMatchStage('Match 1')).toBe('league');
    expect(parseMatchStage('Match 70')).toBe('league');
    // Two of the 74 fixtures use the ordinal form instead.
    expect(parseMatchStage('21st Match')).toBe('league');
    expect(parseMatchStage('24th Match')).toBe('league');
    expect(parseMatchStage('2nd Match')).toBe('league');
    expect(parseMatchStage('3rd Match')).toBe('league');
  });

  it('identifies the four playoff fixtures', () => {
    expect(parseMatchStage('Qualifier 1')).toBe('qualifier1');
    expect(parseMatchStage('Qualifier 2')).toBe('qualifier2');
    expect(parseMatchStage('Eliminator')).toBe('eliminator');
    expect(parseMatchStage('Final')).toBe('final');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseMatchStage('  qualifier  1 ')).toBe('qualifier1');
  });

  it('refuses an unknown label instead of defaulting to league', () => {
    // Defaulting here would silently pull a playoff into the points table.
    expect(() => parseMatchStage('Super Four Match 3')).toThrow(/unrecognised match subtitle/i);
    expect(() => parseMatchStage('')).toThrow();
    expect(() => parseMatchStage(null)).toThrow();
  });
});

describe('countsTowardStandings', () => {
  it('admits league fixtures only', () => {
    expect(countsTowardStandings('league')).toBe(true);
    for (const s of ['qualifier1', 'qualifier2', 'eliminator', 'final'] as const) {
      expect(countsTowardStandings(s)).toBe(false);
    }
  });
});

describe('buildPointsTable — non-result outcomes', () => {
  const line = (battingTeamId: number, bowlingTeamId: number, runs: number): InningsLine => ({
    battingTeamId,
    bowlingTeamId,
    runs,
    legalBalls: 120,
    wicketsLost: 4,
    allottedOvers: 20,
  });

  it('awards one point each for a tie and for a no result', () => {
    const results: TeamMatchResult[] = [
      { teamId: 1, opponentId: 2, outcome: 'tie' },
      { teamId: 2, opponentId: 1, outcome: 'tie' },
      { teamId: 1, opponentId: 3, outcome: 'no_result' },
      { teamId: 3, opponentId: 1, outcome: 'no_result' },
    ];
    const table = buildPointsTable(results, [line(1, 2, 160), line(2, 1, 160)]);
    const t1 = table.find((r) => r.teamId === 1)!;
    expect(t1.points).toBe(2);
    expect(t1.played).toBe(2);
    expect(t1.tied).toBe(1);
    expect(t1.noResult).toBe(1);
    expect(t1.won).toBe(0);
  });

  it('breaks a points-and-NRR tie on head-to-head wins', () => {
    // Both sides finish on 2 points with identical run/ball totals; team 2 beat
    // team 1 in their meeting, so team 2 must be placed above.
    const results: TeamMatchResult[] = [
      { teamId: 1, opponentId: 2, outcome: 'loss' },
      { teamId: 2, opponentId: 1, outcome: 'win' },
      { teamId: 1, opponentId: 3, outcome: 'win' },
      { teamId: 3, opponentId: 1, outcome: 'loss' },
      { teamId: 2, opponentId: 3, outcome: 'loss' },
      { teamId: 3, opponentId: 2, outcome: 'win' },
    ];
    const table = buildPointsTable(results, []);
    const p1 = table.find((r) => r.teamId === 1)!.position;
    const p2 = table.find((r) => r.teamId === 2)!.position;
    expect(p2).toBeLessThan(p1);
  });

  it('gives a team with no innings a zero net run rate rather than NaN', () => {
    const table = buildPointsTable([{ teamId: 9, opponentId: 8, outcome: 'no_result' }], []);
    expect(table[0]!.netRunRate).toBe(0);
    expect(Number.isNaN(table[0]!.netRunRate)).toBe(false);
  });

  it('assigns contiguous positions starting at 1', () => {
    const results: TeamMatchResult[] = [
      { teamId: 1, opponentId: 2, outcome: 'win' },
      { teamId: 2, opponentId: 1, outcome: 'loss' },
      { teamId: 3, opponentId: 4, outcome: 'win' },
      { teamId: 4, opponentId: 3, outcome: 'loss' },
    ];
    const table = buildPointsTable(results, []);
    expect(table.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });
});
