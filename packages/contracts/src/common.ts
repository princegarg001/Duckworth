import { z } from 'zod';

/**
 * Shared request/response primitives.
 *
 * These schemas are the single source of truth for the API surface. Fastify
 * validates against them at runtime, `@fastify/swagger` derives the OpenAPI
 * document from the same objects, and the frontend's client is generated from
 * that document. There is no second place where the shape is written down, so
 * there is nothing for the docs to drift from.
 */

/**
 * RFC 9457 `application/problem+json`.
 *
 * One error shape for every failure, forever. `traceId` is echoed from the
 * active span so a user can paste a string into a support channel and have the
 * exact request found.
 */
export const Problem = z.object({
  type: z.string().url().describe('URI identifying the problem type'),
  title: z.string().describe('Short, human-readable summary'),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional().describe('Explanation specific to this occurrence'),
  instance: z.string().optional().describe('URI of the specific occurrence'),
  traceId: z.string().optional().describe('Correlates with logs and traces'),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .describe('Field-level validation failures'),
});
export type Problem = z.infer<typeof Problem>;

/**
 * Keyset pagination.
 *
 * The cursor is an opaque base64 blob and is documented as such: clients must
 * not construct or parse one. That keeps the sort key an implementation detail
 * we can change without breaking anybody.
 */
export const PageMeta = z.object({
  limit: z.number().int(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().describe('Opaque; pass back verbatim to fetch the next page'),
});
export type PageMeta = z.infer<typeof PageMeta>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), page: PageMeta });
}

export function collection<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item) });
}

export const CursorQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const SeasonYear = z.coerce
  .number()
  .int()
  .min(2008)
  .max(2100)
  .describe('Season year, e.g. 2022');

export const IdParam = z.coerce.number().int().positive();

export const MatchStage = z.enum(['league', 'qualifier1', 'eliminator', 'qualifier2', 'final']);

export const Phase = z.enum(['powerplay', 'middle', 'death']);

export const DismissalKind = z.enum([
  'bowled',
  'caught',
  'caught_and_bowled',
  'lbw',
  'stumped',
  'run_out',
  'hit_wicket',
  'retired_out',
  'retired_hurt',
  'obstructing_the_field',
  'hit_the_ball_twice',
  'timed_out',
]);

/**
 * A rate whose value can legitimately be undefined — a strike rate off zero
 * balls, an average with no dismissals. Modelled as nullable rather than
 * omitted so clients get a stable key and never see `Infinity`.
 */
export const Rate = z.number().nullable();
