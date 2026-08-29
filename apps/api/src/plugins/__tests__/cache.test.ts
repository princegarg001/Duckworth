import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';

import { applyCacheHeaders, isNotModified } from '../cache.js';

/**
 * The ETag/If-None-Match mechanics. These are the two functions responsible
 * for a 304 actually firing, which is the difference between "cached" and
 * "claims to be cached but re-sends the body every time".
 */

function fakeReply() {
  const headers = new Map<string, string>();
  const reply = {
    header: vi.fn((k: string, v: string) => {
      headers.set(k, v);
      return reply;
    }),
  } as unknown as FastifyReply;
  return { reply, headers };
}

describe('applyCacheHeaders', () => {
  it('produces a strong, quoted ETag derived from the body', () => {
    const { reply, headers } = fakeReply();
    const etag = applyCacheHeaders(reply, { a: 1 }, { maxAge: 60 });
    expect(etag).toMatch(/^".+"$/);
    expect(headers.get('etag')).toBe(etag);
  });

  it('is deterministic: the same body produces the same ETag', () => {
    const a = applyCacheHeaders(fakeReply().reply, { points: 20 }, { maxAge: 60 });
    const b = applyCacheHeaders(fakeReply().reply, { points: 20 }, { maxAge: 60 });
    expect(a).toBe(b);
  });

  it('changes when the body changes — a stale cache must not look fresh', () => {
    const a = applyCacheHeaders(fakeReply().reply, { points: 20 }, { maxAge: 60 });
    const b = applyCacheHeaders(fakeReply().reply, { points: 18 }, { maxAge: 60 });
    expect(a).not.toBe(b);
  });

  it('sets Cache-Control with the given max-age and a 5x stale-while-revalidate default', () => {
    const { reply, headers } = fakeReply();
    applyCacheHeaders(reply, {}, { maxAge: 60 });
    expect(headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
  });

  it('honours an explicit stale-while-revalidate override', () => {
    const { reply, headers } = fakeReply();
    applyCacheHeaders(reply, {}, { maxAge: 60, staleWhileRevalidate: 30 });
    expect(headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=30');
  });
});

describe('isNotModified', () => {
  const etag = '"abc123"';

  it('is false when the client sent no If-None-Match', () => {
    expect(isNotModified(undefined, etag)).toBe(false);
  });

  it('is true when the client sent exactly the current ETag', () => {
    expect(isNotModified('"abc123"', etag)).toBe(true);
  });

  it('is false when the client sent a different ETag', () => {
    expect(isNotModified('"xyz789"', etag)).toBe(false);
  });

  it('matches within a comma-separated list of candidates, per If-None-Match syntax', () => {
    expect(isNotModified('"xyz789", "abc123"', etag)).toBe(true);
  });

  it('tolerates whitespace around list entries', () => {
    expect(isNotModified('"xyz789" ,  "abc123" ', etag)).toBe(true);
  });
});
