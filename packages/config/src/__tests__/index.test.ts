import { describe, expect, it, vi } from 'vitest';

import { ApiEnvSchema, IngestEnvSchema, loadEnv } from '../index.js';

/**
 * Config parsing is the process's first line of defence: a service that
 * starts half-configured has turned a deploy-time failure into a user-facing
 * one. These tests are the guarantee that the defence actually holds — in
 * particular the two production-only rules, which are easy to get right once
 * and silently break while refactoring the schema around them.
 */

const BASE_ENV = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/ipl',
};

describe('ApiEnvSchema', () => {
  it('accepts a minimal valid development config and fills in defaults', () => {
    const parsed = ApiEnvSchema.parse(BASE_ENV);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3001']);
    expect(parsed.DATABASE_SSL).toBe(false);
  });

  it('coerces numeric and boolean-ish string env vars', () => {
    const parsed = ApiEnvSchema.parse({
      ...BASE_ENV,
      PORT: '8080',
      DATABASE_SSL: 'true',
      RATE_LIMIT_MAX: '500',
    });
    expect(parsed.PORT).toBe(8080);
    expect(parsed.DATABASE_SSL).toBe(true);
    expect(parsed.RATE_LIMIT_MAX).toBe(500);
  });

  it('splits CORS_ORIGINS on commas and trims whitespace', () => {
    const parsed = ApiEnvSchema.parse({
      ...BASE_ENV,
      CORS_ORIGINS: 'https://a.example.com, https://b.example.com ,',
    });
    expect(parsed.CORS_ORIGINS).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('rejects a non-URL DATABASE_URL', () => {
    expect(() => ApiEnvSchema.parse({ ...BASE_ENV, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  describe('production-only rules', () => {
    it('requires INTERNAL_API_TOKEN in production', () => {
      const result = ApiEnvSchema.safeParse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path.join('.'))).toContain('INTERNAL_API_TOKEN');
      }
    });

    it('rejects CORS_ORIGINS="*" in production', () => {
      const result = ApiEnvSchema.safeParse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        INTERNAL_API_TOKEN: 'a'.repeat(16),
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.path.join('.'))).toContain('CORS_ORIGINS');
      }
    });

    it('reports both production violations at once, not just the first', () => {
      const result = ApiEnvSchema.safeParse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        CORS_ORIGINS: '*',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('INTERNAL_API_TOKEN');
        expect(paths).toContain('CORS_ORIGINS');
      }
    });

    it('accepts a fully-specified production config', () => {
      const result = ApiEnvSchema.safeParse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        INTERNAL_API_TOKEN: 'a'.repeat(16),
        CORS_ORIGINS: 'https://app.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('does not apply the production rules outside production', () => {
      // No token, and CORS_ORIGINS defaults — both fine in development/test.
      expect(() => ApiEnvSchema.parse({ ...BASE_ENV, NODE_ENV: 'test' })).not.toThrow();
    });
  });
});

describe('IngestEnvSchema', () => {
  it('defaults SOURCE_DIR and BATCH_SIZE', () => {
    const parsed = IngestEnvSchema.parse(BASE_ENV);
    expect(parsed.SOURCE_DIR).toBe('./data/raw');
    expect(parsed.BATCH_SIZE).toBe(5_000);
  });

  it('rejects a batch size outside the allowed range', () => {
    expect(() => IngestEnvSchema.parse({ ...BASE_ENV, BATCH_SIZE: '50' })).toThrow();
    expect(() => IngestEnvSchema.parse({ ...BASE_ENV, BATCH_SIZE: '100000' })).toThrow();
  });
});

describe('loadEnv', () => {
  it('returns the parsed config on success', () => {
    const parsed = loadEnv(ApiEnvSchema, BASE_ENV as NodeJS.ProcessEnv);
    expect(parsed.DATABASE_URL).toBe(BASE_ENV.DATABASE_URL);
  });

  it('exits with EX_CONFIG (78) and prints every problem, never a value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    loadEnv(ApiEnvSchema, { DATABASE_URL: 'not-a-url', PORT: 'nope' });

    expect(exitSpy).toHaveBeenCalledWith(78);
    const printed = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(printed).toMatch(/DATABASE_URL/);
    expect(printed).toMatch(/PORT/);
    // A config error must never echo the offending value — that is how a
    // secret pasted into the wrong variable ends up in a log.
    expect(printed).not.toContain('not-a-url');

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
