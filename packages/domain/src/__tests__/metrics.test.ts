import { describe, expect, it } from 'vitest';
import {
  battingAverage,
  bowlingAverage,
  bowlingStrikeRate,
  economyRate,
  round,
  runRate,
  strikeRate,
} from '../metrics.js';
import { phaseForOver, overLabel } from '../phase.js';

describe('strikeRate', () => {
  it('is runs per 100 balls', () => {
    expect(strikeRate(50, 40)).toBe(125);
    expect(round(strikeRate(41, 33), 2)).toBe(124.24);
  });

  it('is null — not Infinity — for a batter who faced no ball', () => {
    // A non-striker run out without facing has no strike rate. Infinity here
    // sorts to the top of every "best strike rate" leaderboard.
    expect(strikeRate(0, 0)).toBeNull();
    expect(strikeRate(1, 0)).toBeNull();
  });

  it('is zero for a duck off real balls, which is different from null', () => {
    expect(strikeRate(0, 7)).toBe(0);
  });
});

describe('battingAverage', () => {
  it('is runs per dismissal', () => {
    expect(battingAverage(278, 10)).toBe(27.8);
  });

  it('is null for a batter never dismissed', () => {
    expect(battingAverage(120, 0)).toBeNull();
  });
});

describe('economyRate', () => {
  it('divides by overs derived from balls, not by the over notation', () => {
    // 2.4 overs is 16 balls. Dividing 28 by 2.4 gives 11.67 — wrong by 6%.
    expect(round(economyRate(28, 16), 2)).toBe(10.5);
    expect(round(economyRate(28, 16), 2)).not.toBe(11.67);
  });

  it('matches a published figure: 4 overs for 23 is 5.75', () => {
    expect(economyRate(23, 24)).toBe(5.75);
  });

  it('is null before a ball is bowled', () => {
    expect(economyRate(0, 0)).toBeNull();
  });
});

describe('bowling averages and strike rates', () => {
  it('are null with no wickets rather than infinite', () => {
    expect(bowlingAverage(40, 0)).toBeNull();
    expect(bowlingStrikeRate(24, 0)).toBeNull();
  });

  it('compute normally with wickets', () => {
    expect(bowlingAverage(40, 2)).toBe(20);
    expect(bowlingStrikeRate(24, 2)).toBe(12);
  });
});

describe('runRate', () => {
  it('is runs per over from a ball count', () => {
    expect(runRate(208, 120)).toBeCloseTo(10.4, 5);
  });
});

describe('round', () => {
  it('passes null through', () => {
    expect(round(null, 2)).toBeNull();
  });

  it('drops non-finite values to null', () => {
    expect(round(Number.POSITIVE_INFINITY, 2)).toBeNull();
    expect(round(Number.NaN, 2)).toBeNull();
  });

  it('rounds to the requested precision', () => {
    expect(round(0.31649, 3)).toBe(0.316);
    expect(round(-0.2531, 3)).toBe(-0.253);
  });
});

describe('phaseForOver', () => {
  it('splits a T20 innings into powerplay / middle / death on 0-indexed overs', () => {
    expect([0, 1, 2, 3, 4, 5].map(phaseForOver)).toEqual(Array(6).fill('powerplay'));
    expect([6, 10, 14].map(phaseForOver)).toEqual(['middle', 'middle', 'middle']);
    expect([15, 18, 19].map(phaseForOver)).toEqual(['death', 'death', 'death']);
  });

  it('clamps out-of-range overs into death rather than throwing', () => {
    expect(phaseForOver(20)).toBe('death');
  });
});

describe('overLabel', () => {
  it('presents 0-indexed over 0 as the 1st over', () => {
    expect(overLabel(0)).toBe(1);
    expect(overLabel(19)).toBe(20);
  });
});
