import { describe, expect, it } from 'vitest';
import { normaliseName, parseReferee, parseUmpires, splitTopLevel } from '../officials.js';

describe('splitTopLevel', () => {
  it('ignores commas nested inside parentheses', () => {
    expect(splitTopLevel('a(1), b(2), c(3, TV)')).toEqual(['a(1)', 'b(2)', 'c(3, TV)']);
  });

  it('handles a string with no parentheses at all', () => {
    expect(splitTopLevel('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty segments from trailing separators', () => {
    expect(splitTopLevel('a, ,b,')).toEqual(['a', 'b']);
  });
});

describe('parseUmpires', () => {
  it('parses the compact form with no space before the bracket', () => {
    const out = parseUmpires('Nitin Menon(India), Rohan Pandit(India), Saiyed Khalid(India, TV)');
    expect(out).toEqual([
      { name: 'Nitin Menon', country: 'India', role: 'field' },
      { name: 'Rohan Pandit', country: 'India', role: 'field' },
      { name: 'Saiyed Khalid', country: 'India', role: 'tv' },
    ]);
  });

  it('parses the spaced form as the same officials', () => {
    const spaced = parseUmpires(
      'Virender Sharma (India), Rohan Pandit (India), Chris Gaffaney (New Zealand, TV)',
    );
    expect(spaced).toEqual([
      { name: 'Virender Sharma', country: 'India', role: 'field' },
      { name: 'Rohan Pandit', country: 'India', role: 'field' },
      { name: 'Chris Gaffaney', country: 'New Zealand', role: 'tv' },
    ]);
  });

  it('never invents a phantom official named "TV)"', () => {
    // A naive `split(',')` yields exactly this bug on all 74 matches.
    const out = parseUmpires('A B(India), C D(India), E F(India, TV)');
    expect(out).toHaveLength(3);
    expect(out.map((o) => o.name)).not.toContain('TV)');
    expect(out.filter((o) => o.role === 'tv')).toHaveLength(1);
  });

  it('resolves the two spellings of one person to one identity key', () => {
    const [a] = parseUmpires('Nitin Menon(India)');
    const [b] = parseUmpires('Nitin  Menon (India)');
    expect(normaliseName(a!.name)).toBe(normaliseName(b!.name));
  });

  it('preserves a multi-word country containing no role token', () => {
    const [o] = parseUmpires('Chris Gaffaney (New Zealand)');
    expect(o).toEqual({ name: 'Chris Gaffaney', country: 'New Zealand', role: 'field' });
  });

  it('returns an empty list for missing input', () => {
    expect(parseUmpires('')).toEqual([]);
    expect(parseUmpires(null)).toEqual([]);
    expect(parseUmpires(undefined)).toEqual([]);
  });

  it('falls back to field role when there is no parenthetical', () => {
    expect(parseUmpires('Solo Umpire')).toEqual([
      { name: 'Solo Umpire', country: null, role: 'field' },
    ]);
  });
});

describe('parseReferee', () => {
  it('parses both observed spacings', () => {
    expect(parseReferee('Javagal Srinath (India)')).toEqual({
      name: 'Javagal Srinath',
      country: 'India',
      role: 'referee',
    });
    expect(parseReferee('Manu Nayyar(India)')).toEqual({
      name: 'Manu Nayyar',
      country: 'India',
      role: 'referee',
    });
  });

  it('returns null for missing input', () => {
    expect(parseReferee('')).toBeNull();
    expect(parseReferee(null)).toBeNull();
  });
});
