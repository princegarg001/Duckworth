import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type Metric,
} from 'prom-client';

/**
 * RED and USE metrics.
 *
 * RED (Rate, Errors, Duration) for the request path, USE (Utilisation,
 * Saturation, Errors) for the resources behind it. The two together answer
 * "are users having a bad time?" and "why?" without needing a third dashboard.
 *
 * Route labels use the *route template* (`/v1/matches/:id`), never the
 * resolved path. Labelling by resolved path gives one time series per match id
 * and turns a metrics backend into a bill.
 */

export interface Metrics {
  readonly registry: Registry;
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;
  readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  readonly dbPoolConnections: Gauge<'state'>;
  readonly dbQueryDuration: Histogram<'operation'>;
  readonly cacheOperations: Counter<'result'>;
  readonly martStalenessSeconds: Gauge<'mart'>;
  readonly ingestRowsTotal: Counter<'entity'>;
  readonly dataQualityCheckStatus: Gauge<'check' | 'status'>;
}

export function createMetrics(opts: { serviceName: string; defaultMetrics?: boolean }): Metrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service: opts.serviceName });
  if (opts.defaultMetrics !== false) {
    collectDefaultMetrics({ register: registry });
  }

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency',
    labelNames: ['method', 'route', 'status'] as const,
    // Buckets chosen around the p99 budget for this API, not the library
    // default, which puts most of its resolution where nothing happens.
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by outcome',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  const dbPoolConnections = new Gauge({
    name: 'db_pool_connections',
    help: 'Database pool connections by state',
    labelNames: ['state'] as const,
    registers: [registry],
  });

  const dbQueryDuration = new Histogram({
    name: 'db_query_duration_seconds',
    help: 'Database query latency by logical operation',
    labelNames: ['operation'] as const,
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [registry],
  });

  const cacheOperations = new Counter({
    name: 'cache_operations_total',
    help: 'Cache lookups by result',
    labelNames: ['result'] as const,
    registers: [registry],
  });

  const martStalenessSeconds = new Gauge({
    name: 'mart_staleness_seconds',
    help: 'Age of each materialised view since its last refresh',
    labelNames: ['mart'] as const,
    registers: [registry],
  });

  const ingestRowsTotal = new Counter({
    name: 'ingest_rows_total',
    help: 'Rows loaded by the ingest pipeline',
    labelNames: ['entity'] as const,
    registers: [registry],
  });

  const dataQualityCheckStatus = new Gauge({
    name: 'data_quality_check_status',
    help: 'Latest data-quality check outcome (1 = active)',
    labelNames: ['check', 'status'] as const,
    registers: [registry],
  });

  return {
    registry,
    httpRequestDuration,
    httpRequestsTotal,
    dbPoolConnections,
    dbQueryDuration,
    cacheOperations,
    martStalenessSeconds,
    ingestRowsTotal,
    dataQualityCheckStatus,
  };
}

export type { Metric, Registry };
