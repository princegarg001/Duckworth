import { pino, stdSerializers, stdTimeFunctions, type Logger, type LoggerOptions } from 'pino';

/**
 * Structured logging.
 *
 * JSON in every environment including development. A log line that is
 * greppable locally but structured in production is two formats to reason
 * about, and the one you debug at 3am is the one you never practised on.
 *
 * Redaction is by configuration, not by remembering. The paths below are
 * removed before serialisation, so a header dump in a debug log cannot leak a
 * token even if someone logs the whole request.
 */

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-token"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.secret',
  'DATABASE_URL',
  'REDIS_URL',
];

export interface LoggerConfig {
  readonly level: string;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly gitSha: string;
  readonly pretty?: boolean;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
    base: {
      service: config.serviceName,
      version: config.serviceVersion,
      commit: config.gitSha,
    },
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    timestamp: stdTimeFunctions.isoTime,
    formatters: {
      // `level: "info"` reads better in a log aggregator than `level: 30`.
      level: (label) => ({ level: label }),
    },
    // Trim the noise Fastify includes by default down to what is actually
    // useful in a request log, and keep the correlation id on every line.
    serializers: {
      req(req: {
        method: string;
        url: string;
        headers?: Record<string, unknown>;
        ip?: string;
        id?: string;
      }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.ip,
          userAgent: req.headers?.['user-agent'],
        };
      },
      res(res: { statusCode: number }) {
        return { statusCode: res.statusCode };
      },
      err: stdSerializers.err,
    },
  };

  return pino(options);
}

export type { Logger };
