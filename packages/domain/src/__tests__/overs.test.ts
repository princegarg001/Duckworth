import { describe, expect, it } from 'vitest';
import { ballsToDecimalOvers, ballsToOvers, oversToBalls } from '../overs.js';

describe('oversToBalls', () => {
  it('reads cricket over notation as base-6, not decimal', () => {
    expect(oversToBalls('17.4')).toBe(106);
    expect(oversToBalls('0.1')).toBe(1);
    expect(oversToBalls('20')).toBe(120);
    expect(oversToBalls('20.0')).toBe(120);
  });

  it('treats an empty string as zero balls', () => {
    expect(oversToBalls('')).toBe(0);
  });

  it('accepts the numeric form the source JSON sometimes uses', () => {
    expect(oversToBalls(2.4)).toBe(16);
    expect(oversToBalls(3)).toBe(18);
  });

  it('rejects a ball component of 6 or more — that is a completed over', () => {
    expect(() => oversToBalls('17.6')).toThrow(/ball component/i);
    expect(() => oversToBalls('17.9')).toThrow(/ball component/i);
  });

  it('rejects negative and malformed input rather than coercing it', () => {
    expect(() => oversToBalls('-1.2')).toThrow();
    expect(() => oversToBalls('abc')).toThrow();
  });
});

describe('ballsToOvers', () => {
  it('round-trips with oversToBalls', () => {
    for (const o of ['0.0', '0.5', '4.3', '17.4', '19.5', '20.0']) {
      expect(ballsToOvers(oversToBalls(o))).toBe(o.replace(/^(\d+)\.0$/, '$1.0'));
    }
  });

  it('rolls 6 balls into a whole over', () => {
    expect(ballsToOvers(6)).toBe('1.0');
    expect(ballsToOvers(119)).toBe('19.5');
    expect(ballsToOvers(120)).toBe('20.0');
  });
});

describe('ballsToDecimalOvers', () => {
  it('is a true ratio, distinct from the display notation', () => {
    // 106 balls is "17.4" on a scoreboard but 17.667 for rate arithmetic.
    expect(ballsToDecimalOvers(106)).toBeCloseTo(17.6667, 4);
    expect(ballsToOvers(106)).toBe('17.4');
  });
});
