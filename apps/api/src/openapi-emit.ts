/**
 * Emit the OpenAPI document to `packages/contracts/openapi.json`.
 *
 * The committed file is what the frontend's types are generated from, and CI
 * regenerates it and fails the build if it differs from what is committed. That
 * is the whole anti-drift mechanism:
 *
 *   Zod schema changes -> spec changes -> committed spec differs -> CI fails
 *                                      -> regenerated types change
 *                                      -> the WEB app's typecheck fails
 *
 * So removing a field the frontend reads breaks the build in the frontend,
 * during the pull request that removed it, rather than in production.
 *
 * No database is touched: postgres-js connects lazily and `app.ready()` only
 * builds the route table, so a placeholder URL is enough to render the spec.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiEnvSchema } from '@ipl/config';

import { buildApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', '..', '..', 'packages', 'contracts', 'openapi.json');

const env = ApiEnvSchema.parse({
  NODE_ENV: 'development',
  DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://spec:spec@127.0.0.1:1/spec',
  LOG_LEVEL: 'silent',
  METRICS_ENABLED: 'false',
  // Pinned so the document is byte-identical between runs; a version string
  // that moved with the package would make every release a spec diff.
  SERVICE_VERSION: '1.0.0',
});

const ctx = await buildApp(env);
const spec = ctx.app.swagger();

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

await ctx.close();

process.stdout.write(
  `openapi.json written: ${Object.keys((spec as { paths?: object }).paths ?? {}).length} paths\n`,
);
process.exit(0);
