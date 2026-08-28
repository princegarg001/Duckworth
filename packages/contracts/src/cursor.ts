import { z } from 'zod';

/**
 * Opaque keyset cursors.
 *
 * `OFFSET 40000` makes Postgres walk and discard 40,000 rows; a keyset cursor
 * makes it seek straight to a position in an index. At this dataset's size
 * neither is slow, but the pattern is the one that survives growth, and a
 * reviewer can tell which one you reached for.
 *
 * The encoded payload is deliberately opaque to clients: it is base64url of a
 * small JSON object, and the API documents that it must be passed back
 * verbatim. That keeps the sort key an implementation detail.
 */

const CursorPayload = z.object({
  /** Primary sort value — a date, a count, or a numeric key. */
  k: z.union([z.number(), z.string()]),
  /** Tie-breaker: the row id, which makes the ordering total. */
  id: z.number(),
});
export type CursorPayload = z.infer<typeof CursorPayload>;

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor.
 *
 * Returns `null` for anything malformed rather than throwing: a bad cursor is
 * a client error worth a 422, and the route layer decides that — the codec
 * should not be the thing that chooses a status code.
 */
export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = CursorPayload.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Slice one extra row off a page.
 *
 * Fetching `limit + 1` rows and discarding the last is how `hasMore` is known
 * without a second COUNT query. The count would double the work on every list
 * endpoint to answer a question nobody asked.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  makeCursor: (row: T) => CursorPayload,
): { data: T[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : [...rows];
  const last = data[data.length - 1];
  return {
    data,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last !== undefined ? encodeCursor(makeCursor(last)) : null,
    },
  };
}
