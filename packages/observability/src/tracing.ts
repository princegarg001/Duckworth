import { trace, type Span } from '@opentelemetry/api';

/**
 * Tracing.
 *
 * The SDK is started from `./bootstrap.js`, which must be imported *before*
 * anything it instruments — that is why it is a separate module rather than a
 * function called from `server.ts`. This file holds only the bits application
 * code touches.
 */

const TRACER_NAME = '@ipl/observability';

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * The active trace id, for correlating a log line or an error body with a
 * trace. Returns null when tracing is disabled, so callers can fall back to
 * the request id.
 */
export function activeTraceId(): string | null {
  const span = trace.getActiveSpan();
  if (span === undefined) return null;
  const ctx = span.spanContext();
  return ctx.traceId === '00000000000000000000000000000000' ? null : ctx.traceId;
}

/**
 * Wrap a unit of work in a span, recording exceptions and setting the status.
 *
 * Used to annotate the ingest phases, where the auto-instrumentation sees only
 * a long series of SQL statements and cannot tell "resolving entities" from
 * "loading deliveries".
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: 2, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
