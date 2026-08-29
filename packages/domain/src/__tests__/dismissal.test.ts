import { describe, expect, it } from 'vitest';
import {
  countsAsWicketLost,
  isBowlerCredited,
  occursOnDelivery,
  parseDismissalKind,
  refineCaught,
} from '../dismissal.js';

describe('parseDismissalKind', () => {
  it('maps every dismissal string present in the dataset', () => {
    // These eight are the complete observed set across all 912 dismissals.
    expect(parseDismissalKind('caught')).toBe('caught');
    expect(parseDismissalKind('bowled')).toBe('bowled');
    expect(parseDismissalKind('lbw')).toBe('lbw');
    expect(parseDismissalKind('stumped')).toBe('stumped');
    expect(parseDismissalKind('runout')).toBe('run_out');
    expect(parseDismissalKind('hitwicket')).toBe('hit_wicket');
    expect(parseDismissalKind('retiredout')).toBe('retired_out');
    expect(parseDismissalKind('retired')).toBe('retired_hurt');
  });

  it('keeps the two retirements distinct', () => {
    // "retired" is retired hurt (batter may return); "retiredout" ends the
    // innings for that batter. Collapsing them corrupts the wicket count.
    expect(parseDismissalKind('retired')).not.toBe(parseDismissalKind('retiredout'));
  });

  it('treats an empty dismissal as not out', () => {
    expect(parseDismissalKind('')).toBeNull();
    expect(parseDismissalKind('   ')).toBeNull();
    expect(parseDismissalKind(null)).toBeNull();
    expect(parseDismissalKind(undefined)).toBeNull();
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parseDismissalKind('  Caught ')).toBe('caught');
    expect(parseDismissalKind('RunOut')).toBe('run_out');
  });

  it('refuses an unknown kind rather than dropping the row', () => {
    expect(() => parseDismissalKind('mankaded')).toThrow(/unrecognised dismissal/i);
  });
});

describe('isBowlerCredited', () => {
  it('credits the bowler for the five wicket-taking modes plus c&b', () => {
    for (const k of [
      'bowled',
      'caught',
      'caught_and_bowled',
      'lbw',
      'stumped',
      'hit_wicket',
    ] as const) {
      expect(isBowlerCredited(k)).toBe(true);
    }
  });

  it('does not credit the bowler for run-outs or retirements', () => {
    for (const k of [
      'run_out',
      'retired_out',
      'retired_hurt',
      'obstructing_the_field',
      'timed_out',
    ] as const) {
      expect(isBowlerCredited(k)).toBe(false);
    }
  });

  it('reconciles with the dataset: 849 of 912 dismissals are bowler wickets', () => {
    // caught 650 (incl. 25 c&b) + bowled 123 + lbw 57 + stumped 18 + hit wicket 1
    const observed = {
      caught: 650,
      bowled: 123,
      lbw: 57,
      stumped: 18,
      hit_wicket: 1,
      run_out: 61,
      retired_out: 1,
      retired_hurt: 1,
    } as const;
    const credited = Object.entries(observed)
      .filter(([k]) => isBowlerCredited(k as never))
      .reduce((n, [, v]) => n + v, 0);
    expect(credited).toBe(849);
    expect(Object.values(observed).reduce((a, b) => a + b, 0)).toBe(912);
  });
});

describe('countsAsWicketLost', () => {
  it('excludes only retired hurt', () => {
    expect(countsAsWicketLost('retired_hurt')).toBe(false);
    expect(countsAsWicketLost('retired_out')).toBe(true);
    expect(countsAsWicketLost('run_out')).toBe(true);
    expect(countsAsWicketLost('caught')).toBe(true);
  });
});

describe('occursOnDelivery', () => {
  it('is false only for retired hurt', () => {
    // Verified: 912 scorecard dismissals vs 911 ball events, the single
    // difference being R Tripathi's retired hurt.
    expect(occursOnDelivery('retired_hurt')).toBe(false);
    expect(occursOnDelivery('retired_out')).toBe(true);
  });
});

describe('refineCaught', () => {
  it('promotes caught to caught-and-bowled when the catcher is the bowler', () => {
    expect(refineCaught('caught', 48436, 48436)).toBe('caught_and_bowled');
  });

  it('leaves an ordinary catch alone', () => {
    expect(refineCaught('caught', 48436, 1098)).toBe('caught');
  });

  it('leaves non-catches alone even if the ids coincide', () => {
    expect(refineCaught('bowled', 123, 123)).toBe('bowled');
    expect(refineCaught('run_out', 123, 123)).toBe('run_out');
  });

  it('handles a missing fielder id', () => {
    expect(refineCaught('caught', 123, null)).toBe('caught');
  });
});
