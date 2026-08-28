import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { DbHandle } from '@ipl/db';

/**
 * The data contract.
 *
 * Each `.sql` file in `packages/db/checks` holds a series of assertions
 * annotated with `-- name:` and `-- description:`. Every assertion is a SELECT
 * that returns *offending* rows, so an empty result is a pass. Writing them
 * this way — rather than as `SELECT count(*) = 0` booleans — means a failure
 * arrives with the rows that caused it attached.
 *
 * Results are persisted to `quality.check_result` so `/health/ready` can report
 * whether the data is trustworthy, not merely whether the database answers.
 */

/**
 * `error` (the default) fails the pipeline. `warn` reports and moves on, and is
 * for assertions about the *source* rather than about our derivation — a known
 * vendor inconsistency should be visible on every run without blocking a
 * deploy, and should start failing only if it changes.
 */
export type CheckSeverity = 'error' | 'warn';

export interface CheckDefinition {
  readonly name: string;
  readonly description: string;
  readonly severity: CheckSeverity;
  readonly sql: string;
  readonly file: string;
}

export interface CheckOutcome extends CheckDefinition {
  readonly status: 'pass' | 'fail' | 'warn';
  readonly violationCount: number;
  readonly sample: unknown[];
  readonly durationMs: number;
}

function checksDir(): string {
  // Resolved through the package entry so it works from source and from dist.
  const require = createRequire(import.meta.url);
  const pkg = require.resolve('@ipl/db/package.json');
  return join(dirname(pkg), 'checks');
}

/** Split an annotated `.sql` file into individual named assertions. */
export function parseChecks(fileName: string, body: string): CheckDefinition[] {
  const out: CheckDefinition[] = [];
  // Statements are separated by a `-- name:` header; everything up to the next
  // header (or EOF) is that check's body.
  const re =
    /^--\s*name:\s*(.+?)\s*$\r?\n^--\s*description:\s*(.+?)\s*$(?:\r?\n^--\s*severity:\s*(warn|error)\s*$)?/gm;
  const headers: {
    name: string;
    description: string;
    severity: CheckSeverity;
    start: number;
    end: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    headers.push({
      name: m[1]!.trim(),
      description: m[2]!.trim(),
      severity: (m[3] as CheckSeverity | undefined) ?? 'error',
      start: m.index,
      end: re.lastIndex,
    });
  }
  for (const [i, h] of headers.entries()) {
    const bodyEnd = headers[i + 1]?.start ?? body.length;
    // Drop comment-only lines so a check's prose cannot leak into its SQL.
    const sql = body
      .slice(h.end, bodyEnd)
      .split(/\r?\n/)
      .filter((line) => !/^\s*--/.test(line))
      .join('\n')
      .trim()
      .replace(/;\s*$/, '');
    if (sql.length > 0) {
      out.push({
        name: h.name,
        description: h.description,
        severity: h.severity,
        sql,
        file: fileName,
      });
    }
  }
  return out;
}

export async function loadChecks(dir = checksDir()): Promise<CheckDefinition[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const out: CheckDefinition[] = [];
  for (const file of files) {
    out.push(...parseChecks(file, await readFile(join(dir, file), 'utf8')));
  }
  return out;
}

export interface VerifyResult {
  readonly outcomes: CheckOutcome[];
  readonly passed: number;
  readonly failed: number;
  readonly warned: number;
}

export async function runChecks(
  handle: DbHandle,
  opts: { ingestRunId?: number | null; persist?: boolean } = {},
): Promise<VerifyResult> {
  const definitions = await loadChecks();
  const outcomes: CheckOutcome[] = [];

  for (const def of definitions) {
    const started = Date.now();
    let rows: unknown[];
    try {
      rows = await handle.sql.unsafe(def.sql);
    } catch (err) {
      // A check that cannot run is a failure, not a skip — most often it means
      // a mart it depends on has not been built.
      rows = [{ error: err instanceof Error ? err.message : String(err) }];
    }
    const durationMs = Date.now() - started;
    outcomes.push({
      ...def,
      status: rows.length === 0 ? 'pass' : def.severity === 'warn' ? 'warn' : 'fail',
      violationCount: rows.length,
      sample: rows.slice(0, 5),
      durationMs,
    });
  }

  if (opts.persist !== false) {
    for (const o of outcomes) {
      await handle.sql`
        insert into quality.check_result
          (ingest_run_id, check_name, description, status, violation_count,
           sample_violations, duration_ms)
        values (${opts.ingestRunId ?? null}, ${o.name}, ${o.description}, ${o.status},
                ${o.violationCount},
                ${o.sample.length > 0 ? JSON.stringify(o.sample) : null}, ${o.durationMs})
      `;
    }
  }

  const failed = outcomes.filter((o) => o.status === 'fail').length;
  const warned = outcomes.filter((o) => o.status === 'warn').length;
  return { outcomes, passed: outcomes.length - failed - warned, failed, warned };
}
