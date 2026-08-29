# Runbook

Operational procedures. Written for whoever is on call at 3am, which may be you
in six months.

---

## Reading `/health/ready`

The single most useful URL. It reports whether the service can serve *and*
whether the data can be trusted.

```bash
curl -s https://<host>/health/ready | jq
```

| Check | `down` means | `degraded` means |
|---|---|---|
| `database` | Postgres unreachable. The service is out. | — |
| `cache` | — | Redis is unreachable. **Not an outage** — the API serves uncached. Latency rises; correctness does not change. |
| `migrations` | No migrations applied. Almost always a deploy that skipped the migration job. | — |
| `martFreshness` | Cannot read `core.mart_refresh`. | Oldest mart is over 24h old. Data is stale but correct. |
| `dataQuality` | — | One or more of the 23 checks is failing. **Investigate before trusting any number the API returns.** |

The endpoint returns 503 only when something is `down`. `degraded` still returns
200, because a degraded service that is serving correct data should stay in the
load balancer.

---

## The data-quality checks are failing

This is the alert that matters most, because the API will still happily return
numbers.

```bash
# What is failing, and since when
psql "$DATABASE_URL" -c "
  SELECT DISTINCT ON (check_name)
         check_name, status, violation_count, ran_at,
         left(sample_violations, 300) AS sample
  FROM quality.check_result
  ORDER BY check_name, ran_at DESC;
"
```

Every check returns the *offending rows*, so `sample_violations` usually
contains the answer. Re-run them on demand:

```bash
make verify     # or: pnpm --filter @ipl/ingest start verify --json
```

**If `points_table_matches_published_standings` fails**, the derived table has
diverged from the official standings. Almost always one of:

- a match's `stage` was mis-parsed, pulling a playoff into the league table;
- a dismissal's `counts_as_wicket_lost` is wrong, so the all-out rule fired (or
  did not) when it should not have (or should have);
- deliveries were partially loaded for some innings.

Compare directly:

```sql
SELECT p.team_id, p.points, s.points, p.net_run_rate, s.net_run_rate,
       p.balls_for, s.balls_for
FROM marts.points_table p
JOIN quality.source_standing s USING (season_id, team_id)
ORDER BY p.position;
```

**A `warn` is not a failure.** `vendor_extras_components_self_consistent` warns
on one innings where the *source's* extras components disagree with its own
total. Expected, documented, and correct to leave warning.

---

## Re-ingesting

The ingest is idempotent. A second run over identical bytes is refused by the
database, not by a flag someone might forget:

```bash
make ingest              # no-op if this exact dataset is already loaded
```

```bash
# Force a reload of the same bytes (after fixing a transform bug)
pnpm --filter @ipl/ingest start load --source ./data/raw --force
pnpm --filter @ipl/ingest start refresh
pnpm --filter @ipl/ingest start verify
```

The idempotency key is a SHA-256 over every source file's content, keyed by
relative path — so it ignores directory ordering and mtimes but changes if any
byte changes. It is `UNIQUE` on `core.ingest_run`.

**Ingest history:**

```sql
SELECT id, source_label, status, files_read, rows_loaded, duration_ms,
       git_sha, started_at, error
FROM core.ingest_run ORDER BY started_at DESC LIMIT 10;
```

---

## Refreshing the materialised views

```bash
pnpm --filter @ipl/ingest start refresh
```

or, against a running API:

```bash
curl -X POST https://<host>/internal/refresh-marts \
  -H "x-internal-token: $INTERNAL_API_TOKEN"
```

Returns **202** and refreshes in the background — a concurrent refresh of all
ten views takes longer than any sensible HTTP timeout.

Two things to know:

**Refresh is `CONCURRENTLY`.** A plain `REFRESH MATERIALIZED VIEW` takes an
`ACCESS EXCLUSIVE` lock for its whole duration, so every read of that view
blocks. On a live site that is an outage, not a refresh. Concurrent refresh
requires a unique index, which is why every view in `packages/db/marts` declares
one.

**A refresh bumps the cache version**, which invalidates every cached aggregate
atomically — Redis keys are namespaced by that integer. No key scanning, no
window where a stale derivation is served.

Dependency order matters: `innings_summary` and the innings cards refresh before
the season rollups and `points_table`, which read them.

---

## Deploys

### Normal deploy

CD is gated. In order:

1. Migration job runs to completion (this also re-runs the 23 checks).
2. New API revision deploys at **0% traffic**.
3. The revision is smoke-tested directly — readiness must be `ok`, and the
   points table must still read `+0.316` for GT.
4. 10% of traffic shifts; error rate is watched for 60 seconds.
5. Promote to 100%.
6. Web deploys.

Any failure rolls traffic back to the previous revision.

### Rolling back

```bash
# Cloud Run — traffic only, no rebuild
gcloud run services update-traffic ipl-platform-api \
  --region "$REGION" --to-revisions PREVIOUS=100

# Kubernetes
helm rollback ipl <previous-revision>
```

**Rolling back code does not roll back a migration.** This is why migrations are
expand-then-contract (below). If a migration must be reversed, restore from the
Cloud SQL point-in-time recovery window rather than hand-writing a down
migration under pressure.

### Migrations: expand, then contract

Never destructive in the same release that starts using the change. Renaming
`x` to `y`:

| Release | Action | Safe to roll back? |
|---|---|---|
| 1 | Add `y`, nullable. Write to both. | Yes — old code ignores `y` |
| 2 | Backfill `y`. Switch reads to `y`. | Yes — `x` still populated |
| 3 | Stop writing `x`. | Yes |
| 4 | Drop `x`. | **No** — this is the point of no return |

Each step is independently deployable and each of the first three is
independently reversible. A single-release rename is not.

---

## Common failures

### API crash-loops on start

Check the logs for an exit code of **78** (`EX_CONFIG`). Config is parsed at
boot and the process exits on anything invalid — every problem is printed at
once, and values are never echoed:

```
Invalid environment configuration:
  - INTERNAL_API_TOKEN: required in production — /internal routes must be guarded
  - CORS_ORIGINS: may not be "*" in production
```

Deliberate. A service that starts half-configured turns a deploy-time failure
into a user-facing one.

### API starts but every request 500s

Almost always the database. Check `/health/ready` first — `database: down` with
`ECONNREFUSED` means the connection string is wrong, the instance is down, or
(on Cloud Run) the VPC connector is missing.

### Requests time out at ~10 seconds

That is `statement_timeout` on the connection doing its job. Find the query:

```sql
SELECT pid, now() - query_start AS duration, state, left(query, 200)
FROM pg_stat_activity
WHERE state <> 'idle' AND now() - query_start > interval '2s'
ORDER BY duration DESC;
```

The timeout is a backstop for the query nobody remembered to bound. Raising it
is not the fix.

### Latency rises but errors do not

Check the cache. `cache: degraded` on readiness means Redis is unreachable and
every aggregate is being recomputed. The service is correct and slow, which is
the intended failure mode — the API must never fail because its cache did.

### A pod is killed during a deploy

Check that `terminationGracePeriodSeconds` (30s) still exceeds
`SHUTDOWN_TIMEOUT_MS` (10–15s). If the drain does not finish before the kubelet
escalates to `SIGKILL`, in-flight requests become 502s on every release.

---

## Debugging a distroless container

The API image has no shell, which is the point. Attach an ephemeral container
sharing its process namespace instead:

```bash
kubectl debug -it <pod> --image=busybox:1.37 --target=api -- sh
```

On Cloud Run, use the revision's logs and the `traceId` from the error body —
every problem response carries one, and it is on every log line for that
request:

```bash
gcloud logging read 'jsonPayload.traceId="<id>"' --limit 50
```

---

## Useful queries

```sql
-- Is the data complete?
SELECT (SELECT count(*) FROM core.match)     AS matches,     -- expect 74
       (SELECT count(*) FROM core.innings)   AS innings,     -- expect 148
       (SELECT count(*) FROM core.delivery)  AS deliveries,  -- expect 17912
       (SELECT count(*) FROM core.dismissal) AS dismissals;  -- expect 912

-- Mart freshness and cache version
SELECT mart_name, refreshed_at, row_count, duration_ms, version
FROM core.mart_refresh ORDER BY refreshed_at;

-- Slowest recent quality checks
SELECT check_name, duration_ms, status FROM quality.check_result
WHERE ran_at > now() - interval '1 day'
ORDER BY duration_ms DESC LIMIT 10;

-- Index usage: is anything unused?
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE schemaname IN ('core','marts')
ORDER BY idx_scan ASC LIMIT 20;
```

---

## Alerts worth configuring

| Alert | Condition | Why |
|---|---|---|
| Error rate | `http_requests_total{status=~"5.."}` > 2% for 5m | Users are seeing failures |
| Latency | p99 `http_request_duration_seconds` > 1s for 10m | Degrading before it breaks |
| Data quality | `data_quality_check_status{status="fail"} > 0` | **The numbers are wrong.** Highest priority — the API is still serving |
| Mart staleness | `mart_staleness_seconds` > 86400 | The refresh job stopped |
| Pool saturation | `db_pool_connections{state="in_use"}` / max > 0.8 | Next traffic increase queues |

The data-quality alert is the one that does not exist in most systems and is the
one that matters most here: everything else tells you the service is unhealthy,
and that one tells you it is healthy and lying.
