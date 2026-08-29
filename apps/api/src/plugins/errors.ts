import { activeTraceId } from '@ipl/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

/**
 * RFC 9457 error handling.
 *
 * Every failure leaves this service as `application/problem+json` with the same
 * shape. One error contract means a client writes one error path, and a
 * `traceId` in the body means a user can paste a string into a support channel
 * and have the exact request found.
 *
 * Internal failures never leak their message. A 500 says "Internal Server
 * Error" to the caller and logs the stack with the request id; a stack trace in
 * a response body is a gift to whoever is probing you.
 */

const ERROR_BASE = 'https://ipl-platform.dev/errors';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly type: string,
    readonly title: string,
    override readonly message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static notFound(resource: string, id: string | number): ApiError {
    return new ApiError(
      404,
      `${ERROR_BASE}/not-found`,
      'Not Found',
      `No ${resource} with identifier ${id}`,
    );
  }

  static badRequest(detail: string): ApiError {
    return new ApiError(400, `${ERROR_BASE}/bad-request`, 'Bad Request', detail);
  }

  static invalidCursor(): ApiError {
    return new ApiError(
      422,
      `${ERROR_BASE}/invalid-cursor`,
      'Invalid cursor',
      'The cursor could not be decoded. Pass back a nextCursor value verbatim, or omit it to start from the first page.',
    );
  }

  static unauthorized(detail: string): ApiError {
    return new ApiError(401, `${ERROR_BASE}/unauthorized`, 'Unauthorized', detail);
  }

  static serviceUnavailable(detail: string): ApiError {
    return new ApiError(503, `${ERROR_BASE}/service-unavailable`, 'Service Unavailable', detail);
  }
}

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  traceId?: string;
  errors?: { path: string; message: string }[];
}

function send(reply: FastifyReply, body: ProblemBody): FastifyReply {
  return reply.code(body.status).type('application/problem+json').send(body);
}

export const errorHandler = fp(
  (app: FastifyInstance, _opts, done) => {
    app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
      const instance = request.url;
      const traceId = activeTraceId() ?? request.id;

      const asError = error instanceof Error ? error : new Error(String(error));

      // Request validation.
      //
      // The Zod type provider does not surface a bare `ZodError`: it attaches
      // an array of `{ instancePath, message, params.issue }` under
      // `error.validation` and marks the error with a symbol that
      // `hasZodFastifySchemaValidationErrors` recognises. Matching on that,
      // rather than on `instanceof ZodError`, is what turns a generic 400 into
      // a 422 carrying the offending field paths.
      if (hasZodFastifySchemaValidationErrors(error)) {
        request.log.info({ traceId, issues: error.validation.length }, 'request failed validation');
        return send(reply, {
          type: `${ERROR_BASE}/validation-failed`,
          title: 'Validation failed',
          status: 422,
          detail: `Validation failed for the request ${error.validationContext ?? 'input'}.`,
          instance,
          traceId,
          errors: error.validation.map((v) => {
            const issue = v.params?.issue;
            const path =
              issue !== undefined && Array.isArray(issue.path) && issue.path.length > 0
                ? `${error.validationContext ?? 'input'}.${issue.path.join('.')}`
                : v.instancePath.replace(/^\//, '').replace(/\//g, '.') || '(root)';
            return { path, message: issue?.message ?? v.message ?? 'Invalid value' };
          }),
        });
      }

      // A bare ZodError can still reach here from code that parses manually.
      if (error instanceof ZodError) {
        request.log.info({ err: error, traceId }, 'request failed validation');
        return send(reply, {
          type: `${ERROR_BASE}/validation-failed`,
          title: 'Validation failed',
          status: 422,
          detail: 'One or more parameters were invalid.',
          instance,
          traceId,
          errors: error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
          })),
        });
      }

      // A response that fails its own schema is OUR bug, not the caller's, and
      // must never be reported as a client error.
      if (isResponseSerializationError(error)) {
        request.log.error(
          { err: error, traceId, route: error.method, url: error.url },
          'response failed its schema — this is a server bug',
        );
        return send(reply, {
          type: `${ERROR_BASE}/internal`,
          title: 'Internal Server Error',
          status: 500,
          detail: 'The server produced a response that did not match its own schema.',
          instance,
          traceId,
        });
      }

      if (error instanceof ApiError) {
        request.log.info({ traceId, status: error.statusCode }, error.message);
        return send(reply, {
          type: error.type,
          title: error.title,
          status: error.statusCode,
          detail: error.message,
          instance,
          traceId,
        });
      }

      // Fastify's own errors (rate limit, body limit, malformed JSON) carry a
      // usable statusCode; anything 4xx is safe to relay.
      const status = (error as { statusCode?: number } | null)?.statusCode ?? 500;
      if (status >= 400 && status < 500) {
        request.log.info({ traceId, status }, asError.message);
        return send(reply, {
          type: `${ERROR_BASE}/${status === 429 ? 'rate-limited' : 'bad-request'}`,
          title: status === 429 ? 'Too Many Requests' : 'Bad Request',
          status,
          detail: asError.message,
          instance,
          traceId,
        });
      }

      request.log.error({ err: asError, traceId }, 'unhandled error');
      return send(reply, {
        type: `${ERROR_BASE}/internal`,
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred. Quote the traceId when reporting this.',
        instance,
        traceId,
      });
    });

    app.setNotFoundHandler((request, reply) =>
      send(reply, {
        type: `${ERROR_BASE}/not-found`,
        title: 'Not Found',
        status: 404,
        detail: `No route matches ${request.method} ${request.url}`,
        instance: request.url,
        traceId: activeTraceId() ?? request.id,
      }),
    );

    done();
  },
  { name: 'error-handler' },
);
