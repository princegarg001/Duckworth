/**
 * OpenTelemetry bootstrap.
 *
 * **Import this first, before anything else in the process.** Auto-instrumentation
 * works by monkey-patching module exports as they are required; anything that
 * was already imported keeps its unpatched reference and is invisible to
 * tracing. `apps/api/src/server.ts` imports it on its first line for exactly
 * this reason.
 *
 * Tracing is opt-in via `OTEL_ENABLED`. Off, this module does nothing and costs
 * one import — the API must run with no collector present, because it usually
 * will (locally, in CI, and in any reviewer's `docker compose up`).
 */

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export interface TracingOptions {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly endpoint?: string | undefined;
}

export function startTracing(opts: TracingOptions): void {
  if (!opts.enabled || sdk !== null) return;

  sdk = new NodeSDK({
    resource: {
      attributes: {
        [ATTR_SERVICE_NAME]: opts.serviceName,
        [ATTR_SERVICE_VERSION]: opts.serviceVersion,
      },
    } as never,
    traceExporter: new OTLPTraceExporter(
      opts.endpoint === undefined ? {} : { url: `${opts.endpoint}/v1/traces` },
    ),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are pure noise in a service that reads files only
        // at boot, and they dominate a trace if left on.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Health and metrics scrapes would otherwise be most of the traffic.
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return url.startsWith('/health') || url.startsWith('/metrics');
          },
        },
      }),
    ],
  });

  sdk.start();
}

export async function stopTracing(): Promise<void> {
  if (sdk === null) return;
  await sdk.shutdown();
  sdk = null;
}
