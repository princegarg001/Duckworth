import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, toPage } from '../cursor.js';

/**
 * The keyset-pagination codec. Every list endpoint in the API depends on
 * `toPage`'s limit+1 slicing being exactly right — get the boundary wrong and
 * a client either loses the last row of a page or loops forever believing
 * there is always one more.
 */

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a numeric key', () => {
    const cursor = encodeCursor({ k: 42, id: 7 });
    expect(decodeCursor(cursor)).toEqual({ k: 42, id: 7 });
  });

  it('round-trips a string key', () => {
    const cursor = encodeCursor({ k: '2022-05-29', id: 54732 });
    expect(decodeCursor(cursor)).toEqual({ k: '2022-05-29', id: 54732 });
  });

  it('produces a URL-safe token with no padding characters', () => {
    const cursor = encodeCursor({ k: 'Jos Buttler', id: 863 });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('is opaque: two different payloads never collide', () => {
    const a = encodeCursor({ k: 1, id: 1 });
    const b = encodeCursor({ k: 1, id: 2 });
    expect(a).not.toBe(b);
  });
});

describe('decodeCursor — malformed input', () => {
  it('returns null for undefined and empty string rather than throwing', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a string that is not valid base64url', () => {
    expect(decodeCursor('not!!valid!!base64')).toBeNull();
  });

  it('returns null for valid base64 that decodes to non-JSON', () => {
    const garbage = Buffer.from('this is not json', 'utf8').toString('base64url');
    expect(decodeCursor(garbage)).toBeNull();
  });

  it('returns null for valid JSON that does not match the cursor shape', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expect(decodeCursor(wrongShape)).toBeNull();
  });

  it('returns null when a required field is missing', () => {
    const missingId = Buffer.from(JSON.stringify({ k: 1 }), 'utf8').toString('base64url');
    expect(decodeCursor(missingId)).toBeNull();
  });

  it('never throws — a route can call it directly on unsanitised query input', () => {
    for (const bad of ['{{{', 'null', '[]', '12345', '<script>alert(1)</script>']) {
      expect(() => decodeCursor(Buffer.from(bad).toString('base64url'))).not.toThrow();
    }
  });
});

describe('toPage', () => {
  const makeCursor = (n: number) => ({ k: n, id: n });

  it('reports hasMore=false and no nextCursor when fewer rows than the limit come back', () => {
    const page = toPage([1, 2, 3], 5, makeCursor);
    expect(page.data).toEqual([1, 2, 3]);
    expect(page.page).toEqual({ limit: 5, hasMore: false, nextCursor: null });
  });

  it('reports hasMore=false when exactly `limit` rows come back — no phantom next page', () => {
    const page = toPage([1, 2, 3], 3, makeCursor);
    expect(page.data).toEqual([1, 2, 3]);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });

  it('detects more rows and trims the sentinel: fetching limit+1 and getting it back means there IS a next page', () => {
    const page = toPage([1, 2, 3, 4], 3, makeCursor);
    expect(page.data).toEqual([1, 2, 3]); // the 4th row is discarded, not returned
    expect(page.page.hasMore).toBe(true);
  });

  it('builds the next cursor from the LAST row actually returned, not the discarded sentinel', () => {
    const page = toPage([1, 2, 3, 4], 3, makeCursor);
    expect(page.page.nextCursor).toBe(encodeCursor(makeCursor(3)));
    expect(page.page.nextCursor).not.toBe(encodeCursor(makeCursor(4)));
  });

  it('handles an empty page', () => {
    const page = toPage([], 10, makeCursor);
    expect(page.data).toEqual([]);
    expect(page.page).toEqual({ limit: 10, hasMore: false, nextCursor: null });
  });

  it('handles limit=1', () => {
    const page = toPage([1, 2], 1, makeCursor);
    expect(page.data).toEqual([1]);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).toBe(encodeCursor(makeCursor(1)));
  });
});
