# IPL Data Platform

Ball-by-ball analytics for IPL 2022, modelled at **one row per delivery** —
17,912 of them — with every served figure derived from those deliveries and
reconciled against the published scorecards by an automated data contract.

The headline claim, and the one the whole design is arranged around:

> The points table this API serves is **computed from raw deliveries** and
> asserted equal to the official IPL 2022 standings — points, wins, losses, run
> and ball subtotals, and net run rate to three decimal places, for all ten
> teams. If any of that drifts, the ingest exits non-zero and the deploy stops.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  74 matches · 148 innings · 17,912 deliveries · 912 dismissals           │
│  247 players · 10 teams · 6 venues · 31 officials                        │
│  23 data-quality checks · 136 tests · ingest in ~15s                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Quickstart

Three commands. The third takes a few minutes on a cold Docker cache.

```bash
git clone <this-repo> && cd ipl-platform
cp .env.example .env
make up
```

| What | Where |
|---|---|
| Web application | http://localhost:3001 |
| API | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| Readiness (returns real detail) | http://localhost:3000/health/ready |

`make up` downloads the dataset, starts Postgres and Redis, runs the migrations,
ingests the season, refreshes the materialised views, runs the 23 quality
checks, and only then starts the API. If a check fails, the API never starts.

This exact sequence runs in CI on every push (`ci.yml` → `compose-smoke`), which
is how the claim above stays true rather than being true on the day it was
written.

<details>
<summary>Running without Docker</summary>

```bash
pnpm install
make db          # postgres + redis only
make ingest      # migrate, load, refresh, verify
pnpm dev         # api on :3000, web on :3001
```
</details>

---

## Architecture

```mermaid
flowchart TB
    subgraph src["Source data"]
        Z["300 JSON files<br/>match_info · scorecards · commentary · standings"]
    end

    subgraph ing["Ingest CLI (one-shot job)"]
        P["parse & coerce"] --> T["transform<br/>delivery_seq · dismissal join"]
        T --> L["load"]
        L --> M["refresh matviews"]
        M --> V["23 quality checks"]
    end

    subgraph db["PostgreSQL 17"]
        CORE["core<br/>normalised truth<br/>1 row per delivery"]
        MARTS["marts<br/>materialised views"]
        QUAL["quality<br/>vendor's own numbers<br/>(asserted against, never served)"]
    end

    subgraph app["Services"]
        API["Fastify API<br/>Zod → OpenAPI 3.1"]
        WEB["Next.js 15<br/>RSC + typed client"]
    end

    Z --> P
    L --> CORE
    L --> QUAL
    CORE --> M
    M --> MARTS
    V -.->|"fails ⇒ exit 1"| ing
    QUAL -.->|reconcile| V
    CORE -.->|reconcile| V
    MARTS --> API
    CORE --> API
    API -->|"openapi.json"| WEB
    WEB --> API

    style QUAL stroke-dasharray: 4 4
```

The unusual piece is the **`quality` schema**. The dataset ships pre-computed
scorecards and an official league table. Serving those would mean publishing
numbers we did not compute; discarding them would mean throwing away the only
independent check available. So they are loaded into a quarantined schema and
used for exactly one thing: proving that what we derived from ball-by-ball
matches what the provider says. Everything the API returns comes from `core`.

**Stack:** Node 22 · TypeScript (strict, `noUncheckedIndexedAccess`) · Fastify 5
· Drizzle · PostgreSQL 17 · Redis · Next.js 15 · Tailwind · Recharts ·
pnpm workspaces + Turborepo · Vitest + Testcontainers · Docker (distroless) ·
GitHub Actions · Helm · Terraform.

---

## The dataset is not what the brief implies

The assignment points at a zip. It is **not** the Cricsheet or Kaggle CSV shape
most IPL work assumes — it is 300 JSON files from a commercial sports API,
covering a single season, in fourteen directories of varying usefulness.

So the first thing built was a profiler, not a schema. Designing from the
actual bytes surfaced eight defects that a schema drawn from the brief would
have silently absorbed:

| # | What the source does | Why it matters | How it is handled |
|---|---|---|---|
| 1 | `result_type` **contradicts its own `status_note` in 49 of 74 matches** | Two thirds of the season would be labelled "won by wickets" when it was won by runs | Field ignored entirely. The margin kind is derived from *which innings the winner batted in* — a side that bats first and wins, wins by runs. Agrees with the prose on 74/74. [`result.ts`](packages/domain/src/result.ts) |
| 2 | `(over, ball)` is **not unique** — 729 collisions | Any sort or pagination by it silently drops or repeats deliveries | Monotonic `delivery_seq`, assigned at transform time, is the ordering key everywhere |
| 3 | `over` is **0-indexed on ball events, 1-indexed on over summaries** | Off-by-one in every phase split | `overend` entries are never read for their over; they are not deliveries at all |
| 4 | `commentaries` mixes **three event kinds** — 17,001 `ball`, 911 `wicket`, 2,837 `overend` | Counting all three inflates the ball count by 16% | Only `ball` and `wicket` are deliveries; a `wicket` *is* one |
| 5 | Of 912 dismissals, **exactly one has no delivery** (a retired hurt) | Modelling dismissals as a column on `delivery` forces that row to be invented, dropped, or misattached | `dismissal` is its own table with a **nullable** `delivery_id`. R Ashwin's retired-out *does* sit on a ball; the two retirements are not the same case |
| 6 | Three deliveries have run components that **don't sum to their total** ("5 no ball") | Extras reconciliation fails by 9 runs | Residual recovered as byes by elimination — not off the bat (batting reconciles), not the no-ball penalty (bowling reconciles) — and reported on every run |
| 7 | Two deliveries list the **striker twice** instead of striker + non-striker | Non-striker unresolvable | Recovered from the previous pair at the crease; the pair only changes on a wicket or between overs |
| 8 | Umpires arrive as **one string** whose third entry contains a comma inside its parenthetical: `"… , Nitin Menon(India, TV)"` | `split(',')` invents a fourth official named `TV)` — 74 times | Split on top-level commas only, then parse role and country. Whitespace-normalised so `Menon(India)` and `Menon (India)` are one person |

Two more the vendor gets wrong that we report rather than absorb: one innings
whose extras components sum to 12 against its own stated total of 11 (the
ball-by-ball agrees with the total), and 11 matches with an empty `win_margin`
recovered from the prose.

Four directories are **deliberately not ingested**, and the ingest prints why on
every run: `match_wagon_wheel` contains no wagon-wheel coordinates despite the
name, `match_live_details` is a stale mid-match snapshot, and the `*_stats`
directories are pre-aggregated leaderboards that are derivable — used as
validation, never stored.

---

## Data model

Grain is **one row per delivery**. Everything else is derived and rebuildable.

```mermaid
erDiagram
    SEASON  ||--o{ MATCH : has
    VENUE   ||--o{ MATCH : hosts
    TEAM    ||--o{ MATCH : plays
    MATCH   ||--|{ INNINGS : "has 2"
    INNINGS ||--|{ DELIVERY : "has ~121"
    INNINGS ||--o| INNINGS_EXTRAS : summarises
    DELIVERY ||--o| DISMISSAL : "may end in"
    DISMISSAL ||--o{ DISMISSAL_FIELDER : "credits 0-3"
    PLAYER  ||--o{ DELIVERY : "bats/bowls"
    PLAYER  ||--o{ DISMISSAL : "is out"
    MATCH   ||--o{ MATCH_OFFICIAL : officiated
    OFFICIAL ||--o{ MATCH_OFFICIAL : officiates
    TEAM    ||--o{ SEASON_SQUAD : fields
    PLAYER  ||--o{ SEASON_SQUAD : "signed to"
```

Four schemas, four different guarantees:

- **`staging`** — raw landed rows, disposable.
- **`core`** — the normalised truth, aggressively constrained.
- **`marts`** — ten materialised views, refreshed `CONCURRENTLY`.
- **`quality`** — the vendor's numbers, asserted against and never served.

Things worth opening the schema for:

**Generated columns.** `extra_runs`, `is_wide`, `is_noball`, `is_legal_ball` and
`counts_as_ball_faced` are computed *by Postgres*, so no code path — ingest,
backfill, or a future writer — can produce a row that disagrees with itself.

**Constraints that make bad rows unstorable.** A winner must be a participant. A
decided match has both a winner and a margin, or neither. A delivery cannot be
both a wide and a no-ball. `credits_bowler` must equal `bowler_id IS NOT NULL`,
so a run-out can never become a bowler's wicket. Only a `retired_hurt` may exist
without a delivery.

**`total_runs` is stored, not generated.** Three deliveries have components that
don't sum; innings totals reconcile on the reported total, so it wins, and a
quality check reports the discrepancy rather than a generated column making
those three rows unstorable.

**No partitioning.** 17,912 delivery rows. Partitioning here would be
resume-driven development. The threshold to revisit is roughly 50M rows, or when
a single-season scan exceeds the p99 budget.

---

## Correctness

This is the part worth checking. 136 tests across three layers, and none of them
assert "returns 200" as the interesting property.

### The data contract — 23 checks, run after every ingest

Every check is a SQL query returning *offending rows*, so a failure arrives with
the rows that caused it. They gate the pipeline: a failure exits non-zero, and in
compose and Helm the API never starts.

```
✓ every_match_has_two_innings          ✓ batting_runs_reconcile
✓ no_over_exceeds_six_legal_balls      ✓ batting_balls_faced_reconcile
✓ innings_within_allotted_overs        ✓ batting_boundaries_reconcile
✓ delivery_sequence_is_contiguous      ✓ bowling_balls_reconcile
✓ striker_is_not_bowler                ✓ bowling_runs_conceded_reconcile
✓ wicket_count_within_innings          ✓ bowling_wickets_reconcile
✓ dismissal_belongs_to_its_innings     ✓ innings_extras_reconcile
✓ bowler_credit_matches_dismissal_kind ✓ innings_runs_reconcile
✓ only_retired_hurt_lacks_a_delivery   ✓ innings_wickets_reconcile
✓ match_winner_played_the_match        ✓ points_table_matches_published_standings
✓ no_orphan_players_in_deliveries      ! vendor_extras_components_self_consistent (warn)
✓ every_match_has_officials
✓ delivery_components_sum_to_total

✓ 23 data-quality checks passed, 1 warning
```

The one warning is deliberate: it flags a defect in the *source*, not in our
derivation, and is `severity: warn` so it stays visible on every run without
blocking a deploy. It starts failing if it ever changes.

### Net run rate, validated against the real table

NRR is where cricket data platforms quietly go wrong. Three rules, all verified:

1. **A side bowled out is charged its full 20-over quota**, not the overs it
   actually faced — otherwise taking the tenth wicket would *hurt* your NRR.
2. **League stage only.** Including the four playoff matches moves all four
   qualifiers and reconciles with nothing.
3. **Retired hurt is not a wicket lost**, so it cannot trigger rule 1 spuriously.

Computed from deliveries, compared to the published standings:

| # | Team | P | W | L | Pts | NRR (ours = official) | Runs for | Overs for |
|---|---|---|---|---|---|---|---|---|
| 1 | GT | 14 | 10 | 4 | 20 | **+0.316** | 2339 | 278.1 |
| 2 | RR | 14 | 9 | 5 | 18 | **+0.298** | 2464 | 279.2 |
| 3 | LSG | 14 | 9 | 5 | 18 | **+0.251** | 2355 | 279.1 |
| 4 | RCB | 14 | 8 | 6 | 16 | **−0.253** | 2268 | 275.4 |
| 5 | DC | 14 | 7 | 7 | 14 | **+0.204** | 2341 | 266.0 |
| 6 | PBKS | 14 | 7 | 7 | 14 | **+0.126** | 2343 | 270.1 |
| 7 | KKR | 14 | 6 | 8 | 12 | **+0.146** | 2223 | 268.1 |
| 8 | SRH | 14 | 6 | 8 | 12 | **−0.379** | 2197 | 261.3 |
| 9 | CSK | 14 | 4 | 10 | 8 | **−0.203** | 2288 | 280.0 |
| 10 | MI | 14 | 4 | 10 | 8 | **−0.506** | 2217 | 273.2 |

Ten of ten, to three decimals — see
[`nrr.test.ts`](packages/domain/src/__tests__/nrr.test.ts) and the
`points_table_matches_published_standings` check.

Independent spot-checks that also come out right: Jos Buttler 863 runs with 4
hundreds (Orange Cap), Yuzvendra Chahal 27 wickets (Purple Cap), Quinton de
Kock's unbeaten 140.

### Tests

| Layer | Tool | What it proves |
|---|---|---|
| **Unit** — 113 tests, 99.5% statements | Vitest | Pure cricket logic: over arithmetic is base-6 (`17.4 + 0.2 = 18.0`), a strike rate off zero balls is `null` not `Infinity`, run-outs never credit a bowler, the umpire parser never invents `TV)` |
| **Integration** — 23 tests | Vitest + **Testcontainers** | Real Postgres 17, real migrations, real ingest run as a subprocess, driven through `app.inject()`. Asserts internally consistent scorecards, cursor pagination that neither repeats nor skips across all 74 matches, ETag/304, and the points table row by row |
| **E2E** | Playwright + axe | Four user flows plus an accessibility pass |

Nothing is mocked in the integration layer, deliberately. A mocked database
cannot tell you that a generated column disagrees with a check constraint, that
a matview refreshes concurrently, or that `(over, ball)` collides.

---

## API

OpenAPI 3.1 at `/openapi.json`, Swagger UI at `/docs`. **26 endpoints.**

```
GET  /health/live                     process only — checks no dependency
GET  /health/ready                    db, cache, migrations, mart age, data quality
GET  /metrics                         Prometheus (RED + USE)

GET  /v1/seasons                          GET  /v1/matches
GET  /v1/seasons/{year}/points-table      GET  /v1/matches/{id}
GET  /v1/seasons/{year}/leaders           GET  /v1/matches/{id}/deliveries
GET  /v1/teams                            GET  /v1/matches/{id}/worm
GET  /v1/teams/{id}                       GET  /v1/matches/{id}/manhattan
GET  /v1/teams/{a}/head-to-head/{b}       GET  /v1/matches/{id}/partnerships
GET  /v1/players                          GET  /v1/venues
GET  /v1/players/{id}                     GET  /v1/venues/{id}/profile
GET  /v1/players/{id}/batting             GET  /v1/analytics/compare
GET  /v1/players/{id}/bowling             GET  /v1/analytics/venues
GET  /v1/players/{id}/phase-splits        GET  /v1/analytics/head-to-head
GET  /v1/players/{id}/form
POST /internal/refresh-marts              service-token guarded
```

### The contract cannot drift

```
Zod schemas ──> OpenAPI 3.1 ──> generated TS types ──> frontend client
 (one source)     (emitted)        (openapi-typescript)   (openapi-fetch)
```

CI regenerates the document and **fails if it differs from the committed copy**,
then regenerates the frontend's types and fails if *those* differ. Remove a
field the UI reads and the **frontend's typecheck** breaks — in the pull request
that removed it, not in production.

### Conventions

**RFC 9457 `application/problem+json`** on every failure, with field-level paths:

```json
{
  "type": "https://ipl-platform.dev/errors/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "Validation failed for the request querystring.",
  "instance": "/v1/matches?limit=500",
  "traceId": "ffe8cbf5-3cde-4934-8939-4714d34fa540",
  "errors": [{ "path": "querystring.limit", "message": "Number must be less than or equal to 100" }]
}
```

A response that fails its *own* schema is reported as 500, not as a client
error — that is our bug, not the caller's.

**Keyset pagination** by default. `OFFSET 40000` makes Postgres walk and discard
40,000 rows. The cursor is opaque base64 and documented as such, which keeps the
sort key an implementation detail. `hasMore` comes from fetching `limit + 1`
rather than a second `COUNT`.

**Undefined rates are `null`, never `Infinity`.** A batter who faced no ball has
no strike rate. `Infinity` sorts to the top of every leaderboard.

**Cache invalidation by version stamp.** Keys are namespaced by the current mart
version (`v7:leaders:2022:runs`), and a refresh bumps that integer — so one
write invalidates every cached aggregate atomically, with no key scanning and no
window where a stale derivation is served.

**Rate metrics carry a qualification floor.** Without one, the best strike rate
of any season belongs to a number eleven who faced two balls.

---

## Frontend

Eight screens, server-rendered, with the charts streaming in behind `<Suspense>`
so the scorecard never waits on them.

| Route | Content |
|---|---|
| `/` | Points table, season leaders, headline stats |
| `/matches` | Filterable, cursor-paginated fixture list |
| `/matches/[id]` | Full scorecard, worm chart, manhattan chart, partnerships, officials |
| `/matches/[id]/deliveries` | Virtualised ball-by-ball |
| `/teams` · `/teams/[id]` | Standings, head-to-head, season results |
| `/players` · `/players/[id]` | Search, career record, phase splits, recent form |
| `/venues` | Scoring and toss profile per ground |

**The URL is the state.** Every filter and cursor lives in the query string, so
a filtered view is shareable and the back button steps through filter changes.

**Loading, empty and error states** are shared components used everywhere, with
a route-segment error boundary offering a real retry and surfacing the API's
`traceId`. In development, append `?__state=empty` (or `loading`/`error`) to see
them on demand.

**Charts** follow a validated method: the form is chosen by the data's job
(cumulative score over time → line; runs per over → bars; three ordered phases →
bars, not a radar). The three-slot categorical palette clears colour-vision
separation gates in both light and dark mode. **No chart has a second y-axis.**
Every chart carries a *Table* toggle rendering the same numbers as a real
`<table>` — the accessibility path, and the relief mechanism for the one series
colour that sits under 3:1 on the light surface.

---

## Operations

**Liveness checks nothing external; readiness checks everything.** If liveness
checked the database, one database blip would fail every replica's probe, kill
them all simultaneously, and turn a recoverable incident into an outage with a
cold start at the end of it.

`/health/ready` returns substance:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "commit": "c1e166a",
  "uptimeSeconds": 8241,
  "checks": {
    "database":      { "status": "ok", "latencyMs": 3 },
    "cache":         { "status": "ok", "latencyMs": 1 },
    "migrations":    { "status": "ok", "applied": 1 },
    "martFreshness": { "status": "ok", "lastRefresh": "2026-08-29T09:12:04Z", "ageSeconds": 312 },
    "dataQuality":   { "status": "ok", "failing": 0, "lastRun": "2026-08-29T09:12:03Z" }
  }
}
```

That last check is the unusual one: readiness reports whether the data is
*trustworthy*, not merely whether the database answers.

**Graceful shutdown.** `SIGTERM` → stop accepting → drain in flight → close the
pool → exit 0. Without it, every rolling deploy returns 502s to whoever was
mid-request. `terminationGracePeriodSeconds` is set above the drain timeout so
the kubelet cannot `SIGKILL` mid-drain.

**Metrics** are labelled by route *template*, never resolved path — one time
series per match id would make the metrics backend the most expensive component
in the system.

---

## CI/CD

Every gate below actually fails the build.

```
lint ─────────── eslint (layering enforced by boundaries) · prettier · tsc
unit ─────────── vitest, 113 tests
contract ─────── regenerate openapi.json → fail on drift → spectral
                 → regenerate client types → fail on drift
integration ──── Testcontainers Postgres · migrations · ingest · 23 tests
security ─────── gitleaks · pnpm audit --audit-level=high
images ───────── buildx → trivy (fail on HIGH/CRITICAL) → SBOM → cosign sign
compose-smoke ── the clean-clone claim, executed: make up, then assert the
                 served points table still reads "GT 20 0.316"
helm ─────────── kind cluster · helm install --wait · rollout · curl
terraform ────── fmt · validate · trivy config scan
codeql ───────── security-extended, weekly
```

Actions are **pinned by SHA**, not by tag. Job permissions are least-privilege.
Superseded runs are cancelled.

**CD uses Workload Identity Federation, not a service-account key.** A key is a
long-lived credential that ends up in a secret store, gets copied to a laptop
"just this once", and is still valid two years after its author left. WIF
exchanges the workflow's OIDC token for a short-lived one scoped to this
repository. There is no key to leak or rotate.

The deploy is gated: migrations run as a **separate blocking job** (which
re-verifies the 23 checks), the new revision goes out at **0% traffic**, gets
smoke-tested directly — including that the points table still matches — canaries
at 10%, and only then promotes. Failure rolls traffic back.

Migrations are **expand-then-contract**: add a column, backfill, switch reads,
drop in a *later* release. A destructive change in the same deploy that starts
using it cannot be rolled back.

---

## Deployment

Being precise about this, because it is the easiest place in a submission to
imply more than is true.

| Component | Status |
|---|---|
| `docker compose up` | **Works**, verified in CI on every push against a clean clone |
| Helm chart | **Validated by applying it** — CI spins a kind cluster, installs, waits for rollout, curls the API |
| Cloud Run deploy | **Scripted and reproducible** (`scripts/deploy-cloudrun.sh`) |
| Terraform | **Written and machine-checked** (`fmt`, `validate`, config scan in CI). **Never applied to a live project** |

<!-- LIVE_URLS -->

### Deploying

Two paths, and the difference between them is deliberate.

**Azure Container Apps — the deployed path.**

```bash
az login
./scripts/deploy-azure.sh
```

Provisions a resource group, an Azure Container Registry, a PostgreSQL
Flexible Server, and a Container Apps environment; builds the images *in* ACR
(so no local Docker and no chance of pushing an arm64 image that will not
run); runs the ingest as a **Container Apps Job** — the direct analogue of the
one-shot job this pipeline was designed around — and only deploys the API once
that job has succeeded.

Container Apps was chosen over App Service because it scales to zero, provides
managed TLS, and has a job primitive. App Service needs a paid tier for Linux
containers and has no equivalent to a run-once job.

**Cloud Run + Neon — the equivalent on GCP.**

```bash
export PROJECT_ID=your-gcp-project
export DATABASE_URL='postgres://…@ep-xxx.neon.tech/ipl?sslmode=require'
./scripts/deploy-cloudrun.sh
```

Roughly five minutes. The script enables the APIs, creates the image
repository, builds `linux/amd64` images, runs the ingest as a Cloud Run Job —
which migrates, loads, refreshes the marts and runs the 23 quality checks,
failing the deploy if any of them fails — deploys the API, smoke-tests it
(including that the points table still reads `+0.316` for GT), then builds the
web image **against the API's real URL** and deploys it.

That last ordering is not incidental: Next inlines `NEXT_PUBLIC_API_URL` at
build time, so the web image cannot be built until Cloud Run has assigned the
API a URL. CORS starts pinned to an unroutable origin and is narrowed to the
web URL once it exists, so there is never a window in which the API is open.

The ingest image **contains the dataset**. A Cloud Run Job has no host
directory to mount, so the 33MB of source JSON is baked in at build time — the
image tag therefore identifies the exact bytes that were loaded, and
`docker run <image> all` is self-contained.

**Terraform — for a real environment.**

```bash
terraform -chdir=infra/terraform/envs/prod apply -var="image_tag=$(git rev-parse --short HEAD)"
```

Provisions a private-IP Cloud SQL instance with PITR, a VPC connector,
Artifact Registry with immutable tags, and both Cloud Run services with secrets
injected from Secret Manager by reference. That is the right shape for
production and costs ~$25/month; the script above is the right shape for a
link on a submission. Both are in the repository, and only one of them has
been run.

**Continuous deployment** is wired in `cd.yml` and needs two repository
secrets (`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`) plus two variables
(`GCP_REGION`, `ARTIFACT_REGISTRY`). It authenticates by Workload Identity
Federation rather than a service-account key, runs migrations as a separate
blocking job, deploys the API at 0% traffic, smoke-tests the revision
directly, canaries at 10%, and only then promotes.

---

## Security

- Config parsed with Zod at boot; the process **exits** on anything invalid,
  including `CORS_ORIGINS="*"` or a missing internal token in production.
- CORS is an explicit allowlist. Helmet, HSTS, body limits, request timeouts,
  Redis-backed rate limiting.
- `statement_timeout` on the connection — a backstop for the query nobody
  remembered to bound, which is by definition the one that takes the site down.
- **Parameterised queries only.** An ESLint rule bans string-concatenated SQL.
  The two places needing a dynamic identifier resolve it through a closed
  lookup keyed by a Zod enum; no client string ever reaches the query text.
- Containers: distroless, non-root, read-only root filesystem, `cap_drop: ALL`,
  Trivy gate on HIGH/CRITICAL, SBOM, cosign keyless signatures.
- Secrets: Secret Manager via ExternalSecrets. Nothing sensitive in any values
  file. gitleaks in CI. Terraform has no `db_password` variable *at all* — the
  credential is generated into Secret Manager and referenced by name.
- Default-deny NetworkPolicy with an explicit egress allowlist.

Threat model and what would change for a multi-tenant deployment:
[`docs/architecture.md`](docs/architecture.md).

---

## Performance

Measured on the development machine (Postgres 17 in Docker, warm cache):

| Operation | Result |
|---|---|
| Full ingest — 300 files → 17,912 deliveries → 10 matviews → 23 checks | **~15 s** end to end |
| Delivery load throughput | ~1,300 rows/s (transactional, per match) |
| Migrations, empty → full schema | 322 ms |
| Mart refresh, all ten, `CONCURRENTLY` | 320 ms total |
| `/v1/seasons/2022/points-table` | ~3 ms |
| `/v1/matches/{id}` full scorecard | ~25 ms, fixed query count |

The scorecard number is the interesting one: a naive implementation issues
1 + 2 + 2×4 = eleven round trips per match and grows with innings. This one
issues six, each covering all innings at once, and is constant in that dimension.

---

## Trade-offs, and what I would do next

- **No partitioning on `core.delivery`** (17,912 rows). It would be
  resume-driven development at this size. Revisit around 50M rows, or when a
  single-season scan exceeds the p99 budget.
- **Marts refresh in batch** after ingest, which is correct for a completed
  season. Live match feeds would want incremental refresh or a CDC → streaming
  aggregate path; the `mart_refresh` version stamp is already the invalidation
  hook that would need.
- **Vendor IDs are primary keys.** They are stable and make re-ingest idempotent
  for free, at the cost of coupling to one provider's id space. A second data
  source would mean surrogate keys and a crosswalk table. See ADR 0003.
- **No authentication.** The dataset is public and the API is read-only. Adding
  it means OIDC plus per-key rate limits; the plugin seams are already in place
  at `apps/api/src/plugins/`.
- **Redis is optional and barely earns its place** at this data size. It is
  wired in to exercise the version-stamped invalidation design, and the API
  runs correctly without it.
- **Single season.** The schema is season-scoped throughout (`season_id` on
  matches, marts keyed by season), so multi-season is an ingest change rather
  than a remodel — but franchise renames across eras (Delhi Daredevils →
  Capitals, Kings XI → Punjab Kings) would then need the alias table this
  dataset did not require.
- **`exactOptionalPropertyTypes` is off.** It mostly fights library typings
  rather than catching real bugs; `strict` and `noUncheckedIndexedAccess` are on.
- **k6 load testing is not included.** The latency numbers above are single-shot
  measurements, not a load profile, and are labelled as such.

---

## Repository layout

```
apps/
  api/         Fastify service — routes → repositories, boundaries lint-enforced
  ingest/      CLI: migrate · load · refresh · verify
  web/         Next.js 15 App Router
packages/
  domain/      Pure cricket logic. No I/O — enforced. 113 tests, 99.5% coverage
  db/          Drizzle schema, migrations, matview SQL, the 23 checks
  contracts/   Zod schemas + generated openapi.json
  observability/ pino, OpenTelemetry, Prometheus
  config/      Zod env parsing that exits on invalid config
infra/
  helm/        Chart proven by a kind job in CI
  terraform/   GCP modules — validated in CI, never applied
  k8s/kind/    CI cluster config
docs/
  architecture.md · data-model.md · runbook.md · adr/
```

## Documentation

- [Architecture and threat model](docs/architecture.md)
- [Data model — the eight source defects in detail](docs/data-model.md)
- [Runbook — reingest, refresh, rollback, what the alerts mean](docs/runbook.md)
- Decision records: [0001 Fastify](docs/adr/0001-fastify-over-nest.md) ·
  [0002 Drizzle](docs/adr/0002-drizzle-over-prisma.md) ·
  [0003 vendor IDs as keys](docs/adr/0003-vendor-ids-as-primary-keys.md) ·
  [0004 deriving the result kind](docs/adr/0004-derive-result-from-innings.md) ·
  [0005 the quality schema](docs/adr/0005-quality-schema.md) ·
  [0006 keyset pagination](docs/adr/0006-keyset-pagination.md)
