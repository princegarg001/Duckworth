import createClient from 'openapi-fetch';

import type { paths } from './api-types';

/**
 * The API client.
 *
 * `paths` is generated from `packages/contracts/openapi.json`, which the API
 * itself emits from its Zod schemas. The chain is:
 *
 *   Zod schema -> OpenAPI document -> generated types -> this client
 *
 * Which means **the frontend cannot compile against an endpoint that does not
 * exist**, and removing a field the UI reads fails this app's typecheck during
 * the pull request that removed it. CI regenerates the document and fails on
 * any difference from the committed copy, so the two halves cannot drift.
 */

const baseUrl =
  process.env['NEXT_PUBLIC_API_URL'] ??
  // Inside compose the browser talks to localhost while the server component
  // talks to the service name; both are set explicitly in docker-compose.yml.
  'http://localhost:3000';

export const api = createClient<paths>({ baseUrl });

/** Thrown when the API returns a `problem+json` body. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    override readonly message: string,
    readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

interface ProblemShape {
  title?: string;
  detail?: string;
  status?: number;
  traceId?: string;
}

/**
 * Unwrap an `openapi-fetch` result, turning a problem response into a thrown
 * `ApiProblem`. Server components let this propagate to the nearest
 * `error.tsx`; client components hand it to TanStack Query.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined && result.error !== null) {
    const p = result.error as ProblemShape;
    throw new ApiProblem(
      p.status ?? result.response.status,
      p.title ?? 'Request failed',
      p.detail ?? `The API responded ${result.response.status}.`,
      p.traceId,
    );
  }
  if (result.data === undefined) {
    throw new ApiProblem(result.response.status, 'Empty response', 'The API returned no body.');
  }
  return result.data;
}

/**
 * Server-side fetch options.
 *
 * Match data for a completed season never changes, so it is cached for an
 * hour rather than refetched on every render. `revalidate` rather than
 * `force-cache` so a re-ingest becomes visible without a redeploy.
 */
export const SERVER_CACHE = { next: { revalidate: 3600 } } as const;
