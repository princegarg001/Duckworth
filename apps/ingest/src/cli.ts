#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { IngestEnvSchema, loadEnv } from '@ipl/config';
import { createDb, runMigrations, type DbHandle } from '@ipl/db';

import { loadBundle } from './load.js';
import { refreshMarts } from './marts.js';
import { assertBundleComplete, IGNORED_DIRS, loadSource } from './source/reader.js';
import { runChecks } from './verify.js';

/**
 * The ingest CLI.
 *
 *   ingest migrate                 apply schema migrations and (re)define marts
 *   ingest load    [--force]       load the dataset; a no-op if already loaded
 *   ingest refresh                 refresh the materialised views
 *   ingest verify                  run the data-quality contract
 *   ingest all     [--force]       migrate → load → refresh → verify
 *
 * `all` is what CI and the container entrypoint run. It exits non-zero if any
 * quality check fails, so a bad load can never quietly become a live database.
 */

const HELP = `
ipl ingest — load the IPL dataset into PostgreSQL

Usage:
  ingest <command> [options]

Commands:
  migrate            Apply schema migrations and rebuild materialised views
  load               Load the dataset into core/quality (idempotent)
  refresh            Refresh materialised views concurrently
  verify             Run data-quality checks; exits non-zero on any failure
  all                migrate -> load -> refresh -> verify

Options:
  --source <dir>     Dataset root (default: $SOURCE_DIR or ./data/raw)
  --label <name>     Ingest run label (default: "bootstrap")
  --force            Re-load even if this exact dataset was already ingested
  --json             Emit machine-readable output
  -h, --help         Show this message
`;

interface Args {
  command: string;
  source?: string;
  label: string;
  force: boolean;
  json: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: argv[0] ?? 'help', label: 'bootstrap', force: false, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--label') args.label = argv[++i] ?? 'bootstrap';
    else if (a === '--force') args.force = true;
    else if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') args.command = 'help';
    else if (a !== undefined && a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const log = (msg: string) => process.stdout.write(`${msg}\n`);
const ms = (n: number) => `${n.toLocaleString()}ms`;

/**
 * Find the root directory of the dataset.
 *
 * The zip expands to a single top-level directory, so `--source ./data/raw`
 * usually needs one more hop. Rather than make the caller know that, look for
 * the marker directory that every valid bundle has.
 */
async function resolveSourceRoot(dir: string): Promise<string> {
  const hasMarker = async (d: string) => {
    try {
      return (await stat(join(d, 'match_innings_commentary'))).isDirectory();
    } catch {
      return false;
    }
  };
  if (await hasMarker(dir)) return dir;
  for (const entry of await readdir(dir)) {
    const candidate = join(dir, entry);
    if (await hasMarker(candidate)) return candidate;
  }
  throw new Error(
    `No dataset found under ${dir} — expected a directory containing 'match_innings_commentary/'.`,
  );
}

async function cmdLoad(handle: DbHandle, args: Args, sourceDir: string): Promise<number> {
  const started = Date.now();
  const root = await resolveSourceRoot(sourceDir);
  log(`▸ reading ${root}`);

  const bundle = await loadSource(root);
  assertBundleComplete(bundle);
  log(`  ${bundle.fileCount} files, sha256 ${bundle.contentSha256.slice(0, 12)}…`);
  for (const { dir, reason } of IGNORED_DIRS) {
    log(`  · skipped ${dir}: ${reason}`);
  }

  // Idempotency gate: the digest is UNIQUE in core.ingest_run, so a repeat run
  // over identical bytes is refused by the database rather than by a flag.
  const existing = await handle.sql<{ id: string; status: string }[]>`
    select id, status from core.ingest_run
    where source_label = ${args.label} and content_sha256 = ${bundle.contentSha256}
      and status = 'succeeded'
  `;
  if (existing.length > 0 && !args.force) {
    log(`✓ already ingested (run #${existing[0]!.id}) — nothing to do`);
    log(`  pass --force to reload the same bytes`);
    return 0;
  }

  const [run] = await handle.sql<{ id: string }[]>`
    insert into core.ingest_run (source_label, content_sha256, status, files_read, git_sha)
    values (${args.label}, ${bundle.contentSha256}, 'running', ${bundle.fileCount}, ${gitSha()})
    on conflict (source_label, content_sha256) do update
      set status = 'running', started_at = now(), finished_at = null, error = null
    returning id
  `;
  const runId = Number(run!.id);

  try {
    const stats = await loadBundle(handle, bundle);
    const durationMs = Date.now() - started;
    const rows = stats.deliveries + stats.dismissals + stats.matches + stats.players;

    await handle.sql`
      update core.ingest_run
      set status = 'succeeded', finished_at = now(), rows_loaded = ${rows},
          duration_ms = ${durationMs}
      where id = ${runId}
    `;

    log('');
    log(`  seasons     ${stats.seasons}`);
    log(`  teams       ${stats.teams}`);
    log(`  venues      ${stats.venues}`);
    log(`  players     ${stats.players}`);
    log(`  officials   ${stats.officials}`);
    log(`  matches     ${stats.matches}`);
    log(`  innings     ${stats.innings}`);
    log(`  deliveries  ${stats.deliveries.toLocaleString()}`);
    log(`  dismissals  ${stats.dismissals}`);
    if (stats.componentRepairs.length > 0) {
      log('');
      log(`  ! repaired ${stats.componentRepairs.length} deliveries whose run components did not`);
      log('    sum to the reported total; the unattributed runs were credited as byes.');
      for (const m of stats.componentRepairs) {
        log(
          `      event ${m.sourceEventId}: ${m.componentSum} -> ${m.reportedTotal} (+${m.residual} byes) "${m.commentary ?? ''}"`,
        );
      }
    }
    if (stats.resultDisagreements.length > 0) {
      log('');
      log(`  ! ${stats.resultDisagreements.length} derived results disagree with the source note:`);
      for (const d of stats.resultDisagreements) log(`      ${d}`);
    }
    log('');
    log(
      `✓ loaded in ${ms(durationMs)} (${Math.round(stats.deliveries / (durationMs / 1000))} deliveries/s)`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await handle.sql`
      update core.ingest_run
      set status = 'failed', finished_at = now(), error = ${message}
      where id = ${runId}
    `;
    throw err;
  }
}

async function cmdVerify(handle: DbHandle, args: Args): Promise<number> {
  const result = await runChecks(handle);
  if (args.json) {
    log(JSON.stringify(result, null, 2));
  } else {
    for (const o of result.outcomes) {
      const mark = o.status === 'pass' ? '✓' : o.status === 'warn' ? '!' : '✗';
      const detail = o.status === 'pass' ? '' : ` — ${o.violationCount} row(s)`;
      log(`  ${mark} ${o.name}${detail}`);
      if (o.status !== 'pass') {
        for (const row of o.sample) log(`      ${JSON.stringify(row)}`);
      }
    }
    log('');
    const warn = result.warned > 0 ? `, ${result.warned} warning(s)` : '';
    log(
      result.failed === 0
        ? `✓ ${result.passed} data-quality checks passed${warn}`
        : `✗ ${result.failed} of ${result.outcomes.length} checks FAILED${warn}`,
    );
  }
  return result.failed === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    log(HELP.trim());
    return 0;
  }

  const env = loadEnv(IngestEnvSchema);
  const sourceDir = args.source ?? env.SOURCE_DIR;
  const handle = createDb({
    url: env.DATABASE_URL,
    max: 4,
    // Ingest runs long, single-purpose statements; the API's 10s ceiling would
    // abort a mart refresh partway through.
    statementTimeoutMs: 300_000,
    ssl: env.DATABASE_SSL,
  });

  try {
    switch (args.command) {
      case 'migrate': {
        const started = Date.now();
        await runMigrations(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
        log(`✓ migrations and marts applied in ${ms(Date.now() - started)}`);
        return 0;
      }
      case 'load':
        return await cmdLoad(handle, args, sourceDir);
      case 'refresh': {
        const refreshed = await refreshMarts(handle);
        for (const r of refreshed) log(`  ✓ ${r.name} — ${r.rowCount} rows in ${ms(r.durationMs)}`);
        return 0;
      }
      case 'verify':
        return await cmdVerify(handle, args);
      case 'all': {
        const started = Date.now();
        await runMigrations(env.DATABASE_URL, { ssl: env.DATABASE_SSL });
        log('✓ schema up to date');
        log('');
        const loadCode = await cmdLoad(handle, args, sourceDir);
        if (loadCode !== 0) return loadCode;
        log('');
        const refreshed = await refreshMarts(handle);
        for (const r of refreshed) log(`  ✓ ${r.name} — ${r.rowCount} rows in ${ms(r.durationMs)}`);
        log('');
        const verifyCode = await cmdVerify(handle, args);
        log('');
        log(`total ${ms(Date.now() - started)}`);
        return verifyCode;
      }
      default:
        process.stderr.write(`Unknown command: ${args.command}\n\n${HELP.trim()}\n`);
        return 2;
    }
  } finally {
    await handle.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`\n✗ ingest failed: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
