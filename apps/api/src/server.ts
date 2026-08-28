/**
 * Entrypoint.
 *
 * The tracing bootstrap is imported FIRST, before anything it needs to
 * instrument. OpenTelemetry patches module exports as they load; a module
 * imported earlier keeps its unpatched reference and never appears in a trace.
 */
import { ApiEnvSchema, loadEnv } from '@ipl/config';
import { startTracing, stopTracing } from '@ipl/observability';

const env = loadEnv(ApiEnvSchema);

startTracing({
  enabled: env.OTEL_ENABLED,
  serviceName: env.SERVICE_NAME,
  serviceVersion: env.SERVICE_VERSION,
  endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

const { buildApp } = await import('./app.js');

const ctx = await buildApp(env);

/**
 * Graceful shutdown.
 *
 * On SIGTERM the orchestrator has already begun removing this instance from
 * the load balancer, but in-flight requests are still being served and new
 * ones may arrive for a second or two. The sequence is: stop accepting, drain
 * what is in flight, close the pool, exit 0.
 *
 * Without this, a rolling deploy returns 502s to whoever was mid-request —
 * a small number of users on every single release. `terminationGracePeriodSeconds`
 * in the Helm chart is set above `SHUTDOWN_TIMEOUT_MS` so the kubelet does not
 * SIGKILL us partway through the drain.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  ctx.app.log.info({ signal }, 'shutdown initiated; draining in-flight requests');

  const timer = setTimeout(() => {
    ctx.app.log.error({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, 'drain timed out; forcing exit');
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  timer.unref();

  try {
    await ctx.close();
    await stopTracing();
    clearTimeout(timer);
    ctx.app.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    ctx.app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

// A rejection nobody handled has left the process in an unknown state. Log it
// with full context and let the orchestrator restart us, rather than limping on.
process.on('unhandledRejection', (reason) => {
  ctx.app.log.fatal({ err: reason }, 'unhandled rejection');
  void shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  ctx.app.log.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});

await ctx.app.listen({ host: env.HOST, port: env.PORT });
ctx.app.log.info(
  { url: `http://${env.HOST}:${env.PORT}`, docs: `http://${env.HOST}:${env.PORT}/docs` },
  'api listening',
);
