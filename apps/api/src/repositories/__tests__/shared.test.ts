import { describe, expect, it } from 'vitest';

import { int, num, oversText, toPlayerSummary, toTeam } from '../shared.js';

/**
 * Every repository in this API funnels its numeric output through these three
 * helpers before it reaches a response. They are the one piece of `apps/api`
 * that is pure enough to unit test without a database — the rest of the
 * repository layer is exercised against real Postgres in the integration
 * suite, where the SQL itself is what needs proving.
 */

describe('oversText', () => {
  it('reads cricket over notation as base-6, matching packages/domain/overs.ts', () => {
    expect(oversText(106)).toBe('17.4');
    expect(oversText(0)).toBe('0.0');
    expect(oversText(120)).toBe('20.0');
  });

  it('rolls over at 6 balls, never producing a ".6"', () => {
    expect(oversText(6)).toBe('1.0');
    expect(oversText(119)).toBe('19.5');
  });
});

describe('num', () => {
  it('parses a Postgres numeric string', () => {
    expect(num('0.316')).toBe(0.316);
    expect(num('-0.506')).toBe(-0.506);
  });

  it('passes a plain number through unchanged', () => {
    expect(num(42)).toBe(42);
  });

  it('is null for null and undefined, not zero — a missing average is not a zero average', () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it('is null for a non-numeric string rather than NaN', () => {
    expect(num('not-a-number')).toBeNull();
    expect(Number.isNaN(num('not-a-number'))).toBe(false);
  });
});

describe('int', () => {
  it('parses a Postgres bigint/count string', () => {
    expect(int('17912')).toBe(17_912);
  });

  it('passes a plain number through unchanged', () => {
    expect(int(74)).toBe(74);
  });

  it('defaults to 0 for null and undefined — a count that was never taken is zero', () => {
    expect(int(null)).toBe(0);
    expect(int(undefined)).toBe(0);
  });
});

describe('toPlayerSummary', () => {
  it('maps a snake_case row to the camelCase API shape', () => {
    const row = {
      player_id: 105,
      full_name: 'Jos Buttler',
      short_name: 'J Buttler',
      country_code: 'gb',
      playing_role: 'bat',
      batting_style: 'Right Hand Bat',
      bowling_style: null,
    };
    expect(toPlayerSummary(row)).toEqual({
      id: 105,
      fullName: 'Jos Buttler',
      shortName: 'J Buttler',
      country: 'gb',
      playingRole: 'bat',
      battingStyle: 'Right Hand Bat',
      bowlingStyle: null,
    });
  });
});

describe('toTeam', () => {
  it('maps a snake_case team row to the camelCase API shape', () => {
    const row = {
      team_id: 610,
      team_name: 'Chennai Super Kings',
      team_short_name: 'CSK',
      team_country: 'India',
      team_logo_url: null,
    };
    expect(toTeam(row)).toEqual({
      id: 610,
      name: 'Chennai Super Kings',
      shortName: 'CSK',
      country: 'India',
      logoUrl: null,
    });
  });
});
